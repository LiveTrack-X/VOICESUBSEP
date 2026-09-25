from pathlib import Path
import threading
import wave

import pytest
from fastapi.testclient import TestClient

from voicesubsep import inference as infer, cloud_diarization, qwen_asr, qwen_model_cache
from voicesubsep.app import create_app, JobRequest
from test_api import fake_probe, upload, request_for, result_for, wait_job


@pytest.fixture
def pipeline(tmp_path, monkeypatch):
    source = tmp_path / "source.wav"
    source.write_bytes(b"original untouched")
    calls = []
    words = [{"start": 0.1, "end": 0.7, "text": " Hello."}]
    records = [{"start": 0.1, "end": 0.7, "text": " Hello.", "words": words}]

    def extract(_path, _track, destination, _cancelled):
        with wave.open(str(destination), "wb") as output:
            output.setparams((1, 2, 16000, 0, "NONE", "uncompressed"))
            output.writeframes(b"\0\0" * 16000)
        return 1.0, 1

    monkeypatch.setattr(infer, "_extract_audio", extract)
    for name in ("_whisper_class", "_nemotron_classes", "_qwen_classes"):
        monkeypatch.setattr(infer, name, lambda name=name: calls.append(name))
    monkeypatch.setattr(infer, "_transcribe", lambda *a, **kw: (calls.append("whisper"), records)[1])
    monkeypatch.setattr(infer, "_diarize", lambda *a, **kw: (calls.append("nemotron"), [{"start": 0, "end": 1, "speaker": "native"}])[1])
    monkeypatch.setattr(qwen_model_cache, "resolve_qwen_model", lambda name: (calls.append(name), str(tmp_path))[1])
    monkeypatch.setattr(qwen_model_cache, "resolve_qwen_aligner", lambda: (calls.append("aligner"), str(tmp_path))[1])
    monkeypatch.setattr(qwen_asr, "transcribe_qwen", lambda *a, **kw: (calls.append("qwen"), records)[1])
    monkeypatch.setattr(cloud_diarization, "diarize_cloud", lambda *a, **kw: (calls.append("deepgram"), [{"start": 0, "end": 1, "speaker": "cloud"}])[1])
    options = dict(audio_track=0, mode="standard", speaker_count=1, whisper_model="large-v3", language="ko",
                   device="cpu", diarization=True, progress=lambda *_: None, cancelled=lambda: False)
    return source, options, calls


def test_default_is_whisper_nemotron_without_qwen_download_or_cloud(pipeline):
    source, options, calls = pipeline
    result = infer.analyze(source, **options)
    assert calls == ["_whisper_class", "_nemotron_classes", "nemotron", "whisper"]
    assert result["captions"][0]["speakerId"] == "speaker-1"
    assert source.read_bytes() == b"original untouched"


def test_cloud_speaker_count_does_not_claim_nemotron_eight_channel_limit():
    turns = [{"start": i, "end": i + .8, "speaker": str(i)} for i in range(9)]
    result = infer.build_result([], turns, duration=10, speaker_count=4, mode="standard", diarization_provider="deepgram")
    assert not any("Nemotron" in item for item in result["warnings"])


def test_qwen_opt_in_routes_model_and_aligner_without_loading_whisper(pipeline):
    source, options, calls = pipeline
    result = infer.analyze(source, **options, local_asr_engine="qwen", qwen_model="0.6b")
    assert calls == ["_qwen_classes", "_nemotron_classes", "nemotron", "qwen3-asr-0.6b", "aligner", "qwen"]
    assert result["captions"][0]["text"] == "Hello."


def test_paid_diarization_replaces_only_speaker_engine(pipeline):
    source, options, calls = pipeline
    result = infer.analyze(source, **options, diarization_provider="deepgram", diarization_consent=True,
                           get_diarization_key=lambda: "only-in-memory-key")
    assert calls == ["_whisper_class", "deepgram", "whisper"]
    assert result["captions"][0]["text"] == "Hello."
    assert any("Deepgram" in item for item in result["warnings"])
    assert not any("Nemotron" in item for item in result["warnings"])


@pytest.mark.parametrize("changes", [dict(diarization_consent=False, get_diarization_key=lambda: "key"),
                                     dict(diarization_consent=True)])
def test_cloud_diarization_missing_consent_or_key_fails_before_any_model(pipeline, changes):
    source, options, calls = pipeline
    with pytest.raises(RuntimeError, match="Deepgram"):
        infer.analyze(source, **options, diarization_provider="deepgram", **changes)
    assert calls == []


def test_paid_diarization_cancel_is_job_cancel_not_failure(pipeline, monkeypatch):
    source, options, _ = pipeline
    def cancelled(*args, **kwargs):
        raise cloud_diarization.CloudDiarizationCancelled("cancelled")
    monkeypatch.setattr(cloud_diarization, "diarize_cloud", cancelled)
    with pytest.raises(infer.AnalysisCancelled):
        infer.analyze(source, **options, diarization_provider="deepgram", diarization_consent=True,
                       get_diarization_key=lambda: "session-key")


def test_old_job_defaults_and_invalid_advanced_options():
    default = JobRequest(**request_for("1" * 32))
    assert default.asrProvider == "local" and default.localAsrEngine == "whisper"
    assert default.diarization and default.diarizationProvider == "nemotron"
    assert not default.cloudConsent and not default.diarizationConsent
    for changes in ({"localAsrEngine": "invented"}, {"localAsrEngine": "qwen", "language": "af"},
                    {"diarizationProvider": "deepgram"}, {"diarizationProvider": "deepgram", "diarizationConsent": True, "language": "yue"}):
        with pytest.raises(ValueError):
            JobRequest(**request_for("1" * 32, **changes))


def test_job_queue_binds_diarization_key_and_revocation_blocks_queued_send(tmp_path):
    entered, release = threading.Event(), threading.Event()
    calls = []
    def analyzer(path, **options):
        calls.append(options)
        if len(calls) == 1:
            entered.set()
            assert release.wait(5)
        return result_for()
    app = create_app(data_dir=tmp_path / "data", probe=fake_probe, analyzer=analyzer)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        media = upload(client)
        first = client.post("/api/jobs", json=request_for(media["id"])).json()["id"]
        assert entered.wait(3)
        key = "private-diarization-key-1234"
        assert client.post("/api/provider-credentials", json={"provider": "deepgram", "key": key}).status_code == 200
        second = client.post("/api/jobs", json=request_for(media["id"], diarizationProvider="deepgram", diarizationConsent=True)).json()["id"]
        client.delete("/api/provider-credentials/deepgram")
        release.set()
        assert wait_job(client, first)["status"] == "completed"
        assert wait_job(client, second)["status"] == "failed"
        assert len(calls) == 1  # No send using a revoked or newly registered account.
        assert not app.state.jobs._diarization_keys
        for path in (tmp_path / "data").rglob("*.json"):
            assert key not in path.read_text(encoding="utf-8")
