"""Small, local-only diagnostic history. Never record request bodies or tracebacks."""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
import json
import math
import os
import re
import threading
from typing import Any

from .storage import Storage

MAX_FILE_BYTES = 256 * 1024
FILE_COUNT = 3
MAX_ENTRIES = 500
MAX_RECORD_BYTES = 4096
_LABEL = re.compile(r"^[a-zA-Z0-9_.:-]{1,80}$")
_CONTEXT = {"jobId", "previewId", "errorType", "method", "route", "status"}


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_text(value: str, limit: int = 1200) -> str:
    """Redact common credentials and local paths before anything touches disk.

    Only the first error line is useful here; native tool stderr and traceback
    continuations can include source text or arguments and are deliberately lost.
    This is defence in depth: callers must never pass media/text/request data.
    """
    text = str(value)[:16384].splitlines()[0] if str(value) else "Unknown error"
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    text = re.sub(r"(?i)\b(?:bearer|basic)\s+[A-Za-z0-9+/_=.-]+", "[credential]", text)
    # Accept JSON/object-style quoted keys and quoted values containing spaces
    # or escaped quotes. Matching only an unquoted first word leaks the rest.
    text = re.sub(r"(?i)(?<!\w)[\"']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)[\"']?\s*[:=]\s*(?:\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|[^\s,;}]+)", "[credential]", text)
    text = re.sub(r"\b(?:hf_|sk-)[A-Za-z0-9_-]+", "[credential]", text)
    text = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[credential]", text)
    text = re.sub(r"(?i)(?:https?|file)://[^\s\"'<>]+", "[url]", text)
    # Quoted paths may contain spaces. Unquoted Windows paths conservatively
    # consume the remainder up to punctuation; retaining an entire diagnostic
    # sentence matters less than retaining somebody's private directory name.
    text = re.sub(r"[\"'](?:[a-zA-Z]:[\\/]|\\\\|/)[^\"']*[\"']", "[path]", text)
    text = re.sub(r"(?i)(?<![a-z0-9])(?:[a-z]:[\\/]|\\\\)[^\r\n\"'<>|]*", "[path]", text)
    text = re.sub(r"(?<![\w:])/(?:[^\s\"'<>:,;]+/)*[^\s\"'<>:,;]+", "[path]", text)
    text = re.sub(r"(?<![\w-])[A-Za-z0-9_-]{40,}(?![\w-])", "[credential]", text)
    text = re.sub(r"(?<![\w.+-])[\w.!#$%&'*+/=?^`{|}~-]+@(?:[\w-]+\.)+[\w-]+", "[email]", text)
    return text[:limit]


def _safe_context(context: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in _CONTEXT:
        value = context.get(key)
        if isinstance(value, str):
            if key in {"jobId", "previewId"}:
                if re.fullmatch(r"[a-f0-9]{32}", value):
                    result[key] = value
            elif key == "route":
                # Only registered route templates, never the incoming URL.
                if re.fullmatch(r"/api(?:/[a-zA-Z0-9_{}:-]+)*", value):
                    result[key] = value[:160]
            else:
                result[key] = sanitize_text(value, 100)
        elif type(value) in (bool, int, float) and -1_000_000_000 <= value <= 1_000_000_000 and math.isfinite(value):
            result[key] = value
    return result


class Diagnostics:
    """One recorder per application/storage owner, thread-safe and fail-open."""

    def __init__(self, storage: Storage, app_version: str, *, max_file_bytes: int = MAX_FILE_BYTES,
                 file_count: int = FILE_COUNT, max_entries: int = MAX_ENTRIES):
        if max_file_bytes < MAX_RECORD_BYTES or not 1 <= file_count <= 10 or not 1 <= max_entries <= MAX_ENTRIES:
            raise ValueError("Invalid diagnostic storage limits.")
        self.storage = storage
        self.app_version = app_version
        self.max_file_bytes = max_file_bytes
        self.file_count = file_count
        self.max_entries = max_entries
        self._lock = threading.RLock()
        self._fallback: deque[dict] = deque(maxlen=max_entries)
        self._available = True

    def _path(self, index: int = 0):
        candidate_folder = self.storage.root / "logs"
        if candidate_folder.is_symlink():
            raise ValueError("Invalid diagnostic storage directory.")
        folder = self.storage.contained(candidate_folder)
        name = "diagnostics.jsonl" + (f".{index}" if index else "")
        candidate = folder / name
        if candidate.is_symlink():
            raise ValueError("Invalid diagnostic storage path.")
        path = self.storage.contained(candidate)
        if path.parent != folder:
            raise ValueError("Invalid diagnostic storage path.")
        return path

    def record(self, source: str, event: str, message: str, *, level: str = "error", **context: Any) -> None:
        if level not in {"error", "warning"}:
            return
        entry = {"timestamp": timestamp(), "level": level,
                 "source": source if _LABEL.fullmatch(source) else "application",
                 "event": event if _LABEL.fullmatch(event) else "error",
                 "message": sanitize_text(message)}
        safe_context = _safe_context(context)
        if safe_context:
            entry["context"] = safe_context
        payload = (json.dumps(entry, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
        while len(payload) > MAX_RECORD_BYTES:
            entry["message"] = entry["message"][:max(0, len(entry["message"]) - 100)]
            payload = (json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        with self._lock:
            try:
                path = self._path()
                path.parent.mkdir(parents=True, exist_ok=True)
                if path.exists() and path.stat().st_size + len(payload) > self.max_file_bytes:
                    for index in range(self.file_count - 1, 0, -1):
                        previous, target = self._path(index - 1), self._path(index)
                        if previous.exists():
                            os.replace(previous, target)
                    if self.file_count == 1:
                        path.unlink(missing_ok=True)
                with path.open("ab") as output:
                    output.write(payload)
                    output.flush()
                self._available = True
            except (OSError, ValueError):
                # Diagnostic failures must never turn a recoverable model error
                # into a stopped worker. The export still includes recent errors.
                self._available = False
                self._fallback.append(entry)

    def exception(self, source: str, event: str, error: Exception, **context: Any) -> None:
        self.record(source, event, str(error) or type(error).__name__, errorType=type(error).__name__, **context)

    def export(self) -> dict[str, Any]:
        with self._lock:
            entries: deque[dict] = deque(maxlen=self.max_entries)
            try:
                self._path().parent.mkdir(parents=True, exist_ok=True)
                for index in reversed(range(self.file_count)):
                    path = self._path(index)
                    if not path.exists():
                        continue
                    read_bytes = 0
                    with path.open("rb") as source:
                        while read_bytes < self.max_file_bytes:
                            line = source.readline(min(MAX_RECORD_BYTES + 1, self.max_file_bytes - read_bytes))
                            if not line:
                                break
                            read_bytes += len(line)
                            # Oversized/corrupt external edits never become
                            # unbounded reads, exports, or nested user data.
                            if len(line) > MAX_RECORD_BYTES or not line.endswith(b"\n"):
                                continue
                            try:
                                entry = json.loads(line)
                                if (not isinstance(entry, dict) or entry.get("level") not in {"error", "warning"}
                                        or any(not isinstance(entry.get(key), str) for key in ("timestamp", "source", "event", "message"))):
                                    continue
                                clean = {"timestamp": entry["timestamp"][:40], "level": entry["level"],
                                         "source": entry["source"] if _LABEL.fullmatch(entry["source"]) else "application",
                                         "event": entry["event"] if _LABEL.fullmatch(entry["event"]) else "error",
                                         "message": sanitize_text(entry["message"])}
                                context = entry.get("context")
                                if isinstance(context, dict):
                                    clean["context"] = _safe_context(context)
                                entries.append(clean)
                            except (ValueError, UnicodeError, RecursionError):
                                continue
            except (OSError, ValueError):
                self._available = False
            entries.extend(self._fallback)
            result = {"version": 1, "appVersion": self.app_version, "generatedAt": timestamp(),
                      "entries": list(entries),
                      "limits": {"maxEntries": self.max_entries, "maxFileBytes": self.max_file_bytes, "fileCount": self.file_count},
                      "persistence": {"available": self._available}}
            if not self._available:
                result["persistence"]["error"] = "Could not access local diagnostic storage; recent errors are kept in memory."
            return result
