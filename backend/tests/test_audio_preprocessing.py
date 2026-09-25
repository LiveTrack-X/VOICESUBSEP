from __future__ import annotations

import io
from pathlib import Path
import shutil
import sys
import time
from types import SimpleNamespace
import wave

from fastapi.testclient import TestClient
import pytest

from voicesubsep import vst_api, vst_host
from voicesubsep.app import create_app
from voicesubsep.audio_preprocessing import process_preprocessing


class NoiseCancelled(RuntimeError):
    pass


@pytest.fixture
def noise(monkeypatch):
    calls = []
    def process(source, destination, mix, cancelled, progress):
        calls.append((source.read_bytes(), mix))
        if cancelled():
            raise NoiseCancelled()
        progress("RNNoise", 0)
        shutil.copyfile(source, destination)
        progress("RNNoise", 1)
        return {"engine": "rnnoise", "mix": mix, "warnings": ["synthetic denoise notice"]}
    module = SimpleNamespace(denoise_rnnoise=process, validate_noise_reduction=lambda value: value,
        NoiseReductionCancelled=NoiseCancelled,
        noise_reduction_status=lambda: {"available": True, "engine": "rnnoise", "issue": None})
    monkeypatch.setitem(sys.modules, "voicesubsep.noise_reduction", module)
    return module, calls


def test_noise_runs_before_vst_with_monotonic_progress_and_original_unchanged(tmp_path, monkeypatch, noise):
    source, destination = tmp_path / "source.wav", tmp_path / "processed.wav"
    source.write_bytes(b"original")
    calls, progress = [], []
    def denoise(original, target, mix, _cancelled, report):
        calls.append("noise")
        assert original.read_bytes() == b"original" and mix == .7
        target.write_bytes(b"denoised")
        report("RNNoise", 0); report("RNNoise", 1)
        return {"warnings": ["noise note"]}
    noise[0].denoise_rnnoise = denoise
    def vst(original, target, chain, _cancelled, report):
        calls.append("vst")
        assert original.read_bytes() == b"denoised" and chain == [{"state": "YWJj"}]
        target.write_bytes(b"final")
        report("VST", 0); report("VST", 1)
        return {"warnings": ["vst note"], "bypassed": True}
    monkeypatch.setattr(vst_host, "process_chain", vst)
    result = process_preprocessing(source, destination, [{"state": "YWJj"}], lambda: False,
        lambda _, fraction: progress.append(fraction), {"engine": "rnnoise", "mix": .7})
    assert calls == ["noise", "vst"] and progress == [0, .5, .5, 1]
    assert source.read_bytes() == b"original" and destination.read_bytes() == b"final"
    assert result["warnings"] == ["noise note", "vst note"] and result["bypassed"] is False
    assert not list(tmp_path.glob("noise-preprocess-*"))


def test_combined_pipeline_cannot_overwrite_source_or_hardlink(tmp_path, noise):
    source = tmp_path / "source.wav"
    source.write_bytes(b"original")
    link = tmp_path / "linked.wav"
    link.hardlink_to(source)
    for target in [source, link]:
        with pytest.raises(ValueError, match="preserve"):
            process_preprocessing(source, target, [], lambda: False, lambda *_: None, {"engine": "rnnoise", "mix": .7})
    assert source.read_bytes() == b"original" and noise[1] == []


@pytest.mark.parametrize("error", [NoiseCancelled("cancel"), RuntimeError("noise failure")])
def test_noise_failure_never_runs_vst_or_replaces_existing_output(tmp_path, monkeypatch, noise, error):
    source, destination = tmp_path / "source.wav", tmp_path / "processed.wav"
    source.write_bytes(b"source"); destination.write_bytes(b"existing")
    def fail(*_):
        raise error
    noise[0].denoise_rnnoise = fail
    monkeypatch.setattr(vst_host, "process_chain", lambda *_: pytest.fail("VST must not run after noise failure"))
    expected = vst_host.VSTCancelled if isinstance(error, NoiseCancelled) else RuntimeError
    with pytest.raises(expected):
        process_preprocessing(source, destination, [], lambda: False, lambda *_: None, {"engine": "rnnoise", "mix": .7})
    assert destination.read_bytes() == b"existing" and source.read_bytes() == b"source"
    assert not list(tmp_path.glob("noise-preprocess-*"))


def audio_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setparams((2, 2, 48000, 0, "NONE", "not compressed"))
        audio.writeframes(b"\x10\0\x20\0" * 48000)
    return output.getvalue()


def test_noise_only_analysis_and_preview_do_not_require_pedalboard(tmp_path, monkeypatch, noise):
    monkeypatch.setattr(vst_api, "runtime_status", lambda: {"available": False, "issue": "Pedalboard absent", "version": None})
    monkeypatch.setattr(vst_api, "_extract_preview", lambda _source, _track, _start, _duration, output, _cancelled: output.write_bytes(audio_bytes()))
    monkeypatch.setattr(vst_host, "_run_worker", lambda *_args, **_kwargs: pytest.fail("Noise-only processing must not load a VST runtime"))
    app = create_app(data_dir=tmp_path / "data", probe=lambda _: {"duration": 1., "audioTracks": [{"index": 0, "channels": 2, "label": "audio"}]},
        analyzer=lambda _, **kwargs: {"captions": [], "speakers": [], "duration": 1, "warnings": [], "settings": kwargs["preprocessing"]})
    config = {"chain": [], "noiseReduction": {"engine": "rnnoise", "mix": .7}}
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        status = client.get("/api/vst/status").json()
        assert not status["available"] and status["noiseReduction"]["available"]
        media = client.post("/api/media", files={"file": ("test.wav", audio_bytes(), "audio/wav")}).json()["id"]
        job = client.post("/api/jobs", json={"mediaId": media, "audioTrack": 0, "speakerCount": 1, "preprocessing": config})
        assert job.status_code == 202
        preview = client.post("/api/vst/previews", json={"mediaId": media, "audioTrack": 0, **config})
        assert preview.status_code == 202
        end = time.monotonic() + 3
        while time.monotonic() < end:
            record = client.get(f"/api/vst/previews/{preview.json()['id']}").json()
            if record["status"] in {"failed", "completed"}: break
            time.sleep(.01)
        assert record["status"] == "completed", record
        assert record["report"]["noiseReduction"]["mix"] == .7
        assert record["report"]["inputFrames"] == record["report"]["outputFrames"] == 48000
        assert client.get(record["originalUrl"]).content == client.get(record["processedUrl"]).content
        for bad in [{"engine": "other", "mix": .7}, {"engine": "rnnoise", "mix": 1.1}, {"engine": "rnnoise", "mix": True}]:
            assert client.post("/api/vst/previews", json={"mediaId": media, "audioTrack": 0, **config, "noiseReduction": bad}).status_code == 422
        noise[0].noise_reduction_status = lambda: {"available": False, "engine": "rnnoise", "issue": "Model missing"}
        unavailable = client.post("/api/jobs", json={"mediaId": media, "audioTrack": 0, "speakerCount": 1, "preprocessing": config})
        assert unavailable.status_code == 422 and "Model missing" in unavailable.text
