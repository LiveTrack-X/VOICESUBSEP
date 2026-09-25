"""Persistent jobs with one cooperative inference worker."""

from __future__ import annotations

import copy
import math
import queue
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .storage import Storage, new_id, valid_id
from .diagnostics import Diagnostics
from .cloud_credentials import ProviderCredentials
from .recognition_preview import PREVIEW_MAX_LINES, preview_line, preview_options

Analyzer = Callable[..., dict[str, Any]]
TERMINAL = {"completed", "failed", "cancelled"}
PROGRESS_SAVE_INTERVAL = 1.0


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_analyzer(media_path: Path, **kwargs: Any) -> dict[str, Any]:
    from .inference import analyze

    return analyze(media_path, **kwargs)


class JobManager:
    def __init__(self, storage: Storage, analyzer: Analyzer | None = None, *, diagnostics: Diagnostics | None = None,
                 provider_credentials: ProviderCredentials | None = None):
        self.storage = storage
        self.diagnostics = diagnostics
        self.provider_credentials = provider_credentials
        self.analyzer = analyzer or default_analyzer
        self._jobs: dict[str, dict[str, Any]] = {}
        self._cancellations: dict[str, threading.Event] = {}
        self._provider_keys: dict[str, Callable[[], str]] = {}
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
                        if self.diagnostics:
                            self.diagnostics.record("analysis", "interrupted", record["error"], level="warning", jobId=path.stem)
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

    def _update(self, record: dict[str, Any], *, persist: bool = True, **changes: Any) -> None:
        candidate = {**record, **changes, "updatedAt": timestamp()}
        if persist:
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
            provider_key = None
            if request.get("asrProvider", "local") != "local":
                if self.provider_credentials is None:
                    raise RuntimeError("클라우드 API 키를 먼저 등록하세요.")
                try:
                    provider_key = self.provider_credentials.bind_provider_key(request["asrProvider"])
                except ValueError:
                    raise RuntimeError("클라우드 API 키를 먼저 등록하세요.") from None
            record = {"id": job_id, "status": "queued", "stage": "queued", "progress": 0.0,
                      "request": request, "createdAt": timestamp(), "updatedAt": timestamp()}
            self.storage.write_json(self.storage.job_path(job_id), record)
            self._jobs[job_id] = record
            self._cancellations[job_id] = threading.Event()
            if provider_key is not None:
                self._provider_keys[job_id] = provider_key
            self._queue.put(job_id)
            return job_id

    def get(self, job_id: str) -> dict[str, Any]:
        with self._mutex:
            record = self._jobs.get(job_id)
            if record is None:
                raise KeyError(job_id)
            return copy.deepcopy({key: record[key] for key in (
                "id", "status", "stage", "progress", "error", "result", "createdAt", "updatedAt",
                "recognitionPreview") if key in record})

    def history(self) -> list[dict]:
        with self._mutex:
            return [{"id": r["id"], "kind": "analysis", "status": r["status"],
                     "createdAt": r.get("createdAt", ""), "mediaId": r.get("request", {}).get("mediaId"),
                     "projectId": r.get("request", {}).get("projectId"),
                     "projectName": r.get("request", {}).get("projectName", ""),
                     "progress": r.get("progress", 0), "stage": r.get("stage", ""),
                     "hasResult": bool(r.get("result"))} for r in self._jobs.values()]

    def referenced_media_ids(self) -> set[str]:
        with self._mutex:
            return {r.get("request", {}).get("mediaId") for r in self._jobs.values()} - {None}

    def remove(self, job_id: str) -> None:
        with self._mutex:
            record = self._jobs[job_id]
            if record["status"] not in TERMINAL:
                raise PermissionError("Cancel the running job before removing its history.")
            self.storage.job_path(job_id).unlink(missing_ok=True)
            del self._jobs[job_id]
            self._provider_keys.pop(job_id, None)
            # Cancelled queue entries remain harmless tombstones until drained.

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
            if job_id not in self._jobs:
                self._provider_keys.pop(job_id, None)
                return
            record = self._jobs[job_id]
            event = self._cancellations[job_id]
            if record["status"] != "queued" or event.is_set():
                self._provider_keys.pop(job_id, None)
                return
            self._update(record, status="running", stage="preparing", progress=0.01)
            request = dict(record["request"])

        last_progress_save = time.monotonic()

        def recognition_preview(text: str) -> None:
            line = preview_line(text)
            if not line:
                return
            with self._mutex:
                if record["status"] != "running" or event.is_set():
                    return
                lines = [*record.get("recognitionPreview", {}).get("lines", []), line][-PREVIEW_MAX_LINES:]
                # The following progress report persists this snapshot at most once
                # per second. API polling sees each completed segment immediately.
                self._update(record, persist=False, recognitionPreview={"lines": lines, "updatedAt": timestamp()})

        def progress(stage: str, fraction: float) -> None:
            nonlocal last_progress_save
            with self._mutex:
                if record["status"] != "running" or event.is_set():
                    return
                fraction = float(fraction)
                if not math.isfinite(fraction):
                    return
                stage = str(stage)[:512]
                now = time.monotonic()
                persist = stage != record.get("stage") or now - last_progress_save >= PROGRESS_SAVE_INTERVAL
                self._update(record, persist=persist, stage=stage, progress=min(0.99, max(0.0, fraction)))
                if persist:
                    last_progress_save = now

        try:
            _, media_path = self.storage.get_media(request["mediaId"])
            options = dict(audio_track=request["audioTrack"], mode=request["mode"],
                speaker_count=request["speakerCount"], whisper_model=request["whisperModel"],
                language=request["language"], device=request["device"],
                speaker_boundary_ms=request.get("speakerBoundaryMs", 500),
                diarization=request["diarization"],
                **({"preprocessing": request["preprocessing"]} if request.get("preprocessing") is not None else {}),
            )
            provider = request.get("asrProvider", "local")
            if provider != "local":
                if self.provider_credentials is None:
                    raise RuntimeError("클라우드 API 키를 먼저 등록하세요.")
                provider_key = self._provider_keys.get(job_id)
                if provider_key is None:
                    raise RuntimeError("클라우드 API 키를 먼저 등록하세요.")
                provider_key()
                options.update(asr_provider=provider, provider_model=request.get("providerModel"),
                               cloud_consent=request.get("cloudConsent", False),
                               get_provider_key=provider_key)
            if request.get("trackSpeakers"):
                from .multitrack import analyze_tracks
                result = analyze_tracks(self.analyzer, media_path, selections=request["trackSpeakers"],
                                        options=options, progress=progress, cancelled=event.is_set,
                                        recognition_preview=recognition_preview)
            else:
                result = self.analyzer(media_path, **options, progress=progress, cancelled=event.is_set,
                                       **preview_options(self.analyzer, recognition_preview))
            with self._mutex:
                # An analyzer returning a completed result wins a late cancellation race.
                # Cancellation is reported only when the analyzer acknowledges it.
                self._update(record, status="completed", stage="completed", progress=1.0, result=result)
        except Exception as exc:
            with self._mutex:
                if type(exc).__name__ == "AnalysisCancelled":
                    self._update(record, status="cancelled", stage="cancelled")
                else:
                    if self.diagnostics:
                        self.diagnostics.exception("analysis", "failed", exc, jobId=job_id)
                    self._update(record, status="failed", stage="failed", error=(str(exc) or type(exc).__name__)[:3000])
        finally:
            with self._mutex:
                self._provider_keys.pop(job_id, None)

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
