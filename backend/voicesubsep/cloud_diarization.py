"""Opt-in, single-request Deepgram speaker intervals; never a replacement transcript.

Official contracts verified 2026-09-25:
https://developers.deepgram.com/docs/diarization
https://developers.deepgram.com/docs/pre-recorded-audio
https://developers.deepgram.com/docs/models-languages-overview
https://developers.deepgram.com/docs/language-detection
"""
from __future__ import annotations

import http.client
import json
import math
from pathlib import Path
import re
import socket
import threading
import time
from urllib.parse import urlencode
import wave

MAX_AUDIO_SECONDS = 7200
MAX_AUDIO_BYTES = 256 * 1024 * 1024
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
REQUEST_TIMEOUT = 660
MODEL = "nova-3"
DIARIZER = "v2"
LANGUAGES = frozenset("af ar hy as be bn bs bg ca zh hr cs da nl en et fi fr ka de el gu he hi hu id it ja kn kk ko lv lt mk ms mr mn ne no ps fa pl pt pa ro ru sr sk sl es sv tl ta te th tr uk ur vi".split())


class CloudDiarizationError(RuntimeError):
    pass


class CloudDiarizationCancelled(Exception):
    pass


def _checkpoint(cancelled):
    if cancelled():
        raise CloudDiarizationCancelled("클라우드 화자 구분을 취소했습니다. 이미 전송한 요청은 과금될 수 있습니다.")


def _endpoint(language: str) -> str:
    params = {"model": MODEL, "diarize_model": DIARIZER, "utterances": "true", "smart_format": "false"}
    if language == "auto":
        params["detect_language"] = "true"
    elif language in LANGUAGES:
        params["language"] = language
    else:
        raise CloudDiarizationError("Deepgram 화자 구분에서 지원하지 않는 언어입니다. AUTO 또는 지원 언어를 선택하세요.")
    return "/v1/listen?" + urlencode(params)


def _audio_duration(path: Path) -> float:
    if not path.is_file() or path.stat().st_size > MAX_AUDIO_BYTES:
        raise CloudDiarizationError("Deepgram 화자 구분은 앱에서 최대 2시간·256 MiB까지 지원합니다. 로컬 Nemotron을 사용하세요.")
    try:
        with wave.open(str(path), "rb") as audio:
            if audio.getframerate() != 16000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getcomptype() != "NONE":
                raise ValueError("Unsupported PCM layout")
            duration = audio.getnframes() / 16000
    except (OSError, EOFError, ValueError, wave.Error):
        raise CloudDiarizationError("화자 구분 입력은 추출된 16 kHz mono PCM WAV여야 합니다.") from None
    if not 0 < duration <= MAX_AUDIO_SECONDS:
        raise CloudDiarizationError("Deepgram 화자 구분은 앱에서 최대 2시간까지 지원합니다. 파일을 임의 분할하지 않았습니다.")
    return duration


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def _constant(_value):
    raise ValueError("Invalid JSON number")


def _decode(raw: bytes, key: str) -> dict:
    if key.encode() in raw:
        raise CloudDiarizationError("화자 구분 응답을 안전하게 처리하지 못했습니다.")
    value = json.loads(raw, object_pairs_hook=_pairs, parse_constant=_constant)
    if not isinstance(value, dict):
        raise CloudDiarizationError("화자 구분 응답 형식이 올바르지 않습니다.")
    pending, count = [value], 0
    while pending:
        item = pending.pop(); count += 1
        if count > 1_000_000 or isinstance(item, str) and key in item:
            raise CloudDiarizationError("화자 구분 응답을 안전하게 처리하지 못했습니다.")
        if isinstance(item, dict):
            pending.extend(item.keys()); pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return value


def normalize_diarization(value: dict, duration: float) -> list[dict]:
    """Drop every provider text/metadata field. Preserve actual per-word intervals."""
    if type(duration) not in (int, float) or not math.isfinite(duration) or not 0 < duration <= MAX_AUDIO_SECONDS:
        raise CloudDiarizationError("화자 구분 오디오 길이가 올바르지 않습니다.")
    metadata = value.get("metadata")
    if not isinstance(metadata, dict) or not isinstance(metadata.get("diarize_info"), dict) or metadata["diarize_info"].get("arch") != DIARIZER:
        raise CloudDiarizationError("Deepgram v2 화자 구분이 실행되었는지 확인할 수 없습니다. 결과를 적용하지 않았습니다.")
    returned_duration = metadata.get("duration")
    if type(returned_duration) not in (int, float) or not math.isfinite(returned_duration) or returned_duration<=0 or abs(returned_duration-duration)>.25:
        raise CloudDiarizationError("Deepgram 응답의 길이가 전체 원본과 다릅니다. 부분 결과를 적용하지 않았습니다.")
    results = value.get("results")
    channels = results.get("channels") if isinstance(results, dict) else None
    if not isinstance(channels, list) or len(channels) != 1 or not isinstance(channels[0], dict):
        raise CloudDiarizationError("화자 구분 응답 채널이 올바르지 않습니다.")
    alternatives = channels[0].get("alternatives")
    if not isinstance(alternatives, list) or not alternatives or not isinstance(alternatives[0], dict):
        raise CloudDiarizationError("화자 구분 응답에 단어 시간이 없습니다.")
    words = alternatives[0].get("words")
    if not isinstance(words, list) or len(words) > 100_000:
        raise CloudDiarizationError("화자 구분 응답의 단어 수가 올바르지 않습니다.")
    transcript = alternatives[0].get("transcript", "")
    if not isinstance(transcript, str):
        raise CloudDiarizationError("화자 구분 응답 형식이 올바르지 않습니다.")
    if not words and transcript.strip():
        raise CloudDiarizationError("음성이 인식되었지만 화자 시간이 없습니다. 결과를 적용하지 않았습니다.")
    intervals = []
    for item in words:
        if not isinstance(item, dict):
            raise CloudDiarizationError("화자 구분 단어 정보가 올바르지 않습니다.")
        start, end, speaker = item.get("start"), item.get("end"), item.get("speaker")
        confidence = item.get("speaker_confidence")
        if (type(start) not in (int, float) or type(end) not in (int, float)
                or not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= duration + .25
                or type(speaker) is not int or not 0 <= speaker <= 10000
                or confidence is not None and (type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1)):
            raise CloudDiarizationError("화자 구분 시간이 원본 범위를 벗어나거나 화자 번호가 없습니다.")
        end = min(duration, end)
        if start >= end:
            raise CloudDiarizationError("화자 구분 시간이 원본 범위를 벗어났습니다.")
        intervals.append({"start": start, "end": end, "speaker": f"deepgram_{speaker}"})
    # Sorting does not join silences or erase overlaps; the existing attribution
    # code may union touching same-speaker intervals later.
    return sorted(intervals, key=lambda item: (item["start"], item["end"], item["speaker"]))


def diarize_cloud(path: Path, *, language: str, consent: bool, get_key, progress, cancelled) -> list[dict]:
    if consent is not True:
        raise CloudDiarizationError("Deepgram 음성 전송과 유료 화자 구분에 동의해야 합니다.")
    _checkpoint(cancelled)
    endpoint = _endpoint(language)
    duration = _audio_duration(path)
    key = get_key()
    if not isinstance(key, str) or not re.fullmatch(r"[!-~]{12,512}", key):
        raise CloudDiarizationError("Deepgram API 키를 먼저 등록하세요.")
    connection = http.client.HTTPSConnection("api.deepgram.com", timeout=30)
    transport = None
    response = None
    finished, timed_out, revoked = threading.Event(), threading.Event(), threading.Event()
    started = time.monotonic()

    def check_binding():
        try:
            valid = get_key() == key
        except Exception:
            valid = False
        if not valid:
            revoked.set()
            raise CloudDiarizationError("Deepgram API 키가 삭제되거나 변경되었습니다. 새 작업을 시작하세요.")

    def interrupt():
        while not finished.wait(.1):
            expired = time.monotonic() - started >= REQUEST_TIMEOUT
            try:
                check_binding()
            except CloudDiarizationError:
                pass
            if cancelled() or expired or revoked.is_set():
                if expired: timed_out.set()
                try:
                    # HTTPResponse may own the socket after Connection: close
                    # detaches it from HTTPConnection. Keep our transport handle.
                    active_socket = transport if transport is not None else connection.sock
                    if active_socket is not None: active_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                # On Windows shutdown alone may not interrupt a pending buffered
                # response read. close() also defers the native handle while a
                # makefile holds it. Detach prevents a later double-close, then
                # close the native socket to wake the pending read immediately.
                try:
                    if isinstance(active_socket, socket.socket):
                        handle = active_socket.detach()
                        if handle != -1: socket.close(handle)
                except (OSError, ValueError):
                    pass
                connection.close()
                return

    watcher = threading.Thread(target=interrupt, daemon=True, name="cloud-diarization-cancel")
    watcher.start()
    try:
        progress("Deepgram 화자 구분 업로드", .01)
        connection.connect()
        transport = connection.sock
        _checkpoint(cancelled); check_binding()
        if timed_out.is_set(): raise CloudDiarizationError("Deepgram 화자 구분 요청 시간이 초과되었습니다.")
        connection.auto_open = 0
        connection.putrequest("POST", endpoint)
        connection.putheader("Authorization", "Token " + key)
        connection.putheader("Content-Type", "audio/wav")
        connection.putheader("Content-Length", str(path.stat().st_size))
        connection.putheader("Accept", "application/json")
        connection.endheaders()
        sent, size = 0, path.stat().st_size
        with path.open("rb") as source:
            while block := source.read(1024 * 1024):
                _checkpoint(cancelled); check_binding()
                connection.send(block); sent += len(block)
                progress("Deepgram 화자 구분 업로드", .05 + .2 * sent / size)
        _checkpoint(cancelled); check_binding()
        progress("Deepgram 화자 구분 응답 대기", .25)
        # Provider processing may legitimately take up to 10 minutes. The
        # independent wall-clock watcher bounds the entire upload + response.
        if connection.sock is not None: connection.sock.settimeout(610)
        response = connection.getresponse()
        if response.status != 200:
            if response.status in (401, 403): raise CloudDiarizationError("Deepgram API 인증에 실패했습니다. 키와 권한을 확인하세요.")
            if response.status == 429: raise CloudDiarizationError("Deepgram 호출 한도에 도달했습니다. 자동 재시도하지 않았습니다.")
            if response.status == 504: raise CloudDiarizationError("Deepgram 처리 시간이 초과되었습니다. 로컬 Nemotron을 사용하세요.")
            raise CloudDiarizationError("Deepgram 화자 구분 요청에 실패했습니다. 자동 재시도하지 않았습니다.")
        chunks, received = [], 0
        while block := response.read(64 * 1024):
            _checkpoint(cancelled); check_binding()
            received += len(block)
            if received > MAX_RESPONSE_BYTES: raise CloudDiarizationError("Deepgram 화자 구분 응답이 너무 큽니다.")
            chunks.append(block)
        _checkpoint(cancelled); check_binding()
        if timed_out.is_set(): raise CloudDiarizationError("Deepgram 화자 구분 요청 시간이 초과되었습니다.")
        result = normalize_diarization(_decode(b"".join(chunks), key), duration)
        progress("Deepgram 화자 구분 완료", 1.)
        return result
    except CloudDiarizationCancelled:
        raise
    except CloudDiarizationError:
        _checkpoint(cancelled)
        raise
    except Exception:
        _checkpoint(cancelled)
        if revoked.is_set(): raise CloudDiarizationError("Deepgram API 키가 삭제되거나 변경되었습니다. 새 작업을 시작하세요.") from None
        if timed_out.is_set(): raise CloudDiarizationError("Deepgram 화자 구분 요청 시간이 초과되었습니다.") from None
        raise CloudDiarizationError("Deepgram 연결 또는 응답 처리에 실패했습니다. 자동 재시도하지 않았습니다.") from None
    finally:
        finished.set()
        if response is not None:
            response.close()
        connection.close(); watcher.join(timeout=.5)
