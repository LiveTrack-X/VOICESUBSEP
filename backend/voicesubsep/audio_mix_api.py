"""Persistent local mixer queue; register under the host app's security middleware."""
from __future__ import annotations

import copy
import math
import threading
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from .audio_mixing import mix_audio, validate_mix
from .media import probe_media
from .render_jobs import RenderJobManager, TERMINAL
from .rendering import RenderCancelled
from .storage import Storage, valid_id


class MixTrack(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    mediaId: str = Field(pattern=r"^[a-f0-9]{32}$")
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    audioTrack: int = Field(ge=0, le=4096)
    gainDb: float = Field(ge=-60, le=12)
    offsetSeconds: float = Field(ge=-604800, le=604800)
    muted: bool = False


class MixRange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    start: float = Field(ge=0, le=604800)
    end: float = Field(gt=0, le=604800)


class MixRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    tracks: list[MixTrack] = Field(min_length=1, max_length=16)
    format: Literal["wav", "mp3", "m4a", "mp4"] = "wav"
    limiter: bool = True
    timelineDuration: float | None = Field(default=None, gt=0, le=604800)
    keepRanges: list[MixRange] | None = Field(default=None, min_length=1, max_length=200)
    videoMediaId: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    frameRate: Literal["original", "30", "60"] = "30"


class AudioMixJobManager(RenderJobManager):
    def __init__(self, storage: Storage, renderer=None, *, diagnostics=None):
        super().__init__(storage, renderer or mix_audio, diagnostics=diagnostics)
        self.root = storage.root / "audio-mixes"

    def start(self):
        if self._thread is not None:
            raise RuntimeError("The mixer worker was already started.")
        self.storage.contained(self.root).mkdir(exist_ok=True)
        for path in self.root.glob("*/job.json"):
            if not valid_id(path.parent.name):
                continue
            try:
                record = self.storage.read_json(path)
                if record.get("id") != path.parent.name or record.get("status") not in TERMINAL | {"queued", "running"}:
                    continue
                MixRequest.model_validate(record.get("request"))
                if record["status"] in {"queued", "running"}:
                    self._update(record, status="failed", stage="interrupted", error="The backend stopped during this mix. Start a new export.")
                if record["status"] == "completed" and not (path.parent / f"edited.{record['request']['format']}").is_file():
                    self._update(record, status="failed", stage="failed", error="The mixed file is missing.", result=None)
                self._jobs[record["id"]] = record
            except (OSError, ValueError, TypeError):
                continue
        self._thread = threading.Thread(target=self._work, name="voicesubsep-mixer", daemon=True)
        self._thread.start()

    def get(self, job_id):
        with self._mutex:
            return {**super().get(job_id), "request": copy.deepcopy(self._jobs[job_id]["request"])}

    def history(self):
        with self._mutex:
            return sorted([{ "id": r["id"], "kind": "mix", "status": r["status"],
                            "createdAt": r.get("createdAt", ""), "format": r["request"]["format"],
                            "tracks": len(r["request"]["tracks"])} for r in self._jobs.values()],
                          key=lambda r: r["createdAt"], reverse=True)

    def referenced_media_ids(self):
        with self._mutex:
            return {media_id for r in self._jobs.values() for media_id in
                    ([t["mediaId"] for t in r["request"]["tracks"]] + [r["request"].get("videoMediaId")]) if media_id}

    def _run(self, job_id):
        with self._mutex:
            if job_id not in self._jobs:
                return
            record, event = self._jobs[job_id], self._cancel[job_id]
            if record["status"] != "queued" or event.is_set():
                return
            self._update(record, status="running", stage="preparing", progress=.01)
            request = record["request"]

        def progress(stage, fraction):
            with self._mutex:
                if not event.is_set() and math.isfinite(float(fraction)):
                    self._update(record, stage=str(stage)[:512], progress=max(record["progress"], min(.99, max(0., float(fraction)))))
        try:
            ids = {t["mediaId"] for t in request["tracks"]} | ({request["videoMediaId"]} if request.get("videoMediaId") else set())
            sources = {mid: self.storage.get_media(mid) for mid in ids}
            destination = self.folder(job_id) / f"edited.{request['format']}"
            result = self.renderer(sources, destination, request=request, progress=progress, cancelled=event.is_set)
            if not destination.is_file() or not destination.stat().st_size:
                raise RuntimeError("The mixer did not create a completed export.")
            result = {**result, "url": f"/api/audio-mixes/{job_id}/file", "filename": f"voicesubsep-mix.{request['format']}"}
            with self._mutex:
                self._update(record, status="completed", stage="completed", progress=1., result=result)
        except Exception as exc:
            with self._mutex:
                if isinstance(exc, RenderCancelled):
                    self._update(record, status="cancelled", stage="cancelled")
                else:
                    if self.diagnostics:
                        self.diagnostics.exception("mixer", "failed", exc, jobId=job_id)
                    self._update(record, status="failed", stage="failed", error=(str(exc) or type(exc).__name__)[:3000])


def register_audio_mixing_routes(app: FastAPI, manager: AudioMixJobManager, storage: Storage, *, probe=probe_media):
    @app.post("/api/audio-mixes")
    def create_mix(request: MixRequest):
        try:
            # Reserve references before a concurrent cache cleanup can run.
            with storage.media_lock:
                payload = request.model_dump()
                ids = {t.mediaId for t in request.tracks} | ({request.videoMediaId} if request.videoMediaId else set())
                sources = {}
                for media_id in ids:
                    metadata, path = storage.get_media(media_id)
                    sources[media_id] = ({**metadata, **probe(path)}, path)
                validate_mix(payload, sources)
                return {"id": manager.submit(payload)}
        except FileNotFoundError as exc:
            raise HTTPException(404, "A source is missing. Reconnect the original file.") from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except OverflowError as exc:
            raise HTTPException(429, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc

    @app.get("/api/audio-mixes")
    def history():
        return {"jobs": manager.history()}

    @app.get("/api/audio-mixes/{job_id}")
    def get_mix(job_id: str):
        try:
            return manager.get(job_id)
        except KeyError as exc:
            raise HTTPException(404, "Mix job not found.") from exc

    @app.delete("/api/audio-mixes/{job_id}")
    def cancel_mix(job_id: str):
        try:
            return manager.cancel(job_id)
        except KeyError as exc:
            raise HTTPException(404, "Mix job not found.") from exc

    @app.delete("/api/audio-mixes/{job_id}/history")
    def remove_mix(job_id: str):
        try:
            with storage.media_lock:
                manager.remove(job_id)
            return {"removed": True}
        except KeyError as exc:
            raise HTTPException(404, "Mix job not found.") from exc
        except PermissionError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get("/api/audio-mixes/{job_id}/file")
    def mix_file(job_id: str):
        try:
            path, filename = manager.file(job_id)
            return FileResponse(path, filename=filename)
        except (KeyError, FileNotFoundError) as exc:
            raise HTTPException(404, "Completed mix not found.") from exc
