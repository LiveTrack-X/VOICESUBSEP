"""Resolve Whisper models without requiring Windows symlink privileges.

Completed Hugging Face snapshots stay read-only and are reused. New Windows
downloads use the upstream local_dir path, which writes ordinary files instead
of concurrently creating cache snapshot symlinks. No upstream monkeypatch or
machine setting is required.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys


_MODEL_NAMES = {"tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"}


def _download_model(name: str, **kwargs) -> str:
    from faster_whisper.utils import download_model

    return download_model(name, **kwargs)


def _local_model_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "VOICESUBSEP" / "models" / "whisper"
    return Path.home() / ".cache" / "voicesubsep" / "models" / "whisper"


def _complete_model(directory: Path, model_name: str) -> bool:
    def present(filename: str) -> bool:
        path = directory / filename
        try:
            return path.is_file() and path.stat().st_size > 0
        except OSError:
            return False

    has_weights = all(present(name) for name in ("model.bin", "config.json", "tokenizer.json")) and any(
        present(name) for name in ("vocabulary.json", "vocabulary.txt")
    )
    if not has_weights:
        return False
    if model_name not in {"large-v3", "large-v3-turbo"}:
        # Older models work with faster-whisper's default 80 mel features even
        # when their upstream snapshot has no preprocessor configuration.
        return True
    try:
        config = json.loads((directory / "preprocessor_config.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    # Without this valid setting faster-whisper falls back to 80 features,
    # while both large-v3 variants require 128. Do not reuse that partial cache.
    return isinstance(config, dict) and type(config.get("feature_size")) is int and config["feature_size"] == 128


def resolve_whisper_model(name: str) -> str:
    """Return a model identifier or complete local path; only inference calls this.

The local-only lookup never repairs/deletes the shared cache. Failed downloads
remain in the application folder so Hugging Face can resume them next time.
"""
    name = "large-v3-turbo" if name == "turbo" else name
    if name not in _MODEL_NAMES:
        raise ValueError("Unsupported Whisper model name.")
    if sys.platform != "win32":
        return name

    destination = _local_model_root() / name
    if _complete_model(destination, name):
        return str(destination.resolve())

    try:
        cached = Path(_download_model(name, local_files_only=True))
    except (OSError, ValueError):
        cached = None
    if cached is not None and _complete_model(cached, name):
        return str(cached.resolve())

    try:
        destination.mkdir(parents=True, exist_ok=True)
        # output_dir maps to HF local_dir. This bypasses _create_symlink even
        # when the first-time symlink-support probe races between worker threads.
        _download_model(name, output_dir=str(destination))
    except OSError as exc:
        raise RuntimeError(
            f"Whisper 모델을 사용자 폴더에 저장하지 못했습니다: {destination}. "
            "디스크 공간·쓰기 권한·다운로드 연결을 확인한 뒤 다시 시도하세요. 기존 모델 캐시는 보존됩니다."
        ) from exc
    if not _complete_model(destination, name):
        raise RuntimeError("Whisper 모델 다운로드가 완료되지 않았습니다. 연결과 디스크 공간을 확인한 뒤 다시 시도하세요.")
    return str(destination.resolve())
