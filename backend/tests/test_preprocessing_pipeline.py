"""No ASR model loads: verify preprocessing routes, failure boundaries and time."""
from pathlib import Path
import shutil
import subprocess
import sys
import threading
from types import SimpleNamespace
import wave

import pytest

from voicesubsep import inference as infer
from voicesubsep.jobs import JobManager
from voicesubsep.storage import Storage, new_id


class FakeVSTCancelled(RuntimeError):
    pass


@pytest.fixture
def pipeline(monkeypatch, tmp_path):
    source = tmp_path / "source.wav"
    source.write_bytes(b"original file")
    state = SimpleNamespace(source=source, stages=[], paths=[], calls=[], fail=None)
    monkeypatch.setattr(infer, "_whisper_class", lambda: object)
    monkeypatch.setattr(infer, "_nemotron_classes", lambda: (None, None, None))

    def extract(_, selected, destination, cancelled):
        assert selected == 3
        destination.write_bytes(b"original 16k")
        state.paths.append(destination)
        return 60, 2

    def prepare(_, selected, destination, cancelled):
        assert selected == 3
        destination.write_bytes(b"original 48k")
        state.paths.append(destination)
        return 60, 2

    def process(source48, destination48, chain, cancelled, progress):
        state.calls.append("vst")
        assert source48.read_bytes() == b"original 48k"
        assert chain == [{"path": "effect.vst3", "enabled": True, "parameters": {"amount": 0.2}}]
        progress("Processing", 0.0)
        progress("Processing", 0.5)
        progress("Processing", 1.0)
        destination48.write_bytes(b"processed 48k")
        state.paths.append(destination48)
        if state.fail:
            raise state.fail
        return {"warnings": ["Reported latency compensated"], "frames": 2880000}

    def resample(source48, destination16, cancelled):
        assert source48.read_bytes() == b"processed 48k"
        destination16.write_bytes(b"processed 16k")
        state.paths.append(destination16)

    def diarize(path, progress, **kwargs):
        state.diarizer_bytes = path.read_bytes()
        state.calls.append("diarizer")
        progress("Diarize", 0.67)
        progress("Diarize", 0.94)
        return [{"Start": 10, "End": 11, "Speaker": 0}]

    def transcribe(path, progress, **kwargs):
        state.asr_bytes = path.read_bytes()
        state.calls.append("asr")
        assert kwargs["duration"] == 60
        progress("ASR", 0.10)
        progress("ASR", 0.64)
        return [{"start": 10, "end": 11, "text": "hello",
                 "words": [{"start": 10, "end": 11, "text": "hello"}]}]

    monkeypatch.setattr(infer, "_extract_audio", extract)
    monkeypatch.setattr(infer, "prepare_preprocessing_audio", prepare)
    monkeypatch.setattr(infer, "resample_preprocessing_audio", resample)
    monkeypatch.setattr(infer, "_diarize", diarize)
    monkeypatch.setattr(infer, "_transcribe", transcribe)
    monkeypatch.setitem(sys.modules, "voicesubsep.vst_host", SimpleNamespace(
        VSTCancelled=FakeVSTCancelled, process_chain=process,
    ))

    def run(preprocessing=None, diarization=True):
        return infer.analyze(source, audio_track=3, mode="standard", speaker_count=1,
                             whisper_model="tiny", language="auto", device="cpu", diarization=diarization,
                             progress=lambda stage, amount: state.stages.append(amount),
                             cancelled=lambda: False, preprocessing=preprocessing)

    state.run = run
    return state


def chain_config(apply_to="asr"):
    return {"applyTo": apply_to, "chain": [
        {"path": "bypassed.vst3", "enabled": False, "parameters": {}},
        {"path": "effect.vst3", "enabled": True, "parameters": {"amount": 0.2}},
    ]}


@pytest.mark.parametrize("apply_to", ["asr", "both"])
def test_processed_asr_and_explicit_diarization_routing_preserve_source_times(pipeline, apply_to):
    result = pipeline.run(chain_config(apply_to))
    assert pipeline.calls == ["vst", "diarizer", "asr"]
    assert pipeline.asr_bytes == b"processed 16k"
    assert pipeline.diarizer_bytes == (b"processed 16k" if apply_to == "both" else b"original 16k")
    assert result["duration"] == 60
    assert [(caption["start"], caption["end"]) for caption in result["captions"]] == [(10, 11)]
    assert result["captions"][0]["speakerId"] == "speaker-1"
    assert pipeline.source.read_bytes() == b"original file"
    assert not any(path.exists() for path in pipeline.paths)
    assert pipeline.stages == sorted(pipeline.stages) and pipeline.stages[-1] == 1
    assert result["preprocessing"]["applyTo"] == apply_to
    assert "Reported latency compensated" in result["warnings"]
    assert any("처리 전 원본" in item for item in result["warnings"]) == (apply_to == "asr")


@pytest.mark.parametrize("apply_to", ["asr", "both"])
def test_rnnoise_precedes_vst_and_keeps_explicit_diarization_scope(pipeline, monkeypatch, apply_to):
    def denoise(source, destination, mix, cancelled, progress):
        pipeline.calls.append("rnnoise")
        assert mix == .7 and source.read_bytes() == b"original 48k"
        destination.write_bytes(source.read_bytes())
        progress("RNNoise", 0); progress("RNNoise", 1)
        return {"engine": "rnnoise", "mix": mix, "warnings": ["noise notice"]}
    monkeypatch.setitem(sys.modules, "voicesubsep.noise_reduction", SimpleNamespace(
        validate_noise_reduction=lambda value: value, denoise_rnnoise=denoise,
        NoiseReductionCancelled=type("NoiseCancelled", (RuntimeError,), {})))
    settings = {**chain_config(apply_to), "noiseReduction": {"engine": "rnnoise", "mix": .7}}
    result = pipeline.run(settings)
    assert pipeline.calls == ["rnnoise", "vst", "diarizer", "asr"]
    assert pipeline.diarizer_bytes == (b"processed 16k" if apply_to == "both" else b"original 16k")
    assert pipeline.asr_bytes == b"processed 16k"
    assert [(caption["start"], caption["end"]) for caption in result["captions"]] == [(10, 11)]
    assert result["preprocessing"]["report"]["noiseReduction"]["mix"] == .7
    assert "noise notice" in result["warnings"]
    assert pipeline.stages == sorted(pipeline.stages)
    assert pipeline.source.read_bytes() == b"original file"


@pytest.mark.parametrize("preprocessing", [None, {"chain": [], "applyTo": "asr"},
                                          {"chain": [{"enabled": False}], "applyTo": "both"}])
def test_disabled_chain_keeps_original_path_and_no_host_dependency(pipeline, preprocessing):
    result = pipeline.run(preprocessing)
    assert pipeline.calls == ["diarizer", "asr"]
    assert pipeline.diarizer_bytes == pipeline.asr_bytes == b"original 16k"
    assert "preprocessing" not in result
    assert len(pipeline.paths) == 1


def test_transcription_only_uses_processed_audio_without_diarizer(pipeline):
    result = pipeline.run(chain_config("both"), diarization=False)
    assert pipeline.calls == ["vst", "asr"]
    assert pipeline.asr_bytes == b"processed 16k"
    assert any("음성 인식에 적용" in item for item in result["warnings"])


@pytest.mark.parametrize("failure,expected", [(RuntimeError("Plugin failed"), RuntimeError),
                                             (FakeVSTCancelled("Cancelled"), infer.AnalysisCancelled)])
def test_failed_or_cancelled_plugin_never_silently_falls_back_and_cleans_temps(pipeline, failure, expected):
    pipeline.fail = failure
    with pytest.raises(expected):
        pipeline.run(chain_config())
    assert pipeline.calls == ["vst"]
    assert not pipeline.paths[0].parent.exists()
    assert pipeline.source.read_bytes() == b"original file"


@pytest.mark.parametrize("invalid", [[], {"chain": "bad"}, {"chain": [], "applyTo": "export"}, {"chain": [None]}])
def test_invalid_preprocessing_fails_before_extraction(pipeline, invalid):
    with pytest.raises(RuntimeError, match="VST"):
        pipeline.run(invalid)
    assert pipeline.paths == []


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="FFmpeg not installed")
def test_preprocessing_48k_preserves_delayed_selected_track_before_16k_resample(tmp_path):
    source, raw48, model16 = (tmp_path / name for name in ("delayed.mkv", "raw.wav", "model.wav"))
    subprocess.run([
        shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=16x16:r=10:d=1.5",
        "-itsoffset", "0.5", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5:sample_rate=48000",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=1.5",
        "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source),
    ], check=True, capture_output=True)
    duration, channels = infer.prepare_preprocessing_audio(source, 1, raw48)
    assert duration == pytest.approx(1.5, abs=0.02)
    assert channels == 1
    with wave.open(str(raw48), "rb") as wav:
        assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (48000, 2, 2)
        frames = wav.getnframes()
        assert not any(wav.readframes(21600))
        assert any(wav.readframes(14400))
    infer.resample_preprocessing_audio(raw48, model16)
    with wave.open(str(model16), "rb") as wav:
        assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (16000, 1, 2)
        assert wav.getnframes() == pytest.approx(frames / 3, abs=1)
        assert not any(wav.readframes(7200))
        assert any(wav.readframes(4800))
    infer.prepare_preprocessing_audio(source, 2, raw48)
    with wave.open(str(raw48), "rb") as wav:
        assert not any(wav.readframes(wav.getnframes()))
    with pytest.raises(RuntimeError, match="오디오 트랙"):
        infer.prepare_preprocessing_audio(source, 0, raw48)


@pytest.mark.parametrize("preprocessing", [None, chain_config()])
def test_job_forwards_preprocessing_only_when_requested(tmp_path, monkeypatch, preprocessing):
    storage = Storage(tmp_path / "data")
    storage.initialize()
    source = tmp_path / "source.wav"
    source.touch()
    monkeypatch.setattr(storage, "get_media", lambda _: ({}, source))
    seen = {}

    def analyzer(path, **kwargs):
        seen.update(kwargs)
        return {"captions": [], "speakers": [], "duration": 1, "warnings": []}

    manager = JobManager(storage, analyzer)
    request = {"mediaId": new_id(), "audioTrack": 0, "mode": "standard", "speakerCount": 1,
               "whisperModel": "tiny", "language": "auto", "device": "cpu", "diarization": False}
    if preprocessing is not None:
        request["preprocessing"] = preprocessing
    job_id = new_id()
    manager._jobs[job_id] = {"id": job_id, "status": "queued", "request": request}
    manager._cancellations[job_id] = threading.Event()
    manager._run(job_id)
    assert manager.get(job_id)["status"] == "completed"
    assert ("preprocessing" in seen) == (preprocessing is not None)
    if preprocessing is not None:
        assert seen["preprocessing"] == preprocessing


def test_frozen_entry_dispatches_vst_worker_without_starting_server(monkeypatch):
    from voicesubsep import desktop_server

    calls = []
    monkeypatch.setitem(sys.modules, "voicesubsep.vst_worker", SimpleNamespace(main=lambda args: calls.append(args) or 7))
    monkeypatch.setattr(sys, "argv", ["voicesubsep-server.exe", "--vst-worker", "--request", "in.json", "--response", "out.json"])
    monkeypatch.setattr(desktop_server, "create_desktop_app", lambda **_: pytest.fail("Worker must not open server/storage"))
    assert desktop_server.main() == 7
    assert calls == [["--request", "in.json", "--response", "out.json"]]
