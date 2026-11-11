"""Validated local-only tool requests; candidates never modify a project."""
from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .media_identity import verify_snapshot_media
from .storage import ID_PATTERN
from .vocabulary import validate_vocabulary


class Identity(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    bytes: int = Field(gt=0)


class VoiceRange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def range(self):
        if self.end <= self.start:
            raise ValueError("구간 끝은 시작보다 늦어야 합니다.")
        return self


class VoiceReference(VoiceRange):
    id: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_.-]+$")
    speakerId: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_.-]+$")


class VoiceTarget(VoiceRange):
    captionId: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_.-]+$")


class SpeechToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    kind: Literal["prepare-voice", "prepare-overlap", "voice-preview", "voice-match", "overlap-recovery"]
    mediaId: str | None = Field(default=None, pattern=ID_PATTERN)
    sourceIdentity: Identity | None = None
    audioTrack: int = Field(default=0, ge=0, le=4096)
    references: list[VoiceReference] = Field(default_factory=list, max_length=16)
    targets: list[VoiceTarget] = Field(default_factory=list, max_length=50)
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, gt=0)
    whisperModel: Literal["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"] = "small"
    language: str = Field(default="ko", pattern=r"^(?:auto|[a-z]{2,3})$")
    vocabulary: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("vocabulary")
    @classmethod
    def terms(cls, values):
        return validate_vocabulary(values)

    @model_validator(mode="after")
    def operation(self):
        if self.kind.startswith("prepare-"):
            if self.mediaId is not None or self.sourceIdentity is not None or self.references or self.targets or self.start is not None or self.end is not None:
                raise ValueError("모델 준비에는 원본이나 분석 구간을 보내지 마세요.")
            return self
        if self.mediaId is None or self.sourceIdentity is None:
            raise ValueError("검증된 원본 미디어를 연결하세요.")
        if self.kind == "voice-match":
            if not self.targets or len({r.speakerId for r in self.references}) < 2:
                raise ValueError("비교할 미배정 자막과 두 인물 이상의 확인한 목소리가 필요합니다.")
            if len({r.id for r in self.references}) != len(self.references) or len({t.captionId for t in self.targets}) != len(self.targets):
                raise ValueError("목소리와 자막 ID가 중복되었습니다.")
            if any(not 3 <= r.end - r.start <= 15 for r in self.references) or any(t.end - t.start > 15 for t in self.targets):
                raise ValueError("기준 목소리는 3~15초, 비교 자막은 최대 15초여야 합니다.")
            if self.start is not None or self.end is not None:
                raise ValueError("목소리 비교에는 각 자막의 구간을 사용하세요.")
        elif self.start is None or self.end is None or not (0.25 if self.kind == "voice-preview" else 2) <= self.end - self.start <= 20 or self.references or self.targets:
            raise ValueError("겹침 복원은 2~20초 구간 하나를 선택하세요.")
        return self


def register_speech_tool_routes(app, manager, storage, jobs, live):
    @app.get("/api/speech-tools/status")
    def status():
        from .voice_embedding import model_status as voice_status
        from .overlap_recovery import model_status as overlap_status
        return {"voice": voice_status(), "overlap": overlap_status()}

    @app.post("/api/speech-tools/jobs", status_code=202)
    def create(request: SpeechToolRequest):
        with storage.media_lock:
            try:
                jobs.require_idle()
                if live.busy():
                    raise PermissionError("라이브 세션을 종료한 뒤 음성 도구를 사용하세요.")
                payload = request.model_dump()
                metadata = None
                if request.mediaId:
                    metadata, _ = storage.get_media(request.mediaId)
                    verify_snapshot_media({"mediaIdentity": payload["sourceIdentity"]}, metadata)
                    if request.audioTrack not in {track["index"] for track in metadata["audioTracks"]}:
                        raise ValueError("원본에 존재하는 오디오 트랙을 선택하세요.")
                    ranges = [*request.references, *request.targets]
                    if any(item.end > metadata["duration"] for item in ranges) or (request.end is not None and request.end > metadata["duration"]):
                        raise ValueError("분석 구간이 원본 길이를 벗어납니다.")
                return {"id": manager.submit(payload, metadata)}
            except (FileNotFoundError, KeyError):
                raise HTTPException(404, "원본 미디어를 다시 연결하세요.") from None
            except PermissionError as exc:
                raise HTTPException(409, str(exc)) from None
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
            except OverflowError as exc:
                raise HTTPException(429, str(exc)) from None
            except RuntimeError as exc:
                raise HTTPException(503, str(exc)) from None

    @app.get("/api/speech-tools/jobs/{identity}")
    def get(identity: str):
        try:
            return manager.get(identity)
        except KeyError:
            raise HTTPException(404, "음성 도구 작업이 없습니다. 다시 실행하세요.") from None

    @app.post("/api/speech-tools/jobs/{identity}/cancel")
    def cancel(identity: str):
        try:
            return manager.cancel(identity)
        except KeyError:
            raise HTTPException(404, "음성 도구 작업이 없습니다.") from None

    @app.delete("/api/speech-tools/jobs/{identity}")
    def discard(identity: str):
        try:
            manager.discard(identity)
            return {"deleted": True}
        except KeyError:
            raise HTTPException(404, "음성 도구 작업이 없습니다.") from None
        except PermissionError as exc:
            raise HTTPException(409, str(exc)) from None

    @app.get("/api/speech-tools/jobs/{identity}/audio/{name}")
    def audio(identity: str, name: str):
        try:
            return FileResponse(manager.audio(identity, name), media_type="audio/wav", headers={"Cache-Control": "no-store"})
        except KeyError:
            raise HTTPException(404, "분리 음원이 만료되었습니다. 다시 실행하세요.") from None
