"""Persistent jobs with one cooperative inference worker."""

from __future__ import annotations

import copy
import math
import queue
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .storage import Storage, new_id, valid_id

Analyzer = Callable[..., dict[str, Any]]
TERMINAL = {"completed", "failed", "cancelled"}


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_analyzer(media_path: Path, **kwargs: Any) -> dict[str, Any]:
    from .inference import analyze

    return analyze(media_path, **kwargs)


class JobManager:
    def __init__(self, storage: Storage, analyzer: Analyzer | None = None):
        self.storage = storage
        self.analyzer = analyzer or default_analyzer
        self._jobs: dict[str, dict[str, Any]] = {}
        self._cancellations: dict[str, threading.Event] = {}
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._mutex = threading.RLock()
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("The inference worker was already started.")
        self.storage.acquire()
        try:
            for path in self.storage.jobs.glob("*.json"):
                if not valid_id(path.stem):
                    continue
                try:
                    record = self.storage.read_json(path)
                    if record.get("id") != path.stem or record.get("status") not in TERMINAL | {"queued", "running"}:
                        continue
                    # Never silently replay a job after a crash or restart.
                    if record["status"] in {"queued", "running"}:
                        record.update(status="failed", stage="interrupted", error="The backend stopped before this job finished. Start a new analysis.", updatedAt=timestamp())
                        self.storage.write_json(path, record)
                    self._jobs[path.stem] = record
                except (OSError, ValueError):
                    continue
            self._thread = threading.Thread(target=self._work, name="voicesubsep-inference", daemon=True)
            self._thread.start()
        except BaseException:
            self.storage.release()
            raise

    def stop(self) -> None:
        self._stopping.set()
        with self._mutex:
            for job_id, record in self._jobs.items():
                if record["status"] not in TERMINAL:
                    self._cancellations[job_id].set()
                    if record["status"] == "queued":
                        self._update(record, status="cancelled", stage="cancelled")
        self._queue.put(None)
        if self._thread is not None:
            self._thread.join(timeout=5)
        # A still-running native model call retains the lock until its worker exits.

    def _update(self, record: dict[str, Any], **changes: Any) -> None:
        candidate = {**record, **changes, "updatedAt": timestamp()}
        self.storage.write_json(self.storage.job_path(record["id"]), candidate)
        record.clear()
        record.update(candidate)

    def submit(self, request: dict[str, Any]) -> str:
        with self._mutex:
            if self._thread is None or not self._thread.is_alive() or self._stopping.is_set():
                raise RuntimeError("The inference worker is not available.")
            if sum(j["status"] not in TERMINAL for j in self._jobs.values()) >= 32:
                raise OverflowError("The analysis queue is full (32 jobs). Wait for existing jobs to finish.")
            job_id = new_id()
            record = {"id": job_id, "status": "queued", "stage": "queued", "progress": 0.0,
                      "request": request, "createdAt": timestamp(), "updatedAt": timestamp()}
            self.storage.write_json(self.storage.job_path(job_id), record)
            self._jobs[job_id] = record
            self._cancellations[job_id] = threading.Event()
            self._queue.put(job_id)
            return job_id

    def get(self, job_id: str) -> dict[str, Any]:
        with self._mutex:
            record = self._jobs.get(job_id)
            if record is None:
                raise KeyError(job_id)
            return copy.deepcopy({key: record[key] for key in ("id", "status", "stage", "progress", "error", "result") if key in record})

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self._mutex:
            record = self._jobs.get(job_id)
            if record is None:
                raise KeyError(job_id)
            if record["status"] in TERMINAL:
                return self.get(job_id)
            self._cancellations[job_id].set()
            if record["status"] == "queued":
                self._update(record, status="cancelled", stage="cancelled")
            else:
                self._update(record, stage="cancellation requested")
            return self.get(job_id)

    def _run(self, job_id: str) -> None:
        with self._mutex:
            record = self._jobs[job_id]
            event = self._cancellations[job_id]
            if record["status"] != "queued" or event.is_set():
                return
            self._update(record, status="running", stage="preparing", progress=0.01)
            request = dict(record["request"])

        def progress(stage: str, fraction: float) -> None:
            with self._mutex:
                if record["status"] != "running" or event.is_set():
                    return
                fraction = float(fraction)
                if not math.isfinite(fraction):
                    return
                self._update(record, stage=str(stage)[:512], progress=min(0.99, max(0.0, fraction)))

        try:
            _, media_path = self.storage.get_media(request["mediaId"])
            result = self.analyzer(
                media_path,
                audio_track=request["audioTrack"], mode=request["mode"],
                speaker_count=request["speakerCount"], whisper_model=request["whisperModel"],
                language=request["language"], device=request["device"],
                diarization=request["diarization"], progress=progress, cancelled=event.is_set,
            )
            with self._mutex:
                # An analyzer returning a completed result wins a late cancellation race.
                # Cancellation is reported only when the analyzer acknowledges it.
                self._update(record, status="completed", stage="completed", progress=1.0, result=result)
        except Exception as exc:
            with self._mutex:
                if type(exc).__name__ == "AnalysisCancelled":
                    self._update(record, status="cancelled", stage="cancelled")
                else:
                    self._update(record, status="failed", stage="failed", error=(str(exc) or type(exc).__name__)[:3000])

    def _work(self) -> None:
        try:
            while True:
                job_id = self._queue.get()
                try:
                    if job_id is None:
                        break
                    self._run(job_id)
                finally:
                    self._queue.task_done()
        finally:
            self.storage.release()
