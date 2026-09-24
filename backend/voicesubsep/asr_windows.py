"""Choose ASR windows from speaker changes without discarding source audio."""

from __future__ import annotations

import math


MIN_CLIP_SECONDS = 0.5


def _finite_number(value) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _speaker_key(value) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        if value.is_integer():
            value = int(value)
    key = str(value).strip()
    return key or None


def speaker_change_clips(intervals: list[dict], duration: float) -> list[float]:
    """Return flat Whisper clip timestamps covering exactly ``[0, duration]``.

    Only changes between exclusive (one active speaker ID) spans suggest cuts.
    A cut is halfway between the previous exclusive span's end and the next
    exclusive span's start. Silence and overlap stay in the surrounding clips;
    these windows neither separate voices nor assign a speaker to the audio.
    Duplicate activity for one ID still counts as one active speaker.

    Cuts that would make a window shorter than 0.5 seconds are skipped from left
    to right; a short final window is merged backward. A source shorter than
    0.5 seconds is kept whole, including the zero-duration ``[0.0, 0.0]`` case.
    Invalid intervals are ignored; invalid or negative duration is an error.
    Native Nemotron ``Start/End/Speaker`` and normalized lowercase keys work.
    """
    duration_value = _finite_number(duration)
    if duration_value is None or duration_value < 0:
        raise ValueError("Audio duration must be a finite non-negative number.")
    if duration_value == 0:
        return [0.0, 0.0]

    events: dict[float, dict[str, int]] = {}
    for interval in intervals:
        if not isinstance(interval, dict):
            continue
        start = _finite_number(interval.get("Start", interval.get("start")))
        end = _finite_number(interval.get("End", interval.get("end")))
        speaker = _speaker_key(interval.get("Speaker", interval.get("speaker")))
        if start is None or end is None or speaker is None:
            continue
        start = min(duration_value, max(0.0, start))
        end = min(duration_value, max(0.0, end))
        if end <= start:
            continue
        for time, delta in ((start, 1), (end, -1)):
            changes = events.setdefault(time, {})
            changes[speaker] = changes.get(speaker, 0) + delta

    active: dict[str, int] = {}
    previous_time = None
    previous_speaker = None
    previous_solo_end = None
    cuts: list[float] = []
    for time in sorted(events):
        if previous_time is not None and time > previous_time and len(active) == 1:
            speaker = next(iter(active))
            if previous_speaker is not None and speaker != previous_speaker:
                cuts.append(previous_solo_end + (previous_time - previous_solo_end) / 2)
            previous_speaker = speaker
            previous_solo_end = time
        # Apply simultaneous starts/ends together so touching spans do not
        # create artificial silence, overlap, or a zero-length exclusive turn.
        for speaker, delta in events[time].items():
            count = active.get(speaker, 0) + delta
            if count > 0:
                active[speaker] = count
            else:
                active.pop(speaker, None)
        previous_time = time

    boundaries = [0.0]
    for cut in cuts:
        if cut - boundaries[-1] >= MIN_CLIP_SECONDS:
            boundaries.append(cut)
    if len(boundaries) > 1 and duration_value - boundaries[-1] < MIN_CLIP_SECONDS:
        boundaries.pop()
    boundaries.append(duration_value)
    return [time for pair in zip(boundaries, boundaries[1:]) for time in pair]
