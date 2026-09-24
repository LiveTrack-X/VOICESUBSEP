from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest

from voicesubsep.app import create_app
from voicesubsep import media, rendering


def metadata(duration=None):
    return {"format": {"duration": duration}, "streams": [{"index": 0, "codec_type": "audio", "channels": 2}]}


def test_positive_metadata_never_triggers_full_decode():
    def forbidden():
        pytest.fail("Normal media must retain the fast metadata-only path")
    assert media.media_info(metadata("3.5"), duration_fallback=forbidden)["duration"] == 3.5
    info = metadata(); info["streams"][0]["duration"] = "2"
    assert media.media_info(info, duration_fallback=forbidden)["duration"] == 2


@pytest.mark.parametrize("duration", [None, "N/A", "0", "-1", "NaN", "inf"])
def test_missing_or_invalid_duration_uses_validated_fallback(duration):
    calls = []
    result = media.media_info(metadata(duration), duration_fallback=lambda: calls.append(True) or 2.1575)
    assert result["duration"] == 2.1575 and calls == [True]


def test_invalid_audio_metadata_is_rejected_before_decoding():
    def forbidden():
        pytest.fail("Invalid media must not start a decoder")
    for streams in [[], [{"index": 0, "codec_type": "video"}], [{"index": 0, "codec_type": "audio", "channels": 0}]]:
        with pytest.raises(ValueError):
            media.media_info({"streams": streams}, duration_fallback=forbidden)


@pytest.mark.parametrize("output", ["", "out_time_us=3000000\nprogress=continue\n", "out_time_us=N/A\nprogress=end\n",
                                     "out_time_us=-1\nprogress=end\n", "out_time_us=0\nprogress=end\n",
                                     "out_time_us=" + "9" * 100 + "\nprogress=end\n"])
def test_decode_requires_completed_progress_with_positive_finite_last_time(output):
    with pytest.raises(ValueError, match="positive duration"):
        media.duration_from_progress(output)
    assert media.duration_from_progress("out_time_us=1000000\nprogress=continue\nout_time_us=2157500\nprogress=end\n") == 2.1575


def test_decode_has_bounded_cpu_time_protocols_and_no_pcm_output(monkeypatch, tmp_path):
    monkeypatch.setattr(media.shutil, "which", lambda name: name)
    calls = []
    def run(command, **options):
        calls.append((command, options))
        return SimpleNamespace(returncode=0, stdout="out_time_us=2000000\nprogress=end\n")
    monkeypatch.setattr(media.subprocess, "run", run)
    source = tmp_path / "original.webm"; source.write_bytes(b"untouched")
    assert media.decoded_duration(source) == 2
    command, options = calls[0]
    assert command[-3:] == ["-f", "null", "-"]
    assert command[command.index("-progress") + 1] == "pipe:1"
    assert command[command.index("-protocol_whitelist") + 1] == "file,pipe"
    assert command[command.index("-i") + 1] == str(source)
    assert all(command[index + 1] == "1" for index, value in enumerate(command) if value in {"-threads", "-filter_threads", "-filter_complex_threads"})
    assert options["timeout"] == 180 and options["shell"] is False
    assert options["stdout"] == subprocess.PIPE and options["stderr"] == subprocess.DEVNULL
    assert source.read_bytes() == b"untouched" and len(list(tmp_path.iterdir())) == 1


@pytest.mark.parametrize("failure", ["timeout", "decode"])
def test_duration_scan_failure_is_reported_without_accepting_partial_time(monkeypatch, failure):
    monkeypatch.setattr(media.shutil, "which", lambda name: name)
    def run(*args, **kwargs):
        if failure == "timeout":
            raise subprocess.TimeoutExpired(args[0], kwargs["timeout"])
        return SimpleNamespace(returncode=1, stdout="out_time_us=2000000\nprogress=end\n")
    monkeypatch.setattr(media.subprocess, "run", run)
    with pytest.raises(ValueError, match="timed out" if failure == "timeout" else "fully decoded"):
        media.decoded_duration(Path("recording.webm"))


@pytest.fixture
def streaming_webm(tmp_path):
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        pytest.skip("FFmpeg/FFprobe are required for generated streaming WebM regression")
    # A nonseekable, live WebM muxer omits duration just like MediaRecorder.
    output = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=330:duration=0.6",
                             "-threads", "1", "-c:a", "libopus", "-f", "webm", "-live", "1", "pipe:1"],
                            check=True, capture_output=True, timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    source = tmp_path / "live-recording.webm"; source.write_bytes(output)
    raw = subprocess.run([ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(source)],
                         check=True, capture_output=True, timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    info = json.loads(raw)
    assert "duration" not in info["format"] and all("duration" not in stream for stream in info["streams"])
    return source


def test_actual_streaming_webm_probe_and_audio_cut_preserve_original(tmp_path, streaming_webm):
    before = hashlib.sha256(streaming_webm.read_bytes()).hexdigest()
    info = media.probe_media(streaming_webm)
    assert info["duration"] == pytest.approx(.6, abs=.03) and not info["hasVideo"]
    output = tmp_path / "cut.wav"
    result = rendering.render_media(streaming_webm, output, keep_ranges=[{"start": .1, "end": .4}], format="wav", audio_track=0,
                                    progress=lambda *_: None, cancelled=lambda: False)
    assert result["duration"] == pytest.approx(.3)
    assert media.probe_media(output)["duration"] == pytest.approx(.3, abs=1 / 48000)
    assert hashlib.sha256(streaming_webm.read_bytes()).hexdigest() == before


def test_streaming_webm_api_upload_and_analysis_preparation_without_models(tmp_path, streaming_webm):
    original = streaming_webm.read_bytes(); seen = []
    def analyzer(path, **options):
        assert path.read_bytes() == original
        seen.append(options["audio_track"])
        return {"captions": [], "speakers": [], "duration": .6, "warnings": []}
    with TestClient(create_app(data_dir=tmp_path / "data", analyzer=analyzer), base_url="http://127.0.0.1:8787") as client:
        response = client.post("/api/media", files={"file": ("live.webm", original, "audio/webm")})
        assert response.status_code == 201, response.text
        uploaded = response.json(); assert uploaded["duration"] == pytest.approx(.6, abs=.03)
        assert client.get(uploaded["url"]).content == original
        job = client.post("/api/jobs", json={"mediaId": uploaded["id"], "audioTrack": 0, "speakerCount": 1, "diarization": False,
                                           "whisperModel": "tiny", "device": "cpu", "language": "auto"})
        assert job.status_code == 202, job.text
        for _ in range(100):
            status = client.get(f"/api/jobs/{job.json()['id']}").json()
            if status["status"] in {"completed", "failed", "cancelled"}: break
            time.sleep(.01)
        assert status["status"] == "completed", status
        assert seen == [0]


def test_real_chromium_mediarecorder_fixture_if_available():
    source = Path(__file__).parents[2] / "tmp" / "qa-mediarecorder-mix.webm"
    if not source.is_file() or not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("Optional local browser QA recording is not present")
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    info = media.probe_media(source)
    assert info["duration"] == pytest.approx(2.16, abs=.03)
    assert info["audioTracks"][0]["channels"] == 2 and not info["hasVideo"]
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
