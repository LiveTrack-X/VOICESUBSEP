"""Small, optional ASR progress payloads; never substitutes for final captions."""

from __future__ import annotations

import inspect
from typing import Callable
import unicodedata

RecognitionPreview = Callable[[str], None]
PREVIEW_MAX_LINES = 2
PREVIEW_MAX_CHARS = 500


def preview_line(value: object) -> str:
    """Collapse whitespace and omit control/surrogate characters, with bounded output."""
    if not isinstance(value, str):
        return ""
    output: list[str] = []
    pending_space = False
    for character in value:
        if character.isspace():
            pending_space = bool(output)
            continue
        if unicodedata.category(character) in {"Cc", "Cf", "Cs"}:
            continue
        if pending_space:
            output.append(" ")
            pending_space = False
        output.append(character)
        if len(output) >= PREVIEW_MAX_CHARS:
            break
    return "".join(output[:PREVIEW_MAX_CHARS]).rstrip()


def preview_options(analyzer: Callable, callback: RecognitionPreview | None) -> dict:
    """Keep strict legacy analyzers working without retrying an inference call."""
    if callback is None:
        return {}
    try:
        parameters = inspect.signature(analyzer).parameters.values()
    except (TypeError, ValueError):
        return {}
    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD or (
            parameter.name == "recognition_preview" and parameter.kind in {
                inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY})
            for parameter in parameters):
        return {"recognition_preview": callback}
    return {}
