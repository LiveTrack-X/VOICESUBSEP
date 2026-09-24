from __future__ import annotations

import array
import hashlib
import math
from pathlib import Path
import shutil
import subprocess
import sys
import wave

import pytest

from voicesubsep import rendering
from voicesubsep.media import media_info, probe_media
from voicesubsep.rendering import RenderCancelled, effective_ranges, render_media


@pytest.mark.parametrize("selection,expected", [("original", 60000/1001), ("60",60)])
def test_original_fractional_and_sixty_fps_exports_keep_actual_frame_mapping(tmp_path,selection,expected):
    source, output=tmp_path/"high-rate.mkv",tmp_path/"edited.mp4"
    ffmpeg("-f","lavfi","-i","color=red:s=32x32:r=60000/1001:d=1",
           "-f","lavfi","-i","sine=frequency=440:duration=1","-map","0:v","-map","1:a",
           "-c:v","libx264","-threads:v","2","-c:a","pcm_s16le",source)
    requested=[{"start":.201,"end":.401},{"start":.601,"end":.801}]
    result=render_media(source,output,keep_ranges=requested,format="mp4",audio_track=1,
        progress=lambda *_:None,cancelled=lambda:False,frame_rate=selection)
    assert result["frameRate"]==pytest.approx(expected)
    assert probe_media(output)["frameRate"]==pytest.approx(expected)
    assert result["duration"]==pytest.approx(sum(r["end"]-r["start"] for r in result["keepRanges"]))
    assert abs(probe_media(output)["duration"]-result["duration"])<.08
    actual_rate=probe_media(source)["frameRate"] if selection=="original" else expected
    assert all(abs(r[key]*actual_rate-round(r[key]*actual_rate))<1e-7 for r in result["keepRanges"] for key in ("start","end"))


def ffmpeg(*args):
    binary = shutil.which("ffmpeg")
    if not binary or not shutil.which("ffprobe"):
        pytest.skip("FFmpeg/FFprobe are required for synthetic media integration checks.")
    return subprocess.run(
        [binary, "-v", "error", "-nostdin", "-threads", "2", "-filter_threads", "1",
         "-filter_complex_threads", "1", *map(str, args)], check=True, capture_output=True, timeout=30,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0),
    ).stdout


def tone_file(path, frequencies, second_duration=1):
    samples = array.array("h")
    for frequency in frequencies:
        samples.extend(round(12000 * math.sin(2 * math.pi * frequency * i / 48000))
                       for i in range(round(48000 * second_duration)))
    if sys.byteorder != "little":
        samples.byteswap()
    with wave.open(str(path), "wb") as wav:
        wav.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
        wav.writeframes(samples.tobytes())


def samples(path):
    data = array.array("h")
    data.frombytes(ffmpeg("-i", path, "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "pipe:1"))
    if sys.byteorder != "little":
        data.byteswap()
    return data


def frequency_at(data, start, duration=0.15):
    part = data[round(start * 48000):round((start + duration) * 48000)]
    return sum(a <= 0 < b for a, b in zip(part, part[1:])) / duration


def rms_at(data, start, end):
    part = data[round(start * 48000):round(end * 48000)]
    assert part
    return math.sqrt(sum(value * value for value in part) / len(part))


@pytest.fixture(scope="module")
def colored_media(tmp_path_factory):
    folder = tmp_path_factory.mktemp("render-source")
    first, second, source = folder / "first.wav", folder / "second.wav", folder / "colors.mkv"
    tone_file(first, [440, 660, 880])
    tone_file(second, [110, 220, 330])
    ffmpeg("-f", "lavfi", "-i", "color=red:s=64x48:r=30:d=1",
           "-f", "lavfi", "-i", "color=lime:s=64x48:r=30:d=1",
           "-f", "lavfi", "-i", "color=blue:s=64x48:r=30:d=1", "-i", first, "-i", second,
           "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]",
           "-map", "3:a", "-map", "4:a", "-c:v", "ffv1", "-threads:v", "2", "-c:a", "pcm_s16le", source)
    return source


def render(source, output, ranges=None, **kwargs):
    return render_media(source, output, keep_ranges=ranges or [{"start": 0.2, "end": 0.7}, {"start": 2.1, "end": 2.6}],
                        format=output.suffix[1:], audio_track=kwargs.pop("audio_track", 1),
                        progress=lambda *_: None, cancelled=lambda: False, **kwargs)


@pytest.mark.parametrize("format", ["wav", "mp3", "m4a"])
def test_audio_exports_retained_order_selected_track_and_source_unchanged(tmp_path, colored_media, format):
    before = hashlib.sha256(colored_media.read_bytes()).hexdigest()
    output = tmp_path / f"edited.{format}"
    result = render(colored_media, output)
    assert result["duration"] == pytest.approx(1)
    assert result["keepRanges"] == [{"start": 0.2, "end": 0.7}, {"start": 2.1, "end": 2.6}]
    assert abs(probe_media(output)["duration"] - 1) < 0.08
    decoded = samples(output)
    assert frequency_at(decoded, 0.1) == pytest.approx(440, abs=8)
    assert frequency_at(decoded, 0.65) == pytest.approx(880, abs=8)
    assert hashlib.sha256(colored_media.read_bytes()).hexdigest() == before
    assert not list(tmp_path.glob(".render-*"))


def test_mp4_frames_audio_and_returned_ranges_use_same_grid(tmp_path, colored_media):
    output = tmp_path / "edited.mp4"
    result = render(colored_media, output, [{"start": 0.201, "end": 0.701}, {"start": 2.101, "end": 2.601}])
    assert result["keepRanges"] == [{"start": 0.2, "end": 0.7}, {"start": 2.1, "end": 2.6}]
    assert result["duration"] == pytest.approx(1)
    info = probe_media(output)
    assert info["hasVideo"] and info["frameRate"] == 30
    assert info["duration"] == pytest.approx(1, abs=0.035)
    for at, expected in [(0.2, 0), (0.7, 2)]:
        raw = ffmpeg("-i", output, "-ss", at, "-frames:v", "1", "-vf", "scale=1:1",
                     "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
        assert len(raw) == 3 and raw[expected] > 200
        assert sum(raw) - raw[expected] < 35
    decoded = samples(output)
    assert frequency_at(decoded, 0.1) == pytest.approx(440, abs=8)
    assert frequency_at(decoded, 0.65) == pytest.approx(880, abs=8)


def test_delayed_audio_and_internal_timestamp_gap_remain_on_source_timeline(tmp_path):
    tone, source, output = tmp_path / "tone.wav", tmp_path / "delayed.mkv", tmp_path / "edited.wav"
    tone_file(tone, [440])
    sequence = tmp_path / "source.ffconcat"
    sequence.write_text("ffconcat version 1.0\nfile tone.wav\nduration 1.5\nfile tone.wav\n", encoding="utf-8")
    ffmpeg("-f", "lavfi", "-i", "color=red:s=32x32:r=30:d=3", "-itsoffset", "0.5",
           "-f", "concat", "-safe", "0", "-i", sequence, "-map", "0:v", "-map", "1:a",
           "-c:v", "ffv1", "-threads:v", "2", "-c:a", "copy", source)
    result = render(source, output, [{"start": 0.25, "end": 0.85}, {"start": 1.6, "end": 2.4}])
    assert result["duration"] == pytest.approx(1.4)
    decoded = samples(output)
    # The first cut begins 250 ms before this track starts. Its tone must not
    # be pulled forward by independently resetting that stream's timestamps.
    assert rms_at(decoded, 0.02, 0.2) < 1
    assert rms_at(decoded, 0.3, 0.5) > 5000
    # The concat demuxer left a real 1.5..2.0 s packet timestamp hole.
    assert rms_at(decoded, 0.65, 0.9) < 1
    assert rms_at(decoded, 1.1, 1.3) > 5000


def test_export_can_select_another_source_global_audio_index(tmp_path, colored_media):
    output = tmp_path / "other.wav"
    render(colored_media, output, audio_track=2)
    decoded = samples(output)
    assert frequency_at(decoded, 0.1) == pytest.approx(110, abs=8)
    assert frequency_at(decoded, 0.65) == pytest.approx(330, abs=8)


def test_late_cut_preserves_last_video_frame_and_missing_audio_as_silence(tmp_path):
    source, output = tmp_path / "uneven.mkv", tmp_path / "edited.mp4"
    ffmpeg("-f", "lavfi", "-i", "color=red:s=32x32:r=25:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
           "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-threads:v", "2", "-c:a", "pcm_s16le", source)
    result = render(source, output, [{"start": 4.5, "end": 5}])
    assert result["duration"] == pytest.approx(0.5)
    raw = ffmpeg("-i", output, "-ss", "0.2", "-frames:v", "1", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
    assert len(raw) == 3 and raw[0] > 200
    assert frequency_at(samples(output), 0.1) == pytest.approx(440, abs=8)


def test_missing_audio_at_late_video_cut_is_silence(tmp_path):
    source, output = tmp_path / "uneven.mkv", tmp_path / "edited.mp4"
    ffmpeg("-f", "lavfi", "-i", "color=blue:s=32x32:r=25:d=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
           "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-threads:v", "2", "-c:a", "pcm_s16le", source)
    result = render(source, output, [{"start": 4.5, "end": 5}])
    assert result["duration"] == pytest.approx(0.5)
    assert rms_at(samples(output), 0.1, 0.4) < 1


@pytest.mark.parametrize("ranges", [[], [{"start": 1, "end": 1}], [{"start": -1, "end": 2}],
    [{"start": 0, "end": 4}], [{"start": True, "end": 1}], [{"start": 0, "end": float("nan")}],
    [{"start": 0, "end": float("inf")}], [{"start": 2, "end": 3}, {"start": 0, "end": 1}],
    [{"start": 0, "end": 2}, {"start": 1, "end": 3}], [{"start": 0, "end": 1, "path": "elsewhere"}],
    [{"start": i / 100, "end": (i + 1) / 100} for i in range(201)]])
def test_invalid_original_ranges_are_rejected(ranges):
    with pytest.raises(ValueError):
        effective_ranges(ranges, 3, "wav")


def test_grid_half_up_source_clamp_and_collapsed_range_rejection():
    assert effective_ranges([{"start": 0.05, "end": 1.049}], 1.049, "mp4") == [
        {"start": 2 / 30, "end": 31 / 30}]
    assert effective_ranges([{"start": 0.5 / 48000, "end": 9.5 / 48000}], 1, "wav") == [
        {"start": 1 / 48000, "end": 10 / 48000}]
    with pytest.raises(ValueError, match="shorter"):
        effective_ranges([{"start": 0.001, "end": 0.002}], 3, "mp4")


def test_probe_ignores_album_art_and_reports_real_video_metadata():
    audio = {"index": 1, "codec_type": "audio", "channels": 2}
    cover = {"index": 0, "codec_type": "video", "avg_frame_rate": "0/0", "disposition": {"attached_pic": 1}}
    data = {"format": {"duration": "3"}, "streams": [cover, audio]}
    assert media_info(data)["hasVideo"] is False
    data["streams"].append({"index": 2, "codec_type": "video", "avg_frame_rate": "30000/1001"})
    info = media_info(data)
    assert info["hasVideo"] and info["videoStream"] == 2
    assert info["frameRate"] == pytest.approx(30000 / 1001)


def test_cancellation_terminates_and_reaps_only_owned_child(tmp_path, monkeypatch):
    calls = []
    class Process:
        returncode = None
        def poll(self):
            return self.returncode
        def terminate(self):
            calls.append("terminate")
        def wait(self, timeout):
            calls.append("wait")
            self.returncode = -1
    monkeypatch.setattr(rendering.subprocess, "Popen", lambda *a, **kw: Process())
    checks = iter([False, True])
    with pytest.raises(RenderCancelled):
        rendering._run(["owned-child"], lambda: next(checks), directory=tmp_path)
    assert calls == ["terminate", "wait"]


@pytest.mark.parametrize("failure", ["cancel", "encoder", "duration"])
def test_failure_removes_owned_partial_and_never_commits(tmp_path, monkeypatch, failure):
    source, destination = tmp_path / "source.wav", tmp_path / "edited.wav"
    source.write_bytes(b"unchanged source")
    unrelated = tmp_path / "keep-this.partial"
    unrelated.write_bytes(b"other owner")
    monkeypatch.setattr(rendering.shutil, "which", lambda _: "fake-ffmpeg")
    def run(command, *args, **kwargs):
        Path(command[-1]).write_bytes(b"incomplete")
        if failure == "cancel":
            raise RenderCancelled()
        if failure == "encoder":
            raise RuntimeError("encoder failed")
    monkeypatch.setattr(rendering, "_run", run)
    def probe(path):
        return {"duration": 3 if path == source else 8, "audioTracks": [{"index": 1}], "hasVideo": False}
    with pytest.raises((RenderCancelled, RuntimeError)):
        render(source, destination, probe=probe)
    assert not destination.exists() and not list(tmp_path.glob(".render-*"))
    assert source.read_bytes() == b"unchanged source" and unrelated.read_bytes() == b"other owner"


def test_source_and_existing_output_cannot_be_overwritten(tmp_path):
    source, output = tmp_path / "source.wav", tmp_path / "output.wav"
    source.write_bytes(b"source")
    output.write_bytes(b"previous export")
    for destination in (source, output):
        with pytest.raises(ValueError, match="new file"):
            render(source, destination)
    assert source.read_bytes() == b"source" and output.read_bytes() == b"previous export"
