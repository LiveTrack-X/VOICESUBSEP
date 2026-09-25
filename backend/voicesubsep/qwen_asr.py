"""Offline native Qwen3 ASR followed by real forced alignment.

The caller resolves pinned model directories explicitly. This module never
downloads models and never substitutes estimated word times for alignment.
"""

from __future__ import annotations

from contextlib import ExitStack
import gc
import math
from pathlib import Path
import unicodedata
import wave

from .recognition_preview import RecognitionPreview


SAMPLE_RATE = 16_000
CHUNK_SECONDS = 30
MAX_NEW_TOKENS = 2048
ALIGNMENT_LANGUAGES = {
    "zh": "Chinese", "en": "English", "yue": "Cantonese", "fr": "French",
    "de": "German", "it": "Italian", "ja": "Japanese", "ko": "Korean",
    "pt": "Portuguese", "ru": "Russian", "es": "Spanish",
}


def load_qwen_classes():
    """Import capability check; does not construct a model or access the Hub."""
    from transformers import (
        Qwen3ASRForConditionalGeneration, Qwen3ASRForTokenClassification, Qwen3ASRProcessor,
    )
    # Korean is a primary application language. Do not advertise an incomplete
    # runtime that can recognize Korean but cannot align its words.
    from soynlp.tokenizer import LTokenizer  # noqa: F401

    return Qwen3ASRForConditionalGeneration, Qwen3ASRForTokenClassification, Qwen3ASRProcessor


def _checkpoint(cancelled):
    if cancelled():
        from .inference import AnalysisCancelled

        raise AnalysisCancelled("분석이 취소되었습니다.")


def alignment_language(value: str | None, *, allow_auto: bool = False) -> str | None:
    if allow_auto and value in {None, "", "auto"}:
        return None
    if isinstance(value, str):
        key = value.strip().lower()
        for code, name in ALIGNMENT_LANGUAGES.items():
            if key in {code, name.lower()}:
                return code
    raise ValueError(
        "Qwen 단어 시간 정렬은 한국어·영어·일본어·중국어·광둥어·프랑스어·독일어·이탈리아어·"
        "포르투갈어·러시아어·스페인어를 지원합니다. 감지 언어를 확인하거나 지원 언어를 직접 선택하세요."
    )


def _kept(character: str) -> bool:
    # Match the pinned processor's _clean_tokens without importing its runtime.
    return character == "'" or unicodedata.category(character).startswith(("L", "N"))


def _source_characters(text: str) -> list[tuple[int, int, str]]:
    """Map normalized tokenizer characters back to untouched source clusters.

    Nagisa normalizes Japanese full/half-width text. Include combining marks
    (including a half-width voiced mark) in the same cluster before NFKC.
    """
    characters = []
    begin = 0
    while begin < len(text):
        end = begin + 1
        while end < len(text):
            next_character = unicodedata.normalize("NFKC", text[end])
            if not next_character or not unicodedata.combining(next_character[0]):
                break
            end += 1
        characters.extend((begin, end, char) for char in unicodedata.normalize("NFKC", text[begin:end]) if _kept(char))
        begin = end
    return characters


def aligned_words(text: str, alignment: list[dict], *, offset: float, duration: float) -> list[dict]:
    """Validate true alignment and restore punctuation/spacing lost by its tokenizer.

    Quantized zero-width tokens are joined to an adjacent aligned interval;
    endpoints come only from the aligner, never uniform text-length estimates.
    Up to one native 80ms tick at the clip end is clipped to the real audio end.
    """
    if not isinstance(text, str) or not text.strip() or not isinstance(alignment, list) or not alignment:
        raise ValueError("Qwen 정렬 결과에 유효한 단어와 시간이 없습니다.")
    source = _source_characters(text)
    clean_source = "".join(char for _, _, char in source)
    tokens = []
    for item in alignment:
        if not isinstance(item, dict) or not isinstance(item.get("text"), str):
            raise ValueError("Qwen 단어 정렬 결과 형식이 올바르지 않습니다.")
        token = "".join(char for char in unicodedata.normalize("NFKC", item["text"]) if _kept(char))
        if not token:
            raise ValueError("Qwen 정렬 결과에 빈 단어가 있습니다.")
        tokens.append(token)
    if "".join(tokens) != clean_source:
        raise ValueError("Qwen 전사와 단어 정렬 텍스트가 일치하지 않습니다. 원문을 보존하기 위해 분석을 중단했습니다.")
    words = []
    cursor = 0
    previous_end = 0.0
    for index, (item, token) in enumerate(zip(alignment, tokens)):
        start, end = item.get("start_time"), item.get("end_time")
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
               for value in (start, end)):
            raise ValueError("Qwen 단어 정렬에 유효하지 않은 시간이 있습니다.")
        if start < previous_end - 0.001 or start < 0 or end < start or end > duration + 0.081:
            raise ValueError("Qwen 단어 정렬 시간이 음원 범위를 벗어나거나 역순입니다.")
        previous_end = end
        # Attach inter-word punctuation and whitespace to the next word, as
        # faster-whisper does. Final punctuation belongs to the final word.
        begin = 0 if index == 0 else source[cursor - 1][1]
        cursor += len(token)
        if cursor < len(source) and source[cursor - 1][:2] == source[cursor][:2]:
            raise ValueError("Qwen 정렬 단어가 원문의 결합 문자 경계와 일치하지 않습니다.")
        finish = len(text) if index == len(tokens) - 1 else source[cursor - 1][1]
        words.append({"start": offset + min(start, duration), "end": offset + min(end, duration),
                      "text": text[begin:finish]})
    merged = []
    prefix = ""
    prefix_start = None
    for word in words:
        if word["end"] <= word["start"]:
            if merged:
                merged[-1]["text"] += word["text"]
                merged[-1]["end"] = max(merged[-1]["end"], word["end"])
            else:
                prefix += word["text"]
                prefix_start = word["start"] if prefix_start is None else prefix_start
            continue
        if prefix:
            word["text"] = prefix + word["text"]
            word["start"] = prefix_start
            prefix = ""
        merged.append(word)
    if not merged or prefix:
        raise ValueError("Qwen 정렬 결과의 모든 단어 길이가 0입니다. 임의의 자막 시간을 생성하지 않습니다.")
    return [{**word, "start": round(word["start"], 6), "end": round(word["end"], 6)} for word in merged]


def _sample_windows(frames: int, clips: list[float] | None, *, duration: float | None = None) -> list[tuple[int, int]]:
    """Validate clip coverage, clipping video-only tails to the real PCM end."""
    if clips is None:
        boundaries = [(0, frames)]
    else:
        if not clips or len(clips) % 2:
            raise ValueError("Qwen 전사 구간은 시작·끝 쌍이어야 합니다.")
        boundaries = []
        previous = 0
        timeline_frames = round(duration * SAMPLE_RATE) if duration is not None else frames
        for index in range(0, len(clips), 2):
            pair = clips[index:index + 2]
            if any(isinstance(value, bool) or not isinstance(value, (float, int))
                   or not math.isfinite(value) or value < 0 for value in pair):
                raise ValueError("Qwen 전사 구간 시간이 유효하지 않습니다.")
            start, end = (round(value * SAMPLE_RATE) for value in pair)
            # Caller duration can differ by a single frame after resampling.
            if index == len(clips) - 2 and abs(end - timeline_frames) <= 1:
                end = timeline_frames
            if start != previous or end <= start or end > timeline_frames:
                raise ValueError("Qwen 전사 구간에 누락·중복 또는 범위 오류가 있습니다.")
            if start < frames:
                boundaries.append((start, min(end, frames)))
            previous = end
        if previous != timeline_frames:
            raise ValueError("Qwen 전사 구간이 전체 음원을 포함하지 않습니다.")
    chunk = CHUNK_SECONDS * SAMPLE_RATE
    return [(start, min(start + chunk, end)) for begin, end in boundaries for start in range(begin, end, chunk)]


def _load_models(model_path: Path, aligner_path: Path, device: str):
    import torch

    asr_class, aligner_class, processor_class = load_qwen_classes()
    dtype = torch.float16 if device == "cuda" else torch.float32
    options = {"local_files_only": True, "trust_remote_code": False}
    processor = processor_class.from_pretrained(str(model_path), **options)
    aligner_processor = processor_class.from_pretrained(str(aligner_path), **options)
    model = asr_class.from_pretrained(str(model_path), dtype=dtype, **options).to(device).eval()
    aligner = aligner_class.from_pretrained(str(aligner_path), dtype=dtype, **options).to(device).eval()
    return torch, processor, model, aligner_processor, aligner


def transcribe_qwen(path: Path, *, model_path: Path, aligner_path: Path, language: str,
                    device: str, duration: float, progress, cancelled,
                    clip_timestamps: list[float] | None = None,
                    recognition_preview: RecognitionPreview | None = None) -> list[dict]:
    """Read bounded 16kHz PCM chunks, recognize and align each before publishing."""
    import numpy as np
    from transformers import StoppingCriteria, StoppingCriteriaList

    _checkpoint(cancelled)
    requested_language = alignment_language(language, allow_auto=True)
    if device not in {"cpu", "cuda"}:
        raise ValueError("Qwen 장치는 cpu 또는 cuda여야 합니다.")
    if not all(Path(item).is_dir() for item in (model_path, aligner_path)):
        raise ValueError("Qwen 전사·정렬 모델을 먼저 완전히 준비해야 합니다.")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise ValueError("Qwen 분석 음원 길이가 유효하지 않습니다.")

    class CancelGeneration(StoppingCriteria):
        def __call__(self, input_ids, scores, **kwargs):
            return bool(cancelled())

    torch = processor = model = aligner_processor = aligner = None
    inputs = output = generated = align_inputs = aligned = decoded = None
    try:
        with ExitStack() as stack:
            stream = stack.enter_context(wave.open(str(path), "rb"))
            if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getcomptype()) != (1, 2, SAMPLE_RATE, "NONE"):
                raise ValueError("Qwen 입력은 16kHz 모노 PCM16 WAV여야 합니다.")
            frames = stream.getnframes()
            if frames <= 0 or frames / SAMPLE_RATE > duration + 0.1:
                raise ValueError("Qwen 입력 음원 길이가 분석 구간과 일치하지 않습니다.")
            frames = min(frames, round(duration * SAMPLE_RATE))
            if frames <= 0:
                raise ValueError("Qwen 입력 음원에 분석 가능한 샘플이 없습니다.")
            windows = _sample_windows(frames, clip_timestamps, duration=duration)
            progress("Qwen 전사·정렬 모델 불러오기", 0.15)
            torch, processor, model, aligner_processor, aligner = _load_models(Path(model_path), Path(aligner_path), device)
            _checkpoint(cancelled)
            records = []
            for begin, end in windows:
                _checkpoint(cancelled)
                stream.setpos(begin)
                raw = stream.readframes(end - begin)
                if len(raw) != (end - begin) * 2:
                    raise ValueError("Qwen 입력 음원을 완전히 읽지 못했습니다.")
                audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
                inputs = processor.apply_transcription_request(audio=audio, language=requested_language)
                inputs = inputs.to(model.device, model.dtype)
                with torch.inference_mode():
                    output = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False,
                                            stopping_criteria=StoppingCriteriaList([CancelGeneration()]))
                _checkpoint(cancelled)
                generated = output[:, inputs["input_ids"].shape[1]:]
                eos = model.generation_config.eos_token_id
                eos_ids = eos if isinstance(eos, (list, tuple)) else [eos]
                if generated.shape[1] >= MAX_NEW_TOKENS and int(generated[0, -1]) not in eos_ids:
                    raise ValueError("Qwen 전사 출력 한도에 도달했습니다. 잘린 문장을 자막으로 저장하지 않습니다.")
                parsed = processor.decode(generated, return_format="parsed")
                if not isinstance(parsed, list) or len(parsed) != 1 or not isinstance(parsed[0], dict):
                    raise ValueError("Qwen 전사 응답 형식이 올바르지 않습니다.")
                text = parsed[0].get("transcription")
                if not isinstance(text, str) or len(text) > 30_000:
                    raise ValueError("Qwen 전사 텍스트 형식 또는 길이가 유효하지 않습니다.")
                if text.strip():
                    detected_language = requested_language or alignment_language(parsed[0].get("language"))
                    _checkpoint(cancelled)
                    align_inputs, word_lists = aligner_processor.prepare_forced_aligner_inputs(
                        audio=audio, transcript=text, language=detected_language)
                    align_inputs = align_inputs.to(aligner.device, aligner.dtype)
                    with torch.inference_mode():
                        aligned = aligner(**align_inputs)
                    _checkpoint(cancelled)
                    decoded = aligner_processor.decode_forced_alignment(
                        logits=aligned.logits, input_ids=align_inputs["input_ids"], word_lists=word_lists,
                        timestamp_token_id=aligner.config.timestamp_token_id)
                    if not isinstance(decoded, list) or len(decoded) != 1:
                        raise ValueError("Qwen 단어 시간 정렬 응답 형식이 올바르지 않습니다.")
                    words = aligned_words(text, decoded[0], offset=begin / SAMPLE_RATE,
                                          duration=(end - begin) / SAMPLE_RATE)
                    records.append({"start": words[0]["start"], "end": words[-1]["end"], "text": text, "words": words})
                    if recognition_preview is not None:
                        recognition_preview(text)
                progress("Qwen 대사 전사·단어 시간 정렬", 0.17 + 0.47 * end / frames)
                # Do not retain the previous chunk's GPU logits across a new
                # generation. The final result contains ordinary Python data.
                del audio, inputs, output, generated
                if text.strip():
                    del align_inputs, aligned, decoded
            return records
    finally:
        inputs = output = generated = align_inputs = aligned = decoded = None
        processor = model = aligner_processor = aligner = None
        gc.collect()
        if torch is not None and device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
