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


@pytest.mark.parametrize("detected", [4, 5, 6, 7, 8])
def test_four_or_more_preserves_all_detected_people_without_count_flag(detected):
    intervals = [{"Start": i * 2, "End": i * 2 + 1, "Speaker": i} for i in range(detected)]
    output = result([record(i * 2, i * 2 + 1) for i in range(detected)], intervals, count=4)
    assert len(output["speakers"]) == detected
    assert len({caption["speakerId"] for caption in output["captions"]}) == detected
    assert all("speaker_count" not in caption["reasons"] for caption in output["captions"])
    assert not any("설정 인원" in warning for warning in output["warnings"])
    assert any("최대 8개" in warning for warning in output["warnings"]) == (detected == 8)


@pytest.mark.parametrize("detected", [0, 1, 3])
def test_four_or_more_flags_too_few_detected_people(detected):
    intervals = [{"Start": i * 2, "End": i * 2 + 1, "Speaker": i} for i in range(detected)]
    output = result([record(0, 1)], intervals, count=4)
    assert len(output["speakers"]) == detected
    assert "speaker_count" in output["captions"][0]["reasons"]
    assert any(f"4명 이상과 검출 화자 {detected}명" in warning for warning in output["warnings"])


@pytest.mark.parametrize("expected", [1, 2, 3])
def test_one_to_three_remain_exact_expected_counts(expected):
    intervals = [{"Start": i * 2, "End": i * 2 + 1, "Speaker": i} for i in range(expected)]
    output = result([record(0, 1)], intervals, count=expected)
    assert "speaker_count" not in output["captions"][0]["reasons"]
    intervals.append({"Start": expected * 2, "End": expected * 2 + 1, "Speaker": expected})
    output = result([record(0, 1)], intervals, count=expected)
    assert "speaker_count" in output["captions"][0]["reasons"]


@pytest.mark.parametrize("expected", [1, 4])
def test_transcription_only_does_not_invent_even_a_single_speaker(expected):
    output = result([record(10, 11)], None, count=expected, mode="overlap")
    assert output["speakers"] == []
    assert output["captions"][0]["speakerId"] is None
    assert "overlap" not in output["captions"][0]["reasons"]
    assert "speaker_count" not in output["captions"][0]["reasons"]
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


def boundary_result(words, intervals=None, **options):
    if intervals is None:
        intervals = [{"start": 1.3, "end": 3, "speaker": "A"}]
    return infer.build_result([record(words[0]["start"], words[-1]["end"], words=words)], intervals,
                              duration=60, speaker_count=1, mode="standard", **options)


@pytest.mark.parametrize("text", [" The", " 오늘은", " えー", " a"])
def test_boundary_compensation_is_language_independent_and_keeps_word_evidence(text):
    words = [{"start": 1, "end": 1.4, "text": text, "probability": 0.975},
             {"start": 1.4, "end": 2, "text": " next", "probability": 0.99}]
    output = boundary_result(words)
    assert [caption["speakerId"] for caption in output["captions"]] == ["speaker-1", "speaker-1"]
    assert output["captions"][0]["reasons"] == ["speaker_boundary"]
    assert output["captions"][0]["reviewed"] is False
    assert [word for caption in output["captions"] for word in caption["words"]] == words
    assert any("500ms" in warning and "1개" in warning for warning in output["warnings"])


@pytest.mark.parametrize("tolerance,expected", [(0, None), (200, None), (299, None),
                                                (300, "speaker-1"), (500, "speaker-1"), (800, "speaker-1")])
def test_boundary_tolerance_is_explicit_and_zero_restores_strict_attribution(tolerance, expected):
    words = [{"start": 1, "end": 1.4, "text": " The"}, {"start": 1.4, "end": 2, "text": " next"}]
    output = boundary_result(words, speaker_boundary_ms=tolerance)
    assert output["captions"][0]["speakerId"] == expected
    if expected is None:
        assert output["captions"][0]["reasons"] == ["unassigned"]
        assert not any("경계 보정" in warning for warning in output["warnings"])


def test_boundary_compensation_can_use_previous_strict_word_at_speech_end():
    words = [{"start": 1, "end": 1.6, "text": " preceding"}, {"start": 1.6, "end": 2, "text": " word"}]
    output = boundary_result(words, [{"start": 1, "end": 1.7, "speaker": "A"}])
    assert output["captions"][-1]["speakerId"] == "speaker-1"
    assert output["captions"][-1]["reasons"] == ["speaker_boundary"]


@pytest.mark.parametrize("start,end,activity_start", [(20.03, 20.43, 20.30), (36.63, 37.15, 37.03)])
def test_boundary_compensation_repairs_observed_the_timing_mismatch(start, end, activity_start):
    # Times retained from the saved synthetic smoke, with a strict next-word
    # anchor. No model execution or assumption about unseen ASR record edges.
    words = [{"start": start, "end": end, "text": " The"},
             {"start": end, "end": end + 0.2, "text": " next"}]
    intervals = [{"start": activity_start, "end": end + 0.5, "speaker": "A"}]
    strict = boundary_result(words, intervals, speaker_boundary_ms=0)
    corrected = boundary_result(words, intervals, speaker_boundary_ms=500)
    assert strict["captions"][0]["speakerId"] is None
    assert corrected["captions"][0]["speakerId"] == "speaker-1"
    assert corrected["captions"][0]["reasons"] == ["speaker_boundary"]


@pytest.mark.parametrize("intervals", [
    [{"start": 1.3, "end": 3, "speaker": "A"}, {"start": 1.35, "end": 1.37, "speaker": "B"}],
    [{"start": 1, "end": 1.2, "speaker": "B"}, {"start": 1.2, "end": 3, "speaker": "A"}],
    [{"start": 1.4, "end": 3, "speaker": "A"}],
    [],
])
def test_boundary_compensation_never_claims_overlap_transition_or_zero_activity(intervals):
    words = [{"start": 1, "end": 1.4, "text": " The"}, {"start": 1.4, "end": 2, "text": " next"}]
    output = boundary_result(words, intervals, speaker_boundary_ms=800)
    assert output["captions"][0]["speakerId"] is None
    assert "speaker_boundary" not in output["captions"][0]["reasons"]


def test_boundary_compensation_requires_immediate_strict_anchor_and_does_not_cascade():
    words = [{"start": 1, "end": 1.3, "text": " first"}, {"start": 1.3, "end": 1.5, "text": " second"},
             {"start": 1.5, "end": 2, "text": " anchor"}]
    intervals = [{"start": 1.2, "end": 1.4, "speaker": "A"}, {"start": 1.55, "end": 2, "speaker": "A"}]
    output = boundary_result(words, intervals)
    assert output["captions"][0]["speakerId"] is None
    assert output["captions"][1]["reasons"] == ["speaker_boundary"]
    assert output["captions"][2]["reasons"] == []


@pytest.mark.parametrize("gap,expected", [(0.2, "speaker-1"), (0.201, None)])
def test_boundary_compensation_does_not_bridge_word_gaps_above_200ms(gap, expected):
    words = [{"start": 1, "end": 1.4, "text": " The"},
             {"start": 1.4 + gap, "end": 2.5, "text": " next"}]
    assert boundary_result(words)["captions"][0]["speakerId"] == expected


def test_boundary_compensation_never_crosses_another_speaker_between_word_and_anchor():
    words = [{"start": 1, "end": 1.4, "text": " The"}, {"start": 1.6, "end": 2, "text": " next"}]
    intervals = [{"start": 1.3, "end": 1.45, "speaker": "A"},
                 {"start": 1.6, "end": 2, "speaker": "A"},
                 {"start": 1.45, "end": 1.55, "speaker": "B"}]
    assert boundary_result(words, intervals)["captions"][0]["speakerId"] is None


def test_conflicting_immediate_strict_neighbor_blocks_other_matching_anchor():
    words = [{"start": 0.4, "end": 1, "text": " other"}, {"start": 1, "end": 1.4, "text": " The"},
             {"start": 1.4, "end": 2, "text": " next"}]
    intervals = [{"start": 0.4, "end": 1, "speaker": "B"}, {"start": 1.3, "end": 3, "speaker": "A"}]
    assert boundary_result(words, intervals)["captions"][1]["speakerId"] is None


@pytest.mark.parametrize("words,intervals", [
    ([{"start": 1, "end": 1.81, "text": " long"}, {"start": 1.81, "end": 2.5, "text": " next"}],
     [{"start": 1.5, "end": 3, "speaker": "A"}]),
    ([{"start": -0.1, "end": 0.4, "text": " clipped"}, {"start": 0.4, "end": 1, "text": " next"}],
     [{"start": 0.3, "end": 3, "speaker": "A"}]),
    ([{"start": 1, "end": 1.4, "text": " The"}], [{"start": 1.3, "end": 3, "speaker": "A"}]),
    ([{"start": 1, "end": 1.4, "text": " The"}, {"start": 1.39, "end": 2, "text": " next"}],
     [{"start": 1.3, "end": 3, "speaker": "A"}]),
])
def test_boundary_compensation_rejects_long_clipped_isolated_and_intersecting_words(words, intervals):
    assert boundary_result(words, intervals, speaker_boundary_ms=800)["captions"][0]["speakerId"] is None


def test_boundary_compensation_does_not_use_anchor_across_asr_records_or_segment_fallback():
    intervals = [{"start": 1.3, "end": 3, "speaker": "A"}]
    for first in (record(1, 1.4, " The"), record(1, 1.4, " The", words=[])):
        output = infer.build_result([first, record(1.4, 2, " next")], intervals,
                                   duration=60, speaker_count=1, mode="standard")
        assert output["captions"][0]["speakerId"] is None


@pytest.mark.parametrize("invalid", [True, False, -1, 801, 500.0, "500", None, float("nan")])
def test_boundary_setting_validation_precedes_model_loading(invalid, monkeypatch, tmp_path):
    with pytest.raises(RuntimeError, match="0~800ms"):
        infer.build_result([], [], duration=60, speaker_count=1, mode="standard", speaker_boundary_ms=invalid)
    monkeypatch.setattr(infer, "_whisper_class", lambda: pytest.fail("Should not load a model"))
    with pytest.raises(RuntimeError, match="0~800ms"):
        infer.analyze(tmp_path / "absent.wav", audio_track=0, mode="standard", speaker_count=1,
                      whisper_model="tiny", language="ko", device="cpu", diarization=True,
                      progress=lambda *_: None, cancelled=lambda: False, speaker_boundary_ms=invalid)


def test_analysis_passes_boundary_setting_to_attribution(monkeypatch, tmp_path):
    source = tmp_path / "source.wav"
    source.touch()
    monkeypatch.setattr(infer, "_whisper_class", lambda: object)
    monkeypatch.setattr(infer, "_nemotron_classes", lambda: object)
    monkeypatch.setattr(infer, "_extract_audio", lambda *_: (60, 1))
    monkeypatch.setattr(infer, "_diarize", lambda *_, **__: [{"start": 1.3, "end": 3, "speaker": "A"}])
    words = [{"start": 1, "end": 1.4, "text": " The"}, {"start": 1.4, "end": 2, "text": " next"}]
    monkeypatch.setattr(infer, "_transcribe", lambda *_, **__: [record(1, 2, words=words)])
    output = infer.analyze(source, audio_track=0, mode="standard", speaker_count=1,
                           whisper_model="tiny", language="ko", device="cpu", diarization=True,
                           progress=lambda *_: None, cancelled=lambda: False, speaker_boundary_ms=0)
    assert output["captions"][0]["speakerId"] is None


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
    monkeypatch.setattr(infer, "resolve_whisper_model", lambda name: name)
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


@pytest.mark.parametrize("language,expected_language,multilingual", [("auto", None, True), ("ko", "ko", False)])
def test_whisper_language_policy_and_clips_preserve_original_word_times(
    monkeypatch, tmp_path, language, expected_language, multilingual
):
    clips = [0.0, 6.25, 6.25, 19.0, 19.0, 30.0]
    observed = []
    monkeypatch.setattr(infer, "resolve_whisper_model", lambda name: name)
    monkeypatch.setattr(infer, "_release_memory", lambda: None)

    class Model:
        def __init__(self, *_args, **_kwargs):
            self.model = SimpleNamespace(unload_model=lambda: None)

        def transcribe(self, path, **options):
            observed.append(options)
            # faster-whisper returns source-global times even when a word is
            # decoded from a clip that starts after zero. Never add that offset.
            return iter([
                SimpleNamespace(start=11.42, end=12.08, text=" first", words=[
                    SimpleNamespace(start=11.42, end=12.08, word=" first", probability=0.9)]),
                SimpleNamespace(start=24.7, end=25.2, text=" second", words=[
                    SimpleNamespace(start=24.7, end=25.2, word=" second", probability=0.8)]),
            ]), None

    monkeypatch.setattr(infer, "_whisper_class", lambda: Model)
    records = infer._transcribe(
        tmp_path / "unused.wav", model_name="tiny", language=language, device="cpu", duration=30,
        clip_timestamps=clips, progress=lambda *_: None, cancelled=lambda: False,
    )
    assert len(observed) == 1
    assert observed[0]["language"] == expected_language
    assert observed[0]["multilingual"] is multilingual
    assert observed[0]["clip_timestamps"] == [0.0, 6.25, 6.25, 19.0, 19.0, 30.0]
    assert observed[0]["word_timestamps"] is True and observed[0]["vad_filter"] is False
    assert observed[0]["condition_on_previous_text"] is False
    assert [(item["start"], item["end"]) for item in records] == [(11.42, 12.08), (24.7, 25.2)]
    assert [(word["start"], word["end"]) for item in records for word in item["words"]] == [
        (11.42, 12.08), (24.7, 25.2)]


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


def test_nemotron_readiness_checks_audio_dependency_and_reports_cause(monkeypatch):
    processor = SimpleNamespace(extract_speaker_dict=lambda: None)
    native = SimpleNamespace(Nemotron3DiarizationForAudioFrameClassification=object,
                             Nemotron3DiarizationProcessor=processor,
                             NemotronAsrStreamingFeatureExtractor=lambda: object())

    def imported(name):
        if name == "faster_whisper":
            return SimpleNamespace(WhisperModel=object)
        if name == "transformers":
            return native
        if name == "librosa":
            raise ImportError("audio runtime missing")
        return object()

    monkeypatch.setattr(infer.importlib, "import_module", imported)
    report = infer.capability_report()
    assert report["engines"] == {"whisper": True, "nemotron": False}
    assert "audio runtime missing" in report["engineIssues"]["nemotron"]
    assert report["engineIssues"]["whisper"] is None


def test_file_diarization_matches_offline_context_and_cache_sizes():
    modes = {"low_latency": (9, 4)}
    selected = []
    processor = SimpleNamespace(streaming_modes=modes, set_streaming_mode=selected.append)
    live = SimpleNamespace(fifo_length=264, speaker_cache_update_period=222)
    config = SimpleNamespace(chunk_length=340, chunk_right_context=40,
                             fifo_length=40, speaker_cache_update_period=300,
                             streaming_config=live)
    infer._configure_file_diarization(processor, SimpleNamespace(config=config))
    assert processor.streaming_modes["file"] == (340, 40)
    assert selected == ["file"]
    assert (live.fifo_length, live.speaker_cache_update_period) == (40, 300)
    assert "file" not in modes  # Never mutate a shared processor class preset.


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
        assert order == ["nemotron"]
        assert kwargs["clip_timestamps"] == [0.0, 15.5, 15.5, 60.0]
        order.append("whisper")
        return [record(10, 11), record(20, 21)]

    def diarize(path, **kwargs):
        assert order == []
        order.append("nemotron")
        return [{"Start": 10, "End": 11, "Speaker": 0}, {"Start": 20, "End": 21, "Speaker": 1}]

    monkeypatch.setattr(infer, "_extract_audio", extract)
    monkeypatch.setattr(infer, "_transcribe", transcribe)
    monkeypatch.setattr(infer, "_diarize", diarize)
    output = infer.analyze(source, audio_track=3, mode="overlap", speaker_count=2, whisper_model="tiny",
                           language="ko", device="cpu", diarization=True,
                           progress=lambda stage, amount: stages.append(amount), cancelled=lambda: False)
    assert [(caption["start"], caption["end"]) for caption in output["captions"]] == [(10, 11), (20, 21)]
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
