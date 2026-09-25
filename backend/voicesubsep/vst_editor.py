"""One ephemeral native editor session; plugin code stays in a child process."""
from __future__ import annotations

import copy
import threading

from .storage import new_id
from .vst_host import VSTCancelled, edit_plugin, validate_chain, validate_plugin_path

TERMINAL = {"completed", "failed", "cancelled"}
STAGES = ("starting", "loading", "opening", "open")


class EditorManager:
    def __init__(self, *, diagnostics=None, editor=None):
        self.diagnostics = diagnostics
        self._editor = editor
        self._lock = threading.RLock()
        self._started = False
        self._stopping = False
        self._records: dict[str, dict] = {}
        self._cancel: dict[str, threading.Event] = {}
        self._close: dict[str, threading.Event] = {}
        self._focus: dict[str, threading.Event] = {}
        self._thread: threading.Thread | None = None

    def start(self):
        with self._lock:
            if self._started or self._stopping:
                raise RuntimeError("The VST editor manager was already started or stopped.")
            self._started = True

    def stop(self):
        with self._lock:
            self._stopping = True
            for identifier, record in self._records.items():
                if record["status"] not in TERMINAL:
                    record["cancelRequested"] = True
                    self._cancel[identifier].set()
            thread = self._thread
        if thread is not None:
            thread.join(timeout=8)
            if thread.is_alive():
                raise RuntimeError("The VST editor worker has not exited; new editors are disabled.")

    def submit(self, slot: dict) -> dict:
        effect = validate_chain([slot])[0]
        effect["path"] = validate_plugin_path(effect["path"])
        with self._lock:
            if not self._started or self._stopping:
                raise RuntimeError("The VST editor manager is unavailable.")
            if any(item["status"] not in TERMINAL for item in self._records.values()):
                raise OverflowError("Close or cancel the current VST editor first.")
            while len(self._records) >= 16:
                oldest = next(iter(self._records))
                del self._records[oldest], self._cancel[oldest], self._close[oldest], self._focus[oldest]
            identifier = new_id()
            self._records[identifier] = {"id": identifier, "status": "queued", "stage": "starting"}
            self._cancel[identifier] = threading.Event()
            self._close[identifier] = threading.Event()
            self._focus[identifier] = threading.Event()
            self._thread = threading.Thread(target=self._work, args=(identifier, effect),
                                            name="vst-editor", daemon=True)
            self._thread.start()
            return self.get(identifier)

    def get(self, identifier: str) -> dict:
        with self._lock:
            return copy.deepcopy(self._records[identifier])

    def close(self, identifier: str) -> dict:
        with self._lock:
            record = self._records[identifier]
            if record["status"] not in TERMINAL:
                record["closeRequested"] = True
                self._close[identifier].set()
            return self.get(identifier)

    def cancel(self, identifier: str) -> dict:
        with self._lock:
            record = self._records[identifier]
            if record["status"] not in TERMINAL:
                record["cancelRequested"] = True
                self._cancel[identifier].set()
            return self.get(identifier)

    def focus(self, identifier: str) -> dict:
        with self._lock:
            record = self._records[identifier]
            if (record["status"] not in TERMINAL and not record.get("closeRequested")
                    and not record.get("cancelRequested")):
                self._focus[identifier].set()
            return self.get(identifier)

    def _work(self, identifier: str, effect: dict):
        with self._lock:
            cancelled, close_requested = self._cancel[identifier], self._close[identifier]
            if cancelled.is_set():
                self._records[identifier]["status"] = "cancelled"
                return
            self._records[identifier]["status"] = "running"

        def progress(stage: str, _fraction: float):
            # Only the worker's actual visible-window observation may report "open".
            # Late callbacks must never recreate an evicted/terminal session or regress it.
            with self._lock:
                record = self._records.get(identifier)
                if (record and record["status"] not in TERMINAL and stage in STAGES
                        and STAGES.index(stage) >= STAGES.index(record["stage"])):
                    record["stage"] = stage

        def focus_requested() -> bool:
            with self._lock:
                record = self._records.get(identifier)
                if (not record or record["status"] in TERMINAL or cancelled.is_set()
                        or close_requested.is_set()):
                    return False
                event = self._focus[identifier]
                requested = event.is_set()
                event.clear()
                return requested

        try:
            result = (self._editor or edit_plugin)(effect, cancelled=cancelled.is_set,
                                                   close_requested=close_requested.is_set,
                                                   progress=progress, focus_requested=focus_requested)
            with self._lock:
                if cancelled.is_set():
                    self._records[identifier]["status"] = "cancelled"
                else:
                    self._records[identifier].update(status="completed", result=copy.deepcopy(result))
        except Exception as error:
            with self._lock:
                if cancelled.is_set() or isinstance(error, VSTCancelled):
                    self._records[identifier]["status"] = "cancelled"
                else:
                    self._records[identifier].update(status="failed", error=(str(error) or type(error).__name__)[:2000])
                    if self.diagnostics:
                        # Native state can contain private preset/licensing data.
                        # Never include the request, result or native exception in logs.
                        self.diagnostics.record("vst", "editor_failed", "VST editor failed.",
                                                level="error", editorId=identifier)
