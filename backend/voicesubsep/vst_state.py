"""Opaque native plugin state validation, without importing plugin code."""
from __future__ import annotations

import base64
import binascii

MAX_STATE_BYTES = 256 * 1024
MAX_STATE_BASE64 = 4 * ((MAX_STATE_BYTES + 2) // 3)


def decode_plugin_state(value: object) -> bytes:
    if not isinstance(value, str) or len(value) > MAX_STATE_BASE64:
        raise ValueError("VST state must be canonical base64, at most 256 KiB decoded.")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("VST state must be canonical base64, at most 256 KiB decoded.") from None
    if len(raw) > MAX_STATE_BYTES or base64.b64encode(raw).decode("ascii") != value:
        raise ValueError("VST state must be canonical base64, at most 256 KiB decoded.")
    return raw


def encode_plugin_state(value: object) -> str:
    if not isinstance(value, bytes) or len(value) > MAX_STATE_BYTES:
        raise ValueError("The plugin state is unavailable or exceeds 256 KiB; changes were not saved.")
    return base64.b64encode(value).decode("ascii")
