"""Loopback API for local media and real inference jobs.

Launch with: uvicorn voicesubsep.app:app --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

import mimetypes
import hashlib
import json
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Callable, Literal

from fastapi import FastAPI, File, HTTPException, Path as ApiPath, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.formparsers import MultiPartException
from starlette.exceptions import HTTPException as StarletteHTTPException

from .diagnostics import Diagnostics
from .jobs import Analyzer, JobManager
from .media import MEDIA_EXTENSIONS, clean_name, probe_media
from .media_cache import MediaCache
from .document_api import register_document_routes
from .waveform import Waveforms
from .render_jobs import Renderer, RenderJobManager
from .rendering import validate_request as validate_render_request
from .storage import ID_PATTERN, Storage, new_id
from .translation import router as translation_router
from .vst_api import PreprocessingRequest, PreviewManager, router as vst_router, validate_available_chain

DEFAULT_ORIGINS = {
    f"http://{host}:{port}"
    for host in ("127.0.0.1", "localhost", "[::1]")
    for port in (5173, 4173, 8787)
}
Identifier = Annotated[str, ApiPath(pattern=ID_PATTERN)]


class RequestSizeLimit:
    """Bound streaming bodies before Starlette spools multipart uploads to disk."""

    def __init__(self, app, upload_limit: int):
        self.app = app
        self.upload_limit = upload_limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        multipart = scope.get("path") == "/api/media"
        limit = self.upload_limit + 64 * 1024 if multipart else (8 * 1024**2 + 64 * 1024 if scope.get("path") == "/api/renders" else 64 * 1024)
        received = 0
        exceeded = False

        async def bounded_receive():
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    if multipart:
                        # MultiPartException also closes files created by the parser.
                        raise MultiPartException("Upload exceeds the configured size limit.")
                    raise StarletteHTTPException(413, "Request body exceeds the configured size limit.")
            return message

        async def bounded_send(message):
            if exceeded and message["type"] == "http.response.start":
                message["status"] = 413
            await send(message)

        await self.app(scope, bounded_receive, bounded_send)


class TrackSpeaker(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    audioTrack: int = Field(ge=0, le=4096)
    speakerId: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_.-]+$")
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(pattern=r"^#[a-fA-F0-9]{6}$")


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    mediaId: str = Field(pattern=ID_PATTERN)
    mode: Literal["standard", "overlap"] = "standard"
    speakerCount: int = Field(ge=1, le=4)
    audioTrack: int = Field(ge=0, le=4096)
    whisperModel: Literal["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo", "turbo"] = "large-v3"
    language: str = Field(default="auto", pattern=r"^(?:auto|[a-z]{2,3})$")
    device: Literal["cpu", "cuda"] = "cuda"
    diarization: bool = True
    speakerBoundaryMs: int = Field(default=500, ge=0, le=800)
    preprocessing: PreprocessingRequest | None = None
    projectId: str | None = Field(default=None, min_length=1, max_length=128)
    projectName: str = Field(default="", max_length=200)
    trackSpeakers: list[TrackSpeaker] | None = Field(default=None, min_length=1, max_length=8)

    @model_validator(mode="after")
    def unique_tracks(self):
        if self.trackSpeakers:
            if len({item.audioTrack for item in self.trackSpeakers}) != len(self.trackSpeakers):
                raise ValueError("Select each source track only once.")
            identities = {}
            for item in self.trackSpeakers:
                if not item.name.strip():
                    raise ValueError("Choose a speaker name for every track.")
                if item.speakerId in identities and identities[item.speakerId] != (item.name, item.color):
                    raise ValueError("A speaker must have consistent name and color across tracks.")
                identities[item.speakerId] = (item.name, item.color)
        return self

    @field_validator("whisperModel")
    @classmethod
    def canonical_model(cls, value: str) -> str:
        return "large-v3-turbo" if value == "turbo" else value


class KeepRange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    mediaId: str = Field(pattern=ID_PATTERN)
    keepRanges: list[KeepRange] = Field(min_length=1, max_length=200)
    format: Literal["mp4", "wav", "mp3", "m4a"]
    audioTrack: int = Field(ge=0, le=4096)
    projectId: str | None = Field(default=None, min_length=1, max_length=128)
    projectName: str = Field(default="", max_length=200)
    projectSnapshot: dict | None = None
    frameRate: Literal["original", "30", "60"] = "30"

    @field_validator("projectSnapshot")
    @classmethod
    def bounded_snapshot(cls, value):
        if value is not None and (len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")) > 8 * 1024**2
                                  or value.get("schemaVersion") not in {1, 2}
                                  or not isinstance(value.get("captions"), list)
                                  or not isinstance(value.get("notes"), list)):
            raise ValueError("Invalid or oversized project snapshot.")
        return value


def create_app(
    *, data_dir: Path | None = None, analyzer: Analyzer | None = None,
    probe: Callable[[Path], dict[str, Any]] | None = None,
    max_upload_bytes: int | None = None,
    allowed_origins: set[str] | None = None,
    renderer: Renderer | None = None,
) -> FastAPI:
    root = data_dir or Path(os.environ.get("VOICESUBSEP_DATA_DIR", str(Path(__file__).resolve().parents[2] / "data")))
    limit = max_upload_bytes if max_upload_bytes is not None else int(os.environ.get("VOICESUBSEP_MAX_UPLOAD_BYTES", str(8 * 1024**3)))
    if limit <= 0:
        raise ValueError("VOICESUBSEP_MAX_UPLOAD_BYTES must be positive.")
    storage = Storage(root)
    diagnostics = Diagnostics(storage, "0.2.0")
    jobs = JobManager(storage, analyzer, diagnostics=diagnostics)
    renders = RenderJobManager(storage, renderer, diagnostics=diagnostics)
    vst_previews = PreviewManager(storage, diagnostics=diagnostics)
    waveforms = Waveforms(storage)
    cache = MediaCache(storage, lambda: jobs.referenced_media_ids() | renders.referenced_media_ids() | vst_previews.referenced_media_ids() | waveforms.referenced_media_ids())
    inspect_media = probe or probe_media
    origins = set(allowed_origins) if allowed_origins is not None else DEFAULT_ORIGINS

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        jobs.start()
        try:
            renders.start()
            try:
                vst_previews.start()
                yield
            finally:
                await run_in_threadpool(vst_previews.stop)
                await run_in_threadpool(renders.stop)
        finally:
            await run_in_threadpool(jobs.stop)

    application = FastAPI(title="VOICESUBSEP", version="0.2.0", lifespan=lifespan)
    application.state.storage = storage
    application.state.jobs = jobs
    application.state.renders = renders
    application.state.vst_previews = vst_previews
    application.state.diagnostics = diagnostics
    application.state.media_cache = cache
    @application.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        # JSON's non-standard NaN/Infinity inputs must yield 422 rather than
        # crashing JSONResponse while echoing the invalid value back.
        return JSONResponse({"detail": [{key: error[key] for key in ("loc", "msg", "type")}
                                        for error in exc.errors()]}, status_code=422)

    application.add_middleware(RequestSizeLimit, upload_limit=limit)
    application.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"])
    application.add_middleware(CORSMiddleware, allow_origins=sorted(origins),
                               allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "Range"],
                               expose_headers=["Accept-Ranges", "Content-Range", "Content-Length"])

    @application.middleware("http")
    async def local_requests(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin is not None and origin not in origins:
            return JSONResponse({"detail": "Only the local VOICESUBSEP editor may access this API."}, status_code=403)
        if request.headers.get("sec-fetch-site") == "cross-site" and origin not in origins:
            return JSONResponse({"detail": "Cross-site requests are not allowed."}, status_code=403)
        if request.method == "POST" and request.url.path == "/api/media":
            size = request.headers.get("content-length")
            if size is not None:
                try:
                    if int(size) < 0 or int(size) > limit + 64 * 1024:
                        return JSONResponse({"detail": f"Upload exceeds the {limit} byte limit."}, status_code=413)
                except ValueError:
                    return JSONResponse({"detail": "Invalid Content-Length."}, status_code=400)
        try:
            response = await call_next(request)
        except Exception as error:
            route = getattr(request.scope.get("route"), "path", "")
            diagnostics.exception("api", "unexpected_error", error,
                                  method=request.method, route=route)
            response = JSONResponse({"detail": "An unexpected local API error occurred. See the diagnostic log."}, status_code=500)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    @application.get("/api/diagnostics")
    def diagnostic_export():
        return JSONResponse(diagnostics.export(), headers={"Cache-Control": "no-store"})

    @application.get("/api/ready")
    def ready():
        # Process identity/liveness for the desktop launcher. Full dependency
        # inspection may take tens of seconds on the first cold import.
        return {"app": "voicesubsep", "status": "ok"}

    @application.get("/api/cache")
    def cache_usage():
        return {**cache.summary(), "maxUploadBytes": limit}

    @application.delete("/api/media/{media_id}")
    def remove_cached_media(media_id: Identifier):
        try:
            cache.remove(media_id)
            return {"removed": media_id}
        except PermissionError as exc:
            raise HTTPException(409, str(exc)) from exc
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, "Media was not found.")

    @application.get("/api/history")
    def history():
        rows = jobs.history() + renders.history()
        for row in rows:
            try:
                info, _ = storage.get_media(row["mediaId"])
                row["mediaName"] = info["name"]
            except (ValueError, OSError, TypeError):
                row["mediaName"] = ""
        return {"items": sorted(rows, key=lambda row: row["createdAt"], reverse=True)}

    @application.delete("/api/history/{kind}/{job_id}")
    def remove_history(kind: Literal["analysis", "render"], job_id: Identifier):
        manager = jobs if kind == "analysis" else renders
        try:
            with storage.media_lock:
                manager.remove(job_id)
            return {"removed": job_id}
        except KeyError:
            raise HTTPException(404, "Job was not found.")
        except PermissionError as exc:
            raise HTTPException(409, str(exc)) from exc

    @application.get("/api/health")
    def health():
        from .gpu_runtime import probe_gpu

        gpu = probe_gpu()
        detail = None
        try:
            from .inference import capability_report

            report = capability_report()
            engines = report["engines"]
            issues = report["engineIssues"]
        except (ImportError, RuntimeError) as exc:
            engines = {"whisper": False, "nemotron": False}
            detail = str(exc)
            issues = {"whisper": detail, "nemotron": detail}
        result = {"app": "voicesubsep", "status": "ok", "ffmpeg": shutil.which("ffmpeg") is not None,
                  "ffprobe": shutil.which("ffprobe") is not None,
                  "engines": {"whisper": bool(engines.get("whisper")), "nemotron": bool(engines.get("nemotron"))},
                  "engineIssues": issues,
                  "gpu": gpu,
                  "defaults": {"device": "cuda" if gpu["available"] else "cpu", "whisperModel": "large-v3",
                               "computeType": "float16" if gpu["available"] else "int8"}}
        if detail:
            result["detail"] = detail
        return result

    @application.post("/api/media", status_code=201)
    async def upload_media(file: UploadFile = File(...)):
        folder = None
        try:
            name = clean_name(file.filename)
            extension = Path(name).suffix.lower()
            if extension not in MEDIA_EXTENSIONS:
                raise HTTPException(415, "Choose a supported audio or video file.")
            media_id = new_id()
            folder = storage.media_dir(media_id)
            folder.mkdir(parents=True, exist_ok=False)
            stored_name = f"source{extension}"
            path = storage.contained(folder / stored_name)
            total = 0
            digest = hashlib.sha256()
            with path.open("xb") as output:
                while chunk := await file.read(1024 * 1024):
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(413, f"Upload exceeds the {limit} byte limit.")
                    output.write(chunk)
                    digest.update(chunk)
            if total == 0:
                raise HTTPException(422, "The selected media file is empty.")
            info = await run_in_threadpool(inspect_media, path)
            metadata = {"id": media_id, "name": name, **info, "url": f"/api/media/{media_id}/file",
                        "storedName": stored_name, "bytes": total, "sha256": digest.hexdigest()}
            metadata = await run_in_threadpool(cache.commit, folder, metadata)
            folder = None
            return metadata
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except OSError as exc:
            raise HTTPException(507, "The media could not be saved. Check available disk space and data directory permissions.") from exc
        finally:
            await file.close()
            if folder is not None and folder.exists():
                shutil.rmtree(storage.contained(folder))

    @application.get("/api/media/{media_id}/file")
    def media_file(media_id: Identifier):
        try:
            metadata, source = storage.get_media(media_id)
        except (ValueError, FileNotFoundError, OSError):
            raise HTTPException(404, "Media was not found.")
        return FileResponse(source, media_type=mimetypes.guess_type(metadata["name"])[0] or "application/octet-stream",
                            filename=metadata["name"], content_disposition_type="inline", headers={"Cache-Control": "private, no-store"})

    @application.get("/api/media/{media_id}")
    def media_metadata(media_id: Identifier):
        try:
            metadata, _ = storage.get_media(media_id)
            return cache.public(metadata)
        except (ValueError, FileNotFoundError, OSError):
            raise HTTPException(404, "Media was not found.")

    @application.get("/api/media/{media_id}/waveform")
    def media_waveform(media_id: Identifier, audioTrack: int = Query(ge=0, le=4096), points: int = Query(default=2000, ge=128, le=4000)):
        try:
            return waveforms.get(media_id, audioTrack, points)
        except FileNotFoundError:
            raise HTTPException(404, "Media was not found.")
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except OverflowError as exc:
            raise HTTPException(429, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc

    @application.post("/api/jobs", status_code=202)
    def create_job(request: JobRequest):
        with storage.media_lock:
            return submit_job(request)

    def submit_job(request: JobRequest):
        try:
            metadata, _ = storage.get_media(request.mediaId)
        except (ValueError, FileNotFoundError, OSError):
            raise HTTPException(404, "Upload or re-link the source media before analysis.")
        if request.audioTrack not in {track["index"] for track in metadata["audioTracks"]}:
            raise HTTPException(422, "Select an audio track that exists in this recording.")
        if request.trackSpeakers and any(item.audioTrack not in {track["index"] for track in metadata["audioTracks"]} for item in request.trackSpeakers):
            raise HTTPException(422, "Every mapped track must exist in this recording.")
        payload = request.model_dump(exclude_none=True)
        if request.preprocessing is not None:
            try:
                validate_available_chain(payload["preprocessing"]["chain"])
            except (ValueError, OSError, RuntimeError) as exc:
                raise HTTPException(422, str(exc)[:2000]) from exc
        try:
            return {"id": jobs.submit(payload)}
        except OverflowError as exc:
            raise HTTPException(429, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc

    @application.get("/api/jobs/{job_id}")
    def get_job(job_id: Identifier):
        try:
            return jobs.get(job_id)
        except KeyError:
            raise HTTPException(404, "Analysis job was not found.")

    @application.delete("/api/jobs/{job_id}")
    def cancel_job(job_id: Identifier):
        try:
            return jobs.cancel(job_id)
        except KeyError:
            raise HTTPException(404, "Analysis job was not found.")

    @application.post("/api/renders", status_code=202)
    def create_render(request: RenderRequest):
        with storage.media_lock:
            return submit_render(request)

    def submit_render(request: RenderRequest):
        try:
            _, source = storage.get_media(request.mediaId)
        except (ValueError, FileNotFoundError, OSError):
            raise HTTPException(404, "Upload or re-link the source media before export.")
        try:
            payload = request.model_dump()
            # Probe the actual file, including older uploads whose metadata did
            # not include video presence, instead of trusting client durations.
            info = inspect_media(source)
            validate_render_request(info, payload["keepRanges"], request.format, request.audioTrack, request.frameRate)
            return {"id": renders.submit(payload)}
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except OverflowError as exc:
            raise HTTPException(429, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc

    @application.get("/api/renders/{render_id}")
    def get_render(render_id: Identifier):
        try:
            return renders.get(render_id)
        except KeyError:
            raise HTTPException(404, "Export job was not found.")

    @application.get("/api/renders/{render_id}/snapshot")
    def render_snapshot(render_id: Identifier):
        try:
            return {"project": renders.snapshot(render_id)}
        except KeyError:
            raise HTTPException(404, "Export job was not found.")

    @application.delete("/api/renders/{render_id}")
    def cancel_render(render_id: Identifier):
        try:
            return renders.cancel(render_id)
        except KeyError:
            raise HTTPException(404, "Export job was not found.")

    @application.get("/api/renders/{render_id}/file")
    def render_file(render_id: Identifier):
        try:
            path, filename = renders.file(render_id)
        except (KeyError, ValueError, FileNotFoundError, OSError):
            raise HTTPException(404, "A completed export was not found.")
        return FileResponse(path, media_type=mimetypes.guess_type(filename)[0] or "application/octet-stream",
                            filename=filename, headers={"Cache-Control": "private, no-store"})

    application.include_router(translation_router)
    application.include_router(vst_router)
    register_document_routes(application)
    return application


app = create_app()
