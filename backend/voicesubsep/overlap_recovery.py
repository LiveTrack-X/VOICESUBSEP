"""Experimental short-window separation and local-only candidate transcription.

Two outputs are unordered model streams, never named or matched speakers.
All returned caption/word times use the original media clock.
"""
from __future__ import annotations

import gc
import importlib
import math
from pathlib import Path
import shutil
import uuid
import wave

from . import overlap_model_cache as cache
from .inference import AnalysisCancelled, _checkpoint, _run, _whisper_class
from .vocabulary import validate_vocabulary

SAMPLE_RATE = 8000
MIN_SECONDS = 2
MAX_SECONDS = 20
_WHISPER_MODELS = {"tiny", "base", "small", "medium", "large-v3", "large-v3-turbo", "turbo"}


def _runtime():
    try:
        torch = importlib.import_module("torch")
        audio = importlib.import_module("torchaudio")
        speechbrain = importlib.import_module("speechbrain")
        if speechbrain.__version__ != "1.1.2" or audio.__version__.split("+")[0] != "2.11.0" or not torch.__version__.startswith("2.11."):
            raise ImportError("Expected SpeechBrain 1.1.2, TorchAudio 2.11.0 and PyTorch 2.11")
        dual_path = importlib.import_module("speechbrain.lobes.models.dual_path")
        separation = importlib.import_module("speechbrain.inference.separation")
        checkpoints = importlib.import_module("speechbrain.utils.checkpoints")
        return torch, dual_path, separation.SepformerSeparation, checkpoints.hook_on_loading_state_dict_checkpoint
    except Exception as exc:
        raise RuntimeError("겹침 분리 실행환경이 필요합니다. backend[separation]의 SpeechBrain 1.1.2·TorchAudio 2.11.0·PyTorch 2.11을 준비하세요. "
                           + f"{type(exc).__name__}: {str(exc)[:250]}") from exc


def model_status() -> dict:
    """Check imports and local checkpoint integrity, without network/model loads."""
    try:
        _runtime()
        _whisper_class()
    except RuntimeError as exc:
        return {"runtimeAvailable": False, "ready": False, "issue": str(exc)}
    missing = cache.invalid_files()
    return {"runtimeAvailable": True, "ready": not missing,
            "issue": "겹침 분리 모델 준비가 필요합니다: " + ", ".join(missing) if missing else None}


def prepare_model(*, progress, cancelled) -> dict:
    _checkpoint(cancelled)
    _runtime()
    _whisper_class()
    cache.prepare_model_files(progress=progress, cancelled=cancelled)
    return {"runtimeAvailable": True, "ready": True, "issue": None,
            "model": cache.MODEL_ID, "revision": cache.REVISION}


def _load_separator(directory: Path, cancelled):
    torch, network, separator_class, patch_state = _runtime()
    _checkpoint(cancelled)
    encoder = network.Encoder(kernel_size=16, out_channels=256)
    def transformer():
        return network.SBTransformerBlock(num_layers=8, d_model=256, nhead=8, d_ffn=1024,
            dropout=0, use_positional_encoding=True, norm_before=True)
    masknet = network.Dual_Path_Model(num_spks=2, in_channels=256, out_channels=256,
        num_layers=2, K=250, intra_model=transformer(), inter_model=transformer(), norm="ln",
        linear_layer_after_inter_intra=False, skip_around_intra=True)
    decoder = network.Decoder(in_channels=256, out_channels=1, kernel_size=16, stride=8, bias=False)
    modules = {"encoder": encoder, "masknet": masknet, "decoder": decoder}
    for name, module in modules.items():
        _checkpoint(cancelled)
        state = torch.load(directory / f"{name}.ckpt", map_location="cpu", weights_only=True)
        module.load_state_dict(patch_state(state), strict=True)
        module.eval()
    _checkpoint(cancelled)
    model = separator_class(modules=modules, hparams={"num_spks": 2, "sample_rate": SAMPLE_RATE},
                            run_opts={"device": "cpu"})
    return torch, model


def _extract_original(source: Path, track: int, first: int, frames: int, destination: Path, cancelled):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg가 필요합니다.")
    # Reconstruct the same zero-based source clock as normal file inference.
    # Sample trim occurs after timestamp gap filling, never input seeking.
    filters = (f"aresample={SAMPLE_RATE}:async=1:first_pts=0,"
               f"atrim=start_sample={first}:end_sample={first + frames},asetpts=PTS-STARTPTS,"
               f"apad=whole_len={frames},atrim=end_sample={frames}")
    _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2",
          "-copyts", "-start_at_zero", "-protocol_whitelist", "file,pipe", "-i", str(source),
          "-map", f"0:{track}", "-vn", "-sn", "-dn", "-filter_threads", "1", "-af", filters,
          "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(destination)], cancelled)
    with wave.open(str(destination), "rb") as audio:
        if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth(), audio.getnframes()) != (SAMPLE_RATE, 1, 2, frames):
            raise RuntimeError("원본 비교 음성의 샘플 수가 선택 구간과 일치하지 않습니다.")


def _read_pcm(path: Path):
    import numpy as np
    with wave.open(str(path), "rb") as audio:
        return np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype("float32") / 32768.0


def _write_pcm(path: Path, values, rate: int = SAMPLE_RATE):
    import numpy as np
    pcm = np.round(np.clip(values, -1.0, 32767 / 32768) * 32768).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(pcm.tobytes())


def _separate(samples, directory: Path, cancelled):
    import numpy as np
    torch = separator = output = None
    try:
        torch, separator = _load_separator(directory, cancelled)
        _checkpoint(cancelled)
        with torch.inference_mode():
            output = separator.separate_batch(torch.from_numpy(samples).unsqueeze(0))
        _checkpoint(cancelled)
        result = output.detach().cpu().numpy()
        if result.shape != (1, len(samples), 2) or not np.isfinite(result).all():
            raise RuntimeError("분리 모델이 유효한 두 음성을 반환하지 않았습니다.")
        return result[0].copy()
    finally:
        output = separator = torch = None
        gc.collect()


def _resolve_local_whisper(name: str) -> Path:
    from . import model_cache
    name = "large-v3-turbo" if name == "turbo" else name
    if name not in _WHISPER_MODELS:
        raise ValueError("지원하지 않는 Whisper 모델입니다.")
    local = model_cache._local_model_root() / name
    if model_cache._complete_model(local, name):
        return local.resolve()
    try:
        cached = Path(model_cache._download_model(name, local_files_only=True))
        if model_cache._complete_model(cached, name):
            return cached.resolve()
    except (OSError, ValueError):
        pass
    raise RuntimeError(f"선택한 Whisper {name} 모델이 이 기기에 없습니다. 먼저 모델 준비를 완료하세요. 겹침 복구는 모델을 자동 다운로드하지 않습니다.")


def _finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _caption_records(records, *, offset: float, duration: float, index: int) -> list[dict]:
    result = []
    # Quantized outer bounds avoid floating addition rounding one ULP outside
    # the returned sample-exact end, which the client validates strictly.
    source_end = round(offset * SAMPLE_RATE + duration * SAMPLE_RATE) / SAMPLE_RATE
    for record in records:
        start, end = _finite(record.get("start")), _finite(record.get("end"))
        text = record.get("text")
        if start is None or end is None or not isinstance(text, str) or not text.strip():
            continue
        start, end = max(0.0, start), min(duration, end)
        if end <= start:
            continue
        absolute_start, absolute_end = offset + start, min(source_end, offset + end)
        if absolute_end <= absolute_start:
            continue
        words = []
        uncertain = False
        for word in record.get("words") or []:
            left, right = _finite(word.get("start")), _finite(word.get("end"))
            if left is None or right is None or not isinstance(word.get("text"), str):
                continue
            left, right = max(start, left), min(end, right)
            if right <= left:
                continue
            absolute_left, absolute_right = max(absolute_start, offset + left), min(absolute_end, offset + right)
            if absolute_right <= absolute_left:
                continue
            item = {"start": absolute_left, "end": absolute_right, "text": word["text"]}
            probability = _finite(word.get("probability"))
            if probability is not None:
                item["probability"] = max(0.0, min(1.0, probability))
            uncertain = uncertain or bool(word.get("_speechUncertain"))
            words.append(item)
        result.append({"id": f"overlap-{index}-{uuid.uuid4().hex}", "start": absolute_start,
            "end": absolute_end, "text": text.strip(), "speakerId": None,
            "reasons": ["overlap", "unassigned", *(["speech_uncertain"] if uncertain else [])],
            "reviewed": False, **({"words": words} if words else {})})
    return result


def _transcribe_candidate(path: Path, *, model_path: Path, language: str, vocabulary: list[str], duration: float,
                          progress, cancelled) -> tuple[list[dict], list[str]]:
    from .speech_activity import SpeechActivityCancelled, SpeechActivityGate
    terms = validate_vocabulary(vocabulary)
    model = segments = gate = None
    try:
        _checkpoint(cancelled)
        model = _whisper_class()(str(model_path), device="cpu", compute_type="int8", local_files_only=True)
        _checkpoint(cancelled)
        if terms:
            hint_tokens = model.hf_tokenizer.encode(" " + ", ".join(terms), add_special_tokens=False).ids
            hint_limit = model.max_length // 2 - 1
            if len(hint_tokens) > hint_limit:
                raise ValueError(f"Whisper 용어 힌트는 이 모델에서 {hint_limit}토큰까지 지원합니다. "
                                 "용어를 줄이세요. 용어를 자동으로 자르지 않습니다.")
        segments, _ = model.transcribe(str(path), language=None if language == "auto" else language,
            task="transcribe", multilingual=False, word_timestamps=True, vad_filter=False,
            condition_on_previous_text=False, beam_size=5,
            **({"hotwords": ", ".join(terms)} if terms else {}))
        gate = SpeechActivityGate(path, cancelled)
        records = []
        for segment in segments:
            _checkpoint(cancelled)
            words = []
            dropped = False
            for word in segment.words or []:
                verdict = gate.classify(word.start, word.end, getattr(word, "probability", None))
                if verdict == "silence":
                    dropped = True
                    continue
                item = {"start": word.start, "end": word.end, "text": word.word,
                        "probability": getattr(word, "probability", None)}
                if verdict == "uncertain":
                    item["_speechUncertain"] = True
                words.append(item)
            keep = bool(words) if segment.words else gate.classify(segment.start, segment.end) != "silence"
            if keep:
                records.append({"start": segment.start, "end": segment.end,
                    "text": "".join(word["text"] for word in words) if dropped else segment.text, "words": words})
            progress("분리 후보를 CPU Whisper로 재전사", min(1.0, max(0.0, segment.end / duration)))
        _checkpoint(cancelled)
        return records, gate.warnings()
    except SpeechActivityCancelled:
        raise AnalysisCancelled("겹침 구간 재전사를 취소했습니다.") from None
    finally:
        if gate is not None:
            gate.close()
        if segments is not None and callable(getattr(segments, "close", None)):
            segments.close()
        unload = getattr(getattr(model, "model", None), "unload_model", None)
        if callable(unload):
            try:
                unload()
            except Exception:
                pass
        model = segments = gate = None
        gc.collect()


def recover_overlap(media_path: Path, *, audio_track: int, start: float, end: float, whisper_model: str,
                    language: str, vocabulary: list[str], output_dir: Path, progress, cancelled) -> dict:
    """Preserve originals; publish only after both candidate streams complete."""
    import numpy as np
    _checkpoint(cancelled)
    if (isinstance(audio_track, bool) or not isinstance(audio_track, int) or not 0 <= audio_track <= 4096
            or _finite(start) is None or _finite(end) is None or start < 0
            or not MIN_SECONDS <= end - start <= MAX_SECONDS):
        raise ValueError("겹침 복구는 원본의 2–20초 구간과 유효한 오디오 트랙이 필요합니다.")
    if not isinstance(language, str) or (language != "auto" and not (2 <= len(language) <= 10 and language.replace("-", "").isalpha())):
        raise ValueError("지원하는 언어 코드 또는 auto를 선택하세요.")
    vocabulary = validate_vocabulary(vocabulary)
    media_path, output_dir = Path(media_path), Path(output_dir)
    if not media_path.is_file():
        raise ValueError("원본 미디어가 없습니다.")
    # The manager supplies an app-owned job directory. Refuse preexisting files,
    # links, and any destination equal to the input before writing or cleanup.
    if output_dir.is_symlink() or (output_dir.exists() and (not output_dir.is_dir() or any(output_dir.iterdir()))):
        raise ValueError("겹침 복구 출력에는 비어 있는 작업 폴더가 필요합니다.")
    if media_path.resolve().is_relative_to(output_dir.resolve()):
        raise ValueError("원본 미디어가 있는 폴더에 결과를 쓸 수 없습니다.")
    directory = cache.require_model()
    _runtime()
    whisper_path = _resolve_local_whisper(whisper_model)
    first, last = round(start * SAMPLE_RATE), round(end * SAMPLE_RATE)
    frames, offset = last - first, first / SAMPLE_RATE
    duration = frames / SAMPLE_RATE
    warnings = ["실험적 2인 분리입니다. 두 후보의 순서는 화자 신원이 아니며 원본 대사 복원이나 한국어 정확도를 보장하지 않습니다.",
                "분리 모델은 8 kHz WSJ0-2Mix 학습 모델입니다. 음악·고함·웃음·3인 이상 동시 발화에서는 대사가 손상되거나 섞일 수 있습니다.",
                "원본 자막은 유지했습니다. 분리 음성과 후보 문장을 원본과 비교해 직접 검수하세요."]
    output_dir.mkdir(parents=True, exist_ok=True)
    owned = [output_dir / name for name in ("original.wav", "stream-1.wav", "stream-2.wav", "asr-1.wav", "asr-2.wav")]
    try:
        progress("원본 시간축에서 선택 구간 준비", .03)
        _extract_original(media_path, audio_track, first, frames, owned[0], cancelled)
        _checkpoint(cancelled)
        samples = _read_pcm(owned[0])
        if len(samples) != frames or not np.isfinite(samples).all() or np.max(np.abs(samples)) <= 1 / 32768:
            raise RuntimeError("선택 구간이 무음이거나 유효한 음성 샘플이 없습니다.")
        progress("SepFormer로 두 후보 음성 분리 (CPU)", .12)
        separated = _separate(samples, directory, cancelled)
        # Defensive validation also protects alternate/injected model adapters.
        if separated.shape != (frames, 2) or not np.isfinite(separated).all() or np.max(np.abs(separated)) <= 1 / 32768:
            raise RuntimeError("분리 모델의 출력이 유효하지 않거나 모두 무음입니다.")
        peak = float(np.max(np.abs(separated)))
        if peak > .999:
            separated *= .999 / peak
            warnings.append("PCM 클리핑을 막기 위해 두 후보에 같은 감쇠율을 적용했습니다. 후보 간 상대 음량은 유지했습니다.")
        for index in range(2):
            _write_pcm(owned[index + 1], separated[:, index])
        del separated, samples
        _checkpoint(cancelled)
        progress("분리 완료·재전사 준비", .48)
        streams = []
        for index in range(2):
            _checkpoint(cancelled)
            asr = owned[index + 3]
            ffmpeg = shutil.which("ffmpeg")
            if not ffmpeg:
                raise RuntimeError("FFmpeg가 필요합니다.")
            _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2",
                  "-protocol_whitelist", "file,pipe", "-i", str(owned[index + 1]), "-vn", "-sn", "-dn",
                  "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(asr)], cancelled)
            candidate = _read_pcm(owned[index + 1])
            if np.max(np.abs(candidate)) <= 1 / 32768:
                records, notices = [], [f"분리 후보 {index + 1}이 무음이어서 재전사를 실행하지 않았습니다."]
            else:
                records, notices = _transcribe_candidate(asr, model_path=whisper_path, language=language,
                    vocabulary=vocabulary, duration=duration, cancelled=cancelled,
                    progress=lambda stage, fraction, index=index: progress(stage, .5 + .24 * (index + fraction)))
            warnings.extend(notices)
            streams.append({"index": index, "audioFile": owned[index + 1].name,
                            "captions": _caption_records(records, offset=offset, duration=duration, index=index)})
            asr.unlink(missing_ok=True)
        _checkpoint(cancelled)
        progress("분리 후보 준비 완료", 1.0)
        return {"model": cache.MODEL_ID, "revision": cache.REVISION, "start": offset,
                "end": last / SAMPLE_RATE, "originalFile": "original.wav", "streams": streams, "warnings": warnings}
    except BaseException:
        for path in owned:
            path.unlink(missing_ok=True)
        raise
