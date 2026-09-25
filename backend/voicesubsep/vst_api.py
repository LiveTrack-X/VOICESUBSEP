"""Local-only VST discovery and bounded, cancellable A/B audio previews.

Listing candidates never loads their code. Loading and rendering are delegated
to the separate VST worker only after an explicit inspect or process request.
"""

from __future__ import annotations

import copy
import importlib.metadata
import math
import os
from pathlib import Path
import queue
import shutil
import threading
from typing import Annotated, Any, Literal
import wave

from fastapi import APIRouter, HTTPException, Path as ApiPath, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .storage import ID_PATTERN, Storage, new_id, valid_id
from .diagnostics import Diagnostics
from .vst_state import MAX_STATE_BASE64, decode_plugin_state

router = APIRouter(prefix="/api/vst", tags=["VST3"])
Identifier = Annotated[str, ApiPath(pattern=ID_PATTERN)]


class VstSlot(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    path: str = Field(min_length=1, max_length=2048)
    pluginName: str | None = Field(default=None, min_length=1, max_length=512)
    enabled: bool = True
    parameters: dict[str, float | bool | str] = Field(default_factory=dict, max_length=256)
    state: str | None = Field(default=None, max_length=MAX_STATE_BASE64)

    @field_validator("state")
    @classmethod
    def bounded_state(cls, value):
        decode_plugin_state(value)
        return value

    @field_validator("parameters")
    @classmethod
    def bounded_parameters(cls, values):
        for key, value in values.items():
            if not key or len(key) > 256 or key.startswith("_") or any(ord(c) < 32 for c in key):
                raise ValueError("Invalid VST parameter name.")
            if isinstance(value, str) and (len(value) > 1024 or any(ord(c) < 32 for c in value)):
                raise ValueError("Invalid VST parameter value.")
        return values


class NoiseReductionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    engine: Literal["rnnoise"]
    mix: float = Field(default=1, ge=0, le=1)


class PreprocessingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    chain: list[VstSlot] = Field(max_length=4)
    applyTo: Literal["asr", "both"] = "asr"
    noiseReduction: NoiseReductionRequest | None = None

    @model_validator(mode="after")
    def require_processing(self):
        if not self.chain and self.noiseReduction is None:
            raise ValueError("Select RNNoise or at least one VST effect.")
        return self


class InspectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str = Field(min_length=1, max_length=2048)
    pluginName: str | None = Field(default=None, min_length=1, max_length=512)


class CloseEditorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    mediaId: str = Field(pattern=ID_PATTERN)
    audioTrack: int = Field(ge=0, le=4096)
    start: float = Field(default=0, ge=0)
    duration: float = Field(default=30, gt=0, le=30)
    chain: list[VstSlot] = Field(max_length=4)
    noiseReduction: NoiseReductionRequest | None = None

    @model_validator(mode="after")
    def require_processing(self):
        if not self.chain and self.noiseReduction is None:
            raise ValueError("Select RNNoise or at least one VST effect.")
        return self


def runtime_status() -> dict:
    from .vst_host import runtime_available

    try:
        available = runtime_available()
        version = importlib.metadata.version("pedalboard") if available else None
    except (ImportError, ValueError, importlib.metadata.PackageNotFoundError):
        available, version = False, None
    if available and version != "0.9.25":
        return {"available": False, "version": version,
                "issue": "이 VST 호스트에는 Pedalboard 0.9.25가 필요합니다. docs/VST-CHAIN.md를 확인하세요."}
    return {"available": available, "version": version,
            "issue": None if available else "VST3 실행환경이 없습니다. docs/VST-CHAIN.md의 설치 절차를 확인하세요."}


def plugin_roots() -> list[Path]:
    roots = [Path(os.environ.get("COMMONPROGRAMFILES", r"C:\Program Files\Common Files")) / "VST3"]
    if os.environ.get("LOCALAPPDATA"):
        roots.append(Path(os.environ["LOCALAPPDATA"]) / "Programs/Common/VST3")
    return list(dict.fromkeys(roots))


def discover_plugins(roots: list[Path] | None = None) -> dict:
    """Bounded filesystem enumeration; prune bundles and never follow links."""
    roots = plugin_roots() if roots is None else roots
    plugins, visited = [], 0
    for root in roots:
        if not root.is_dir() or root.is_symlink():
            continue
        for folder, directories, filenames in os.walk(root, followlinks=False):
            visited += 1
            if visited > 2048 or len(plugins) >= 512:
                break
            parent = Path(folder)
            retained = []
            for name in directories:
                candidate = parent / name
                if candidate.is_symlink() or getattr(candidate, "is_junction", lambda: False)():
                    continue
                if name.lower().endswith(".vst3"):
                    plugins.append({"path": str(candidate.resolve()), "name": candidate.stem})
                else:
                    retained.append(name)
            directories[:] = retained if len(plugins) < 512 else []
            for name in filenames:
                candidate = parent / name
                if name.lower().endswith(".vst3") and not candidate.is_symlink():
                    plugins.append({"path": str(candidate.resolve()), "name": candidate.stem})
            if len(plugins) >= 512:
                break
    unique = {entry["path"].casefold(): entry for entry in plugins}
    return {"roots": [str(p) for p in roots],
            "plugins": sorted(unique.values(), key=lambda p: (p["name"].casefold(), p["path"]))[:512]}


def validate_available_chain(chain: list[dict]) -> None:
    from .vst_host import validate_chain

    validate_chain(chain)
    if any(slot.get("enabled", True) for slot in chain) and not runtime_status()["available"]:
        raise ValueError(runtime_status()["issue"])


def noise_reduction_status() -> dict:
    try:
        from .noise_reduction import noise_reduction_status as get_status
    except ImportError:
        return {"available": False, "engine": "rnnoise", "issue": "RNNoise is not included in this runtime."}
    return get_status()


def validate_available_preprocessing(settings: dict) -> None:
    validate_available_chain(settings["chain"])
    if settings.get("noiseReduction") is not None:
        from .noise_reduction import validate_noise_reduction
        validate_noise_reduction(settings["noiseReduction"])
        status = noise_reduction_status()
        if not status["available"]:
            raise ValueError(status.get("issue") or "RNNoise is unavailable in this runtime.")


def _extract_preview(source: Path, track: int, start: float, duration: float,
                     destination: Path, cancelled) -> None:
    from .inference import _run

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg가 필요합니다.")
    # Trim by samples after the same zero-based timestamp reconstruction as
    # inference, retaining delayed tracks and source gaps. Pad a shorter audio
    # track through a video tail without changing the requested source clock.
    start_frame, frames = round(start * 48000), round(duration * 48000)
    if frames < 1:
        raise ValueError("미리듣기 구간이 너무 짧습니다.")
    filters = (f"aresample=48000:async=1:first_pts=0,"
               f"atrim=start_sample={start_frame}:end_sample={start_frame + frames},"
               f"asetpts=PTS-STARTPTS,apad=whole_len={frames},atrim=end_sample={frames}")
    _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2",
          "-copyts", "-start_at_zero", "-protocol_whitelist", "file,pipe", "-i", str(source),
          "-map", f"0:{track}", "-vn", "-sn", "-dn", "-filter_threads", "1",
          "-af", filters, "-ac", "2", "-ar", "48000", "-t", f"{frames / 48000:.9f}",
          "-c:a", "pcm_s16le", str(destination)], cancelled)
    with wave.open(str(destination), "rb") as audio:
        if audio.getnframes() != frames or audio.getframerate() != 48000 or audio.getnchannels() != 2:
            raise RuntimeError("미리듣기 음원의 샘플 수가 원본 구간과 일치하지 않습니다.")


class PreviewManager:
    """At most two pending jobs and sixteen retained previews per session."""

    def __init__(self, storage: Storage, *, diagnostics: Diagnostics | None = None):
        self.storage = storage
        self.diagnostics = diagnostics
        self._records: dict[str, dict] = {}
        self._events: dict[str, threading.Event] = {}
        self._queue: queue.Queue = queue.Queue(maxsize=2)
        self._lock = threading.RLock()
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None
        self._session_root = storage.contained(storage.root / "vst-previews" / new_id())

    def start(self):
        with self._lock:
            if self._thread is not None or self._stopping.is_set():
                raise RuntimeError("The VST preview worker was already started or stopped.")
            self._thread = threading.Thread(target=self._work, name="vst-preview", daemon=True)
            self._thread.start()

    def stop(self):
        with self._lock:
            if not self._stopping.is_set():
                self._stopping.set()
                for identifier, event in self._events.items():
                    event.set()
                    if self._records[identifier]["status"] == "queued":
                        self._records[identifier]["status"] = "cancelled"
                self._prune_queue_locked()
                self._queue.put_nowait(None)
        if self._thread:
            self._thread.join(timeout=6)
            if not self._thread.is_alive():
                self._cleanup_session()

    def _cleanup_session(self):
        # Resolve again before deleting only this manager's random session tree.
        shutil.rmtree(self.storage.contained(self._session_root), ignore_errors=True)

    def _prune_queue_locked(self):
        """Drop cancelled queue entries instead of accumulating tombstones.

        A worker may already hold a dequeued entry while waiting for our lock;
        it must independently re-check its record/event before starting it.
        Every drained entry is acknowledged exactly once, including retained
        entries, which receive a fresh queue task when placed back below.
        """
        retained = []
        while True:
            try:
                item = self._queue.get_nowait()
            except queue.Empty:
                break
            try:
                if item is None:
                    retained.append(item)
                else:
                    identifier = item[0]
                    record, event = self._records.get(identifier), self._events.get(identifier)
                    if record is not None and event is not None and record["status"] == "queued" and not event.is_set():
                        retained.append(item)
            finally:
                self._queue.task_done()
        for item in retained:
            self._queue.put_nowait(item)

    def _folder(self, identifier):
        if not valid_id(identifier):
            raise ValueError("Invalid preview identifier.")
        return self.storage.contained(self._session_root / identifier)

    def referenced_media_ids(self) -> set[str]:
        with self._lock:
            return {r.get("mediaId") for r in self._records.values()} - {None}

    def submit(self, request: dict) -> dict:
        with self.storage.media_lock:
            return self._submit_locked(request)

    def _submit_locked(self, request: dict) -> dict:
        metadata, source = self.storage.get_media(request["mediaId"])
        duration = metadata["duration"]
        if request["start"] >= duration:
            raise ValueError("미리듣기 시작 시간이 미디어 길이를 벗어납니다.")
        if not any(t["index"] == request["audioTrack"] for t in metadata["audioTracks"]):
            raise ValueError("선택한 오디오 트랙이 없습니다.")
        request = {**request, "duration": min(request["duration"], duration - request["start"])}
        if round(request["duration"] * 48000) < 1:
            raise ValueError("미리듣기 구간이 너무 짧습니다.")
        with self._lock:
            if self._stopping.is_set() or self._thread is None or not self._thread.is_alive():
                raise RuntimeError("미리듣기 작업기를 사용할 수 없습니다.")
            self._prune_queue_locked()
            if sum(record["status"] in {"queued", "running"} for record in self._records.values()) >= 2:
                raise OverflowError("진행 중인 VST 미리듣기를 마친 뒤 다시 시도하세요.")
            if len(self._records) >= 16:
                oldest = next((key for key, record in self._records.items()
                               if record["status"] in {"completed", "failed", "cancelled"}), None)
                if oldest:
                    # Only our per-session owned, contained temporary folder.
                    shutil.rmtree(self._folder(oldest), ignore_errors=True)
                    del self._records[oldest]
                    del self._events[oldest]
            identifier = new_id()
            self._records[identifier] = {"id": identifier, "mediaId": request["mediaId"], "status": "queued", "progress": 0}
            self._events[identifier] = threading.Event()
            self._queue.put_nowait((identifier, source, copy.deepcopy(request)))
            return self.get(identifier)

    def get(self, identifier):
        with self._lock:
            if identifier not in self._records:
                raise KeyError(identifier)
            return copy.deepcopy(self._records[identifier])

    def cancel(self, identifier):
        with self._lock:
            record = self.get(identifier)
            if record["status"] in {"queued", "running"}:
                self._events[identifier].set()
                if record["status"] == "queued":
                    self._records[identifier]["status"] = "cancelled"
                    self._prune_queue_locked()
            return self.get(identifier)

    def _update(self, identifier, **fields):
        with self._lock:
            self._records[identifier].update(fields)

    def _work(self):
        try:
            from .vst_host import VSTCancelled
            from .audio_preprocessing import process_preprocessing

            while True:
                item = self._queue.get()
                try:
                    if item is None:
                        return
                    identifier, source, request = item
                    with self._lock:
                        record, event = self._records.get(identifier), self._events.get(identifier)
                        if (record is None or event is None or event.is_set()
                                or record["status"] != "queued"):
                            continue
                        self._update(identifier, status="running", progress=0.02)
                    folder = self._folder(identifier)
                    try:
                        folder.mkdir(parents=True, exist_ok=False)
                        _extract_preview(source, request["audioTrack"], request["start"],
                                         request["duration"], folder / "original.wav", event.is_set)

                        def report(_stage, value):
                            with self._lock:
                                if not event.is_set() and math.isfinite(value):
                                    self._update(identifier, progress=0.1 + 0.85 * min(1, max(0, value)))

                        result = process_preprocessing(folder / "original.wav", folder / "processed.wav",
                            request["chain"], event.is_set, report, request.get("noiseReduction"))
                        with self._lock:
                            if event.is_set():
                                raise VSTCancelled("미리듣기를 취소했습니다.")
                            self._update(identifier, status="completed", progress=1,
                                         originalUrl=f"/api/vst/previews/{identifier}/original",
                                         processedUrl=f"/api/vst/previews/{identifier}/processed",
                                         report=result, start=request["start"], duration=request["duration"])
                    except Exception as error:
                        if isinstance(error, VSTCancelled) or type(error).__name__ == "AnalysisCancelled":
                            self._update(identifier, status="cancelled")
                        else:
                            if self.diagnostics:
                                self.diagnostics.exception("vst", "preview_failed", error, previewId=identifier)
                            self._update(identifier, status="failed", error=(str(error) or type(error).__name__)[:2000])
                        shutil.rmtree(folder, ignore_errors=True)
                finally:
                    self._queue.task_done()
        finally:
            # If a slow native worker outlives stop()'s join timeout, its eventual
            # exit still removes this session's preview files.
            if self._stopping.is_set():
                self._cleanup_session()

    def file(self, identifier, kind):
        if self.get(identifier)["status"] != "completed":
            raise ValueError("미리듣기가 아직 준비되지 않았습니다.")
        return self.storage.contained(self._folder(identifier) / f"{kind}.wav")


@router.get("/status")
def status():
    return {**runtime_status(), "noiseReduction": noise_reduction_status()}


@router.post("/editors", status_code=202)
def create_editor(body: VstSlot, request: Request):
    runtime = runtime_status()
    if not runtime["available"]:
        raise HTTPException(503, runtime["issue"])
    try:
        return request.app.state.vst_editors.submit(body.model_dump(exclude_none=True))
    except OverflowError as error:
        raise HTTPException(409, str(error)) from error
    except (ValueError, OSError, RuntimeError) as error:
        raise HTTPException(400, str(error)) from error


@router.get("/editors/{identifier}")
def get_editor(identifier: Identifier, request: Request):
    try:
        return request.app.state.vst_editors.get(identifier)
    except KeyError as error:
        raise HTTPException(404, "This VST editor is missing or expired.") from error


@router.post("/editors/{identifier}/close")
def close_editor(identifier: Identifier, body: CloseEditorRequest, request: Request):
    try:
        return request.app.state.vst_editors.close(identifier)
    except KeyError as error:
        raise HTTPException(404, "This VST editor is missing or expired.") from error


@router.post("/editors/{identifier}/focus")
def focus_editor(identifier: Identifier, body: CloseEditorRequest, request: Request):
    try:
        return request.app.state.vst_editors.focus(identifier)
    except KeyError as error:
        raise HTTPException(404, "This VST editor is missing or expired.") from error


@router.delete("/editors/{identifier}")
def cancel_editor(identifier: Identifier, request: Request):
    try:
        return request.app.state.vst_editors.cancel(identifier)
    except KeyError as error:
        raise HTTPException(404, "This VST editor is missing or expired.") from error


@router.get("/plugins")
def plugins():
    return discover_plugins()


@router.post("/inspect")
def inspect(body: InspectRequest, request: Request):
    from .vst_host import inspect_plugin

    runtime = runtime_status()
    if not runtime["available"]:
        request.app.state.diagnostics.record("vst", "inspect_unavailable", runtime["issue"] or "VST runtime unavailable", level="warning")
        raise HTTPException(503, runtime["issue"])
    try:
        return inspect_plugin(body.path, body.pluginName)
    except (ValueError, OSError, RuntimeError) as error:
        request.app.state.diagnostics.exception("vst", "inspect_failed", error)
        raise HTTPException(400, str(error)[:2000]) from error


@router.post("/previews", status_code=202)
def create_preview(body: PreviewRequest, request: Request):
    try:
        values = body.model_dump(exclude_none=True)
        validate_available_preprocessing(values)
        return request.app.state.vst_previews.submit(values)
    except (FileNotFoundError, KeyError) as error:
        raise HTTPException(404, "원본 미디어를 다시 연결하세요.") from error
    except OverflowError as error:
        raise HTTPException(429, str(error)) from error
    except (ValueError, RuntimeError) as error:
        raise HTTPException(400, str(error)) from error


@router.get("/previews/{identifier}")
def get_preview(identifier: Identifier, request: Request):
    try:
        return request.app.state.vst_previews.get(identifier)
    except KeyError as error:
        raise HTTPException(404, "이 미리듣기가 없거나 만료되었습니다.") from error


@router.delete("/previews/{identifier}")
def cancel_preview(identifier: Identifier, request: Request):
    try:
        return request.app.state.vst_previews.cancel(identifier)
    except KeyError as error:
        raise HTTPException(404, "이 미리듣기가 없거나 만료되었습니다.") from error


@router.get("/previews/{identifier}/{kind}")
def preview_file(identifier: Identifier, kind: Literal["original", "processed"], request: Request):
    try:
        source = request.app.state.vst_previews.file(identifier, kind)
    except KeyError as error:
        raise HTTPException(404, "이 미리듣기가 없거나 만료되었습니다.") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return FileResponse(source, media_type="audio/wav", headers={"Cache-Control": "no-store"})
