"""Explicit preparation and verified, local-only SepFormer checkpoints.

Manifest: official HF API, 2026-11-11. No YAML or remote Python is executed.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import sys
import tempfile

MODEL_ID = "speechbrain/sepformer-wsj02mix"
REVISION = "3a2826343a10e2d2e8a75f79aeab5ff3a2473531"
FILES = {
    "encoder.ckpt": (17267, "3139bb880b29ea77ae8a168b8f2ad6e8eb5c2c0904289676c223d0e93cd2a35d"),
    "decoder.ckpt": (17202, "abea1a2d41151331b4c36071d1b3205aed940a189721f008b12a703e9c63e7e4"),
    "masknet.ckpt": (113108458, "57dd5f49bf21c5a2101bb4e46648d05d34d517a59e26f0b06646d0bebe8214c7"),
}
_verified: dict[Path, tuple] = {}


def model_directory() -> Path:
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "VOICESUBSEP"
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Caches" / "voicesubsep"
    else:
        root = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "voicesubsep"
    return root / "models" / "overlap" / REVISION


def _signature(path: Path) -> tuple:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_dev, stat.st_ino


def valid_file(path: Path, name: str) -> bool:
    size, expected = FILES[name]
    try:
        if path.is_symlink() or not path.is_file():
            return False
        signature = _signature(path)
        if signature[0] != size:
            return False
        key = path.resolve()
        if _verified.get(key) == (signature, expected):
            return True
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != expected or _signature(path) != signature:
            return False
        if len(_verified) >= 16:
            _verified.clear()
        _verified[key] = signature, expected
        return True
    except OSError:
        return False


def invalid_files() -> list[str]:
    directory = model_directory()
    return [name for name in FILES if not valid_file(directory / name, name)]


def require_model() -> Path:
    invalid = invalid_files()
    if invalid:
        raise RuntimeError("겹침 분리 모델 준비가 필요합니다. 먼저 모델 준비를 실행하세요. 누락·손상 파일: " + ", ".join(invalid))
    return model_directory().resolve()


def _download(name: str, directory: Path) -> Path:
    from huggingface_hub import hf_hub_download
    return Path(hf_hub_download(MODEL_ID, filename=name, revision=REVISION,
                               local_dir=str(directory), token=False))


def prepare_model_files(*, progress, cancelled) -> Path:
    from .inference import _checkpoint

    _checkpoint(cancelled)
    missing = invalid_files()
    if not missing:
        return require_model()
    if any(os.environ.get(name, "").strip().upper() in {"1", "ON", "YES", "TRUE"}
           for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")):
        raise RuntimeError("오프라인 모드입니다. 온라인에서 겹침 분리 모델 준비를 완료하세요.")
    directory = model_directory()
    directory.mkdir(parents=True, exist_ok=True)
    # Download into our staging directory, validate, then promote a complete
    # ordinary file. Existing valid weights survive failures and cancellation.
    with tempfile.TemporaryDirectory(prefix=".overlap-prepare-", dir=directory.parent) as temporary:
        staging = Path(temporary)
        for index, name in enumerate(missing):
            _checkpoint(cancelled)
            progress(f"겹침 분리 모델 다운로드: {name}", index / len(missing))
            downloaded = _download(name, staging)
            _checkpoint(cancelled)
            if downloaded.resolve() != (staging / name).resolve() or not valid_file(downloaded, name):
                raise RuntimeError(f"겹침 분리 모델 무결성 검증에 실패했습니다: {name}")
            os.replace(downloaded, directory / name)
        _checkpoint(cancelled)
    result = require_model()
    progress("겹침 분리 모델 준비 완료", 1.0)
    return result
