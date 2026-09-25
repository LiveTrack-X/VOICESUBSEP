"""Synthetic attribution evidence contracts; no models or user media are used."""
from copy import deepcopy
import json
import math

import pytest

from voicesubsep.inference import build_result
from voicesubsep.multitrack import analyze_tracks
from voicesubsep.storage import Storage
from voicesubsep.speaker_evidence import bound_speaker_evidence


def word(start, end, text=" 말", probability=0.95, **extra):
    return {"start": start, "end": end, "text": text, "probability": probability, **extra}


def record(*words):
    return {"start": words[0]["start"], "end": words[-1]["end"], "words": list(words)}


def build(records, activity=None, tolerance=500):
    if activity is None:
        activity = [{"start": 1.3, "end": 3, "speaker": "A"}]
    return build_result(records, activity, duration=60, speaker_count=1, mode="standard",
                        speaker_boundary_ms=tolerance)


def cross_boundary(target=None, anchor=None, **kwargs):
    return build([record(target or word(1, 1.4)), record(anchor or word(1.4, 2, " 다음"))], **kwargs)


def recommendation(caption):
    return caption["speakerEvidence"].get("recommendation")


def test_cross_record_recommendation_preserves_unassigned_and_exact_source_snapshots():
    records = [record(word(1, 1.4)), record(word(1.4, 2, " 다음"))]
    before = deepcopy(records)
    output = build(records)
    target, anchor = output["captions"]
    assert records == before
    assert target["speakerId"] is None and target["reviewed"] is False
    assert target["reasons"] == ["unassigned"]
    assert recommendation(target) == {
        "speakerId": "speaker-1", "method": "boundary_context", "anchorCaptionIds": [anchor["id"]],
        "targetWordCount": 1,
        "sourceSnapshots": [{"captionId": item["id"], "start": item["start"], "end": item["end"],
                             "text": item["text"], "speakerId": item["speakerId"]} for item in (target, anchor)]}
    evidence = target["speakerEvidence"]
    assert evidence["method"] == "unassigned" and evidence["reasons"] == ["insufficient_activity"]
    assert evidence["activity"] == [{"speakerId": "speaker-1", "overlapSeconds": 0.1, "coverage": 0.25}]
    assert evidence["words"][0] == {"start": 1.0, "end": 1.4, "sourceRecord": 0,
        "method": "unassigned", "reasons": ["insufficient_activity"], "activity": evidence["activity"],
        "asrProbability": 0.95}
    assert anchor["speakerEvidence"]["words"][0]["sourceRecord"] == 1
    assert "confidence" not in json.dumps(evidence)


def test_previous_record_is_allowed_but_zero_setting_disables_recommendations():
    records = [record(word(1, 1.6)), record(word(1.6, 2))]
    activity = [{"start": 1, "end": 1.7, "speaker": "A"}]
    target = build(records, activity)["captions"][-1]
    assert target["speakerId"] is None and recommendation(target)["speakerId"] == "speaker-1"
    assert recommendation(build(records, activity, tolerance=0)["captions"][-1]) is None


@pytest.mark.parametrize("probability", [None, 0.799, -1, 1.01, float("nan"), float("inf"), True, "0.95"])
@pytest.mark.parametrize("where", ["target", "anchor"])
def test_low_missing_and_malformed_asr_probability_never_become_recommendation_evidence(probability, where):
    target, anchor = word(1, 1.4), word(1.4, 2)
    (target if where == "target" else anchor)["probability"] = probability
    output = cross_boundary(target, anchor)
    assert recommendation(output["captions"][0]) is None
    # Also prove malformed values cannot break strict persisted JSON.
    json.dumps(output, allow_nan=False)
    if probability is None or isinstance(probability, (str, bool)) or probability < 0 or probability > 1 or not math.isfinite(probability):
        assert "asrProbability" not in output["captions"][0 if where == "target" else 1]["speakerEvidence"]["words"][0]


def test_probability_gate_inclusive_boundary_is_only_a_review_recommendation():
    output = cross_boundary(word(1, 1.4, probability=0.8), word(1.4, 2, probability=0.8))
    assert recommendation(output["captions"][0]) is not None
    assert output["captions"][0]["speakerId"] is None


@pytest.mark.parametrize("where", ["target", "anchor"])
def test_speech_uncertain_target_or_anchor_is_excluded(where):
    target, anchor = word(1, 1.4), word(1.4, 2)
    (target if where == "target" else anchor)["_speechUncertain"] = True
    output = cross_boundary(target, anchor)
    assert recommendation(output["captions"][0]) is None
    assert "speech_uncertain" in output["captions"][0 if where == "target" else 1]["speakerEvidence"]["reasons"]


@pytest.mark.parametrize("activity,expected", [
    ([], ["no_activity"]),
    ([{"start": 1, "end": 1.2, "speaker": "A"}, {"start": 1.2, "end": 1.4, "speaker": "B"}],
     ["speaker_transition", "timing_uncertain"]),
    ([{"start": 1, "end": 1.4, "speaker": "A"}, {"start": 1.2, "end": 1.3, "speaker": "B"}], ["overlap"]),
])
def test_evidence_distinguishes_absence_transition_and_detected_overlap(activity, expected):
    target = cross_boundary(activity=activity)["captions"][0]
    assert target["speakerEvidence"]["reasons"] == expected
    assert recommendation(target) is None


def test_disabled_diarization_is_not_mislabeled_activity_miss():
    output = build_result([record(word(1, 2))], None, duration=60, speaker_count=1, mode="standard")
    evidence = output["captions"][0]["speakerEvidence"]
    assert evidence["reasons"] == ["diarization_disabled"]
    assert evidence["activity"] == []


@pytest.mark.parametrize("gap,allowed", [(0.2, True), (0.201, False), (-0.01, False)])
def test_cross_record_gap_and_intersecting_asr_spans_are_guarded(gap, allowed):
    target = cross_boundary(anchor=word(1.4 + gap, 2))["captions"][0]
    assert (recommendation(target) is not None) is allowed


def test_nested_non_immediate_asr_overlap_cannot_support_candidate():
    output = build([record(word(0.1, 1.7)), record(word(0.5, 1)), record(word(1, 1.4)), record(word(1.4, 2))])
    assert recommendation(output["captions"][2]) is None


def test_different_speaker_immediate_neighbor_blocks_matching_anchor_even_with_low_probability():
    records = [record(word(0.4, 1, probability=0.1)), record(word(1, 1.4)), record(word(1.4, 2))]
    output = build(records, [{"start": 0.4, "end": 1, "speaker": "B"}, {"start": 1.3, "end": 3, "speaker": "A"}])
    assert recommendation(output["captions"][1]) is None


def test_other_speaker_activity_in_bridge_is_a_veto():
    output = cross_boundary(anchor=word(1.6, 2), activity=[
        {"start": 1.3, "end": 1.45, "speaker": "A"}, {"start": 1.6, "end": 2, "speaker": "A"},
        {"start": 1.45, "end": 1.55, "speaker": "B"}])
    assert recommendation(output["captions"][0]) is None


def test_recommendations_do_not_cascade_across_records():
    output = build([record(word(0.8, 1.2)), record(word(1.2, 1.6)), record(word(1.6, 2))],
                  [{"start": 1.1, "end": 1.35, "speaker": "A"}, {"start": 1.55, "end": 2, "speaker": "A"}])
    first, second, anchor = output["captions"]
    assert recommendation(first) is None
    assert recommendation(second)["anchorCaptionIds"] == [anchor["id"]]
    assert first["speakerId"] is None and second["speakerId"] is None


def test_existing_boundary_compensated_caption_cannot_become_new_anchor():
    output = build([record(word(1, 1.2)), record(word(1.2, 1.6), word(1.6, 2))],
                  [{"start": 1.15, "end": 1.25, "speaker": "A"}, {"start": 1.55, "end": 2, "speaker": "A"}])
    assert "speaker_boundary" in output["captions"][1]["reasons"]
    assert recommendation(output["captions"][0]) is None
    assert output["captions"][1]["speakerEvidence"]["method"] == "boundary"


def test_every_word_in_caption_needs_independent_candidate_and_original_anchors():
    output = build([record(word(0.5, 1)), record(word(1, 1.3), word(1.3, 1.6)), record(word(1.6, 2))], [
        {"start": 0.5, "end": 1, "speaker": "A"}, {"start": 1.1, "end": 1.15, "speaker": "A"},
        {"start": 1.4, "end": 1.5, "speaker": "A"}, {"start": 1.6, "end": 2, "speaker": "A"}])
    first, target, last = output["captions"]
    assert recommendation(target)["targetWordCount"] == 2
    assert recommendation(target)["anchorCaptionIds"] == [first["id"], last["id"]]
    assert len(recommendation(target)["sourceSnapshots"]) == 3
    output = build([record(word(1, 1.2), word(1.2, 1.4)), record(word(1.4, 2))])
    assert recommendation(output["captions"][0]) is None


def test_speaker_activity_and_word_evidence_are_bounded():
    activity = [{"start": 1, "end": 2, "speaker": str(index)} for index in range(40)]
    target = build([record(word(1, 2))], activity)["captions"][0]
    assert target["speakerEvidence"]["activityTruncated"] is True
    assert len(target["speakerEvidence"]["activity"]) == 32
    assert len(target["speakerEvidence"]["words"][0]["activity"]) == 32
    assert recommendation(target) is None


def test_one_caption_with_different_word_candidates_never_gets_single_person_recommendation():
    output = build([record(word(0.5, 1)), record(word(1, 1.3), word(1.3, 1.6)), record(word(1.6, 2))], [
        {"start": 0.5, "end": 1, "speaker": "A"}, {"start": 1.1, "end": 1.15, "speaker": "A"},
        {"start": 1.4, "end": 1.5, "speaker": "B"}, {"start": 1.6, "end": 2, "speaker": "B"}])
    assert recommendation(output["captions"][1]) is None


@pytest.mark.parametrize("width", [0.801, 1.5])
def test_long_unassigned_word_is_never_recommended(width):
    target = cross_boundary(word(1, 1 + width), word(1 + width, 3),
                            activity=[{"start": 1 + width - 0.1, "end": 3, "speaker": "A"}])["captions"][0]
    assert recommendation(target) is None


def test_precision_collapse_and_huge_probability_do_not_break_json_or_divide_by_zero():
    output = build([record(word(1, 1.0000001, probability=10**1000))])
    caption = output["captions"][0]
    assert caption["speakerEvidence"]["activity"] == []
    assert caption["speakerEvidence"]["words"] == []
    assert caption["speakerEvidence"]["wordsTruncated"] is True
    assert caption["speakerEvidence"]["reasons"] == ["timing_uncertain"]
    assert caption["words"] == [{"start": 1.0, "end": 1.0, "text": " 말"}]
    assert recommendation(caption) is None
    json.dumps(output, allow_nan=False)


def test_unrepresentable_activity_amount_and_oversized_utf16_snapshot_have_no_recommendation():
    output = cross_boundary(activity=[{"start": 1.3999999, "end": 3, "speaker": "A"}])
    assert recommendation(output["captions"][0]) is None
    output = cross_boundary(target=word(1, 1.4, text="😀" * 251))
    assert recommendation(output["captions"][0]) is None


def test_optional_evidence_budget_preserves_candidate_bundle_before_other_detail():
    captions = build([record(word(1, 1.4)), record(word(1.4, 2)), record(word(10, 11))])["captions"]
    original_transcript = [{key: value for key, value in item.items() if key != "speakerEvidence"} for item in deepcopy(captions)]
    target_before = deepcopy(captions[0]["speakerEvidence"])
    anchor_before = deepcopy(captions[1]["speakerEvidence"])
    total = sum(len(json.dumps(item["speakerEvidence"], ensure_ascii=False, separators=(",", ":")).encode())
                + len(',"speakerEvidence":') for item in captions)
    assert bound_speaker_evidence(captions, budget=total - 100) == 1
    assert captions[0]["speakerEvidence"] == target_before
    assert captions[1]["speakerEvidence"] == anchor_before
    assert captions[2]["speakerEvidence"]["words"] == []
    assert captions[2]["speakerEvidence"]["wordsTruncated"] is True
    assert [{key: value for key, value in item.items() if key != "speakerEvidence"} for item in captions] == original_transcript


def test_tiny_evidence_budget_withholds_recommendations_and_keeps_original_words():
    captions = cross_boundary()["captions"]
    original = [{key: value for key, value in item.items() if key != "speakerEvidence"} for item in deepcopy(captions)]
    assert bound_speaker_evidence(captions, budget=400) == 2
    assert all("recommendation" not in caption.get("speakerEvidence", {}) for caption in captions)
    assert [{key: value for key, value in item.items() if key != "speakerEvidence"} for item in captions] == original
    bound_speaker_evidence(captions, budget=0)
    assert captions == original


def test_recommendation_evidence_persists_and_legacy_storage_stays_optional(tmp_path):
    store = Storage(tmp_path)
    store.initialize()
    result = cross_boundary()
    store.write_json(tmp_path / "result.json", result)
    assert store.read_json(tmp_path / "result.json") == result
    legacy = {"captions": [{"id": "old", "speakerId": None}], "speakers": []}
    store.write_json(tmp_path / "legacy.json", legacy)
    assert store.read_json(tmp_path / "legacy.json") == legacy


def test_explicit_track_mapping_does_not_export_misleading_diarization_evidence(tmp_path):
    source = cross_boundary()
    output = analyze_tracks(lambda *_args, **_kwargs: source, tmp_path / "unused.wav",
        selections=[{"audioTrack": 2, "speakerId": "chosen", "name": "이름", "color": "#123456"}],
        options={}, progress=lambda *_: None, cancelled=lambda: False)
    assert all(caption["speakerId"] == "chosen" and "speakerEvidence" not in caption for caption in output["captions"])
