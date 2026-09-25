"""Bounded CPU evidence and native Whisper integration, without ASR weights."""

import hashlib
import math
import shutil
from types import SimpleNamespace
import wave

import numpy as np
import pytest

from voicesubsep import inference as infer
from voicesubsep import speech_activity as speech


def wav(tmp_path, samples=None, seconds=4):
    path = tmp_path / "fixture.wav"
    if samples is None:
        samples = np.zeros(round(seconds * speech.SAMPLE_RATE), dtype=np.float32)
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, speech.SAMPLE_RATE, 0, "NONE", "not compressed"))
        output.writeframes((np.asarray(samples) * 32767).astype("<i2").tobytes())
    return path


def fixed_vad(monkeypatch, value=0.001):
    calls = []
    def model(samples):
        calls.append(len(samples))
        return np.full(len(samples) // speech.FRAME_SAMPLES, value, dtype=np.float32)
    monkeypatch.setattr(speech, "_vad_model", lambda: model)
    return calls


def test_only_joint_silence_evidence_excludes_and_keeps_original(tmp_path, monkeypatch):
    path = wav(tmp_path)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    fixed_vad(monkeypatch)
    gate = speech.SpeechActivityGate(path, lambda: False)
    assert gate.classify(1, 2, 0.999) == "silence"  # No text/phrase confidence blacklist.
    assert gate.suppressed == 1 and gate.uncertain == 0
    assert "1.00–2.00초" in gate.warnings()[0]
    gate.close()
    assert gate._wave is None and gate._cache is None
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


@pytest.mark.parametrize("barrier", ["rms", "peak", "vad", "before", "after"])
def test_any_signal_or_nearby_voice_barrier_preserves_text(tmp_path, monkeypatch, barrier):
    samples = np.zeros(64000, dtype=np.float32)
    if barrier == "rms":
        samples[16000:32000] = .008
    elif barrier == "peak":
        samples[24000] = .2  # Even a brief click/laugh peak is retained.
    elif barrier == "before":
        samples[12500:15900] = .1  # Within the 250ms context.
    elif barrier == "after":
        samples[32100:35400] = .1
    fixed_vad(monkeypatch, .1 if barrier == "vad" else .001)
    gate = speech.SpeechActivityGate(wav(tmp_path, samples), lambda: False)
    assert gate.classify(1, 2, .9) == "keep"
    gate.close()


def test_uncertain_is_preserved_and_requires_valid_low_asr_probability(tmp_path, monkeypatch):
    fixed_vad(monkeypatch, .08)
    gate = speech.SpeechActivityGate(wav(tmp_path, np.full(64000, .008)), lambda: False)
    assert gate.classify(1, 2, .293) == "uncertain"
    assert gate.suppressed == 0 and gate.uncertain == 1
    for score in (None, float("nan"), float("inf"), -1, 1.1, True, .5, .95):
        assert gate.classify(1, 2, score) == "keep"
    gate.close()


@pytest.mark.parametrize("start,end", [(0, .04), (-.5, 1), (1, 4.001), (1, 1), (2, 1),
                                       (float("nan"), 2), (True, 2), (1, float("inf")), (0, 31)])
def test_invalid_tiny_or_outside_spans_are_never_declared_silent(tmp_path, monkeypatch, start, end):
    calls = fixed_vad(monkeypatch)
    gate = speech.SpeechActivityGate(wav(tmp_path), lambda: False)
    assert gate.classify(start, end, .1) == "keep"
    assert calls == []
    gate.close()


@pytest.mark.parametrize("failure", ["raise", "nan", "wrong-length", "out-of-range"])
def test_missing_or_invalid_vad_fails_open_once_without_private_error_echo(tmp_path, monkeypatch, failure):
    calls = []
    def model(samples):
        calls.append(1)
        if failure == "raise":
            raise RuntimeError("private source path and transcript must not leak")
        if failure == "wrong-length":
            return np.zeros(1)
        return np.full(len(samples) // 512, math.nan if failure == "nan" else 1.1)
    monkeypatch.setattr(speech, "_vad_model", lambda: model)
    gate = speech.SpeechActivityGate(wav(tmp_path), lambda: False)
    assert gate.classify(1, 2, .1) == "keep"
    assert gate.classify(2, 3, .1) == "keep"
    assert len(calls) == 1 and len(gate.warnings()) == 1
    assert "private" not in gate.warnings()[0]
    assert gate._wave is None


def test_missing_wav_or_wrong_pcm_format_keeps_results(tmp_path, monkeypatch):
    monkeypatch.setattr(speech, "_vad_model", lambda: pytest.fail("No model needed"))
    for path in (tmp_path / "missing.wav", tmp_path / "invalid.wav"):
        if path.name == "invalid.wav":
            with wave.open(str(path), "wb") as output:
                output.setparams((2, 2, 48000, 0, "NONE", "not compressed"))
                output.writeframes(b"\0" * 400)
        gate = speech.SpeechActivityGate(path, lambda: False)
        assert gate.classify(1, 2) == "keep"
        assert len(gate.warnings()) == 1


def test_long_recording_uses_bounded_reusable_pcm_vad_cache(tmp_path, monkeypatch):
    calls = fixed_vad(monkeypatch)
    gate = speech.SpeechActivityGate(wav(tmp_path, seconds=185), lambda: False)
    for start in (1, 2, 59, 60, 89, 130, 131, 181):
        assert gate.classify(start, start + 1) == "silence"
    assert len(calls) == 2
    assert max(calls) <= speech.MAX_CACHE_SAMPLES + speech.FRAME_SAMPLES
    assert len(gate._cache[2]) <= speech.MAX_CACHE_SAMPLES
    gate.close()


def test_cancellation_is_not_swallowed_as_vad_unavailability(tmp_path, monkeypatch):
    cancelled = False
    def model(samples):
        nonlocal cancelled
        cancelled = True
        return np.zeros(len(samples) // 512)
    monkeypatch.setattr(speech, "_vad_model", lambda: model)
    gate = speech.SpeechActivityGate(wav(tmp_path), lambda: cancelled)
    with pytest.raises(speech.SpeechActivityCancelled):
        gate.classify(1, 2)
    assert gate._failed is False
    gate.close()


def fake_whisper(monkeypatch, segments, observed, events):
    class Model:
        def __init__(self, *_args, **_kwargs):
            self.model = SimpleNamespace(unload_model=lambda: events.append("unload"))
        def transcribe(self, _path, **kwargs):
            observed.append(kwargs)
            def generate():
                try:
                    yield from segments
                finally:
                    events.append("close")
            return generate(), None
    monkeypatch.setattr(infer, "_whisper_class", lambda: Model)
    monkeypatch.setattr(infer, "resolve_whisper_model", lambda _: "no-model-download")
    monkeypatch.setattr(infer, "_release_memory", lambda: None)


def segment(start, end, text, words):
    return SimpleNamespace(start=start, end=end, text=text, words=[
        SimpleNamespace(start=s, end=e, word=t, probability=p) for s, e, t, p in words])


def transcribe(path, **kwargs):
    return infer._transcribe(path, model_name="tiny", language="ko", device="cpu", duration=6,
                            progress=lambda *_: None, cancelled=lambda: False, **kwargs)


def test_filtered_words_do_not_leak_via_segment_fallback_or_preview(tmp_path, monkeypatch):
    samples = np.zeros(96000, dtype=np.float32)
    samples[48000:80000] = .1
    fixed_vad(monkeypatch)
    observed, events, previews, warnings = [], [], [], []
    fake_whisper(monkeypatch, [
        segment(.5, 1.5, " 감사합니다", [(.5, 1.5, " 감사합니다", .99)]),
        segment(2, 4, " phantom 감사합니다", [(2, 2.5, " phantom", .3), (3, 4, " 감사합니다", .9)]),
        segment(5.3, 5.7, " fallback phantom", []),
    ], observed, events)
    clips = [0, 2.8, 2.8, 6]
    records = transcribe(wav(tmp_path, samples), clip_timestamps=clips,
                         recognition_preview=previews.append, silence_warnings=warnings)
    assert [r["text"] for r in records] == [" 감사합니다"]
    assert previews == [" 감사합니다"]  # The same phrase with voice remains.
    assert records[0]["words"] == [{"start": 3, "end": 4, "text": " 감사합니다", "probability": .9}]
    assert observed[0]["clip_timestamps"] == clips
    assert observed[0]["vad_filter"] is False
    assert events == ["close", "unload"]
    assert "3개" in warnings[0]


def test_uncertain_reason_survives_attribution_without_exporting_internal_marker(tmp_path, monkeypatch):
    fixed_vad(monkeypatch, .08)
    observed, events, warnings = [], [], []
    fake_whisper(monkeypatch, [segment(1, 2, " retained", [(1, 2, " retained", .293)])], observed, events)
    records = transcribe(wav(tmp_path, np.full(96000, .008)), silence_warnings=warnings)
    result = infer.build_result(records, [{"Start": 0, "End": 6, "Speaker": 0}], duration=6,
                                speaker_count=1, mode="standard")
    cue = result["captions"][0]
    assert cue["text"] == "retained" and cue["start"] == 1 and cue["end"] == 2
    assert cue["speakerId"] == "speaker-1" and cue["reviewed"] is False
    assert cue["reasons"] == ["speech_uncertain"]
    assert "_speechUncertain" not in cue["words"][0]
    assert "삭제하지 않고" in warnings[0]


def test_cancel_during_speech_check_closes_whisper_and_gate(tmp_path, monkeypatch):
    path = wav(tmp_path)
    cancelled = False
    def model(samples):
        nonlocal cancelled
        cancelled = True
        return np.zeros(len(samples) // 512)
    monkeypatch.setattr(speech, "_vad_model", lambda: model)
    observed, events = [], []
    fake_whisper(monkeypatch, [segment(1, 2, " x", [(1, 2, " x", .3)])], observed, events)
    with pytest.raises(infer.AnalysisCancelled):
        infer._transcribe(path, model_name="tiny", language="ko", device="cpu", duration=4,
                          progress=lambda *_: None, cancelled=lambda: cancelled)
    assert events == ["close", "unload"]
    path.unlink()  # No file handle remains on Windows.


def test_file_analysis_exposes_silence_warning_in_final_result(tmp_path, monkeypatch):
    path = wav(tmp_path, seconds=6)
    fixed_vad(monkeypatch)
    fake_whisper(monkeypatch, [segment(1, 2, " silent text", [(1, 2, " silent text", .9)])], [], [])
    def extract(source, selected, destination, cancelled):
        assert selected == 1
        shutil.copyfile(source, destination)
        return 6, 1
    monkeypatch.setattr(infer, "_extract_audio", extract)
    result = infer.analyze(path, audio_track=1, mode="standard", speaker_count=1,
                           whisper_model="tiny", language="ko", device="cpu", diarization=False,
                           progress=lambda *_: None, cancelled=lambda: False)
    assert result["captions"] == []
    assert any("전사 구간 1개를 제외" in warning for warning in result["warnings"])
