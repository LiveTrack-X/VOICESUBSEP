"""Persistent CPU render queue sharing the application's existing storage lock."""

from __future__ import annotations

import copy
import math
from pathlib import Path
import queue
import shutil
import threading
from typing import Any, Callable

from .jobs import timestamp
from .rendering import FORMATS, RenderCancelled, render_media
from .storage import Storage, new_id, valid_id
from .diagnostics import Diagnostics

Renderer = Callable[..., dict[str, Any]]
TERMINAL = {"completed", "failed", "cancelled"}


class RenderJobManager:
    def __init__(self, storage: Storage, renderer: Renderer | None = None, *, diagnostics: Diagnostics | None = None):
        self.storage = storage
        self.diagnostics = diagnostics
        self.renderer = renderer or render_media
        self.root = storage.root / "renders"
        self._jobs: dict[str, dict] = {}
        self._cancel: dict[str, threading.Event] = {}
        self._queue: queue.Queue[str | None] = queue.Queue(maxsize=8)
        self._mutex = threading.RLock()
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None

    def folder(self, job_id: str) -> Path:
        if not valid_id(job_id):
            raise ValueError("Invalid render identifier.")
        return self.storage.contained(self.root / job_id)

    def _update(self, record: dict, **changes) -> None:
        updated = {**record, **changes, "updatedAt": timestamp()}
        self.storage.write_json(self.folder(record["id"]) / "job.json", updated)
        record.clear()
        record.update(updated)

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("The render worker was already started.")
        # JobManager acquired the shared lock before this lifecycle starts.
        self.storage.contained(self.root).mkdir(exist_ok=True)
        for path in self.root.glob("*/job.json"):
            if not valid_id(path.parent.name):
                continue
            try:
                record = self.storage.read_json(path)
                job_id = path.parent.name
                request = record.get("request", {})
                if (not isinstance(request, dict) or record.get("id") != job_id
                        or record.get("status") not in TERMINAL | {"queued", "running"}
                        or request.get("format") not in FORMATS or not valid_id(request.get("mediaId", ""))):
                    continue
                if record["status"] in {"queued", "running"}:
                    self._update(record, status="failed", stage="interrupted",
                                 error="The backend stopped before this render finished. Start a new export.")
                    if self.diagnostics:
                        self.diagnostics.record("render", "interrupted", record["error"], level="warning", jobId=job_id)
                if record["status"] == "completed" and not (self.folder(job_id) / f"edited.{request['format']}").is_file():
                    self._update(record, status="failed", stage="failed", error="The exported file is missing.", result=None)
                self._jobs[job_id] = record
            except (OSError, ValueError, TypeError):
                continue
        self._thread = threading.Thread(target=self._work, name="voicesubsep-render", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stopping.set()
        with self._mutex:
            for job_id, record in self._jobs.items():
                if record["status"] not in TERMINAL:
                    self._cancel[job_id].set()
                    if record["status"] == "queued":
                        self._update(record, status="cancelled", stage="cancelled")
        self._queue.put(None)
        if self._thread is not None:
            # The renderer terminates/reaps its owned child before acknowledging
            # cancellation. Keep the shared data lock until that cleanup ends.
            self._thread.join()

    def submit(self, request: dict) -> str:
        with self._mutex:
            if self._thread is None or not self._thread.is_alive() or self._stopping.is_set():
                raise RuntimeError("The render worker is not available.")
            if self._queue.full() or sum(record["status"] not in TERMINAL for record in self._jobs.values()) >= 8:
                raise OverflowError("The export queue is full (8 jobs). Wait for an export to finish.")
            job_id = new_id()
            saved_request = copy.deepcopy(request)
            snapshot = saved_request.pop("projectSnapshot", None)
            if snapshot is not None:
                # Write the immutable revision once; progress updates must not
                # rewrite megabytes of captions and documents every tick.
                self.storage.write_json(self.folder(job_id) / "snapshot.json", snapshot)
                saved_request["hasSnapshot"] = True
            record = {"id": job_id, "request": saved_request, "status": "queued", "stage": "queued",
                      "progress": 0.0, "createdAt": timestamp(), "updatedAt": timestamp()}
            self.storage.write_json(self.folder(job_id) / "job.json", record)
            self._jobs[job_id] = record
            self._cancel[job_id] = threading.Event()
            self._queue.put_nowait(job_id)
            return job_id

    def get(self, job_id: str) -> dict:
        with self._mutex:
            record = self._jobs[job_id]
            return copy.deepcopy({key: record[key] for key in
                ("id", "status", "progress", "stage", "error", "result") if key in record})

    def history(self) -> list[dict]:
        with self._mutex:
            return [{"id": r["id"], "kind": "render", "status": r["status"],
                     "createdAt": r.get("createdAt", ""), "mediaId": r.get("request", {}).get("mediaId"),
                     "projectId": r.get("request", {}).get("projectId"),
                     "projectName": r.get("request", {}).get("projectName", ""),
                     "progress": r.get("progress", 0), "stage": r.get("stage", ""),
                     "hasResult": bool(r.get("result"))} for r in self._jobs.values()]

    def snapshot(self, job_id: str) -> dict | None:
        with self._mutex:
            request = self._jobs[job_id]["request"]
            if request.get("hasSnapshot"):
                try:
                    return self.storage.read_json(self.folder(job_id) / "snapshot.json")
                except (OSError, ValueError):
                    return None
            return copy.deepcopy(request.get("projectSnapshot"))

    def referenced_media_ids(self) -> set[str]:
        with self._mutex:
            return {r.get("request", {}).get("mediaId") for r in self._jobs.values()} - {None}

    def remove(self, job_id: str) -> None:
        with self._mutex:
            record = self._jobs[job_id]
            if record["status"] not in TERMINAL:
                raise PermissionError("Cancel the running export before removing its history.")
            target = self.folder(job_id)
            if target.parent != self.root.resolve():
                raise ValueError("Invalid export directory.")
            shutil.rmtree(target)
            del self._jobs[job_id]

    def cancel(self, job_id: str) -> dict:
        with self._mutex:
            record = self._jobs[job_id]
            if record["status"] not in TERMINAL:
                self._cancel[job_id].set()
                self._update(record, stage="cancellation requested" if record["status"] == "running" else "cancelled",
                             status=record["status"] if record["status"] == "running" else "cancelled")
            return self.get(job_id)

    def file(self, job_id: str) -> tuple[Path, str]:
        with self._mutex:
            record = self._jobs[job_id]
            if record["status"] != "completed":
                raise FileNotFoundError("Export is not complete.")
            format = record["request"]["format"]
            if format not in FORMATS:
                raise ValueError("Invalid saved export format.")
            folder = self.folder(job_id)
            path = self.storage.contained(folder / f"edited.{format}")
            if path.parent != folder or not path.is_file():
                raise FileNotFoundError("Export is missing.")
            return path, record["result"]["filename"]

    def _run(self, job_id: str) -> None:
        with self._mutex:
            if job_id not in self._jobs:
                return
            record, event = self._jobs[job_id], self._cancel[job_id]
            if record["status"] != "queued" or event.is_set():
                return
            self._update(record, status="running", stage="preparing", progress=0.01)
            request = record["request"]

        def progress(stage, fraction):
            with self._mutex:
                if not event.is_set() and math.isfinite(float(fraction)):
                    self._update(record, stage=str(stage)[:512],
                                 progress=max(record["progress"], min(0.99, max(0.0, float(fraction)))))

        try:
            metadata, source = self.storage.get_media(request["mediaId"])
            destination = self.storage.contained(self.folder(job_id) / f"edited.{request['format']}")
            result = self.renderer(source, destination, keep_ranges=request["keepRanges"], format=request["format"],
                                   audio_track=request["audioTrack"], progress=progress, cancelled=event.is_set,
                                   **({"frame_rate": request["frameRate"]} if request.get("frameRate", "30") != "30" else {}))
            if not destination.is_file() or not destination.stat().st_size:
                raise RuntimeError("The renderer did not create a completed export.")
            filename = Path(metadata["name"]).stem[:120] + f"-edited.{request['format']}"
            result = {**result, "url": f"/api/renders/{job_id}/file", "filename": filename}
            with self._mutex:
                # Successful atomic commit wins a cancellation arriving afterward.
                self._update(record, status="completed", stage="completed", progress=1.0, result=result)
        except Exception as exc:
            with self._mutex:
                if isinstance(exc, RenderCancelled):
                    self._update(record, status="cancelled", stage="cancelled")
                else:
                    if self.diagnostics:
                        self.diagnostics.exception("render", "failed", exc, jobId=job_id)
                    self._update(record, status="failed", stage="failed", error=(str(exc) or type(exc).__name__)[:3000])

    def _work(self) -> None:
        while True:
            job_id = self._queue.get()
            try:
                if job_id is None:
                    return
                self._run(job_id)
            finally:
                self._queue.task_done()
