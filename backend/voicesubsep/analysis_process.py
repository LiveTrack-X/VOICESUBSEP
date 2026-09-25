"""Parent-side isolation for a single analysis; the queue stays in the server."""
from __future__ import annotations

import json
from contextlib import contextmanager
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading

from .analysis_ipc import MAX_CONTROL_BYTES, read_frame, send_frame
from .inference import AnalysisCancelled
from .process_tree import ProcessTree


class AnalysisWorkerCleanupError(RuntimeError):
    """Do not start another GPU job if the previous owned worker could not exit."""


@contextmanager
def worker_temporary_directory():
    directory = tempfile.TemporaryDirectory(prefix="voicesubsep-analysis-")
    try:
        yield directory.name
    except AnalysisWorkerCleanupError:
        # A native process may still own files. Preserve the fail-closed signal,
        # even when Windows also refuses to remove its temporary directory.
        try:
            directory.cleanup()
        except OSError:
            pass
        raise
    except BaseException:
        directory.cleanup()
        raise
    else:
        directory.cleanup()


def worker_command():
    if getattr(sys, "frozen", False):
        return [sys.executable, "--analysis-worker"]
    return [sys.executable, "-m", "voicesubsep.analysis_worker"]


def contains_secret(value, secrets):
    if isinstance(value, str):
        return any(key in value or json.dumps(key, ensure_ascii=True)[1:-1] in value for key in secrets)
    if isinstance(value, dict):
        return any(contains_secret(k, secrets) or contains_secret(v, secrets) for k, v in value.items())
    if isinstance(value, list):
        return any(contains_secret(item, secrets) for item in value)
    return False


class AnalysisProcess:
    def __init__(self, *, command=None):
        # Injection is for isolated tests only; never supplied by an HTTP request.
        self.command = command or worker_command()
        self.pid = None

    def run(self, media_path, *, options, track_speakers, progress, recognition_preview,
            cancelled, force_cancelled):
        if cancelled() or force_cancelled():
            raise AnalysisCancelled("Analysis was cancelled.")
        options = dict(options)
        getters = {}
        for name, slot in (("get_provider_key", "asr"), ("get_diarization_key", "diarization")):
            if name in options:
                getters[slot] = options.pop(name)
        with worker_temporary_directory() as temporary:
            environment = dict(os.environ)
            environment.pop("VOICESUBSEP_DESKTOP_TOKEN", None)
            environment["PYTHONPATH"] = os.pathsep.join(filter(None, [str(Path(__file__).resolve().parent.parent), environment.get("PYTHONPATH", "")]))
            environment.update({"TMP": temporary, "TEMP": temporary, "TMPDIR": temporary})
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
            process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, shell=False, env=environment,
                                       creationflags=flags, start_new_session=os.name != "nt", bufsize=0)
            self.pid = process.pid
            tree = None
            reader = None
            writer = None
            reader_done = threading.Event()
            write_failed = threading.Event()
            messages = queue.Queue(maxsize=2)
            commands = queue.Queue(maxsize=4)
            secrets = set()

            def read_messages():
                try:
                    while not reader_done.is_set():
                        message = read_frame(process.stdout)
                        while not reader_done.is_set():
                            try:
                                messages.put(message, timeout=.1)
                                break
                            except queue.Full:
                                pass
                except (EOFError, OSError, ValueError):
                    while not reader_done.is_set():
                        try:
                            messages.put({"type": "pipe_closed"}, timeout=.1)
                            break
                        except queue.Full:
                            pass

            def write_messages():
                try:
                    while not reader_done.is_set():
                        try:
                            command = commands.get(timeout=.1)
                        except queue.Empty:
                            continue
                        send_frame(process.stdin, command, limit=MAX_CONTROL_BYTES)
                except (OSError, ValueError):
                    write_failed.set()

            def send_command(command):
                try:
                    commands.put_nowait(command)
                except queue.Full:
                    raise RuntimeError("The analysis worker control channel stalled.") from None

            try:
                # The child waits for its first frame: no model/FFmpeg/VST work can
                # escape containment before assignment, including on Windows.
                tree = ProcessTree(process)
                reader = threading.Thread(target=read_messages, name="analysis-messages", daemon=True)
                reader.start()
                writer = threading.Thread(target=write_messages, name="analysis-commands", daemon=True)
                writer.start()
                send_command({"type": "start", "mediaPath": str(media_path), "options": options,
                              "trackSpeakers": track_speakers, "keySlots": list(getters)})
                cancel_sent = False
                while True:
                    if force_cancelled():
                        raise AnalysisCancelled("Analysis was force-stopped.")
                    if cancelled() and not cancel_sent:
                        send_command({"type": "cancel"})
                        cancel_sent = True
                    try:
                        message = messages.get(timeout=.05)
                    except queue.Empty:
                        # A late graceful cancel can encounter a closed stdin
                        # while the reader is still decoding a completed result.
                        # Drain that result before considering a writer failure.
                        if write_failed.is_set() and process.poll() is None:
                            raise RuntimeError("The analysis worker control pipe closed or rejected its request.")
                        if process.poll() is not None and not reader.is_alive():
                            raise RuntimeError("The analysis worker exited without a result.")
                        continue
                    if contains_secret(message, secrets):
                        raise RuntimeError("The analysis worker returned sensitive provider data; its response was discarded.")
                    kind = message.get("type")
                    if kind == "progress":
                        progress(message["stage"], message["fraction"])
                    elif kind == "preview":
                        recognition_preview(message["text"])
                    elif kind == "key":
                        slot = message.get("slot")
                        key = None
                        if slot in getters and not cancelled() and not force_cancelled():
                            try:
                                key = getters[slot]()
                                secrets.add(key)
                            except (RuntimeError, ValueError):
                                pass
                        send_command({"type": "key", "slot": slot, "key": key})
                    elif kind == "result":
                        result = message.get("result")
                        if not isinstance(result, dict):
                            raise RuntimeError("The analysis worker returned an invalid result.")
                        return result
                    elif kind == "cancelled":
                        raise AnalysisCancelled("Analysis was cancelled.")
                    elif kind == "error":
                        raise RuntimeError(str(message.get("message", "Analysis failed."))[:3000])
                    else:
                        raise RuntimeError("The analysis worker exited or returned an invalid response.")
            finally:
                # Never release the queue slot until this owned process is reaped.
                # Closing the Job Object also removes descendants left by a plugin.
                reader_done.set()
                cleanup_error = None
                try:
                    if tree is not None:
                        tree.close()
                    elif process.poll() is None:
                        # Containment failed before the start frame was sent.
                        process.kill()
                except (OSError, subprocess.TimeoutExpired) as exc:
                    cleanup_error = AnalysisWorkerCleanupError("The analysis worker could not be stopped. Further analyses are paused; restart the backend.")
                    cleanup_error.__cause__ = exc
                try:
                    process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired) as exc:
                    cleanup_error = AnalysisWorkerCleanupError("The analysis worker could not be stopped. Further analyses are paused; restart the backend.")
                    cleanup_error.__cause__ = exc
                finally:
                    if writer:
                        writer.join(timeout=1)
                        if writer.is_alive() and cleanup_error is None:
                            cleanup_error = AnalysisWorkerCleanupError("The analysis worker control pipe did not close. Further analyses are paused; restart the backend.")
                    if process.stdin:
                        try:
                            process.stdin.close()
                        except OSError:
                            pass
                    if reader:
                        reader.join(timeout=1)
                        if reader.is_alive() and cleanup_error is None:
                            cleanup_error = AnalysisWorkerCleanupError("The analysis worker pipe did not close. Further analyses are paused; restart the backend.")
                    if process.stdout:
                        try:
                            process.stdout.close()
                        except OSError:
                            pass
                if cleanup_error is not None:
                    raise cleanup_error
