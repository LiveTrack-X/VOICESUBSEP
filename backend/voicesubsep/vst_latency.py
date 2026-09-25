"""Conservative, bounded residual-delay evidence after host latency compensation.

This measures this render, not a plugin's universal latency. Periodic, silent,
gated, time-varying or substantially changed signals must not produce a guess.
"""
from __future__ import annotations

import numpy as np

SAMPLE_RATE = 48000
MAX_RESIDUAL_FRAMES = SAMPLE_RATE // 4
WINDOW_FRAMES = SAMPLE_RATE // 2
MAX_WINDOWS = 7
MIN_WINDOWS = 3


def _window_delay(source, processed, maximum: int) -> tuple[int | None, float, str]:
    # Differencing reduces broad autocorrelation lobes and DC, without assuming
    # stereo channels have the same polarity. Each channel is checked separately.
    if float(np.sqrt(np.mean(np.square(source, dtype=np.float64)))) < 0.0001:
        return None, 0.0, "silent"
    x = np.diff(source.astype(np.float64))
    y = np.diff(processed.astype(np.float64))
    x -= x.mean()
    energy = float(np.dot(x, x))
    if energy < len(x) * 1e-10:
        return None, 0.0, "silent"
    size = 1 << (len(x) + len(y) - 2).bit_length()
    convolution = np.fft.irfft(np.fft.rfft(y, size) * np.fft.rfft(x[::-1], size), size)
    dots = convolution[len(x) - 1:len(y)]
    sums = np.concatenate(([0.0], np.cumsum(y)))
    squares = np.concatenate(([0.0], np.cumsum(y * y)))
    local_energy = np.maximum(0, squares[len(x):] - squares[:-len(x)]
                              - (sums[len(x):] - sums[:-len(x)]) ** 2 / len(x))
    scores = np.abs(dots) / np.sqrt(np.maximum(energy * local_energy, 1e-30))
    scores[local_energy < len(x) * 1e-10] = 0
    index = int(np.argmax(scores))
    best = min(1.0, float(scores[index]))
    lag = index - maximum
    # A distant competing peak means periodic/ambiguous content. Ignore only
    # the immediate 1 ms neighborhood of the winning correlation peak.
    alternatives = scores.copy()
    alternatives[max(0, index - 48):index + 49] = 0
    second = float(alternatives.max(initial=0))
    if best < 0.90:
        return None, best, "low-correlation"
    if second > best * 0.85 or best - second < 0.08:
        return None, best, "ambiguous"
    if abs(lag) >= maximum:
        return None, best, "search-boundary"
    return lag, best, "matched"


def measure_residual(source, processed, progress=lambda _: None) -> dict:
    """Read at most seven non-overlapping half-second windows, never whole audio.

    Readers expose frames/num_channels/read/seek. ``processed`` includes a
    quarter-second flushed tail, and is already aligned by reported latency.
    """
    total, channels = int(source.frames), int(source.num_channels)
    first, last = MAX_RESIDUAL_FRAMES, total - WINDOW_FRAMES - MAX_RESIDUAL_FRAMES
    available = max(0, (last - first) // WINDOW_FRAMES + 1)
    count = min(MAX_WINDOWS, available)
    base = {"status": "uncertain", "reason": "insufficient-audio", "measuredSamples": None,
            "appliedSamples": 0, "confidence": 0.0, "matchedWindows": 0,
            "examinedWindows": count, "maxSearchSamples": MAX_RESIDUAL_FRAMES}
    if count < MIN_WINDOWS:
        return base
    starts = np.linspace(first, last, count, dtype=np.int64)
    matches: list[tuple[int, int, float]] = []
    failures: list[str] = []
    for index, start in enumerate(starts):
        source.seek(int(start))
        processed.seek(int(start) - MAX_RESIDUAL_FRAMES)
        original = source.read(WINDOW_FRAMES)
        rendered = processed.read(WINDOW_FRAMES + 2 * MAX_RESIDUAL_FRAMES)
        if (original.shape != (channels, WINDOW_FRAMES)
                or rendered.shape != (channels, WINDOW_FRAMES + 2 * MAX_RESIDUAL_FRAMES)
                or not np.isfinite(original).all() or not np.isfinite(rendered).all()):
            raise ValueError("Residual latency verification received invalid audio.")
        for channel in range(channels):
            lag, confidence, reason = _window_delay(original[channel], rendered[channel], MAX_RESIDUAL_FRAMES)
            if lag is not None:
                matches.append((index, lag, confidence))
            elif reason != "silent":
                failures.append(reason)
        progress((index + 1) / count)
    base["matchedWindows"] = len({row[0] for row in matches})
    base["confidence"] = round(min((row[2] for row in matches), default=0.0), 6)
    if failures:
        base["reason"] = failures[0]
    elif base["matchedWindows"] < MIN_WINDOWS:
        base["reason"] = "insufficient-signal"
    else:
        lags = [row[1] for row in matches]
        if max(lags) - min(lags) > 1:
            base["reason"] = "inconsistent"
        elif min(lags) < 0:
            base["reason"] = "negative-delay"
        else:
            measured = int(round(float(np.median(lags))))
            base.update(status="corrected" if measured else "verified", reason="consistent",
                        measuredSamples=measured, appliedSamples=measured)
    return base
