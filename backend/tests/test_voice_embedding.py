"""Acoustic policy and file boundaries; no downloaded weights or inference."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import wave

import numpy as np
import pytest


def test_acoustic_module_is_available():
    assert importlib.util.find_spec("voicesubsep.voice_embedding") is not None


def pcm(path, seconds=12, value=None):
    samples = (np.sin(np.arange(seconds * 16000) * .04) * 4000).astype("<i2")
    if value is not None:
        samples[:] = value
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        output.writeframes(samples.tobytes())


@pytest.fixture
def acoustic(monkeypatch, tmp_path):
    from voicesubsep import voice_embedding as voice
    monkeypatch.setattr(voice, "_runtime", lambda: SimpleNamespace(np=np))
    monkeypatch.setattr(voice.cache, "verified_model_path", lambda **kwargs: tmp_path / "fixture.onnx")
    monkeypatch.setattr(voice, "_load_session", lambda *_: object())
    def decode(source, track, destination, cancelled):
        assert track == 2
        pcm(destination)
    monkeypatch.setattr(voice, "_decode_audio", decode)
    monkeypatch.setattr(voice, "_speech_probabilities", lambda samples, runtime: np.ones((len(samples) + 511) // 512))
    references = [{"id": "ref-a", "speakerId": "speaker-a", "start": 0, "end": 3},
                  {"id": "ref-b", "speakerId": "speaker-b", "start": 4, "end": 7}]
    targets = [{"captionId": "target", "start": 8, "end": 10}]
    def run(vectors, refs=None, cues=None, cancelled=lambda: False):
        iterator = iter(vectors)
        monkeypatch.setattr(voice, "_embedding", lambda *_: np.asarray(next(iterator), dtype="float32"))
        return voice.match_voices(tmp_path / "source.wav", audio_track=2,
            references=references if refs is None else refs, targets=targets if cues is None else cues,
            progress=lambda *_: None, cancelled=cancelled)
    return voice, references, targets, run


def test_raw_cosine_threshold_and_margin_produce_only_review_candidate(acoustic):
    _, _, _, run = acoustic
    result = run([[1., 0.], [0., 1.], [.99, .01]])
    row = result["candidates"][0]
    assert row["recommendedSpeakerId"] == "speaker-a"
    assert row["reason"] == "candidate"
    assert row["scores"][0]["similarity"] > .99
    assert "uncalibrated" in " ".join(result["warnings"]).lower()


def test_negative_cosine_is_not_remapped_into_probability(acoustic):
    _, _, _, run = acoustic
    row = run([[1., 0.], [0., 1.], [-1., 0.]])["candidates"][0]
    assert row["recommendedSpeakerId"] is None
    assert row["reason"] == "low_similarity"
    assert {s["speakerId"]: s["similarity"] for s in row["scores"]}["speaker-a"] == -1


def test_close_competitors_are_withheld(acoustic):
    _, _, _, run = acoustic
    row = run([[1., 0.], [.99, .1], [1., 0.]])["candidates"][0]
    assert row["recommendedSpeakerId"] is None
    assert row["reason"] == "ambiguous"


def test_short_target_is_not_extended_into_neighbors(acoustic):
    _, _, _, run = acoustic
    row = run([[1., 0.], [0., 1.]], cues=[{"captionId": "short", "start": 8, "end": 8.4}])["candidates"][0]
    assert row == {"captionId": "short", "scores": [], "recommendedSpeakerId": None, "reason": "too_short"}


@pytest.mark.parametrize("change", ["one_speaker", "short_reference", "nan", "duplicate_target", "reference_overlap", "track_bool", "too_many_targets"])
def test_invalid_inputs_rejected_before_decode(acoustic, monkeypatch, change):
    voice, refs, targets, _ = acoustic
    refs = [dict(row) for row in refs]
    targets = [dict(row) for row in targets]
    track = 2
    if change == "one_speaker": refs[1]["speakerId"] = "speaker-a"
    if change == "short_reference": refs[0]["end"] = 2
    if change == "nan": targets[0]["start"] = float("nan")
    if change == "duplicate_target": targets *= 2
    if change == "reference_overlap": refs[1].update(start=2, end=5)
    if change == "track_bool": track = True
    if change == "too_many_targets": targets = [{"captionId": str(i), "start": 8, "end": 10} for i in range(51)]
    monkeypatch.setattr(voice, "_decode_audio", lambda *_: pytest.fail("Invalid input reached decoding"))
    with pytest.raises(ValueError):
        voice.match_voices(Path("unused"), audio_track=track, references=refs, targets=targets,
                           progress=lambda *_: None, cancelled=lambda: False)


def test_missing_weights_do_not_download(acoustic, monkeypatch):
    voice, _, _, run = acoustic
    def missing(**kwargs): raise RuntimeError("Prepare the voice model first")
    monkeypatch.setattr(voice.cache, "verified_model_path", missing)
    monkeypatch.setattr(voice.cache, "prepare_weights", lambda **_: pytest.fail("Compare must never prepare/download"))
    with pytest.raises(RuntimeError, match="Prepare"):
        run([])


def test_cancellation_prevents_model_or_audio_work(acoustic, monkeypatch):
    voice, _, _, run = acoustic
    monkeypatch.setattr(voice, "_runtime", lambda: pytest.fail("Cancelled request reached runtime"))
    with pytest.raises(Exception, match="취소"):
        run([], cancelled=lambda: True)


@pytest.mark.parametrize("kind,reason", [("silence", "silence"), ("clipped", "clipped"), ("vad", "insufficient_speech")])
def test_bad_reference_audio_rejects_whole_comparison(acoustic, monkeypatch, kind, reason):
    voice, _, _, run = acoustic
    if kind == "vad":
        monkeypatch.setattr(voice, "_speech_probabilities", lambda samples, runtime: np.zeros((len(samples) + 511) // 512))
    else:
        monkeypatch.setattr(voice, "_decode_audio", lambda source, track, destination, cancelled: pcm(destination, value=0 if kind == "silence" else 32767))
    with pytest.raises(ValueError, match=reason):
        run([])


def test_failed_speech_check_never_passes_as_clean_voice(acoustic, monkeypatch):
    voice, _, _, run = acoustic
    def failure(*_): raise RuntimeError("VAD unavailable")
    monkeypatch.setattr(voice, "_speech_probabilities", failure)
    with pytest.raises(ValueError, match="speech_check_unavailable"):
        run([])


def test_out_of_source_range_is_rejected(acoustic):
    _, _, _, run = acoustic
    with pytest.raises(ValueError, match="source"):
        run([[1., 0.], [0., 1.]], cues=[{"captionId": "outside", "start": 11, "end": 14}])


def test_target_quality_failure_does_not_return_similarity(acoustic, monkeypatch):
    voice, _, _, run = acoustic
    calls = 0
    def probabilities(samples, runtime):
        nonlocal calls
        calls += 1
        return np.full((len(samples) + 511) // 512, 1 if calls <= 2 else 0)
    monkeypatch.setattr(voice, "_speech_probabilities", probabilities)
    row = run([[1., 0.], [0., 1.]])["candidates"][0]
    assert row == {"captionId": "target", "scores": [], "recommendedSpeakerId": None, "reason": "insufficient_speech"}


def test_nonfinite_embedding_is_not_turned_into_a_candidate(acoustic):
    _, _, _, run = acoustic
    with pytest.raises(RuntimeError, match="nonfinite"):
        run([[1., 0.], [0., 1.], [float("nan"), 0.]])


def test_inference_session_explicitly_uses_cpu_and_one_thread(monkeypatch):
    from voicesubsep import voice_embedding as voice
    options = SimpleNamespace()
    calls = []
    expected = SimpleNamespace(get_inputs=lambda: [SimpleNamespace(name="feats", type="tensor(float)")],
                               get_outputs=lambda: [SimpleNamespace(name="embs")])
    def session(*args, **kwargs):
        calls.append((args, kwargs))
        return expected
    runtime = SimpleNamespace(ort=SimpleNamespace(SessionOptions=lambda: options, InferenceSession=session))
    assert voice._load_session(runtime, Path("fixture.onnx")) is expected
    assert options.inter_op_num_threads == options.intra_op_num_threads == 1
    assert calls == [(("fixture.onnx",), {"sess_options": options, "providers": ["CPUExecutionProvider"]})]


def test_real_feature_runtime_emits_finite_80_bin_input_without_weights():
    torch = pytest.importorskip("torch")
    kaldi = pytest.importorskip("torchaudio.compliance.kaldi")
    from voicesubsep import voice_embedding as voice
    samples = (np.sin(np.arange(16000 * 3, dtype="float32") * .04) * .1).astype("float32")
    captured = []
    class Session:
        def run(self, names, feed):
            assert names == ["embs"]
            captured.append(feed["feats"])
            return [np.ones((1, 256), dtype="float32")]
    vector = voice._embedding(samples, SimpleNamespace(torch=torch, np=np, kaldi=kaldi), Session())
    assert vector.shape == (256,)
    assert np.linalg.norm(vector) == pytest.approx(1.)
    assert captured[0].shape == (1, 298, 80)
    assert captured[0].dtype == np.float32
    assert np.isfinite(captured[0]).all()
    assert np.max(np.abs(captured[0].mean(axis=1))) < .0001
