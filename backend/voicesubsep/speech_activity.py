"""Conservative, CPU-only evidence for Whisper silence hallucinations.

Explicit Whisper clip timestamps bypass its built-in VAD. This independent
check never concatenates audio, changes timestamps, or inspects recognized
text. It retains uncertain audio; the thresholds are safeguards, not proof
that every quiet utterance or laugh can be recognized by a speech detector.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Callable
import wave


SAMPLE_RATE = 16000
FRAME_SAMPLES = 512
CONTEXT_SECONDS = 0.25
MAX_UNIT_SECONDS = 30
CACHE_SECONDS = 60
WARMUP_SECONDS = 2
# A cache includes the next longest accepted unit and context. At most 94 s
# of PCM/float audio are resident, independent of the recording's length.
MAX_CACHE_SAMPLES = (CACHE_SECONDS + MAX_UNIT_SECONDS + 2 * WARMUP_SECONDS) * SAMPLE_RATE


class SpeechActivityCancelled(Exception):
    pass


def _vad_model():
    # The installed faster-whisper asset is local; this performs no download
    # and SileroVADModel explicitly selects CPUExecutionProvider.
    from faster_whisper.vad import get_vad_model
    return get_vad_model()


def _finite(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError, OverflowError):
        return None


class SpeechActivityGate:
    """One bounded, forward-friendly PCM/VAD cache; failures always keep text."""

    def __init__(self, path: Path, cancelled: Callable[[], bool]):
        self.cancelled = cancelled
        self._wave = None
        self._model = None
        self._cache = None
        self._failed = False
        self.suppressed = 0
        self.uncertain = 0
        self._suppressed_spans: list[tuple[float, float]] = []
        try:
            self._wave = wave.open(str(path), "rb")
            if (self._wave.getframerate(), self._wave.getnchannels(), self._wave.getsampwidth(),
                    self._wave.getcomptype()) != (SAMPLE_RATE, 1, 2, "NONE"):
                raise ValueError("Expected analysis PCM WAV")
            self._frames = self._wave.getnframes()
        except Exception:
            self._failed = True
            self.close()

    def _checkpoint(self):
        if self.cancelled():
            raise SpeechActivityCancelled()

    def _measure(self, start: float, end: float):
        import numpy as np

        first = max(0, math.floor((start - CONTEXT_SECONDS) * SAMPLE_RATE))
        last = min(self._frames, math.ceil((end + CONTEXT_SECONDS) * SAMPLE_RATE))
        if self._cache is None or first < self._cache[0] or last > self._cache[1]:
            self._checkpoint()
            bucket = math.floor(start / CACHE_SECONDS) * CACHE_SECONDS
            base = max(0, math.floor((bucket - WARMUP_SECONDS) * SAMPLE_RATE / FRAME_SAMPLES) * FRAME_SAMPLES)
            limit = min(self._frames, base + MAX_CACHE_SAMPLES)
            self._wave.setpos(base)
            raw = self._wave.readframes(limit - base)
            if len(raw) != (limit - base) * 2:
                raise ValueError("Incomplete analysis PCM")
            samples = np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0
            if self._model is None:
                self._model = _vad_model()
            self._checkpoint()
            padded = np.pad(samples, (0, (-len(samples)) % FRAME_SAMPLES))
            probabilities = np.asarray(self._model(padded)).reshape(-1)
            if (len(probabilities) != len(padded) // FRAME_SAMPLES or
                    not np.isfinite(probabilities).all() or
                    (probabilities < 0).any() or (probabilities > 1).any()):
                raise ValueError("Invalid speech evidence")
            self._checkpoint()
            self._cache = base, limit, samples, probabilities
        base, limit, samples, probabilities = self._cache
        if first < base or last > limit or last <= first:
            raise ValueError("Speech evidence outside bounded cache")
        padded_samples = samples[first - base:last - base]
        probability_start = (first - base) // FRAME_SAMPLES
        probability_end = math.ceil((last - base) / FRAME_SAMPLES)
        surrounding_probabilities = probabilities[probability_start:probability_end]
        unit_first = max(0, math.floor(start * SAMPLE_RATE) - base)
        unit_last = min(len(samples), math.ceil(end * SAMPLE_RATE) - base)
        unit_samples = samples[unit_first:unit_last]
        unit_probabilities = probabilities[unit_first // FRAME_SAMPLES:math.ceil(unit_last / FRAME_SAMPLES)]
        if not len(unit_samples) or not len(unit_probabilities):
            raise ValueError("Empty speech evidence")
        rms = float(np.sqrt(np.mean(padded_samples * padded_samples)))
        peak = float(np.max(np.abs(padded_samples)))
        unit_rms = float(np.sqrt(np.mean(unit_samples * unit_samples)))
        return (float(np.max(surrounding_probabilities)), rms, peak,
                float(np.mean(unit_probabilities >= 0.1)), unit_rms)

    def classify(self, start: object, end: object, probability: object = None) -> str:
        """Return keep / silence / uncertain, without trusting absent ASR scores."""
        self._checkpoint()
        start, end = _finite(start), _finite(end)
        if self._failed or start is None or end is None:
            return "keep"
        # Keep malformed times, sub-phoneme snippets and oversized spans. Do
        # not use padded zero samples beyond the source as silence evidence.
        if start < 0 or end > self._frames / SAMPLE_RATE or not 0.096 <= end - start <= MAX_UNIT_SECONDS:
            return "keep"
        try:
            max_vad, rms, peak, speech_ratio, unit_rms = self._measure(start, end)
        except SpeechActivityCancelled:
            raise
        except Exception:
            self._failed = True
            self.close()
            return "keep"
        if max_vad < 0.05 and rms <= 10 ** (-50 / 20) and peak <= 10 ** (-35 / 20):
            self.suppressed += 1
            if len(self._suppressed_spans) < 8:
                self._suppressed_spans.append((start, end))
            return "silence"
        score = _finite(probability)
        if score is not None and 0 <= score < 0.5 and speech_ratio <= 0.25 and unit_rms <= 10 ** (-38 / 20):
            self.uncertain += 1
            return "uncertain"
        return "keep"

    def warnings(self) -> list[str]:
        result = []
        if self.suppressed:
            spans = ", ".join(f"{start:.2f}–{end:.2f}초" for start, end in self._suppressed_spans)
            result.append(f"CPU 음성 활동과 신호 크기가 모두 매우 낮은 전사 구간 {self.suppressed}개를 제외했습니다: {spans}. 작은 목소리나 웃음이 빠지지 않았는지 원본을 확인하세요.")
        if self.uncertain:
            result.append(f"음성 인식 신뢰도가 낮고 음성 활동이 희박한 구간 {self.uncertain}개를 삭제하지 않고 ‘음성 확인 필요’로 표시했습니다.")
        if self._failed:
            result.append("CPU 음성 활동 검사를 완료하지 못해 나머지 전사 결과를 보존했습니다. 무음 구간의 잘못된 대사는 원본과 비교해 검수하세요.")
        return result

    def close(self):
        if self._wave is not None:
            self._wave.close()
            self._wave = None
        self._cache = None
        self._model = None
