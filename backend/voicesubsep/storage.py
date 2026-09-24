"""Bounded identifiers, atomic JSON writes, and a single-process data lock."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Any

ID_PATTERN = r"^[a-f0-9]{32}$"


def valid_id(value: str) -> bool:
    return bool(re.fullmatch(ID_PATTERN, value))


def new_id() -> str:
    return uuid.uuid4().hex


class Storage:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.media = self.root / "media"
        self.jobs = self.root / "jobs"
        self._lock_file = None
        self._write_lock = threading.RLock()
        # Upload deduplication, new job reservations and explicit cache cleanup
        # must agree on whether a source is still in use.
        self.media_lock = threading.RLock()

    def contained(self, path: Path) -> Path:
        resolved = path.resolve()
        if not resolved.is_relative_to(self.root):
            raise ValueError("Path is outside the application data directory.")
        return resolved

    def media_dir(self, media_id: str) -> Path:
        if not valid_id(media_id):
            raise ValueError("Invalid media identifier.")
        return self.contained(self.media / media_id)

    def job_path(self, job_id: str) -> Path:
        if not valid_id(job_id):
            raise ValueError("Invalid job identifier.")
        return self.contained(self.jobs / f"{job_id}.json")

    def initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.contained(self.media).mkdir(exist_ok=True)
        self.contained(self.jobs).mkdir(exist_ok=True)

    def acquire(self) -> None:
        self.initialize()
        if self._lock_file is not None:
            raise RuntimeError("The application data directory is already locked.")
        lock_file = self.contained(self.root / ".worker.lock").open("a+b")
        try:
            if os.name == "nt":
                import msvcrt

                lock_file.seek(0, os.SEEK_END)
                if lock_file.tell() == 0:
                    lock_file.write(b"0")
                    lock_file.flush()
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError) as exc:
            lock_file.close()
            raise RuntimeError(
                "Another VOICESUBSEP process is using this data directory. "
                "Run one backend process (no --workers or --reload)."
            ) from exc
        self._lock_file = lock_file

    def release(self) -> None:
        if self._lock_file is None:
            return
        lock_file, self._lock_file = self._lock_file, None
        if os.name == "nt":
            import msvcrt

            lock_file.seek(0)
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()

    def write_json(self, path: Path, data: dict[str, Any]) -> None:
        target = self.contained(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.contained(target.with_name(f".{target.name}.{new_id()}.tmp"))
        with self._write_lock:
            try:
                with temporary.open("x", encoding="utf-8", newline="\n") as output:
                    json.dump(data, output, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)

    def read_json(self, path: Path) -> dict[str, Any]:
        with self.contained(path).open(encoding="utf-8") as source:
            value = json.load(source)
        if not isinstance(value, dict):
            raise ValueError("Invalid saved metadata.")
        return value

    def get_media(self, media_id: str) -> tuple[dict[str, Any], Path]:
        folder = self.media_dir(media_id)
        metadata = self.read_json(folder / "metadata.json")
        # Metadata is local, but still do not allow it to redirect file serving.
        filename = metadata.get("storedName", "")
        if not isinstance(filename, str) or not re.fullmatch(r"source\.[a-z0-9]{1,8}", filename):
            raise ValueError("Invalid saved media path.")
        source = self.contained(folder / filename)
        if source.parent != folder or not source.is_file():
            raise FileNotFoundError("Source media is missing.")
        return metadata, source
