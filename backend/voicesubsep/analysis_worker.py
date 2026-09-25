"""Private subprocess entry point. Only its parent supplies the analysis request."""
from __future__ import annotations

import os
from pathlib import Path
import queue
import sys
import threading

from .analysis_ipc import MAX_CONTROL_BYTES, read_frame, send_frame


def run_worker(incoming, outgoing, analyzer=None):
    from .inference import AnalysisCancelled, analyze
    from .recognition_preview import preview_line
    analyzer = analyzer or analyze
    cancelled = threading.Event()
    answers = queue.Queue(maxsize=1)
    write_lock = threading.Lock()
    secrets = set()

    def send(value):
        with write_lock:
            send_frame(outgoing, value)

    request = read_frame(incoming, limit=MAX_CONTROL_BYTES)
    if request.get("type") != "start":
        raise ValueError("Invalid analysis worker startup.")

    def control():
        try:
            while True:
                message = read_frame(incoming, limit=MAX_CONTROL_BYTES)
                if message.get("type") == "cancel":
                    cancelled.set()
                elif message.get("type") == "key":
                    answers.put_nowait(message)
                else:
                    cancelled.set()
                    return
        except (EOFError, OSError, ValueError, queue.Full):
            cancelled.set()

    threading.Thread(target=control, name="analysis-control", daemon=True).start()

    def get_key(slot):
        if cancelled.is_set():
            raise AnalysisCancelled("Analysis was cancelled.")
        send({"type": "key", "slot": slot})
        while not cancelled.is_set():
            try:
                answer = answers.get(timeout=.1)
            except queue.Empty:
                continue
            key = answer.get("key")
            if answer.get("slot") != slot or not isinstance(key, str) or not 12 <= len(key) <= 512:
                raise RuntimeError("The provider key was removed or replaced. Register it and start a new analysis.")
            secrets.add(key)
            return key
        raise AnalysisCancelled("Analysis was cancelled.")

    def progress(stage, fraction):
        if not cancelled.is_set():
            send({"type": "progress", "stage": str(stage)[:512], "fraction": fraction})

    def preview(text):
        line = preview_line(text)
        if line and not cancelled.is_set():
            send({"type": "preview", "text": line})

    try:
        options = request["options"]
        for name, slot in (("get_provider_key", "asr"), ("get_diarization_key", "diarization")):
            if slot in request.get("keySlots", []):
                options[name] = lambda slot=slot: get_key(slot)
        if request.get("trackSpeakers"):
            from .multitrack import analyze_tracks
            result = analyze_tracks(analyzer, Path(request["mediaPath"]), selections=request["trackSpeakers"], options=options,
                                    progress=progress, cancelled=cancelled.is_set, recognition_preview=preview)
        else:
            result = analyzer(Path(request["mediaPath"]), **options, progress=progress,
                              cancelled=cancelled.is_set, recognition_preview=preview)
        send({"type": "result", "result": result})
    except AnalysisCancelled:
        send({"type": "cancelled"})
    except Exception as exc:
        message = str(exc) or type(exc).__name__
        for key in secrets:
            message = message.replace(key, "[redacted]")
        send({"type": "error", "message": message[:3000]})


def main():
    # Keep BOTH protocol handles separate from the C runtime standard streams.
    # On Windows a blocking control read on fd 0 can hold its CRT lock while
    # NumPy's native import also inspects stdin, deadlocking before first progress.
    # Libraries must see a noninteractive null stdin, never consume our IPC.
    incoming = os.fdopen(os.dup(sys.stdin.fileno()), "rb", buffering=0)
    outgoing = os.fdopen(os.dup(sys.stdout.fileno()), "wb", buffering=0)
    with open(os.devnull, "r+b") as null:
        os.dup2(null.fileno(), sys.stdin.fileno())
        os.dup2(null.fileno(), sys.stdout.fileno())
        os.dup2(null.fileno(), sys.stderr.fileno())
    try:
        run_worker(incoming, outgoing)
        return 0
    except Exception:
        return 1  # Do not expose arbitrary payloads/keys through tracebacks.
    finally:
        outgoing.close()
        # The daemon control reader may still own a blocking read. The parent
        # closes the pipe/reaps this owned process; do not close across that read.


if __name__ == "__main__":
    raise SystemExit(main())
