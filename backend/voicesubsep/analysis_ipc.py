"""Bounded JSON frames over inherited anonymous pipes; never files or sockets."""
from __future__ import annotations

import json
import struct

MAX_FRAME_BYTES = 64 * 1024 * 1024
MAX_CONTROL_BYTES = 128 * 1024


def send_frame(stream, value, *, limit=MAX_FRAME_BYTES):
    data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(data) > limit:
        raise ValueError("Analysis worker message exceeds its size limit.")
    for part in (struct.pack("!I", len(data)), data):
        remaining = memoryview(part)
        while remaining:
            written = stream.write(remaining)
            if not written:
                raise OSError("Analysis worker pipe closed.")
            remaining = remaining[written:]
    stream.flush()


def _read_exact(stream, size):
    chunks = bytearray()
    while len(chunks) < size:
        data = stream.read(size - len(chunks))
        if not data:
            raise EOFError("Analysis worker pipe closed.")
        chunks.extend(data)
    return bytes(chunks)


def read_frame(stream, *, limit=MAX_FRAME_BYTES):
    size = struct.unpack("!I", _read_exact(stream, 4))[0]
    if size > limit:
        raise ValueError("Analysis worker message exceeds its size limit.")
    value = json.loads(_read_exact(stream, size), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Invalid worker JSON.")))
    if not isinstance(value, dict):
        raise ValueError("Analysis worker message is not an object.")
    return value
