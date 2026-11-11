"""Pinned, explicit-only WeSpeaker download and verified local reuse.

Official provenance checked 2026-11-11. Weights are CC-BY-4.0, independent of
the toolkit's Apache-2.0 code. No model loader uses remote executable code.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import sys
from typing import Callable

MODEL_ID = "Wespeaker/wespeaker-voxceleb-resnet34-LM"
MODEL_REVISION = "f0c48c298fd835726c27956a5d617bad7115627e"
MODEL_FILENAME = "voxceleb_resnet34_LM.onnx"
MODEL_BYTES = 26_530_309
MODEL_SHA256 = "7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068"
PROVENANCE = {
    "model": MODEL_ID, "revision": MODEL_REVISION, "filename": MODEL_FILENAME,
    "bytes": MODEL_BYTES, "sha256": MODEL_SHA256, "license": "CC-BY-4.0",
    "modelCard": f"https://huggingface.co/{MODEL_ID}/blob/{MODEL_REVISION}/README.md",
    "codeRevision": "9fecd6cb4f47475d01761d87c826298dff4ef18c",
    "codeLicense": "Apache-2.0",
    "codeSource": "https://github.com/wenet-e2e/wespeaker/blob/9fecd6cb4f47475d01761d87c826298dff4ef18c/wespeaker/bin/infer_onnx.py",
}
_verified: dict[Path, tuple] = {}


def _checkpoint(cancelled: Callable[[], bool]) -> None:
    if cancelled():
        from .inference import AnalysisCancelled
        raise AnalysisCancelled("음성 비교 취소 요청을 처리했습니다.")


def _model_root() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "VOICESUBSEP"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Caches" / "voicesubsep"
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "voicesubsep"
    return base / "models" / "voice-embedding"


def _signature(path: Path) -> tuple:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_dev, stat.st_ino


def _valid(path: Path, cancelled: Callable[[], bool]) -> bool:
    _checkpoint(cancelled)
    try:
        if (path.is_symlink() or not path.is_file() or path.parent.is_symlink()
                or getattr(path.parent, "is_junction", lambda: False)()):
            return False
        before = _signature(path)
        if before[0] != MODEL_BYTES:
            return False
        key = path.resolve()
        if _verified.get(key) == (before, MODEL_SHA256):
            return True
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                _checkpoint(cancelled)
                digest.update(block)
        if digest.hexdigest() != MODEL_SHA256 or _signature(path) != before:
            return False
        if len(_verified) >= 8:
            _verified.clear()
        _verified[key] = before, MODEL_SHA256
        return True
    except OSError:
        return False


def verified_model_path(*, cancelled: Callable[[], bool] = lambda: False) -> Path:
    """Local, read-only lookup. Never creates directories or calls the Hub."""
    path = _model_root() / MODEL_REVISION / MODEL_FILENAME
    if not _valid(path, cancelled):
        raise RuntimeError("음성 비교 모델을 먼저 준비하세요. 고정 가중치가 없거나 검증에 실패했습니다.")
    return path.resolve()


def _download(*, destination: Path, force_download: bool) -> None:
    from huggingface_hub import hf_hub_download
    hf_hub_download(repo_id=MODEL_ID, filename=MODEL_FILENAME, revision=MODEL_REVISION,
                    local_dir=str(destination), force_download=force_download, token=False)


def prepare_weights(*, progress: Callable[[str, float], None], cancelled: Callable[[], bool]) -> dict:
    """Only this explicitly requested operation may download the pinned file."""
    _checkpoint(cancelled)
    destination = _model_root() / MODEL_REVISION
    path = destination / MODEL_FILENAME
    if not _valid(path, cancelled):
        if any(os.environ.get(name, "").lower() in {"1", "true", "yes"}
               for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")):
            raise RuntimeError("오프라인 상태에서는 없는 음성 비교 모델을 준비할 수 없습니다.")
        if destination.is_symlink() or getattr(destination, "is_junction", lambda: False)():
            raise RuntimeError("음성 비교 모델 폴더가 올바르지 않습니다.")
        progress("음성 비교 모델 다운로드 · 26.5 MB", .05)
        _checkpoint(cancelled)
        try:
            destination.mkdir(parents=True, exist_ok=True)
            _download(destination=destination, force_download=path.exists())
        except (OSError, ValueError, RuntimeError) as exc:
            _checkpoint(cancelled)
            raise RuntimeError("음성 비교 모델 준비를 완료하지 못했습니다. 부분 다운로드와 기존 캐시는 보존됩니다.") from exc
    _checkpoint(cancelled)
    progress("음성 비교 모델 무결성 검증", .9)
    if not _valid(path, cancelled):
        raise RuntimeError("음성 비교 모델 무결성 검증에 실패했습니다. 모델 준비를 다시 실행하세요.")
    progress("음성 비교 모델 준비 완료", 1.)
    return {"model": MODEL_ID, "revision": MODEL_REVISION, "ready": True,
            "bytes": MODEL_BYTES, "license": "CC-BY-4.0"}
