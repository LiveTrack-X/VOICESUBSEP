"""Persistent local models for incremental PCM recognition (never downloads weights).

Nemotron uses its native streaming FIFO/cache. Whisper consumes overlapping,
bounded windows on the same model, committing words by their midpoint. This is
incremental segment recognition, not token streaming or acoustic separation.
"""
from __future__ import annotations

import importlib
from pathlib import Path

from . import model_cache
from .inference import _checkpoint, _nemotron_classes, _release_memory, _whisper_class, build_result

RATE = 16000
STEP = RATE * 4
CONTEXT = RATE


def cached_model_paths(name: str) -> tuple[str, str]:
    name = "large-v3-turbo" if name == "turbo" else name
    if name not in model_cache._MODEL_NAMES:
        raise ValueError("Unsupported local Whisper model.")
    whisper = model_cache._local_model_root() / name
    if not model_cache._complete_model(whisper, name):
        try:
            whisper = Path(model_cache._download_model(name, local_files_only=True))
        except Exception:
            raise RuntimeError("먼저 모델 관리에서 Whisper 모델을 준비하세요. 라이브 모드에서는 모델을 다운로드하지 않습니다.") from None
    if not model_cache._complete_model(whisper, name):
        raise RuntimeError("Whisper 로컬 모델 캐시가 불완전합니다. 모델 관리에서 준비하세요.")
    nemotron = model_cache._nemotron_model_root() / model_cache.NEMOTRON_REVISION
    if model_cache._invalid_nemotron_files(nemotron):
        raise RuntimeError("먼저 모델 관리에서 Nemotron 모델을 준비하세요. 라이브 모드에서는 모델을 다운로드하지 않습니다.")
    return str(whisper.resolve()), str(nemotron.resolve())


class NativeLiveEngine:
    def __init__(self, request: dict, cancelled, stage):
        self.cancelled = cancelled
        self.request = request
        self.whisper = self.model = self.processor = self.cache = None
        self.records = []
        self.intervals = []
        self.last_interval = {}
        self.frame_cursor = 0
        self.chunk_cursor = 0
        self.first = True
        self.committed = 0
        self.detected_language: str | None = None
        self.np = importlib.import_module("numpy")
        try:
            stage("로컬 모델 캐시 확인")
            whisper_path, nemotron_path = cached_model_paths(request["whisperModel"])
            _checkpoint(cancelled)
            if request["device"] == "cuda":
                from .gpu_runtime import ensure_cuda_runtime
                ensure_cuda_runtime()
            stage("Whisper·Nemotron 모델 준비")
            self.torch, model_class, processor_class = _nemotron_classes()
            if request["device"] == "cuda" and not self.torch.cuda.is_available():
                raise RuntimeError("CUDA 장치를 사용할 수 없습니다. CPU를 선택하거나 GPU 실행환경을 확인하세요.")
            self.whisper = _whisper_class()(whisper_path, device=request["device"],
                                            compute_type="int8" if request["device"] == "cpu" else "float16")
            _checkpoint(cancelled)
            self.processor = processor_class.from_pretrained(nemotron_path, local_files_only=True)
            self.processor.set_streaming_mode("low_latency")
            self.model = model_class.from_pretrained(nemotron_path, local_files_only=True).to(request["device"]).eval()
            if self.processor.feature_extractor.sampling_rate != RATE:
                raise RuntimeError("라이브 모델은 16 kHz 입력이 필요합니다.")
            _checkpoint(cancelled)
        except BaseException:
            self.close()
            raise

    def _read(self, path: Path, start: int, end: int):
        with path.open("rb") as source:
            source.seek(start * 2)
            data = source.read((end - start) * 2)
        if len(data) != (end - start) * 2:
            raise RuntimeError("저장된 라이브 PCM 길이가 일치하지 않습니다.")
        return self.np.frombuffer(data, dtype="<i2").astype(self.np.float32) / 32768.0

    def _append_activity(self, active):
        # Raw output columns are persistent speaker identities. The public
        # processor extractor renumbers by arrival separately on every call.
        dt = self.processor.feature_extractor.hop_length / RATE
        for speaker in range(active.shape[1]):
            flags = self.np.pad(active[:, speaker].astype(self.np.int8), (1, 1))
            changes = self.np.diff(flags)
            for start, end in zip(self.np.flatnonzero(changes == 1), self.np.flatnonzero(changes == -1)):
                a, b = (self.frame_cursor + int(start)) * dt, (self.frame_cursor + int(end)) * dt
                previous = self.last_interval.get(speaker)
                if previous is not None and abs(previous["end"] - a) < dt / 2:
                    previous["end"] = b
                else:
                    interval = {"speaker": f"live-{speaker}", "start": a, "end": b}
                    self.intervals.append(interval)
                    self.last_interval[speaker] = interval
        self.frame_cursor += len(active)

    def advance(self, path: Path, samples: int, final: bool = False):
        _checkpoint(self.cancelled)
        p = self.processor
        while True:
            start = 0 if self.first else p.audio_chunk_start(self.chunk_cursor)
            size = p.num_samples_first_audio_chunk if self.first else p.num_samples_per_audio_chunk
            if samples <= start or (samples < start + size and not final):
                break
            last = final and samples <= start + size
            end = samples if last else start + size
            _checkpoint(self.cancelled)
            audio = self._read(path, start, end)
            # Very short final clips need an analysis window of padding. Output
            # times are clipped to the original source duration by build_result.
            if last and len(audio) < 512:
                audio = self.np.pad(audio, (0, 512 - len(audio)))
            with self.torch.inference_mode():
                inputs = p(audio, sampling_rate=RATE, is_streaming=True,
                           is_first_audio_chunk=self.first, is_last_audio_chunk=last)
                if last and self.cache is None:
                    inputs["num_lookahead_frames"] = 0
                inputs = inputs.to(self.model.device, dtype=self.model.dtype)
                output = self.model(**inputs, speaker_cache=self.cache)
                self.cache = output.speaker_cache
                active = (output.logits[0].detach().cpu().numpy() > 0)
            self._append_activity(active)
            self.first = False
            self.chunk_cursor += p.num_mel_frames_per_step
            if last:
                break
        changed = False
        # Diarization's lookahead must be available before assigning ASR words.
        available = samples if final else min(samples - CONTEXT, round(self.frame_cursor * p.feature_extractor.hop_length))
        while self.committed < available and (final or self.committed + STEP <= available):
            _checkpoint(self.cancelled)
            end = min(self.committed + STEP, available)
            start = max(0, self.committed - CONTEXT)
            audio_end = min(samples, end + CONTEXT)
            audio = self._read(path, start, audio_end)
            # Avoid known silence hallucinations without requiring another model.
            if len(audio) and float(self.np.max(self.np.abs(audio))) > 0.0001:
                auto_language = self.request["language"] == "auto"
                segments, info = self.whisper.transcribe(audio,
                    language=self.detected_language if auto_language else self.request["language"],
                    task="transcribe", multilingual=False, word_timestamps=True,
                    vad_filter=False, condition_on_previous_text=False, beam_size=5)
                first_record = len(self.records)
                try:
                    for segment in segments:
                        _checkpoint(self.cancelled)
                        words = []
                        for word in segment.words or []:
                            a, b = word.start + start / RATE, word.end + start / RATE
                            midpoint = (a + b) / 2 * RATE
                            if self.committed <= midpoint < end:
                                words.append({"start": max(0, a), "end": min(samples / RATE, b),
                                              "text": word.word, "probability": word.probability})
                        if words:
                            self.records.append({"start": words[0]["start"], "end": words[-1]["end"],
                                                 "text": "".join(w["text"] for w in words), "words": words})
                finally:
                    if callable(getattr(segments, "close", None)):
                        segments.close()
                _checkpoint(self.cancelled)
                # Each live window would otherwise start AUTO detection anew.
                # Keep the first confident language with committed speech for
                # this session; silence/uncertain windows never choose a fallback.
                if auto_language and self.detected_language is None:
                    detected = getattr(info, "language", None)
                    probability = getattr(info, "language_probability", None)
                    if (isinstance(detected, str) and 2 <= len(detected) <= 3 and detected.isalpha()
                            and isinstance(probability, (int, float)) and not isinstance(probability, bool)
                            and 0.5 <= probability <= 1
                            and any(record["text"].strip() for record in self.records[first_record:])):
                        self.detected_language = detected
            self.committed = end
            changed = True
            if len(self.records) > 50000 or len(self.intervals) > 200000:
                raise RuntimeError("라이브 자막 한도에 도달했습니다. 원본 녹음을 보존하고 새 세션을 시작하세요.")
        if not changed and not final:
            return None
        result = build_result(self.records, self.intervals, duration=max(samples / RATE, 1 / RATE),
                              speaker_count=self.request["speakerCount"], mode="overlap", cancelled=self.cancelled)
        result["warnings"].append("라이브 인식은 약 4초 단위로 갱신됩니다. 화자 초기 적응·겹친 말·경계 단어를 원본과 검수하세요.")
        return result, self.committed / RATE

    def close(self):
        if self.whisper is not None:
            native = getattr(self.whisper, "model", None)
            if callable(getattr(native, "unload_model", None)):
                native.unload_model()
        self.whisper = self.model = self.processor = self.cache = None
        _release_memory()
