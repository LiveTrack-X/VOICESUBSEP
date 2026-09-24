"""Loopback API for local media and real inference jobs.

Launch with: uvicorn voicesubsep.app:app --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

import mimetypes
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Callable, Literal

from fastapi import FastAPI, File, HTTPException, Path as ApiPath, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.formparsers import MultiPartException
from starlette.exceptions import HTTPException as StarletteHTTPException

from .jobs import Analyzer, JobManager
from .media import MEDIA_EXTENSIONS, clean_name, probe_media
from .storage import ID_PATTERN, Storage, new_id

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
        limit = self.upload_limit + 64 * 1024 if multipart else 64 * 1024
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
                    raise StarletteHTTPException(413, "Request body exceeds the 64 KiB limit.")
            return message

        async def bounded_send(message):
            if exceeded and message["type"] == "http.response.start":
                message["status"] = 413
            await send(message)

        await self.app(scope, bounded_receive, bounded_send)


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    mediaId: str = Field(pattern=ID_PATTERN)
    mode: Literal["standard", "overlap"] = "standard"
    speakerCount: int = Field(ge=1, le=4)
    audioTrack: int = Field(ge=0, le=4096)
    whisperModel: Literal["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo", "turbo"] = "large-v3"
    language: str = Field(default="ko", pattern=r"^(?:auto|[a-z]{2,3})$")
    device: Literal["cpu", "cuda"] = "cuda"
    diarization: bool = True

    @field_validator("whisperModel")
    @classmethod
    def canonical_model(cls, value: str) -> str:
        return "large-v3-turbo" if value == "turbo" else value


def create_app(
    *, data_dir: Path | None = None, analyzer: Analyzer | None = None,
    probe: Callable[[Path], dict[str, Any]] | None = None,
    max_upload_bytes: int | None = None,
    allowed_origins: set[str] | None = None,
) -> FastAPI:
    root = data_dir or Path(os.environ.get("VOICESUBSEP_DATA_DIR", str(Path(__file__).resolve().parents[2] / "data")))
    limit = max_upload_bytes if max_upload_bytes is not None else int(os.environ.get("VOICESUBSEP_MAX_UPLOAD_BYTES", str(8 * 1024**3)))
    if limit <= 0:
        raise ValueError("VOICESUBSEP_MAX_UPLOAD_BYTES must be positive.")
    storage = Storage(root)
    jobs = JobManager(storage, analyzer)
    inspect_media = probe or probe_media
    origins = set(allowed_origins) if allowed_origins is not None else DEFAULT_ORIGINS

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        jobs.start()
        try:
            yield
        finally:
            await run_in_threadpool(jobs.stop)

    application = FastAPI(title="VOICESUBSEP", version="0.1.0", lifespan=lifespan)
    application.state.storage = storage
    application.state.jobs = jobs
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
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @application.get("/api/health")
    def health():
        from .gpu_runtime import probe_gpu

        gpu = probe_gpu()
        detail = None
        try:
            from .inference import capabilities

            engines = capabilities()
        except (ImportError, RuntimeError) as exc:
            engines = {"whisper": False, "nemotron": False}
            detail = str(exc)
        result = {"app": "voicesubsep", "status": "ok", "ffmpeg": shutil.which("ffmpeg") is not None,
                  "ffprobe": shutil.which("ffprobe") is not None,
                  "engines": {"whisper": bool(engines.get("whisper")), "nemotron": bool(engines.get("nemotron"))},
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
            with path.open("xb") as output:
                while chunk := await file.read(1024 * 1024):
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(413, f"Upload exceeds the {limit} byte limit.")
                    output.write(chunk)
            if total == 0:
                raise HTTPException(422, "The selected media file is empty.")
            info = await run_in_threadpool(inspect_media, path)
            metadata = {"id": media_id, "name": name, **info, "url": f"/api/media/{media_id}/file"}
            storage.write_json(folder / "metadata.json", {**metadata, "storedName": stored_name, "bytes": total})
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

    @application.post("/api/jobs", status_code=202)
    def create_job(request: JobRequest):
        try:
            metadata, _ = storage.get_media(request.mediaId)
        except (ValueError, FileNotFoundError, OSError):
            raise HTTPException(404, "Upload or re-link the source media before analysis.")
        if request.audioTrack not in {track["index"] for track in metadata["audioTracks"]}:
            raise HTTPException(422, "Select an audio track that exists in this recording.")
        try:
            return {"id": jobs.submit(request.model_dump())}
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

    return application


app = create_app()
