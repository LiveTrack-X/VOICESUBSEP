"""Timeline partition tests only; no model packages, GPU or network needed."""

import copy
import math
import random

import pytest

from voicesubsep.asr_windows import speaker_change_clips


def span(start, end, speaker):
    return {"start": start, "end": end, "speaker": speaker}


def assert_partition(clips, duration):
    assert len(clips) >= 2 and len(clips) % 2 == 0
    assert clips[0] == 0 and clips[-1] == duration
    assert all(math.isfinite(value) for value in clips)
    pairs = list(zip(clips[::2], clips[1::2]))
    for index, (start, end) in enumerate(pairs):
        assert 0 <= start <= end <= duration
        if duration >= 0.5:
            assert end - start >= 0.5
        if index:
            assert start == pairs[index - 1][1], "No source audio may be lost or duplicated"
    assert sum(end - start for start, end in pairs) == pytest.approx(duration)


@pytest.mark.parametrize("duration", [0, 0.1, 0.5, 30, 3600])
def test_without_activity_keeps_entire_source(duration):
    assert speaker_change_clips([], duration) == [0.0, float(duration)]


def test_speaker_change_cuts_at_silent_gap_midpoint_and_keeps_uncovered_ends():
    clips = speaker_change_clips([span(1, 3, "A"), span(5, 8, "B")], 10)
    assert clips == [0, 4, 4, 10]
    assert_partition(clips, 10)


def test_same_speaker_vad_gaps_do_not_split_windows():
    assert speaker_change_clips([span(1, 2, "A"), span(2.1, 3, "A"), span(7, 8, "A")], 10) == [0, 10]


def test_change_uses_last_exclusive_span_after_same_speaker_resumes():
    clips = speaker_change_clips([span(0, 1, "A"), span(2, 3, "A"), span(5, 6, "B")], 7)
    assert clips == [0, 4, 4, 7]


def test_overlap_is_preserved_and_cut_between_exclusive_speaker_spans():
    # A alone 0..2, A+B 2..4, B alone 4..6. All overlap audio stays
    # in the two contiguous clips; the overlap is not a third speaker.
    clips = speaker_change_clips([span(0, 4, "A"), span(2, 6, "B")], 7)
    assert clips == [0, 3, 3, 7]
    assert_partition(clips, 7)


def test_overlap_without_exclusive_turn_of_new_id_does_not_force_a_cut():
    assert speaker_change_clips([span(0, 6, "A"), span(2, 4, "B")], 6) == [0, 6]


def test_overlap_only_does_not_invent_an_exclusive_speaker():
    assert speaker_change_clips([span(1, 5, "A"), span(1, 5, "B")], 6) == [0, 6]


def test_duplicate_and_overlapping_intervals_for_same_id_count_once():
    intervals = [span(0, 4, 0), span(0, 4, "0"), span(2, 3, 0.0), span(6, 8, 1)]
    assert speaker_change_clips(intervals, 9) == [0, 5, 5, 9]


def test_touching_changes_have_no_synthetic_gap_and_support_native_fields():
    intervals = [{"Start": 0, "End": 2, "Speaker": 0},
                 {"Start": 2, "End": 4, "Speaker": 1},
                 {"Start": 4, "End": 6, "Speaker": 0}]
    assert speaker_change_clips(intervals, 6) == [0, 2, 2, 4, 4, 6]


def test_intervals_are_clamped_and_out_of_source_intervals_ignored():
    intervals = [span(-4, 2, "A"), span(4, 20, "B"), span(-5, -1, "C"), span(10, 20, "D")]
    assert speaker_change_clips(intervals, 6) == [0, 3, 3, 6]


def test_malformed_and_nonfinite_intervals_are_ignored():
    invalid = [span(float("nan"), 2, "X"), span(2, float("inf"), "X"), span(True, 2, "X"),
               span(4, 2, "X"), span(2, 2, "X"), span(0, 4, None), span(0, 4, ""),
               span(0, 4, float("nan")), span(0, 4, True), span(0, 4, {}), {}, None, "invalid"]
    assert speaker_change_clips(invalid + [span(0, 2, "A"), span(4, 6, "B")], 6) == [0, 3, 3, 6]


@pytest.mark.parametrize("duration", [-1, float("nan"), float("inf"), -float("inf"), None, True])
def test_invalid_duration_is_rejected(duration):
    with pytest.raises(ValueError, match="duration"):
        speaker_change_clips([], duration)


def test_large_finite_timestamps_do_not_overflow_when_finding_midpoint():
    clips = speaker_change_clips([span(0, 1e308, "A"), span(1.2e308, 1.7e308, "B")], 1.7e308)
    assert clips[1] == pytest.approx(1.1e308)
    assert_partition(clips, 1.7e308)


def test_initial_short_window_is_merged_forward():
    assert speaker_change_clips([span(0, 0.1, "A"), span(0.1, 2, "B")], 2) == [0, 2]


def test_final_short_window_is_merged_backward():
    assert speaker_change_clips([span(0, 1.9, "A"), span(1.9, 2, "B")], 2) == [0, 2]


def test_short_middle_window_merges_without_losing_audio():
    clips = speaker_change_clips([span(0, 1, "A"), span(1, 1.1, "B"), span(1.1, 3, "A")], 3)
    assert clips == [0, 1, 1, 3]
    assert_partition(clips, 3)


def test_exact_half_second_windows_are_retained():
    assert speaker_change_clips([span(0, 0.5, "A"), span(0.5, 1, "B")], 1) == [0, 0.5, 0.5, 1]


def test_source_shorter_than_minimum_is_kept_whole_despite_changes():
    assert speaker_change_clips([span(0, 0.1, "A"), span(0.1, 0.2, "B")], 0.2) == [0, 0.2]


def test_many_ultrashort_turns_never_create_tiny_decoder_windows():
    intervals = [span(index / 100, (index + 1) / 100, str(index % 2)) for index in range(230)]
    clips = speaker_change_clips(intervals, 2.3)
    assert_partition(clips, 2.3)
    assert len(clips) <= 8


def test_unordered_intervals_are_deterministic_and_input_is_unchanged():
    intervals = [span(0, 4, "A"), span(2, 6, "B"), span(7, 8, "B"),
                 span(9, 10, "A"), span(10, 10.1, "C"), span(10.1, 12, "A")]
    original = copy.deepcopy(intervals)
    expected = speaker_change_clips(intervals, 13)
    rng = random.Random(2026)
    for _ in range(20):
        shuffled = list(intervals)
        rng.shuffle(shuffled)
        assert speaker_change_clips(shuffled, 13) == expected
    assert intervals == original
    assert_partition(expected, 13)
