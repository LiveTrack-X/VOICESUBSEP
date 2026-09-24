"""No model downloads: synthetic timing tests and small FFmpeg fixtures only."""

from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
import wave

import pytest

from voicesubsep import inference as infer


def record(start, end, text=" 대사", **extra):
    return {"start": start, "end": end, "text": text,
            "words": [{"start": start, "end": end, "text": text}], **extra}


def result(records, intervals=None, count=2, mode="standard"):
    return infer.build_result(records, intervals, duration=60, speaker_count=count, mode=mode)


def test_overlapping_same_speaker_intervals_are_union_not_two_speakers():
    intervals = [{"Start": 1, "End": 3, "Speaker": 0}, {"Start": 2, "End": 4, "Speaker": 0},
                 {"Start": 4, "End": 5, "Speaker": 0}]
    assert infer.merge_speaker_intervals(intervals, 60) == [{"start": 1, "end": 5, "speaker": "0"}]
    caption = result([record(2, 3)], intervals, count=1)["captions"][0]
    assert caption["speakerId"] == "speaker-1"
    assert caption["reasons"] == []


def test_even_dominant_speaker_does_not_claim_overlapping_word():
    intervals = [{"Start": 0, "End": 10, "Speaker": 0}, {"Start": 3.9, "End": 4.1, "Speaker": 1}]
    caption = result([record(3, 4)], intervals)["captions"][0]
    assert caption["speakerId"] is None
    assert caption["reasons"] == ["overlap", "unassigned"]


def test_switch_inside_word_is_reviewable_without_false_overlap_claim():
    intervals = [{"start": 0, "end": 3.5, "speaker": "A"}, {"start": 3.5, "end": 8, "speaker": "B"}]
    caption = result([record(3, 4)], intervals)["captions"][0]
    assert caption["speakerId"] is None
    assert set(caption["reasons"]) == {"unassigned", "timing"}


def test_silence_is_not_assigned_to_nearest_speaker_and_gaps_are_preserved():
    intervals = [{"Start": 10, "End": 11, "Speaker": 0}, {"Start": 20, "End": 21, "Speaker": 1}]
    output = result([record(10, 11), record(15, 16), record(20, 21)], intervals)
    assert [(c["start"], c["end"]) for c in output["captions"]] == [(10, 11), (15, 16), (20, 21)]
    assert output["captions"][1]["speakerId"] is None
    assert output["captions"][1]["reasons"] == ["unassigned"]


def test_expected_count_never_caps_or_merges_detected_people():
    intervals = [{"Start": i * 2, "End": i * 2 + 1, "Speaker": i} for i in range(6)]
    output = result([record(i * 2, i * 2 + 1) for i in range(6)], intervals, count=2)
    assert len(output["speakers"]) == 6
    assert len({caption["speakerId"] for caption in output["captions"]}) == 6
    assert all("speaker_count" in caption["reasons"] for caption in output["captions"])
    assert "6명" in output["warnings"][0]


def test_transcription_only_does_not_invent_even_a_single_speaker():
    output = result([record(10, 11)], None, count=1, mode="overlap")
    assert output["speakers"] == []
    assert output["captions"][0]["speakerId"] is None
    assert "overlap" not in output["captions"][0]["reasons"]
    assert any("자동 검출하지" in warning for warning in output["warnings"])


def test_detected_overlap_without_any_asr_word_is_still_visible():
    output = result([], [{"Start": 20, "End": 22, "Speaker": 0},
                         {"Start": 21, "End": 23, "Speaker": 1}], mode="overlap")
    assert output["captions"] == []  # Never fabricate the missing dialogue.
    assert any("21.00–22.00초" in warning for warning in output["warnings"])


def test_words_split_at_speaker_changes_and_long_gaps():
    words = [{"start": 1, "end": 2, "text": " 첫"}, {"start": 2, "end": 3, "text": " 말"},
             {"start": 4, "end": 5, "text": " 다음"}, {"start": 8, "end": 9, "text": " 마지막"}]
    output = result([record(1, 9, words=words)], [{"Start": 1, "End": 3, "Speaker": 0},
                                               {"Start": 4, "End": 9, "Speaker": 1}])
    assert [c["text"] for c in output["captions"]] == ["첫 말", "다음", "마지막"]
    assert [c["speakerId"] for c in output["captions"]] == ["speaker-1", "speaker-2", "speaker-2"]


def test_nonfinite_and_invalid_timestamps_are_not_exported():
    output = result([record(float("nan"), 1), record(20, 19), record(10, 11), record(-1, 2),
                     record(59, 65), record(8, 8)])
    assert [(c["start"], c["end"]) for c in output["captions"]] == [(0, 2), (10, 11), (59, 60)]
    assert "timing" in output["captions"][0]["reasons"]
    assert "timing" in output["captions"][-1]["reasons"]
    assert any("3개" in warning for warning in output["warnings"])


def test_segment_without_words_is_retained_and_marked_for_timing():
    output = result([record(10, 11, "시간 없는 단어", words=[])])
    assert output["captions"][0]["text"] == "시간 없는 단어"
    assert "timing" in output["captions"][0]["reasons"]


def test_cancellation_before_analysis_never_loads_engine(monkeypatch, tmp_path):
    monkeypatch.setattr(infer, "_whisper_class", lambda: pytest.fail("Should not load an engine"))
    with pytest.raises(infer.AnalysisCancelled):
        infer.analyze(tmp_path / "absent.wav", audio_track=0, mode="standard", speaker_count=2,
                      whisper_model="tiny", language="ko", device="cpu", diarization=False,
                      progress=lambda *_: None, cancelled=lambda: True)


def test_cancellation_during_attribution_is_observed():
    calls = 0

    def cancelled():
        nonlocal calls
        calls += 1
        return calls >= 3

    with pytest.raises(infer.AnalysisCancelled):
        infer.build_result([record(i, i + 0.5) for i in range(10)], [], duration=20,
                           speaker_count=1, mode="overlap", cancelled=cancelled)


def test_native_whisper_generator_is_closed_and_unloaded_on_cancel(monkeypatch, tmp_path):
    events = []
    is_cancelled = False

    class Model:
        def __init__(self, name, **options):
            assert name == "tiny" and options == {"device": "cpu", "compute_type": "int8"}
            self.model = SimpleNamespace(unload_model=lambda: events.append("unload"))

        def transcribe(self, path, **options):
            assert options["word_timestamps"] is True
            assert options["vad_filter"] is False

            def segments():
                nonlocal is_cancelled
                try:
                    yield SimpleNamespace(start=1, end=2, text="말", words=[SimpleNamespace(start=1, end=2, word="말", probability=0.9)])
                    is_cancelled = True
                    yield SimpleNamespace(start=3, end=4, text="끝", words=[])
                finally:
                    events.append("close")

            return segments(), None

    monkeypatch.setattr(infer, "_whisper_class", lambda: Model)
    with pytest.raises(infer.AnalysisCancelled):
        infer._transcribe(tmp_path / "unused.wav", model_name="tiny", language="ko", device="cpu", duration=10,
                          progress=lambda *_: None, cancelled=lambda: is_cancelled)
    assert events == ["close", "unload"]


def test_subprocess_is_reaped_after_cancellation(monkeypatch):
    events = []
    process = SimpleNamespace(returncode=None)

    def communicate(timeout=None):
        if timeout is not None:
            events.append("poll")
            raise subprocess.TimeoutExpired("fake", timeout)
        events.append("reap")
        return "", ""

    def kill():
        process.returncode = -1
        events.append("kill")

    process.communicate = communicate
    process.kill = kill
    process.poll = lambda: process.returncode
    monkeypatch.setattr(infer.subprocess, "Popen", lambda *_, **__: process)
    with pytest.raises(infer.AnalysisCancelled):
        infer._run(["fake"], lambda: "poll" in events)
    assert events == ["poll", "kill", "reap"]


def test_capabilities_requires_native_nemotron_support(monkeypatch):
    def imported(name):
        if name == "faster_whisper":
            return SimpleNamespace(WhisperModel=object)
        # Older transformers exposes auto classes but not native Nemotron.
        return SimpleNamespace(AutoProcessor=object, AutoModelForAudioFrameClassification=object)

    monkeypatch.setattr(infer.importlib, "import_module", imported)
    assert infer.capabilities() == {"whisper": True, "nemotron": False}


def test_missing_requested_diarizer_fails_before_transcription(monkeypatch, tmp_path):
    source = tmp_path / "source.wav"
    source.touch()
    monkeypatch.setattr(infer, "_whisper_class", lambda: object)
    monkeypatch.setattr(infer, "_nemotron_classes", lambda: (_ for _ in ()).throw(RuntimeError("Nemotron unavailable")))
    monkeypatch.setattr(infer, "_extract_audio", lambda *_: pytest.fail("Do not process media"))
    with pytest.raises(RuntimeError, match="Nemotron unavailable"):
        infer.analyze(source, audio_track=0, mode="standard", speaker_count=2, whisper_model="tiny",
                      language="ko", device="cpu", diarization=True, progress=lambda *_: None,
                      cancelled=lambda: False)


def test_sequential_engines_temp_cleanup_and_progress(monkeypatch, tmp_path):
    source = tmp_path / "source.wav"
    source.touch()
    paths, stages, order = [], [], []
    monkeypatch.setattr(infer, "_whisper_class", lambda: object)
    monkeypatch.setattr(infer, "_nemotron_classes", lambda: (None, None, None))

    def extract(_, selected, destination, cancelled):
        assert selected == 3
        destination.touch()
        paths.append(destination)
        return 60, 2

    def transcribe(path, **kwargs):
        assert path.is_file()
        order.append("whisper")
        return [record(10, 11)]

    def diarize(path, **kwargs):
        assert order == ["whisper"]
        order.append("nemotron")
        return [{"Start": 10, "End": 11, "Speaker": 0}]

    monkeypatch.setattr(infer, "_extract_audio", extract)
    monkeypatch.setattr(infer, "_transcribe", transcribe)
    monkeypatch.setattr(infer, "_diarize", diarize)
    output = infer.analyze(source, audio_track=3, mode="overlap", speaker_count=1, whisper_model="tiny",
                           language="ko", device="cpu", diarization=True,
                           progress=lambda stage, amount: stages.append(amount), cancelled=lambda: False)
    assert output["captions"][0]["start"] == 10
    assert not paths[0].exists()
    assert stages == sorted(stages) and stages[-1] == 1
    assert any("#3" in warning for warning in output["warnings"])


def test_cancelled_transcription_cleans_temp_directory(monkeypatch, tmp_path):
    source = tmp_path / "source.wav"
    source.touch()
    paths = []
    monkeypatch.setattr(infer, "_whisper_class", lambda: object)

    def extract(_, selected, destination, cancelled):
        destination.touch()
        paths.append(destination)
        return 1, 1

    monkeypatch.setattr(infer, "_extract_audio", extract)
    monkeypatch.setattr(infer, "_transcribe", lambda *_, **__: (_ for _ in ()).throw(infer.AnalysisCancelled()))
    with pytest.raises(infer.AnalysisCancelled):
        infer.analyze(source, audio_track=0, mode="standard", speaker_count=1, whisper_model="tiny",
                      language="ko", device="cpu", diarization=False,
                      progress=lambda *_: None, cancelled=lambda: False)
    assert not paths[0].parent.exists()


def test_streaming_final_chunk_handles_short_and_exact_lengths():
    processor = SimpleNamespace(num_samples_first_audio_chunk=10, num_samples_per_audio_chunk=12,
                                num_mel_frames_per_step=8, audio_chunk_start=lambda cursor: cursor - 2)
    assert [(first, last, used) for _, first, last, used in infer._stream_chunks(list(range(4)), processor)] == [(True, True, 4)]
    chunks = list(infer._stream_chunks(list(range(18)), processor))
    assert [(first, last, used) for _, first, last, used in chunks] == [(True, False, 10), (False, True, 18)]
    assert chunks[-1][0] == list(range(6, 18))


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="FFmpeg not installed")
def test_ffmpeg_selected_global_stream_and_delayed_audio_keep_source_time(tmp_path):
    source = tmp_path / "delayed.mkv"
    output = tmp_path / "audio.wav"
    # Source video begins at zero; selected PCM audio starts half a second later.
    subprocess.run([
        shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=16x16:r=10:d=1.5",
        "-itsoffset", "0.5", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5:sample_rate=16000",
        "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono:d=1.5",
        "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source),
    ], check=True, capture_output=True)
    duration, channels = infer._extract_audio(source, 1, output, lambda: False)
    assert duration == pytest.approx(1.5, abs=0.02)
    assert channels == 1
    with wave.open(str(output), "rb") as wav:
        assert wav.getframerate() == 16000
        assert wav.getnchannels() == 1
        leading = wav.readframes(7200)
        tone = wav.readframes(4800)
    assert not any(leading), "Delayed track must not be shifted to zero"
    assert any(tone), "The selected track is tone; do not mix/select the silent second track"
    infer._extract_audio(source, 2, output, lambda: False)
    with wave.open(str(output), "rb") as wav:
        assert not any(wav.readframes(wav.getnframes()))
    with pytest.raises(RuntimeError, match="오디오 트랙"):
        infer._extract_audio(source, 0, output, lambda: False)
