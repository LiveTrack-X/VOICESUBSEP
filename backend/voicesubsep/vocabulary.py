"""Bounded plain recognition hints. Never replacement rules or transcript edits."""
from __future__ import annotations

import re
import unicodedata

MAX_TERMS = 50
MAX_TERM_LENGTH = 50
MAX_LENGTH = 2_000
GROQ_MAX_BYTES = 224
_CONTROLS = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")
INVALID = "용어 사전은 최대 50개, 용어당 50자, 전체 2,000자까지 입력하세요. 빈 용어와 제어 문자는 사용할 수 없습니다."
GROQ_LIMIT = "Groq 용어 힌트는 쉼표와 공백을 포함해 UTF-8 224바이트까지 지원합니다. 용어를 줄이거나 다른 엔진을 선택하세요. 용어를 자동으로 자르지 않습니다."
UNSUPPORTED = "이 엔진 설정에서는 용어 힌트를 지원하지 않습니다. 사전은 프로젝트에 보관하며 이번 외부 요청에는 전송하지 않습니다."


def validate_vocabulary(value) -> list[str]:
    if not isinstance(value, list) or len(value) > MAX_TERMS:
        raise ValueError(INVALID)
    terms = []
    for item in value:
        if not isinstance(item, str) or _CONTROLS.search(item):
            raise ValueError(INVALID)
        term = unicodedata.normalize("NFC", item).strip()
        if not term or len(term) > MAX_TERM_LENGTH:
            raise ValueError(INVALID)
        if term not in terms:
            terms.append(term)
    if len(", ".join(terms)) > MAX_LENGTH:
        raise ValueError(INVALID)
    return terms


def vocabulary_for_provider(value, provider: str, model: str | None = None) -> list[str]:
    terms = validate_vocabulary(value)
    if provider == "groq" and len(", ".join(terms).encode("utf-8")) > GROQ_MAX_BYTES:
        raise ValueError(GROQ_LIMIT)
    if provider == "gemini" or provider == "xai" and model != "grok-voice-transcribe-2.0":
        return []
    return terms
