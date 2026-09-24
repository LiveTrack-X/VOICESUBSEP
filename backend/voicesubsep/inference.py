"""Local, sequential ASR and optional diarization. No model is imported at startup.

Nemotron's native Transformers API is documented at
https://huggingface.co/nvidia/Nemotron-3-Diarization (2026-09-24).
The processor, not the internal 80 ms encoder stride, determines output timing.
"""

from __future__ import annotations

import gc
import importlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Callable
import wave

from .model_cache import resolve_nemotron_model, resolve_whisper_model
from .asr_windows import speaker_change_clips


class AnalysisCancelled(Exception):
    """The worker observed a cancellation request at a safe boundary."""


NEMOTRON_MODEL = "nvidia/Nemotron-3-Diarization"
WHISPER_MODELS = {"tiny", "base", "small", "medium", "large-v3", "large-v3-turbo", "turbo"}
COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#64748b"]
Progress = Callable[[str, float], None]
Cancelled = Callable[[], bool]


def _whisper_class():
    try:
        return importlib.import_module("faster_whisper").WhisperModel
    except Exception as exc:
        raise RuntimeError(
            "Whisper 실행 모듈을 불러올 수 없습니다. 이 서버의 Python 환경에 "
            "faster-whisper를 설치하고 서버를 다시 시작하세요. docs/MODEL-SETUP.md를 확인하세요."
        ) from exc


def _nemotron_classes():
    try:
        torch = importlib.import_module("torch")
        transformers = importlib.import_module("transformers")
        model = getattr(transformers, "Nemotron3DiarizationForAudioFrameClassification")
        processor = getattr(transformers, "Nemotron3DiarizationProcessor")
        # The processor delegates to this extractor. Model/processor imports
        # alone can succeed while its required audio dependencies are absent.
        extractor = getattr(transformers, "NemotronAsrStreamingFeatureExtractor")
        importlib.import_module("librosa")
        extractor()
        if not callable(getattr(processor, "extract_speaker_dict", None)):
            raise ImportError("Native Nemotron postprocessor is unavailable")
        return torch, model, processor
    except Exception as exc:
        raise RuntimeError(
            "Nemotron 화자 구분 실행환경을 준비해야 합니다. 지원 PyTorch·Transformers·librosa가 "
            "필요합니다. docs/MODEL-SETUP.md의 화자 구분 설치 절차를 확인하세요. "
            f"원인: {type(exc).__name__}: {str(exc)[:300]}"
        ) from exc


def capabilities() -> dict[str, bool]:
    """Import availability only: does not download or check cached model weights."""
    return capability_report()["engines"]


def capability_report() -> dict:
    """Report actionable dependency errors without loading model weights."""
    result = {"whisper": False, "nemotron": False}
    issues = {"whisper": None, "nemotron": None}
    for name, loader in (("whisper", _whisper_class), ("nemotron", _nemotron_classes)):
        try:
            loader()
            result[name] = True
        except RuntimeError as exc:
            issues[name] = str(exc)
    return {"engines": result, "engineIssues": issues}


def _checkpoint(cancelled: Cancelled) -> None:
    if cancelled():
        raise AnalysisCancelled("분석 취소 요청을 처리했습니다.")


def _run(args: list[str], cancelled: Cancelled) -> str:
    """Poll subprocesses without a shell; cancellation always reaps the child."""
    _checkpoint(cancelled)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace", creationflags=flags,
    )
    try:
        while True:
            _checkpoint(cancelled)
            try:
                stdout, stderr = process.communicate(timeout=0.2)
                break
            except subprocess.TimeoutExpired:
                continue
        if process.returncode:
            # Tool output is bounded; paths never originate in a user shell command.
            raise RuntimeError(f"{Path(args[0]).stem} 처리 실패: {stderr[-1600:].strip()}")
        return stdout
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _extract_audio(media_path: Path, audio_track: int, destination: Path, cancelled: Cancelled) -> tuple[float, int]:
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RuntimeError("FFmpeg와 ffprobe가 필요합니다. 설치 후 PATH를 확인하고 서버를 다시 시작하세요.")
    metadata = json.loads(_run([
        ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", str(media_path),
    ], cancelled))
    selected = next((stream for stream in metadata.get("streams", []) if
                     stream.get("index") == audio_track and stream.get("codec_type") == "audio"), None)
    if selected is None:
        raise RuntimeError("선택한 오디오 트랙이 없습니다. 미디어를 다시 열고 트랙을 선택하세요.")
    # Preserve the source player's zero-based timeline, including a delayed audio
    # track and timestamp gaps. Only this global stream index is downmixed. Never
    # combine separate tracks. The original file is left untouched.
    _run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-copyts", "-start_at_zero", "-protocol_whitelist", "file,pipe", "-i", str(media_path),
        "-map", f"0:{audio_track}", "-vn", "-sn", "-dn",
        "-af", "aresample=16000:async=1:first_pts=0", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(destination),
    ], cancelled)
    with wave.open(str(destination), "rb") as wav:
        audio_duration = wav.getnframes() / wav.getframerate()
    if audio_duration <= 0:
        raise RuntimeError("선택한 오디오 트랙에 분석할 샘플이 없습니다.")
    media_duration = _number(metadata.get("format", {}).get("duration")) or 0.0
    return max(audio_duration, media_duration), int(selected.get("channels") or 1)


def prepare_preprocessing_audio(media_path: Path, audio_track: int, destination: Path,
                                cancelled: Cancelled = lambda: False) -> tuple[float, int]:
    """Decode one source track for VST effects, preserving the player's time origin.

    VST effects receive stereo 48 kHz PCM16 before the speech-model downsample.
    RF64 permits recordings longer than the ordinary WAV 4 GiB boundary. The
    original track and its silence/delayed start are never trimmed or replaced.
    """
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RuntimeError("FFmpeg와 ffprobe가 필요합니다. 설치 후 PATH를 확인하세요.")
    metadata = json.loads(_run([
        ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", str(media_path),
    ], cancelled))
    selected = next((stream for stream in metadata.get("streams", []) if
                     stream.get("index") == audio_track and stream.get("codec_type") == "audio"), None)
    if selected is None:
        raise RuntimeError("선택한 오디오 트랙이 없습니다. 미디어를 다시 열고 트랙을 선택하세요.")
    _run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2",
        "-copyts", "-start_at_zero", "-protocol_whitelist", "file,pipe", "-i", str(media_path),
        "-map", f"0:{audio_track}", "-vn", "-sn", "-dn", "-filter_threads", "1",
        "-af", "aresample=48000:async=1:first_pts=0", "-ac", "2", "-ar", "48000",
        "-c:a", "pcm_s16le", "-rf64", "auto", str(destination),
    ], cancelled)
    prepared = json.loads(_run([
        ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_format", "-of", "json", str(destination),
    ], cancelled))
    audio_duration = _number(prepared.get("format", {}).get("duration")) or 0.0
    if audio_duration <= 0:
        raise RuntimeError("선택한 오디오 트랙에 처리할 샘플이 없습니다.")
    media_duration = _number(metadata.get("format", {}).get("duration")) or 0.0
    return max(audio_duration, media_duration), int(selected.get("channels") or 1)


def resample_preprocessing_audio(source: Path, destination: Path,
                                 cancelled: Cancelled = lambda: False) -> None:
    """Downsample the host's time-aligned output without adding/removing gaps."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg가 필요합니다. 설치 후 PATH를 확인하세요.")
    _run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2",
        "-protocol_whitelist", "file,pipe", "-i", str(source), "-map", "0:a:0", "-vn", "-sn", "-dn",
        "-filter_threads", "1", "-af", "aresample=16000", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(destination),
    ], cancelled)
    with wave.open(str(destination), "rb") as wav:
        if wav.getnframes() <= 0 or wav.getframerate() != 16000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise RuntimeError("VST 처리 음성을 분석용 16 kHz 모노로 변환하지 못했습니다.")


def _release_memory() -> None:
    gc.collect()
    torch = sys.modules.get("torch")
    if torch is not None:
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass


def _transcribe(path: Path, *, model_name: str, language: str, device: str,
                duration: float, progress: Progress, cancelled: Cancelled,
                clip_timestamps: list[float] | None = None) -> list[dict]:
    _checkpoint(cancelled)
    if device == "cuda":
        from .gpu_runtime import ensure_cuda_runtime

        progress("CUDA 실행 환경 확인", 0.10)
        ensure_cuda_runtime()
    model_class = _whisper_class()
    model_name = "large-v3-turbo" if model_name == "turbo" else model_name
    model = None
    segments = None
    records: list[dict] = []
    try:
        progress("Whisper 모델 준비 (첫 실행 시 가중치 다운로드)", 0.12)
        model_path = resolve_whisper_model(model_name)
        _checkpoint(cancelled)
        model = model_class(model_path, device=device, compute_type="int8" if device == "cpu" else "float16")
        _checkpoint(cancelled)
        progress("대사 전사", 0.17)
        segments, _ = model.transcribe(
            str(path), language=None if language == "auto" else language,
            multilingual=language == "auto",
            word_timestamps=True, vad_filter=False, condition_on_previous_text=False,
            beam_size=5,
            **({"clip_timestamps": clip_timestamps} if clip_timestamps else {}),
        )
        last_progress = 0.17
        for segment in segments:
            _checkpoint(cancelled)
            words = []
            for word in segment.words or []:
                item = {"start": word.start, "end": word.end, "text": word.word}
                probability = _number(getattr(word, "probability", None))
                if probability is not None:
                    item["probability"] = min(1.0, max(0.0, probability))
                words.append(item)
            records.append({"start": segment.start, "end": segment.end, "text": segment.text, "words": words})
            last_progress = max(last_progress, min(0.64, 0.17 + 0.47 * max(0.0, segment.end) / duration))
            progress("대사 전사", last_progress)
        _checkpoint(cancelled)
        return records
    except AnalysisCancelled:
        raise
    except Exception as exc:
        raise RuntimeError(
            "Whisper 실행에 실패했습니다. 선택한 장치의 실행 환경과 모델 다운로드 연결을 확인하세요. "
            "CUDA 오류라면 CPU 또는 더 작은 모델로 다시 실행할 수 있습니다. " + str(exc)[:500]
        ) from exc
    finally:
        if segments is not None and callable(getattr(segments, "close", None)):
            segments.close()
        if model is not None:
            unload = getattr(getattr(model, "model", None), "unload_model", None)
            if callable(unload):
                try:
                    unload()
                except Exception:
                    pass
        segments = None
        model = None
        _release_memory()


def _stream_chunks(audio, processor):
    """Follow the native processor's lookahead/window contract; retain global IDs."""
    first_size = processor.num_samples_first_audio_chunk
    if len(audio) <= first_size:
        yield audio, True, True, len(audio)
        return
    yield audio[:first_size], True, False, first_size
    cursor = processor.num_mel_frames_per_step
    start = processor.audio_chunk_start(cursor)
    while start + processor.num_samples_per_audio_chunk < len(audio):
        end = start + processor.num_samples_per_audio_chunk
        yield audio[start:end], False, False, end
        cursor += processor.num_mel_frames_per_step
        start = processor.audio_chunk_start(cursor)
    yield audio[start:], False, True, len(audio)


def _configure_file_diarization(processor, model) -> None:
    """Use the official offline context with bounded, cancellable forwards.

    Uploads already contain future audio. The one-second live preset can merge
    similar voices before it has enough context. Keep the processor's alignment
    and a single cache, but match BOTH offline chunk and FIFO/update sizes.
    """
    config = model.config
    processor.streaming_modes = {
        **processor.streaming_modes,
        "file": (config.chunk_length, config.chunk_right_context),
    }
    processor.set_streaming_mode("file")
    config.streaming_config.fifo_length = config.fifo_length
    config.streaming_config.speaker_cache_update_period = config.speaker_cache_update_period


def _diarize(path: Path, *, device: str, progress: Progress, cancelled: Cancelled) -> list[dict]:
    torch, model_class, processor_class = _nemotron_classes()
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("PyTorch에서 CUDA 장치를 찾지 못했습니다. CUDA용 PyTorch를 설치하거나 CPU를 선택하세요.")
    model = processor = inputs = outputs = cache = logits = audio = None
    chunks: list = []
    try:
        _checkpoint(cancelled)
        progress("Nemotron 모델 준비 (첫 실행 시 가중치 다운로드)", 0.67)
        model_path = resolve_nemotron_model()
        _checkpoint(cancelled)
        processor = processor_class.from_pretrained(model_path, local_files_only=True)
        model = model_class.from_pretrained(model_path, local_files_only=True).to(device).eval()
        # Float32 avoids assuming BF16 support on arbitrary user-selected GPUs.
        _configure_file_diarization(processor, model)
        sampling_rate = processor.feature_extractor.sampling_rate
        if sampling_rate != 16000:
            raise RuntimeError("Nemotron 모델의 샘플률이 예상한 16 kHz와 다릅니다.")
        np = importlib.import_module("numpy")
        with wave.open(str(path), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != sampling_rate:
                raise RuntimeError("분석용 오디오 형식이 16 kHz mono PCM16이 아닙니다.")
            audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
        with torch.inference_mode():
            for samples, first, last, consumed in _stream_chunks(audio, processor):
                _checkpoint(cancelled)
                inputs = processor(samples, sampling_rate=sampling_rate, is_streaming=True,
                                   is_first_audio_chunk=first, is_last_audio_chunk=last)
                inputs = inputs.to(model.device, dtype=model.dtype)
                outputs = model(**inputs, speaker_cache=cache)
                cache = outputs.speaker_cache
                chunks.append(outputs.logits.detach().cpu())
                progress("화자 활동 분석", 0.70 + 0.24 * consumed / len(audio))
        _checkpoint(cancelled)
        logits = torch.cat(chunks, dim=1)
        # Official extraction applies sigmoid + threshold and uses the 10 ms mel
        # frame stride; overlapping speakers intentionally produce overlap.
        return processor.extract_speaker_dict(logits)[0]
    except AnalysisCancelled:
        raise
    except Exception as exc:
        raise RuntimeError(
            "Nemotron 화자 분석에 실패했습니다. 지원 실행환경, 장치 메모리와 "
            "모델 캐시를 확인한 뒤 다시 실행하세요. " + str(exc)[:500]
        ) from exc
    finally:
        model = processor = inputs = outputs = cache = logits = audio = None
        chunks.clear()
        _release_memory()


def _clean_span(start: Any, end: Any, duration: float) -> tuple[float, float, bool] | None:
    start_value, end_value = _number(start), _number(end)
    if start_value is None or end_value is None:
        return None
    clipped_start, clipped_end = max(0.0, min(duration, start_value)), max(0.0, min(duration, end_value))
    if clipped_end <= clipped_start:
        return None
    return clipped_start, clipped_end, clipped_start != start_value or clipped_end != end_value


def merge_speaker_intervals(segments: list[dict], duration: float) -> list[dict]:
    """Union duplicate/touching same-speaker intervals without merging people."""
    per_speaker: dict[str, list[tuple[float, float]]] = {}
    for segment in segments:
        # Native Transformers fields are capitalized, unlike our normalized data.
        start = segment.get("Start", segment.get("start"))
        end = segment.get("End", segment.get("end"))
        speaker = segment.get("Speaker", segment.get("speaker"))
        if speaker is None:
            continue
        span = _clean_span(start, end, duration)
        if span is not None:
            per_speaker.setdefault(str(speaker), []).append(span[:2])
    merged = []
    for speaker, spans in per_speaker.items():
        for start, end in sorted(spans):
            if merged and merged[-1]["speaker"] == speaker and start <= merged[-1]["end"] + 1e-9:
                merged[-1]["end"] = max(merged[-1]["end"], end)
            else:
                merged.append({"start": start, "end": end, "speaker": speaker})
    return sorted(merged, key=lambda item: (item["start"], item["end"], item["speaker"]))


def _attribute(start: float, end: float, intervals: list[dict]) -> tuple[str | None, list[str]]:
    relevant = [item for item in intervals if item["end"] > start and item["start"] < end]
    coverage: dict[str, float] = {}
    for item in relevant:
        coverage[item["speaker"]] = coverage.get(item["speaker"], 0) + min(end, item["end"]) - max(start, item["start"])
    # A midpoint label can silently give a second person's words to the first.
    # Any actual simultaneous activity intersecting this word stays unassigned.
    for i, left in enumerate(relevant):
        for right in relevant[i + 1:]:
            if left["speaker"] != right["speaker"] and min(end, left["end"], right["end"]) > max(start, left["start"], right["start"]) + 1e-6:
                return None, ["overlap", "unassigned"]
    ranked = sorted(coverage.items(), key=lambda item: item[1], reverse=True)
    width = end - start
    if ranked and ranked[0][1] / width >= 0.6 and (len(ranked) == 1 or ranked[1][1] / width < 0.2):
        return ranked[0][0], []
    return None, ["unassigned"] + (["timing"] if len(ranked) > 1 else [])


def _validate_speaker_boundary_ms(value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 800:
        raise RuntimeError("화자 경계 보정은 0~800ms 사이의 정수여야 합니다.")


def _compensate_speaker_boundaries(atoms: list[tuple[dict, str | None, list[str]]],
                                  intervals: list[dict], tolerance_ms: int) -> int:
    """Repair short boundary words using only immediate, strictly assigned anchors.

    Keep original words/timestamps and detected activity intact. The snapshot
    prevents a repaired word becoming evidence for further repairs. Words with
    no actual activity intersection are never attributed by proximity alone.
    """
    if not tolerance_ms:
        return 0
    strict_atoms = list(atoms)
    repaired = 0
    epsilon = 1e-6
    for index, (word, identity, reasons) in enumerate(strict_atoms):
        if identity is not None or "unassigned" not in reasons or any(
            reason in reasons for reason in ("overlap", "timing")
        ):
            continue
        start, end = word["start"], word["end"]
        width = end - start
        if width <= 0 or width > 0.8 + epsilon:
            continue
        relevant = [item for item in intervals if item["end"] > start and item["start"] < end]
        candidates = {item["speaker"] for item in relevant}
        if len(candidates) != 1:
            continue
        candidate = next(iter(candidates))
        covered = sum(min(end, item["end"]) - max(start, item["start"]) for item in relevant)
        if width - covered > tolerance_ms / 1000 + epsilon:
            continue
        anchors = []
        conflict = False
        for neighbor_index in (index - 1, index + 1):
            if not 0 <= neighbor_index < len(strict_atoms):
                continue
            neighbor, neighbor_identity, neighbor_reasons = strict_atoms[neighbor_index]
            gap = start - neighbor["end"] if neighbor_index < index else neighbor["start"] - end
            if gap < -epsilon:
                conflict = True  # Intersecting ASR words have uncertain timing.
                break
            if gap > 0.2 + epsilon or neighbor_identity is None:
                continue
            if neighbor_identity != candidate:
                conflict = True
                break
            if any(reason in neighbor_reasons for reason in ("overlap", "timing", "unassigned")):
                continue
            bridge_start, bridge_end = min(start, neighbor["start"]), max(end, neighbor["end"])
            if any(item["speaker"] != candidate and item["end"] > bridge_start
                   and item["start"] < bridge_end for item in intervals):
                continue
            anchors.append(neighbor_index)
        if anchors and not conflict:
            atoms[index] = (word, candidate, ["speaker_boundary" if reason == "unassigned" else reason
                                             for reason in reasons])
            repaired += 1
    return repaired


def _overlap_windows(intervals: list[dict]) -> list[tuple[float, float]]:
    events: dict[float, int] = {}
    for interval in intervals:
        events[interval["start"]] = events.get(interval["start"], 0) + 1
        events[interval["end"]] = events.get(interval["end"], 0) - 1
    active, previous = 0, None
    windows: list[tuple[float, float]] = []
    for at, delta in sorted(events.items()):
        if previous is not None and active >= 2 and at > previous:
            if windows and abs(windows[-1][1] - previous) < 1e-9:
                windows[-1] = (windows[-1][0], at)
            else:
                windows.append((previous, at))
        active += delta
        previous = at
    return windows


def build_result(records: list[dict], diarization_segments: list[dict] | None, *, duration: float,
                 speaker_count: int, mode: str, speaker_boundary_ms: int = 500,
                 cancelled: Cancelled = lambda: False) -> dict:
    """Pure attribution/segmentation; source times and silent gaps are preserved."""
    _validate_speaker_boundary_ms(speaker_boundary_ms)
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("미디어 길이를 확인할 수 없습니다.")
    intervals = merge_speaker_intervals(diarization_segments or [], duration)
    identities = list(dict.fromkeys(item["speaker"] for item in intervals))
    speaker_ids = {identity: f"speaker-{i + 1}" for i, identity in enumerate(identities)}
    speakers = [{"id": speaker_ids[identity], "name": f"인물 {i + 1}", "color": COLORS[i % len(COLORS)]}
                for i, identity in enumerate(identities)]
    warnings = []
    # The UI's fourth option means "4 or more"; it is not a detection cap.
    mismatch = diarization_segments is not None and (
        len(speakers) < 4 if speaker_count == 4 else len(speakers) != speaker_count
    )
    if mismatch:
        expected = "4명 이상" if speaker_count == 4 else f"{speaker_count}명"
        warnings.append(f"설정 인원 {expected}과 검출 화자 {len(speakers)}명이 다릅니다. 검출 화자를 강제로 합치지 않았습니다.")
    if len(speakers) >= 8:
        warnings.append("Nemotron의 최대 8개 화자 채널이 모두 사용됐습니다. 추가 화자가 섞였는지 확인하세요.")
    if diarization_segments is None:
        warnings.append("전사만 실행했습니다. 인물은 자동 추정하지 않았으므로 직접 배정하세요.")
    if mode == "overlap":
        warnings.append("v0.1 겹침 모드는 화자 활동의 겹침을 검수 표시합니다. 음성 분리나 누락된 두 번째 대사의 복원은 수행하지 않습니다.")
        if diarization_segments is None:
            warnings.append("화자 구분을 끈 상태이므로 겹침 구간도 자동 검출하지 않았습니다.")
    captions: list[dict] = []
    invalid = 0
    boundary_repairs = 0
    for record in sorted(records, key=lambda item: _number(item.get("start")) or 0):
        _checkpoint(cancelled)
        source_words = record.get("words") or []
        fallback = not source_words
        if fallback:
            source_words = [{"start": record.get("start"), "end": record.get("end"), "text": record.get("text", "")}]
        atoms = []
        for word in source_words:
            span = _clean_span(word.get("start"), word.get("end"), duration)
            text = str(word.get("text", ""))
            if span is None or not text.strip():
                invalid += 1
                continue
            start, end, clipped = span
            identity, reasons = _attribute(start, end, intervals)
            if fallback or clipped:
                reasons = list(dict.fromkeys([*reasons, "timing"]))
            if mismatch:
                reasons.append("speaker_count")
            clean_word = {"start": round(start, 6), "end": round(end, 6), "text": text}
            probability = _number(word.get("probability"))
            if probability is not None:
                clean_word["probability"] = max(0, min(1, probability))
            atoms.append((clean_word, identity, reasons))
        atoms.sort(key=lambda item: (item[0]["start"], item[0]["end"]))
        boundary_repairs += _compensate_speaker_boundaries(atoms, intervals, speaker_boundary_ms)
        group: dict | None = None
        for word, identity, reasons in atoms:
            speaker_id = speaker_ids.get(identity)
            # Keep speaker changes, review boundaries and long silent gaps intact.
            can_append = group is not None and group["speakerId"] == speaker_id and group["reasons"] == reasons
            can_append = can_append and word["start"] - group["end"] <= 0.7 and word["end"] - group["start"] <= 6.0
            can_append = can_append and len(group["text"] + word["text"]) <= 70
            if can_append:
                if word["start"] < group["end"] - 0.001 and "timing" not in group["reasons"]:
                    group["reasons"].append("timing")
                group["words"].append(word)
                group["end"] = max(group["end"], word["end"])
                group["text"] += word["text"]
            else:
                group = {"id": "", "start": word["start"], "end": word["end"], "text": word["text"],
                         "speakerId": speaker_id, "reasons": list(reasons), "reviewed": False, "words": [word]}
                captions.append(group)
    captions.sort(key=lambda item: (item["start"], item["end"]))
    for i, caption in enumerate(captions):
        caption["id"] = f"caption-{i + 1}"
        caption["text"] = caption["text"].strip()
    if invalid:
        warnings.append(f"시간이 유효하지 않거나 비어 있는 단어 {invalid}개를 자막으로 만들지 못했습니다. 해당 원문 구간을 확인하세요.")
    if not captions:
        warnings.append("생성된 대사 자막이 없습니다. 무음 또는 전사 누락인지 원본을 확인하세요.")
    if boundary_repairs:
        warnings.append(f"화자 경계 보정 {speaker_boundary_ms}ms로 짧은 단어 {boundary_repairs}개를 인접 화자에 연결했습니다. 경계 보정 표시를 확인하세요.")
    if any("overlap" in caption["reasons"] for caption in captions):
        warnings.append("여러 화자가 동시에 활동한 단어는 인물 미지정으로 남겼습니다. 모든 겹친 대사가 복원됐다는 뜻은 아닙니다.")
    # Independently report detected overlap even when Whisper returned no words
    # there. A missing word cannot carry a low-confidence/review flag itself.
    windows = _overlap_windows(intervals)
    if windows:
        preview = ", ".join(f"{start:.2f}–{end:.2f}초" for start, end in windows[:8])
        warnings.append(f"화자 활동 겹침 {len(windows)}구간을 검출했습니다: {preview}" + (" 외" if len(windows) > 8 else "") + ". 자막이 없는 부분도 원본에서 확인하세요.")
    _checkpoint(cancelled)
    return {"captions": captions, "speakers": speakers, "duration": duration, "warnings": warnings}


def analyze(media_path: Path, *, audio_track: int, mode: str, speaker_count: int,
            whisper_model: str, language: str, device: str, diarization: bool,
            progress: Progress, cancelled: Cancelled, speaker_boundary_ms: int = 500,
            preprocessing: dict | None = None) -> dict:
    _checkpoint(cancelled)
    _validate_speaker_boundary_ms(speaker_boundary_ms)
    if mode not in {"standard", "overlap"} or device not in {"cpu", "cuda"}:
        raise RuntimeError("지원하지 않는 분석 모드 또는 장치입니다.")
    if whisper_model not in WHISPER_MODELS or isinstance(speaker_count, bool) or not 1 <= speaker_count <= 4:
        raise RuntimeError("지원하지 않는 Whisper 모델 또는 설정 인원입니다.")
    if isinstance(audio_track, bool) or not isinstance(audio_track, int) or audio_track < 0:
        raise RuntimeError("오디오 트랙 인덱스가 유효하지 않습니다.")
    if not media_path.is_file():
        raise RuntimeError("분석할 원본 미디어를 찾을 수 없습니다.")
    if preprocessing is not None and (not isinstance(preprocessing, dict)
            or preprocessing.get("applyTo", "asr") not in {"asr", "both"}
            or not isinstance(preprocessing.get("chain"), list)):
        raise RuntimeError("VST 사전처리 설정이 유효하지 않습니다.")
    chain = preprocessing["chain"] if preprocessing else []
    if any(not isinstance(item, dict) for item in chain):
        raise RuntimeError("VST 체인 항목이 유효하지 않습니다.")
    enabled_chain = [item for item in chain if item.get("enabled", True)]
    _whisper_class()
    if diarization:
        _nemotron_classes()  # Fail before extraction/ASR if requested engine is missing.
    progress("선택한 오디오 트랙 확인", 0.02)
    with tempfile.TemporaryDirectory(prefix="voicesubsep-") as directory:
        wav_path = Path(directory) / "selected-track.wav"
        duration, channels = _extract_audio(media_path, audio_track, wav_path, cancelled)
        _checkpoint(cancelled)
        progress("선택한 트랙을 분석용 16 kHz 음성으로 준비", 0.10)
        def mapped_progress(low, high, source_low, source_high):
            def report(stage, value):
                fraction = min(1.0, max(0.0, (value - source_low) / (source_high - source_low)))
                progress(stage, low + fraction * (high - low))
            return report

        asr_path = diarization_path = wav_path
        preprocessing_report = None
        engine_start, diarization_end = 0.10, 0.40
        if enabled_chain:
            from .vst_host import VSTCancelled, process_chain

            raw_path = Path(directory) / "vst-original-48k.wav"
            processed_path = Path(directory) / "vst-processed-48k.wav"
            asr_path = Path(directory) / "vst-processed-16k.wav"
            progress("VST 처리용 48 kHz 오디오 준비", 0.11)
            prepare_preprocessing_audio(media_path, audio_track, raw_path, cancelled)
            _checkpoint(cancelled)
            try:
                preprocessing_report = process_chain(
                    raw_path, processed_path, enabled_chain, cancelled=cancelled,
                    progress=mapped_progress(0.12, 0.23, 0.0, 1.0),
                )
            except VSTCancelled as exc:
                raise AnalysisCancelled("VST 사전처리 취소 요청을 처리했습니다.") from exc
            _checkpoint(cancelled)
            resample_preprocessing_audio(processed_path, asr_path, cancelled)
            if preprocessing.get("applyTo", "asr") == "both":
                diarization_path = asr_path
            engine_start, diarization_end = 0.25, 0.50
            progress("VST 처리 음성을 분석용 16 kHz로 준비", engine_start)

        # Detect turns before ASR, then unload Nemotron. Decode windows cover
        # the WHOLE audio, including overlap and any speech Nemotron missed.
        # This prevents one initial language choice from hiding another person
        # and bounds word alignment at speaker changes without shifting time.
        diarized = _diarize(diarization_path, device=device,
                            progress=mapped_progress(engine_start, diarization_end, 0.67, 0.94),
                            cancelled=cancelled) if diarization else None
        _checkpoint(cancelled)
        clips = speaker_change_clips(diarized, duration) if diarized is not None else None
        records = _transcribe(asr_path, model_name=whisper_model, language=language, device=device,
                              duration=duration, clip_timestamps=clips,
                              progress=mapped_progress(diarization_end if diarization else engine_start, 0.94, 0.10, 0.64),
                              cancelled=cancelled)
        _checkpoint(cancelled)
        progress("단어·화자 시간 연결 및 검수 표시", 0.96)
        result = build_result(records, diarized, duration=duration, speaker_count=speaker_count, mode=mode,
                              speaker_boundary_ms=speaker_boundary_ms, cancelled=cancelled)
        if channels > 1:
            result["warnings"].insert(0, f"선택한 오디오 트랙 #{audio_track}의 {channels}개 채널을 분석용 모노로 변환했습니다. 원본과 다른 트랙은 보존했습니다.")
        if preprocessing_report is not None:
            target = "음성 인식과 화자 구분" if diarization and preprocessing.get("applyTo", "asr") == "both" else "음성 인식"
            result["warnings"].append(f"VST 체인 {len(enabled_chain)}개를 {target}에 적용했습니다. 원본 미디어와 자막 시간 기준은 유지했습니다.")
            if diarization and preprocessing.get("applyTo", "asr") != "both":
                result["warnings"].append("화자 구분은 처리 전 원본 음성으로 실행했습니다.")
            result["warnings"].extend(str(warning) for warning in preprocessing_report.get("warnings", []))
            result["preprocessing"] = {"applyTo": preprocessing.get("applyTo", "asr"), "report": preprocessing_report}
        _checkpoint(cancelled)
        progress("분석 완료", 1.0)
        return result
