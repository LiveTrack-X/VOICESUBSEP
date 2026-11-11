"""Vocabulary contracts use fake engines; no model downloads or paid requests."""
import pytest
import io
from types import SimpleNamespace

from voicesubsep.app import JobRequest
from voicesubsep import inference
from voicesubsep.analysis_ipc import read_frame, send_frame
from voicesubsep.analysis_worker import run_worker


def job_request(**changes):
    return JobRequest(mediaId="a" * 32, speakerCount=1, audioTrack=0, diarization=False, device="cpu", **changes)


def test_job_accepts_normalized_plain_terms():
    request = job_request(vocabulary=["  젠야타 ", "cafe\u0301", "café"])
    assert request.vocabulary == ["젠야타", "café"]


@pytest.mark.parametrize("terms", [None, "term", [1], [""], ["a\nb"], ["a\r\nb"], ["a\tb"],
                                       ["a\0b"], ["a\x85b"], ["x" * 51], [str(i) for i in range(51)],
                                       [str(i).zfill(50) for i in range(40)]])
def test_job_rejects_invalid_or_unbounded_terms(terms):
    with pytest.raises(ValueError):
        job_request(vocabulary=terms)


def test_groq_byte_limit_is_checked_before_any_job_is_created():
    with pytest.raises(ValueError, match="224"):
        job_request(asrProvider="groq", providerModel="whisper-large-v3", cloudConsent=True,
                    vocabulary=["한" * 50, "글" * 50])


def test_whisper_receives_plain_hotwords_without_rewriting_output(monkeypatch, tmp_path):
    seen = {}
    class Whisper:
        max_length = 448
        hf_tokenizer = SimpleNamespace(encode=lambda *args, **kwargs: SimpleNamespace(ids=[1, 2]))
        def __init__(self, *args, **kwargs):
            pass
        def transcribe(self, *args, **kwargs):
            seen.update(kwargs)
            return iter([SimpleNamespace(start=0, end=1, text="Original transcript", words=[])]), None
    monkeypatch.setattr(inference, "_whisper_class", lambda: Whisper)
    monkeypatch.setattr(inference, "resolve_whisper_model", lambda _: "local")
    monkeypatch.setattr(inference, "SpeechActivityGate", lambda *_: SimpleNamespace(classify=lambda *_: "speech", warnings=lambda: [], close=lambda: None))
    records = inference._transcribe(tmp_path / "a.wav", model_name="tiny", language="ko", device="cpu", duration=1,
                                   progress=lambda *_: None, cancelled=lambda: False, vocabulary=["젠야타", "D.Va"])
    assert seen["hotwords"] == "젠야타, D.Va"
    assert records[0]["text"] == "Original transcript"
    assert seen["word_timestamps"] is True


def test_whisper_rejects_hints_that_engine_would_silently_truncate(monkeypatch, tmp_path):
    class Whisper:
        max_length = 448
        hf_tokenizer = SimpleNamespace(encode=lambda *args, **kwargs: SimpleNamespace(ids=list(range(224))))
        def __init__(self, *args, **kwargs):
            pass
        def transcribe(self, *args, **kwargs):
            pytest.fail("An overlong vocabulary must never enter truncating inference")
    monkeypatch.setattr(inference, "_whisper_class", lambda: Whisper)
    monkeypatch.setattr(inference, "resolve_whisper_model", lambda _: "local")
    with pytest.raises(RuntimeError, match="용어 힌트.*223"):
        inference._transcribe(tmp_path / "a.wav", model_name="tiny", language="ko", device="cpu", duration=1,
                              progress=lambda *_: None, cancelled=lambda: False, vocabulary=["젠야타"])


def test_direct_analysis_rejects_invalid_terms_before_loading_models(monkeypatch, tmp_path):
    monkeypatch.setattr(inference, "_whisper_class", lambda: pytest.fail("Must validate before model load"))
    with pytest.raises(ValueError):
        inference.analyze(tmp_path / "absent.wav", audio_track=0, mode="standard", speaker_count=1, whisper_model="tiny",
                          language="ko", device="cpu", diarization=False, progress=lambda *_: None, cancelled=lambda: False,
                          vocabulary=["bad\nterm"])


@pytest.mark.parametrize("provider,engine,model,supported", [
    ("local", "whisper", None, True), ("local", "qwen", None, True),
    ("groq", "whisper", "whisper-large-v3", True),
    ("xai", "whisper", "grok-voice-transcribe-2.0", True),
    ("gemini", "whisper", "gemini-3.5-transcribe", False),
    ("xai", "whisper", "grok-voice-transcribe-1.0", False),
])
def test_analyze_dispatches_hints_only_to_supported_engines(monkeypatch, tmp_path, provider, engine, model, supported):
    from voicesubsep import cloud_asr, qwen_asr, qwen_model_cache
    source = tmp_path / "source.wav"
    source.touch()
    seen = {}
    def transcribe(*args, **kwargs):
        seen.update(kwargs)
        return [{"start": .1, "end": .5, "text": "Original", "words": [{"start": .1, "end": .5, "text": "Original"}]}]
    monkeypatch.setattr(inference, "_whisper_class", lambda: object)
    monkeypatch.setattr(inference, "_qwen_classes", lambda: object)
    monkeypatch.setattr(inference, "_extract_audio", lambda *_: (1, 1))
    monkeypatch.setattr(inference, "_transcribe", transcribe)
    monkeypatch.setattr(qwen_asr, "transcribe_qwen", transcribe)
    monkeypatch.setattr(cloud_asr, "transcribe_cloud", transcribe)
    monkeypatch.setattr(qwen_model_cache, "resolve_qwen_model", lambda *_: str(tmp_path))
    monkeypatch.setattr(qwen_model_cache, "resolve_qwen_aligner", lambda: str(tmp_path))
    output = inference.analyze(source, audio_track=0, mode="standard", speaker_count=1, whisper_model="tiny",
        language="ko", device="cpu", diarization=False, progress=lambda *_: None, cancelled=lambda: False,
        asr_provider=provider, provider_model=model, cloud_consent=provider != "local", get_provider_key=lambda: "test-key",
        local_asr_engine=engine, vocabulary=["젠야타"])
    assert seen.get("vocabulary", []) == (["젠야타"] if supported else [])
    assert output["captions"][0]["text"] == "Original"
    assert any("용어 힌트를 지원하지" in warning for warning in output["warnings"]) is not supported


def test_unicode_vocabulary_crosses_worker_ipc_without_replacing_recognized_text(tmp_path):
    incoming, outgoing = io.BytesIO(), io.BytesIO()
    terms = ["젠야타", "D.Va", "café"]
    send_frame(incoming, {"type": "start", "mediaPath": str(tmp_path / "source.wav"), "options": {"vocabulary": terms}})
    incoming.seek(0)
    def analyze(path, **kwargs):
        assert kwargs["vocabulary"] == terms
        return {"captions": [{"text": "Original"}], "speakers": [], "duration": 1, "warnings": []}
    run_worker(incoming, outgoing, analyze)
    outgoing.seek(0)
    response = read_frame(outgoing)
    assert response["type"] == "result"
    assert response["result"]["captions"][0]["text"] == "Original"
