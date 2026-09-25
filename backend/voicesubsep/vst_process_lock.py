"""One VST operation per user across the server and isolated analysis workers."""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import time

BUSY_MESSAGE = "Another VST operation is running. Wait for it to finish or cancel it first."


def vst_lock_path():
    # Never use TEMP: every isolated analysis has a different temporary root.
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        root = Path(os.environ["LOCALAPPDATA"]) / "VOICESUBSEP"
    else:
        root = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "voicesubsep"
    return root / "locks" / "vst-processing.lock"


@contextmanager
def vst_process_lock():
    path = vst_lock_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        stream = path.open("a+b")
    except OSError:
        raise RuntimeError("Could not open the per-user VST processing lock.") from None
    acquired = False
    try:
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write(b"\0")
            stream.flush()
        stream.seek(0)
        # Windows may signal process exit a few milliseconds before releasing
        # that process's byte-range locks. Permit only this short hand-off;
        # never wait indefinitely or break an active editor/analysis lock.
        attempts = 4 if os.name == "nt" else 1
        for attempt in range(attempts):
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except OSError:
                if attempt == attempts - 1:
                    raise RuntimeError(BUSY_MESSAGE) from None
                time.sleep(.02)
        yield
    finally:
        try:
            if acquired:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        finally:
            stream.close()
