"""Explain attribution and offer bounded, review-only boundary recommendations.

This module never changes a caption's speaker, text, timing or review flags.
ASR probability is only an exclusion gate, not a calibrated speaker confidence.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
import math
import json
from typing import Callable


MAX_ACTIVITY = 32
MAX_WORDS = 70
MIN_RECOMMENDATION_ASR_PROBABILITY = 0.8
EPSILON = 1e-6
MAX_EVIDENCE_BYTES = 2 * 1024 * 1024
MAX_CAPTION_BYTES_WITH_EVIDENCE = 6 * 1024 * 1024


class _ActivityIndex:
    """Query normalized, non-overlapping intervals per speaker in log time."""
    def __init__(self, intervals: list[dict]):
        grouped: dict[str, list[dict]] = {}
        for item in intervals:
            grouped.setdefault(item["speaker"], []).append(item)
        self.groups = [(items, [item["start"] for item in items], [item["end"] for item in items])
                       for items in grouped.values()]

    def intersecting(self, start: float, end: float) -> list[dict]:
        if end <= start:
            return []
        return [item for items, starts, ends in self.groups
                for item in items[bisect_right(ends, start):bisect_left(starts, end)]]


def _probability(word: dict) -> float | None:
    value = word.get("probability")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
        return None
    return value if math.isfinite(value) else None


def _activity(start: float, end: float, intervals: _ActivityIndex, speaker_ids: dict) -> list[dict]:
    if end <= start:
        return []  # Sub-microsecond input can collapse under existing rounding.
    coverage: dict[str, float] = {}
    for item in intervals.intersecting(start, end):
        overlap = min(end, item["end"]) - max(start, item["start"])
        if overlap > 0:
            identity = speaker_ids[item["speaker"]]
            coverage[identity] = coverage.get(identity, 0.0) + overlap
    return [{"speakerId": identity, "overlapSeconds": round(seconds, 6),
             "coverage": round(min(1.0, seconds / (end - start)), 6)}
            for identity, seconds in sorted(coverage.items(), key=lambda item: (-item[1], item[0]))]


def _reasons(flags: list[str], activity: list[dict], identity: str | None, diarization: bool) -> list[str]:
    reasons = []
    if not diarization:
        reasons.append("diarization_disabled")
    elif "overlap" in flags:
        reasons.append("overlap")
    elif identity is None:
        reasons.append("no_activity" if not activity else
                       "speaker_transition" if len(activity) > 1 else "insufficient_activity")
    if "speech_uncertain" in flags:
        reasons.append("speech_uncertain")
    if "timing" in flags:
        reasons.append("timing_uncertain")
    return reasons


def _eligible_probability(word: dict) -> bool:
    probability = _probability(word)
    return probability is not None and probability >= MIN_RECOMMENDATION_ASR_PROBABILITY


def _recommend_words(atoms: list[dict], intervals: _ActivityIndex, tolerance_ms: int,
                     checkpoint: Callable[[], None]) -> dict[int, tuple[str, list[dict]]]:
    """Read only original strict attributions; never use another recommendation.

    All ASR records share this ordered snapshot. Cross-record anchors therefore
    get the same immediate-neighbor, collision and actual-activity checks.
    """
    recommendations = {}
    if not tolerance_ms:
        return recommendations
    for index, atom in enumerate(atoms):
        if index % 128 == 0:
            checkpoint()
        word, caption, source = atom["word"], atom["caption"], atom["source"]
        if caption["speakerId"] is not None or source["identity"] is not None:
            continue
        if any(flag in caption["reasons"] for flag in ("overlap", "timing", "speech_uncertain")):
            continue
        if atom["overlappingWord"] or not _eligible_probability(source):
            continue
        start, end = word["start"], word["end"]
        width = end - start
        if not 0 < width <= 0.8 + EPSILON:
            continue
        relevant = intervals.intersecting(start, end)
        candidates = {item["speaker"] for item in relevant}
        if len(candidates) != 1:
            continue
        candidate = next(iter(candidates))
        covered = sum(min(end, item["end"]) - max(start, item["start"]) for item in relevant)
        if round(covered, 6) <= 0 or width - covered > tolerance_ms / 1000 + EPSILON:
            continue
        anchors = []
        conflict = False
        for neighbor_index in (index - 1, index + 1):
            if not 0 <= neighbor_index < len(atoms):
                continue
            neighbor = atoms[neighbor_index]
            neighbor_word, neighbor_source = neighbor["word"], neighbor["source"]
            if neighbor_word["end"] <= neighbor_word["start"]:
                continue
            gap = start - neighbor_word["end"] if neighbor_index < index else neighbor_word["start"] - end
            if gap < -EPSILON:
                conflict = True
                break
            if gap > 0.2 + EPSILON:
                continue
            # Even a low-probability differently assigned neighbor is a veto.
            # Rejecting it as an anchor must not erase evidence of conflict.
            neighbor_identity = neighbor_source["identity"]
            if neighbor_identity is not None and neighbor_identity != candidate:
                conflict = True
                break
            if neighbor_identity != candidate or neighbor["overlappingWord"] or not _eligible_probability(neighbor_source):
                continue
            if any(flag in neighbor["caption"]["reasons"] for flag in
                   ("overlap", "timing", "unassigned", "speech_uncertain", "speaker_boundary")):
                continue
            bridge_start = min(start, neighbor_word["start"])
            bridge_end = max(end, neighbor_word["end"])
            if any(item["speaker"] != candidate for item in intervals.intersecting(bridge_start, bridge_end)):
                continue
            anchors.append(neighbor["caption"])
        if anchors and not conflict:
            recommendations[id(word)] = candidate, anchors
    return recommendations


def _json_bytes(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8"))


def bound_speaker_evidence(captions: list[dict], *, budget: int | None = None) -> int:
    """Fit optional evidence without altering any original transcript fields.

    The project, live-result and IPC limits predate this metadata. Reserve room
    for their other fields. Recommendation targets and anchors keep full word
    evidence as a unit; if that cannot fit, recommendations are withheld.
    """
    if budget is None:
        base_size = sum(_json_bytes({key: value for key, value in caption.items() if key != "speakerEvidence"}) + 1
                        for caption in captions) + 2
        budget = max(0, min(MAX_EVIDENCE_BYTES, MAX_CAPTION_BYTES_WITH_EVIDENCE - 256 * 1024 - base_size))
    sizes = {id(caption): _json_bytes(caption["speakerEvidence"]) + len(',"speakerEvidence":')
             for caption in captions if "speakerEvidence" in caption}
    total = sum(sizes.values())
    changed = set()

    def changed_size(caption):
        nonlocal total
        new_size = (_json_bytes(caption["speakerEvidence"]) + len(',"speakerEvidence":')
                    if "speakerEvidence" in caption else 0)
        total += new_size - sizes[id(caption)]
        sizes[id(caption)] = new_size
        changed.add(id(caption))

    protected = set()
    for caption in captions:
        recommendation = caption.get("speakerEvidence", {}).get("recommendation")
        if recommendation:
            protected.update([caption["id"], *recommendation["anchorCaptionIds"]])
    for caption in captions:
        if total <= budget:
            return len(changed)
        evidence = caption.get("speakerEvidence")
        if evidence and evidence["words"] and caption["id"] not in protected:
            evidence.update(words=[], wordsTruncated=True)
            changed_size(caption)
    if total <= budget:
        return len(changed)
    # Don't keep a candidate whose complete source evidence has been discarded.
    for caption in captions:
        evidence = caption.get("speakerEvidence")
        if evidence and evidence.pop("recommendation", None) is not None:
            changed_size(caption)
    for caption in captions:
        if total <= budget:
            return len(changed)
        evidence = caption.get("speakerEvidence")
        if evidence and evidence["words"]:
            evidence.update(words=[], wordsTruncated=True)
            changed_size(caption)
    for caption in captions:
        if total <= budget:
            return len(changed)
        evidence = caption.get("speakerEvidence")
        if evidence and evidence["activity"]:
            evidence.update(activity=[], activityTruncated=True)
            changed_size(caption)
    for caption in captions:
        if total <= budget:
            break
        if caption.pop("speakerEvidence", None) is not None:
            changed_size(caption)
    return len(changed)


def attach_speaker_evidence(captions: list[dict], sources: dict[int, dict], intervals: list[dict],
                            speaker_ids: dict, *, diarization: bool, tolerance_ms: int,
                            checkpoint: Callable[[], None]) -> int:
    """Attach optional versioned evidence after final caption IDs are available."""
    atoms = [{"word": word, "caption": caption, "source": sources[id(word)]}
             for caption in captions for word in caption["words"]]
    atoms.sort(key=lambda item: (item["word"]["start"], item["word"]["end"]))
    previous_end = -math.inf
    for index, atom in enumerate(atoms):
        word = atom["word"]
        # Nested or cross-record ASR spans can overlap a non-immediate word.
        # Mark both sides without changing the original caption timing flags.
        atom["overlappingWord"] = previous_end > word["start"] + EPSILON or (
            index + 1 < len(atoms) and atoms[index + 1]["word"]["start"] < word["end"] - EPSILON)
        previous_end = max(previous_end, word["end"])
    activity_index = _ActivityIndex(intervals)
    recommendations = _recommend_words(atoms, activity_index, tolerance_ms, checkpoint)
    for caption in captions:
        checkpoint()
        word_evidence, reasons, totals = [], [], {}
        total_duration = 0.0
        truncated_activity = False
        for word in caption["words"]:
            if word["end"] <= word["start"]:
                # Preserve the original ASR data, but never export a zero-width
                # evidence span that the optional frontend schema cannot read.
                if "timing_uncertain" not in reasons:
                    reasons.append("timing_uncertain")
                continue
            source = sources[id(word)]
            activity = _activity(word["start"], word["end"], activity_index, speaker_ids)
            word_reasons = _reasons(source["reasons"], activity, source["identity"], diarization)
            reasons.extend(reason for reason in word_reasons if reason not in reasons)
            method = "boundary" if "speaker_boundary" in caption["reasons"] else (
                "activity" if source["identity"] is not None else "unassigned")
            item = {"start": word["start"], "end": word["end"], "sourceRecord": source["record"],
                    "method": method, "reasons": word_reasons, "activity": activity[:MAX_ACTIVITY]}
            probability = _probability(source)
            if probability is not None:
                item["asrProbability"] = probability
            if len(activity) > MAX_ACTIVITY:
                item["activityTruncated"] = truncated_activity = True
            if len(word_evidence) < MAX_WORDS:
                word_evidence.append(item)
            total_duration += word["end"] - word["start"]
            for entry in activity:
                identity = entry["speakerId"]
                totals[identity] = totals.get(identity, 0.0) + entry["overlapSeconds"]
        activity = [{"speakerId": identity, "overlapSeconds": round(seconds, 6),
                     "coverage": round(min(1.0, seconds / total_duration), 6)}
                    for identity, seconds in sorted(totals.items(), key=lambda item: (-item[1], item[0]))]
        evidence = {"version": 1, "method": "boundary" if "speaker_boundary" in caption["reasons"] else (
            "activity" if caption["speakerId"] is not None else "unassigned"),
            "reasons": reasons, "activity": activity[:MAX_ACTIVITY], "words": word_evidence}
        if len(activity) > MAX_ACTIVITY or truncated_activity:
            evidence["activityTruncated"] = True
        if len(word_evidence) < len(caption["words"]):
            evidence["wordsTruncated"] = True
        caption["speakerEvidence"] = evidence
        proposed = [recommendations.get(id(word)) for word in caption["words"]]
        if not proposed or any(item is None for item in proposed) or len(proposed) > 2:
            continue
        candidates = {item[0] for item in proposed}
        if len(candidates) != 1 or evidence.get("activityTruncated") or evidence.get("wordsTruncated"):
            continue
        anchors = {anchor["id"]: anchor for item in proposed for anchor in item[1]}
        snapshots = [caption, *anchors.values()]
        if not 1 <= len(anchors) <= 2 or any(len(item["text"].encode("utf-16-le")) // 2 > 500 for item in snapshots):
            continue
        evidence["recommendation"] = {"speakerId": speaker_ids[next(iter(candidates))],
            "method": "boundary_context", "anchorCaptionIds": list(anchors), "targetWordCount": len(proposed),
            "sourceSnapshots": [{"captionId": item["id"], "start": item["start"], "end": item["end"],
                                 "text": item["text"], "speakerId": item["speakerId"]} for item in snapshots]}
    return bound_speaker_evidence(captions)
