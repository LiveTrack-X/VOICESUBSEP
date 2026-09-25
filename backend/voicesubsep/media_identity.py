"""Bind edits to the bytes uploaded as their original, not a file name."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
from typing import Callable

from .rendering import checkpoint

HASH_BLOCK_BYTES = 1024 * 1024
SOURCE_MISMATCH = "The connected media does not match this project's original. Reconnect the original before export."


def verify_snapshot_media(snapshot: dict | None, metadata: dict) -> None:
    # Old clients/projects did not persist a fingerprint. New UI explicitly
    # confirms and binds their source; old API requests remain readable.
    if snapshot is None or "mediaIdentity" not in snapshot:
        return
    identity = snapshot["mediaIdentity"]
    if (not isinstance(identity, dict) or set(identity) != {"sha256", "bytes"}
            or not isinstance(identity.get("sha256"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", identity["sha256"])
            or type(identity.get("bytes")) is not int or identity["bytes"] <= 0):
        raise ValueError("Invalid saved source identity. Reconnect the original media.")
    if identity["sha256"] != metadata.get("sha256") or identity["bytes"] != metadata.get("bytes"):
        raise ValueError(SOURCE_MISMATCH)


def verify_snapshot_source(snapshot: dict | None, metadata: dict, source: Path,
                           cancelled: Callable[[], bool]) -> None:
    """Recheck the cache's actual bytes just before rendering, with bounded memory.

    Upload metadata alone cannot detect a cache file changed while an export
    waited in the queue. Legacy snapshots without an identity retain their old
    policy; a bound project must match both metadata and the current source.
    """
    checkpoint(cancelled)
    verify_snapshot_media(snapshot, metadata)
    if snapshot is None or "mediaIdentity" not in snapshot:
        return
    identity = snapshot["mediaIdentity"]

    def signature(stat):
        return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)

    digest, size = hashlib.sha256(), 0
    path_before = source.stat()
    with source.open("rb") as stream:
        before = os.fstat(stream.fileno())
        if (before.st_size != identity["bytes"]
                or (before.st_dev, before.st_ino) != (path_before.st_dev, path_before.st_ino)):
            raise ValueError(SOURCE_MISMATCH)
        while True:
            checkpoint(cancelled)
            block = stream.read(HASH_BLOCK_BYTES)
            if not block:
                break
            size += len(block)
            if size > identity["bytes"]:
                raise ValueError(SOURCE_MISMATCH)
            digest.update(block)
        checkpoint(cancelled)
        # Detect replacement or mutation during the read as well as corruption
        # present before it. The source remains read-only throughout this check.
        if signature(before) != signature(os.fstat(stream.fileno())):
            raise ValueError(SOURCE_MISMATCH)
    # Compare each stat API with itself: Windows Python versions can report
    # different ctime semantics through the handle and path APIs.
    if (signature(path_before) != signature(source.stat()) or size != identity["bytes"]
            or digest.hexdigest() != identity["sha256"]):
        raise ValueError(SOURCE_MISMATCH)
    checkpoint(cancelled)
