"""Separation contracts and source-time recovery using synthetic, private-free audio."""
from pathlib import Path
import shutil
from types import SimpleNamespace
import wave

import numpy as np
import pytest

from voicesubsep import overlap_recovery as recovery
from voicesubsep.inference import AnalysisCancelled


def write_wav(path, values, rate=8000):
    recovery._write_pcm(path, np.asarray(values, dtype="float32"), rate)


@pytest.fixture
def mocked_recovery(monkeypatch, tmp_path):
    source = tmp_path / "source.wav"
    original = np.sin(np.arange(48000) * .04).astype("float32") * .2
    write_wav(source, original)
    monkeypatch.setattr(recovery.cache, "require_model", lambda: tmp_path / "model")
    monkeypatch.setattr(recovery, "_runtime", lambda: None)
    monkeypatch.setattr(recovery, "_resolve_local_whisper", lambda name: tmp_path / name)
    monkeypatch.setattr(recovery.shutil, "which", lambda _: "ffmpeg-fixture")
    def extract(path, track, first, frames, destination, cancelled):
        write_wav(destination, recovery._read_pcm(path)[first:first + frames])
    monkeypatch.setattr(recovery, "_extract_original", extract)
    monkeypatch.setattr(recovery, "_separate", lambda audio, *_: np.column_stack((audio * 10, audio * 5)))
    def run(args, cancelled):
        source_path, destination = Path(args[args.index("-i") + 1]), Path(args[-1])
        write_wav(destination, np.repeat(recovery._read_pcm(source_path), 2), 16000)
        return ""
    monkeypatch.setattr(recovery, "_run", run)
    records = [{"start": -.1, "end": .5, "text": "candidate", "words": [
        {"start": .1, "end": .3, "text": "candidate", "probability": .9}]}]
    monkeypatch.setattr(recovery, "_transcribe_candidate", lambda *args, **kwargs: (records, []))
    return source, tmp_path / "output"


def recover(source, output, **options):
    return recovery.recover_overlap(source, audio_track=options.pop("audio_track", 0),
        start=options.pop("start", 1.00013), end=options.pop("end", 3.00013),
        whisper_model="tiny", language="ko", vocabulary=["용어"], output_dir=output,
        progress=lambda *_: None, cancelled=options.pop("cancelled", lambda: False), **options)


def test_recovery_preserves_original_maps_every_time_and_keeps_relative_gain(mocked_recovery):
    source, output = mocked_recovery
    original = source.read_bytes()
    result = recover(source, output)
    assert source.read_bytes() == original
    assert result["start"] == 1.000125
    assert result["end"] == 3.000125
    assert result["originalFile"] == "original.wav"
    assert sorted(path.name for path in output.iterdir()) == ["original.wav", "stream-1.wav", "stream-2.wav"]
    assert len(result["streams"]) == 2
    for index, stream in enumerate(result["streams"]):
        assert stream["index"] == index
        caption = stream["captions"][0]
        assert caption["start"] == result["start"]
        assert caption["end"] == pytest.approx(result["start"] + .5)
        assert caption["words"][0]["start"] == pytest.approx(result["start"] + .1)
        assert caption["words"][0]["end"] == pytest.approx(result["start"] + .3)
        assert caption["speakerId"] is None and caption["reviewed"] is False
        assert caption["reasons"] == ["overlap", "unassigned"]
    first = recovery._read_pcm(output / "stream-1.wav")
    second = recovery._read_pcm(output / "stream-2.wav")
    assert np.max(np.abs(first)) < 1
    assert np.max(np.abs(second)) == pytest.approx(np.max(np.abs(first)) / 2, abs=1 / 32768)
    assert any("같은 감쇠율" in warning for warning in result["warnings"])


@pytest.mark.parametrize("start,end,track", [(0, 1.99, 0), (0, 20.01, 0), (-1, 2, 0),
    (float("nan"), 3, 0), (0, float("inf"), 0), (True, 3, 0), (0, 2, True), (0, 2, -1)])
def test_invalid_windows_fail_before_writes(mocked_recovery, start, end, track):
    source, output = mocked_recovery
    with pytest.raises(ValueError):
        recover(source, output, start=start, end=end, audio_track=track)
    assert not output.exists()


@pytest.mark.parametrize("kind", ["nan", "wrong_shape", "silence"])
def test_invalid_model_outputs_are_not_published(mocked_recovery, monkeypatch, kind):
    source, output = mocked_recovery
    def invalid(audio, *_):
        if kind == "nan":
            return np.full((len(audio), 2), np.nan)
        if kind == "wrong_shape":
            return np.zeros((len(audio) - 1, 2))
        return np.zeros((len(audio), 2))
    monkeypatch.setattr(recovery, "_separate", invalid)
    with pytest.raises(RuntimeError):
        recover(source, output)
    assert list(output.iterdir()) == []


def test_second_transcription_failure_cleans_all_owned_outputs(mocked_recovery, monkeypatch):
    source, output = mocked_recovery
    count = [0]
    def transcribe(*args, **kwargs):
        count[0] += 1
        if count[0] == 2:
            raise RuntimeError("fixture ASR failure")
        return [], []
    monkeypatch.setattr(recovery, "_transcribe_candidate", transcribe)
    with pytest.raises(RuntimeError, match="fixture ASR"):
        recover(source, output)
    assert list(output.iterdir()) == []
    assert source.is_file()


def test_cancel_after_separation_cleans_outputs_and_skips_asr(mocked_recovery, monkeypatch):
    source, output = mocked_recovery
    flag = [False]
    def separate(audio, *_):
        flag[0] = True
        return np.column_stack((audio, audio / 2))
    monkeypatch.setattr(recovery, "_separate", separate)
    monkeypatch.setattr(recovery, "_transcribe_candidate", lambda *_args, **_kwargs: pytest.fail("Cancelled ASR"))
    with pytest.raises(AnalysisCancelled):
        recover(source, output, cancelled=lambda: flag[0])
    assert list(output.iterdir()) == []


def test_existing_output_is_preserved_and_never_deleted(mocked_recovery):
    source, output = mocked_recovery
    output.mkdir()
    important = output / "original.wav"
    important.write_bytes(b"existing user audio")
    with pytest.raises(ValueError, match="비어"):
        recover(source, output)
    assert important.read_bytes() == b"existing user audio"


def test_local_whisper_missing_uses_only_offline_resolution(monkeypatch, tmp_path):
    from voicesubsep import model_cache
    monkeypatch.setattr(model_cache, "_local_model_root", lambda: tmp_path / "models")
    calls = []
    def download(name, **kwargs):
        calls.append((name, kwargs))
        raise FileNotFoundError()
    monkeypatch.setattr(model_cache, "_download_model", download)
    with pytest.raises(RuntimeError, match="자동 다운로드하지"):
        recovery._resolve_local_whisper("turbo")
    assert calls == [("large-v3-turbo", {"local_files_only": True})]
    assert not (tmp_path / "models").exists()


def test_runtime_missing_status_does_not_download_or_claim_ready(monkeypatch):
    monkeypatch.setattr(recovery, "_runtime", lambda: (_ for _ in ()).throw(RuntimeError("missing runtime")))
    monkeypatch.setattr(recovery.cache, "invalid_files", lambda: pytest.fail("Unneeded cache lookup"))
    assert recovery.model_status() == {"runtimeAvailable": False, "ready": False, "issue": "missing runtime"}


def test_source_time_clipping_rejects_invalid_and_gives_distinct_ids():
    records = [{"start": 0, "end": 30, "text": "x", "words": [
        {"start": -1, "end": 30, "text": "x", "probability": 1.2}]},
        {"start": float("nan"), "end": 1, "text": "bad"}, {"start": 9, "end": 10, "text": "outside"}]
    one = recovery._caption_records(records, offset=12, duration=2, index=0)
    two = recovery._caption_records(records, offset=12, duration=2, index=0)
    assert len(one) == 1
    assert (one[0]["start"], one[0]["end"]) == (12, 14)
    assert one[0]["words"] == [{"start": 12, "end": 14, "text": "x", "probability": 1}]
    assert one[0]["id"] != two[0]["id"]


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg not installed")
def test_real_ffmpeg_sample_trim_matches_original_clock(tmp_path):
    source, destination = tmp_path / "source.wav", tmp_path / "original.wav"
    samples = (np.arange(40000) % 1000).astype("float32") / 32768
    write_wav(source, samples)
    original = source.read_bytes()
    recovery._extract_original(source, 0, 8001, 16000, destination, lambda: False)
    assert source.read_bytes() == original
    np.testing.assert_array_equal(recovery._read_pcm(destination), recovery._read_pcm(source)[8001:24001])


def test_whisper_is_local_cpu_and_vocabulary_is_hint_only(monkeypatch, tmp_path):
    from voicesubsep import speech_activity
    path = tmp_path / "asr.wav"
    write_wav(path, np.ones(32000) * .1, 16000)
    calls = []
    word = SimpleNamespace(start=.1, end=.4, word="actual", probability=.95)
    segment = SimpleNamespace(start=.1, end=.4, text="actual", words=[word])
    class FakeWhisper:
        max_length = 448
        hf_tokenizer = SimpleNamespace(encode=lambda *_args, **_kwargs: SimpleNamespace(ids=[1, 2]))
        def __init__(self, *args, **kwargs):
            calls.append((args, kwargs))
        def transcribe(self, *args, **kwargs):
            calls.append((args, kwargs))
            return iter([segment]), None
    class Gate:
        def __init__(self, *_): pass
        def classify(self, *_): return "keep"
        def warnings(self): return []
        def close(self): pass
    monkeypatch.setattr(recovery, "_whisper_class", lambda: FakeWhisper)
    monkeypatch.setattr(speech_activity, "SpeechActivityGate", Gate)
    records, notices = recovery._transcribe_candidate(path, model_path=tmp_path / "model", language="ko",
        vocabulary=["hint"], duration=2, progress=lambda *_: None, cancelled=lambda: False)
    assert calls[0][1] == {"device": "cpu", "compute_type": "int8", "local_files_only": True}
    assert calls[1][1]["hotwords"] == "hint"
    assert records[0]["text"] == "actual" and notices == []


def test_overlap_whisper_rejects_token_overflow_before_truncating_inference(monkeypatch, tmp_path):
    class Whisper:
        max_length = 448
        hf_tokenizer = SimpleNamespace(encode=lambda *args, **kwargs: SimpleNamespace(ids=list(range(224))))
        def __init__(self, *args, **kwargs): pass
        def transcribe(self, *args, **kwargs):
            pytest.fail("Over-budget hints must not enter Whisper inference")
    monkeypatch.setattr(recovery, "_whisper_class", lambda: Whisper)
    with pytest.raises(ValueError, match="용어 힌트.*223"):
        recovery._transcribe_candidate(tmp_path / "asr.wav", model_path=tmp_path / "model", language="ko",
            vocabulary=["젠야타"], duration=2, progress=lambda *_: None, cancelled=lambda: False)


@pytest.mark.parametrize("terms", [["x" * 51], [str(index) for index in range(51)], ["bad\x85term"]])
def test_overlap_reuses_project_vocabulary_validation(mocked_recovery, terms):
    source, output = mocked_recovery
    with pytest.raises(ValueError, match="최대 50개"):
        recovery.recover_overlap(source, audio_track=0, start=1, end=3, whisper_model="tiny", language="ko",
            vocabulary=terms, output_dir=output, progress=lambda *_: None, cancelled=lambda: False)
    assert not output.exists()


def test_source_word_bounds_remain_inside_strict_caption_and_window_bounds():
    first, last = 8001, 104009
    offset, duration = first / 8000, (last - first) / 8000
    records = [{"start": 0., "end": duration + .1, "text": "last word", "words": [
        {"start": duration - .1, "end": duration + .1, "text": "word"}]}]
    caption = recovery._caption_records(records, offset=offset, duration=duration, index=0)[0]
    assert offset <= caption["start"] < caption["end"] <= last / 8000
    assert all(caption["start"] <= word["start"] < word["end"] <= caption["end"] for word in caption["words"])


def test_model_load_is_weights_only_strict_and_applies_upstream_legacy_hook(monkeypatch, tmp_path):
    loads, applied, constructors = [], [], []
    class Module:
        def __init__(self, kind, options):
            self.kind = kind
            constructors.append((kind, options))
        def load_state_dict(self, state, strict):
            applied.append((self.kind, state, strict))
        def eval(self): pass
    def constructor(kind):
        return lambda **kwargs: Module(kind, kwargs)
    network = SimpleNamespace(**{name: constructor(name) for name in ("Encoder", "Decoder", "SBTransformerBlock", "Dual_Path_Model")})
    def load(path, **kwargs):
        loads.append((path.name, kwargs))
        return {"legacy.mutihead_attn.weight": "fixture"}
    torch = SimpleNamespace(load=load)
    def patch(state):
        return {key.replace(".mutihead_attn", ".multihead_attn"): value for key, value in state.items()}
    def separator(**kwargs):
        assert kwargs["hparams"] == {"num_spks": 2, "sample_rate": 8000}
        assert kwargs["run_opts"] == {"device": "cpu"}
        return "separator"
    monkeypatch.setattr(recovery, "_runtime", lambda: (torch, network, separator, patch))
    assert recovery._load_separator(tmp_path, lambda: False) == (torch, "separator")
    assert [name for name, _ in loads] == ["encoder.ckpt", "masknet.ckpt", "decoder.ckpt"]
    assert all(options == {"map_location": "cpu", "weights_only": True} for _, options in loads)
    assert all(state == {"legacy.multihead_attn.weight": "fixture"} and strict is True for _, state, strict in applied)
    mask = next(options for kind, options in constructors if kind == "Dual_Path_Model")
    assert mask["num_spks"] == 2 and mask["K"] == 250 and mask["num_layers"] == 2


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg not installed")
def test_delayed_audio_track_keeps_source_silence_before_selected_trim(tmp_path):
    import subprocess
    source, destination = tmp_path / "delayed.mkv", tmp_path / "original.wav"
    subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-f", "lavfi", "-i", "color=black:s=16x16:r=10:d=4", "-itsoffset", "1", "-f", "lavfi", "-i",
        "sine=frequency=400:sample_rate=8000:duration=2", "-map", "0:v", "-map", "1:a", "-c:v", "ffv1",
        "-c:a", "pcm_s16le", str(source)], check=True, capture_output=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    recovery._extract_original(source, 1, 4000, 16000, destination, lambda: False)
    audio = recovery._read_pcm(destination)
    assert len(audio) == 16000
    assert np.max(np.abs(audio[:4000])) == 0
    assert np.max(np.abs(audio[4000:])) > .1
