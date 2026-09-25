"""Explicit-consent cloud transcription. No SDK, retries, redirects or raw error logging.

Official contracts: console.groq.com/docs/speech-to-text,
docs.x.ai/developers/model-capabilities/audio/speech-to-text and
ai.google.dev/gemini-api/docs/transcribe (2026-09-25).
Only extracted 16 kHz mono PCM audio is sent, in bounded requests.
"""
from __future__ import annotations

import base64
import http.client
import json
import math
from pathlib import Path
import re
import socket
import tempfile
import threading
import time
import uuid
import wave

ASR_MODELS = {
    "groq": ("whisper-large-v3", "whisper-large-v3-turbo"),
    "xai": ("grok-voice-transcribe-2.0", "grok-voice-transcribe-1.0"),
    "gemini": ("gemini-3.5-transcribe",),
}
ENDPOINTS = {"groq": ("api.groq.com", "/openai/v1/audio/transcriptions"),
             "xai": ("api.x.ai", "/v1/stt"),
             "gemini": ("generativelanguage.googleapis.com", "/v1beta/interactions")}
CHUNK_SECONDS = 600
GEMINI_CHUNK_SECONDS = 300
# Conservative documented inline-audio request cap, including JSON/base64 overhead.
GEMINI_MAX_REQUEST = 20_000_000
GEMINI_LANGUAGES = {"ko": "ko-KR", "en": "en-US", "ja": "ja-JP", "zh": "cmn-Hans-CN", "es": "es-419"}
OVERLAP_SECONDS = 1
MAX_RESPONSE = 4 * 1024 * 1024
REQUEST_TIMEOUT = 180
BLOCK_SIZE = 1024 * 1024


class CloudASRError(RuntimeError):
    pass


class CloudASRCancelled(Exception):
    pass


def _checkpoint(cancelled):
    if cancelled():
        raise CloudASRCancelled("클라우드 음성 인식을 취소했습니다. 이미 전송한 요청은 과금될 수 있습니다.")


def _json_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("Duplicate JSON field")
        result[name] = value
    return result


def _json_constant(value):
    raise ValueError("Invalid JSON number")


def validate_cloud_options(provider: str, model: str | None, consent: bool) -> None:
    if provider not in ASR_MODELS or model not in ASR_MODELS[provider]:
        raise CloudASRError("지원하지 않는 클라우드 음성 인식 모델입니다.")
    if consent is not True:
        raise CloudASRError("선택한 제공자로 음성을 전송하는 데 동의해야 합니다.")


def _fields(provider: str, model: str, language: str) -> list[tuple[str, str]]:
    if provider == "gemini":
        _gemini_config(language)
        return []
    fields = [("model", model)]
    if provider == "groq":
        fields += [("response_format", "verbose_json"), ("timestamp_granularities[]", "word"),
                   ("timestamp_granularities[]", "segment"), ("temperature", "0")]
        if language != "auto":
            if not re.fullmatch(r"[a-z]{2}", language):
                raise CloudASRError("Groq 음성 언어는 AUTO 또는 두 글자 언어 코드여야 합니다.")
            fields.append(("language", language))
    else:
        # xAI language is a formatting hint, not an ASR language constraint.
        # Keep fillers for an editable transcript and use local speaker attribution.
        fields += [("format", "false"), ("diarize", "false"), ("filler_words", "true")]
    return fields


def _gemini_config(language: str) -> dict:
    # VERBATIM retains disfluencies and is the mode with real word timestamps.
    config = {"mode": {"type": "verbatim", "timestamp_granularities": ["word"]}}
    if language != "auto":
        if language not in GEMINI_LANGUAGES:
            raise CloudASRError("Gemini 음성 언어는 AUTO, 한국어, 영어, 일본어, 중국어, 스페인어를 선택하세요.")
        config["language_codes"] = [GEMINI_LANGUAGES[language]]
    return config


def _post_audio(provider: str, model: str, language: str, key: str, path: Path, cancelled) -> dict:
    _checkpoint(cancelled)
    # A caller cannot use this helper to select arbitrary hosts or models.
    validate_cloud_options(provider, model, True)
    fields = _fields(provider, model, language)
    if not isinstance(key, str) or not re.fullmatch(r"[!-~]{12,512}", key):
        raise CloudASRError("클라우드 API 키를 먼저 등록하세요.")
    size = path.stat().st_size
    if size > 25_000_000:
        raise CloudASRError("클라우드에 전송할 오디오 조각이 너무 큽니다.")
    if provider == "gemini":
        # Stream base64 directly into inline audio. No remote Files API resource is
        # created, and interaction history is explicitly disabled with store=false.
        prefix = ("{\"model\":" + json.dumps(model) + ',"store":false,"stream":false,"input":[{"type":"audio","mime_type":"audio/wav","data":"').encode()
        suffix = ('"}],"generation_config":' + json.dumps({"transcription_config": _gemini_config(language)}, separators=(",", ":")) + "}").encode()
        content_type = "application/json"
        content_length = len(prefix) + 4 * ((size + 2) // 3) + len(suffix)
        if content_length > GEMINI_MAX_REQUEST:
            raise CloudASRError("클라우드에 전송할 오디오 조각이 너무 큽니다.")
    else:
        boundary = "voicesubsep-" + uuid.uuid4().hex
        prefix = b"".join((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").encode()
                          for name, value in fields)
        # xAI requires the file to be the final multipart field. Never send source names.
        prefix += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n").encode()
        suffix = f"\r\n--{boundary}--\r\n".encode()
        content_type = "multipart/form-data; boundary=" + boundary
        content_length = len(prefix) + size + len(suffix)
    host, endpoint = ENDPOINTS[provider]
    connection = http.client.HTTPSConnection(host, timeout=30)
    finished = threading.Event()
    timed_out = threading.Event()
    started = time.monotonic()
    transport_socket = None
    response = None

    def interrupt():
        while not finished.wait(0.1):
            expired = time.monotonic() - started >= REQUEST_TIMEOUT
            if cancelled() or expired:
                if expired:
                    timed_out.set()
                try:
                    # HTTPConnection detaches its socket for Connection: close;
                    # the response may still be blocked reading that transport.
                    active_socket = transport_socket if transport_socket is not None else connection.sock
                    if active_socket is not None:
                        try:
                            active_socket.shutdown(socket.SHUT_RDWR)
                        finally:
                            # On Windows shutdown alone may leave a timed read
                            # waiting in select, and close() defers while an HTTP
                            # makefile holds a reference. Detach invalidates that
                            # socket object before closing its native handle.
                            socket.close(active_socket.detach())
                except OSError:
                    pass
                connection.close()
                return

    watcher = threading.Thread(target=interrupt, daemon=True, name="cloud-asr-cancel")
    watcher.start()
    try:
        connection.connect()
        transport_socket = connection.sock
        _checkpoint(cancelled)
        if timed_out.is_set():
            raise CloudASRError("클라우드 음성 인식 요청 시간이 초과되었습니다.")
        connection.auto_open = 0  # Never reconnect after the cancellation watcher closes this socket.
        connection.putrequest("POST", endpoint)
        connection.putheader("x-goog-api-key" if provider == "gemini" else "Authorization", key if provider == "gemini" else "Bearer " + key)
        connection.putheader("Content-Type", content_type)
        connection.putheader("Content-Length", str(content_length))
        connection.putheader("Accept", "application/json")
        connection.endheaders()
        _checkpoint(cancelled)
        connection.send(prefix)
        with path.open("rb") as source:
            # Multiples of three prevent padding between base64 blocks; every send
            # remains at most one MiB rather than allocating the complete request.
            block_size = 3 * (BLOCK_SIZE // 4) if provider == "gemini" else BLOCK_SIZE
            while block := source.read(block_size):
                _checkpoint(cancelled)
                connection.send(base64.b64encode(block) if provider == "gemini" else block)
        _checkpoint(cancelled)
        connection.send(suffix)
        _checkpoint(cancelled)
        response = connection.getresponse()
        # No redirect handling and no automatic retry, including 429/5xx.
        if response.status != 200:
            if response.status in (401, 403):
                raise CloudASRError("클라우드 API 인증에 실패했습니다. 키와 계정 권한을 확인하세요.")
            if response.status == 429:
                raise CloudASRError("클라우드 사용량 또는 호출 한도에 도달했습니다. 계정 한도를 확인한 뒤 다시 시도하세요.")
            raise CloudASRError("클라우드 음성 인식 요청에 실패했습니다. 제공자 상태와 계정 설정을 확인하세요.")
        chunks, received = [], 0
        while block := response.read(64 * 1024):
            _checkpoint(cancelled)
            received += len(block)
            if received > MAX_RESPONSE:
                raise CloudASRError("클라우드 음성 인식 응답이 너무 큽니다.")
            chunks.append(block)
        _checkpoint(cancelled)
        if timed_out.is_set():
            raise CloudASRError("클라우드 음성 인식 요청 시간이 초과되었습니다.")
        raw = b"".join(chunks)
        if key.encode() in raw:
            raise CloudASRError("클라우드 음성 인식 응답을 안전하게 처리하지 못했습니다.")
        value = json.loads(raw, object_pairs_hook=_json_object, parse_constant=_json_constant)
        if not isinstance(value, dict):
            raise CloudASRError("클라우드 음성 인식 응답 형식이 올바르지 않습니다.")
        # JSON escape sequences must not turn a hidden credential into saved transcript text.
        pending, visited = [value], 0
        while pending:
            item = pending.pop()
            visited += 1
            if visited > 100_000 or isinstance(item, str) and key in item:
                raise CloudASRError("클라우드 음성 인식 응답을 안전하게 처리하지 못했습니다.")
            if isinstance(item, dict):
                pending.extend(item.keys()); pending.extend(item.values())
            elif isinstance(item, list):
                pending.extend(item)
        return value
    except CloudASRCancelled:
        raise
    except CloudASRError:
        _checkpoint(cancelled)
        raise
    except Exception:
        _checkpoint(cancelled)
        if timed_out.is_set():
            raise CloudASRError("클라우드 음성 인식 요청 시간이 초과되었습니다.") from None
        raise CloudASRError("클라우드 음성 인식 연결 또는 응답 처리에 실패했습니다. 자동 재시도하지 않았습니다.") from None
    finally:
        finished.set()
        if response is not None:
            response.close()
        connection.close()
        watcher.join(timeout=0.5)


def _safe_text(value, limit: int) -> str:
    if not isinstance(value, str) or len(value) > limit or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]", value):
        raise CloudASRError("클라우드 음성 인식 응답의 텍스트가 올바르지 않습니다.")
    return value


def normalize_response(value: dict, provider: str, duration: float, offset: float) -> list[dict]:
    if provider == "gemini":
        return _normalize_gemini(value, duration, offset)
    text = _safe_text(value.get("text"), 500_000)
    words = value.get("words", [])
    if not isinstance(words, list) or len(words) > 50_000 or (text.strip() and not words):
        raise CloudASRError("클라우드 응답에 유효한 단어별 시간이 없습니다. 자막 시간을 임의로 만들지 않았습니다.")
    clean_words = []
    cursor, previous_start = 0, -1.0
    for item in words:
        if not isinstance(item, dict):
            raise CloudASRError("클라우드 단어 정보가 올바르지 않습니다.")
        word = _safe_text(item.get("word" if provider == "groq" else "text"), 1000).strip()
        start, end = item.get("start"), item.get("end")
        if (not word or type(start) not in (int, float) or type(end) not in (int, float)
                or not math.isfinite(start) or not math.isfinite(end)
                or start < 0 or end <= start or end > duration + 0.25 or start < previous_start):
            raise CloudASRError("클라우드 단어 시간이 올바르지 않습니다. 원본 시간에 맞는 결과만 사용할 수 있습니다.")
        previous_start = start
        # Exact source spacing includes empty gaps, contractions and punctuation.
        # Unrepresented spoken text is an incomplete alignment, not permission to omit it.
        position = text.find(word, cursor)
        if position < cursor or any(character.isalnum() for character in text[cursor:position]):
            raise CloudASRError("클라우드 전사 본문과 단어 시간이 일치하지 않습니다. 원문을 임의로 바꾸지 않았습니다.")
        clean = {"start": round(offset + start, 6), "end": round(offset + min(end, duration), 6), "text": text[cursor:position] + word}
        cursor = position + len(word)
        if clean["end"] <= clean["start"]:
            raise CloudASRError("클라우드 단어 시간이 오디오 범위를 벗어났습니다.")
        clean_words.append(clean)
    tail = text[cursor:]
    if any(character.isalnum() for character in tail):
        raise CloudASRError("클라우드 전사 본문에 시간 정보가 없는 단어가 있습니다.")
    if clean_words:
        clean_words[-1]["text"] += tail
    records, group = [], None
    for clean in clean_words:
        if group is None or clean["start"] - group["end"] > 0.7 or clean["end"] - group["start"] > 6 or len(group["text"] + clean["text"]) > 70:
            group = {"start": clean["start"], "end": clean["end"], "text": clean["text"].lstrip(), "words": [clean]}
            records.append(group)
        else:
            group["end"] = max(group["end"], clean["end"])
            group["text"] += clean["text"]
            group["words"].append(clean)
    return records


def _gemini_seconds(value) -> float:
    # Official WordInfo uses protobuf-style seconds strings, not numeric offsets.
    if not isinstance(value, str) or len(value) > 32 or not re.fullmatch(r"(?:0|[1-9]\d*)(?:\.\d{1,9})?s", value, re.ASCII):
        raise CloudASRError("Gemini 응답에 유효한 단어별 시간이 없습니다.")
    return float(value[:-1])


def _normalize_gemini(value: dict, duration: float, offset: float) -> list[dict]:
    steps = value.get("steps")
    if value.get("status") != "completed" or not isinstance(steps, list) or not 0 < len(steps) <= 1000:
        raise CloudASRError("Gemini 음성 인식이 완료되지 않았거나 응답 형식이 올바르지 않습니다.")
    records, word_count, text_count, previous_start = [], 0, 0, -1.0
    for step in steps:
        if not isinstance(step, dict) or step.get("type") != "model_output":
            raise CloudASRError("Gemini 음성 인식 응답 형식이 올바르지 않습니다.")
        content = step.get("content")
        if not isinstance(content, list) or not 0 < len(content) <= 1000:
            raise CloudASRError("Gemini 음성 인식 응답 형식이 올바르지 않습니다.")
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "text":
                raise CloudASRError("Gemini 음성 인식 응답 형식이 올바르지 않습니다.")
            text = _safe_text(block.get("text"), 500_000)
            annotations = block.get("annotations", [])
            if not isinstance(annotations, list):
                raise CloudASRError("Gemini 응답에 유효한 단어별 시간이 없습니다.")
            word_count += len(annotations)
            text_count += len(text)
            if word_count > 50_000 or text_count > 500_000:
                raise CloudASRError("Gemini 음성 인식 응답이 너무 큽니다.")
            words = []
            for annotation in annotations:
                if not isinstance(annotation, dict) or annotation.get("type") != "word_info":
                    raise CloudASRError("Gemini 응답에 유효한 단어별 시간이 없습니다.")
                start = _gemini_seconds(annotation.get("start_offset"))
                if start < previous_start:
                    raise CloudASRError("Gemini 단어 시간 순서가 올바르지 않습니다.")
                previous_start = start
                words.append({"text": annotation.get("text"), "start": start,
                              "end": _gemini_seconds(annotation.get("end_offset"))})
            # Keep provider text, punctuation and true source times using the same
            # validated ASR contract. Native speaker labels are deliberately unused.
            records.extend(normalize_response({"text": text, "words": words}, "gemini-words", duration, offset))
    return records


def transcribe_cloud(path: Path, *, provider: str, model: str, language: str, consent: bool,
                     get_key, progress, cancelled, recognition_preview=None) -> list[dict]:
    validate_cloud_options(provider, model, consent)
    _fields(provider, model, language)  # Reject invalid language before any upload.
    records = []
    with wave.open(str(path), "rb") as source, tempfile.TemporaryDirectory(prefix="voicesubsep-cloud-") as temporary:
        if source.getframerate() != 16000 or source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getnframes() <= 0:
            raise CloudASRError("클라우드 분석용 음성은 16 kHz 모노 PCM이어야 합니다.")
        total = source.getnframes()
        context_frames = round(16000 * OVERLAP_SECONDS)
        chunk_seconds = min(CHUNK_SECONDS, GEMINI_CHUNK_SECONDS) if provider == "gemini" else CHUNK_SECONDS
        frames = round(16000 * chunk_seconds) - 2 * context_frames
        if frames <= 0:
            raise CloudASRError("클라우드 오디오 조각 설정이 올바르지 않습니다.")
        done = 0
        while done < total:
            _checkpoint(cancelled)
            count = min(frames, total - done)
            read_start, read_end = max(0, done - context_frames), min(total, done + count + context_frames)
            source.setpos(read_start)
            chunk = Path(temporary) / "audio.wav"
            with wave.open(str(chunk), "wb") as output:
                output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
                remaining = read_end - read_start
                while remaining:
                    _checkpoint(cancelled)
                    part = source.readframes(min(remaining, BLOCK_SIZE // 2))
                    if not part:
                        raise CloudASRError("클라우드 분석용 음성을 끝까지 읽지 못했습니다.")
                    output.writeframesraw(part)
                    remaining -= len(part) // 2
            _checkpoint(cancelled)
            key = get_key()
            progress(f"{provider} 클라우드 음성 인식 · {done // frames + 1}/{math.ceil(total / frames)}", 0.17 + 0.47 * done / total)
            try:
                response = _post_audio(provider, model, language, key, chunk, cancelled)
            finally:
                key = None
            normalized = normalize_response(response, provider, (read_end - read_start) / 16000, read_start / 16000)
            # One-second context protects cut words. Midpoint ownership retains each
            # returned word only in its nominal chunk, without shifting source time.
            owned = []
            for record in normalized:
                words = [word for word in record["words"]
                         if done / 16000 <= (word["start"] + word["end"]) / 2 < (done + count) / 16000]
                if words:
                    owned.append({"start": words[0]["start"], "end": max(word["end"] for word in words),
                                  "text": "".join(word["text"] for word in words).strip(), "words": words})
            records.extend(owned)
            for record in owned:
                _checkpoint(cancelled)
                if recognition_preview is not None:
                    recognition_preview(record["text"])
            done += count
            progress(f"{provider} 클라우드 전사 수신", 0.17 + 0.47 * done / total)
    return records
