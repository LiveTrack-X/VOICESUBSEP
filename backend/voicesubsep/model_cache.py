"""Resolve local speech models without requiring Windows symlink privileges.

Completed Hugging Face snapshots stay read-only and are reused. New Windows
downloads use the upstream local_dir path, which writes ordinary files instead
of concurrently creating cache snapshot symlinks. No upstream monkeypatch or
machine setting is required.
"""

from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import sys


_MODEL_NAMES = {"tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"}
NEMOTRON_MODEL_ID = "nvidia/Nemotron-3-Diarization"
NEMOTRON_REVISION = "f667ed73aee57d40cc39428eb768b4fd87a0a29e"
NEMOTRON_WEIGHTS_SIZE = 396954592
NEMOTRON_WEIGHTS_SHA256 = "c074d86335b3b794f8fa5edc25594558f128bdb3914d27806a3a5a2e44963cb6"
NEMOTRON_MODEL_FILES = ("config.json", "processor_config.json", "model.safetensors")

# Each process hashes a weights file once, then reuses that result only while
# its size, timestamps and identity are unchanged. Never trust a disk marker.
_verified_nemotron_weights: dict[Path, tuple] = {}


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


def _nemotron_model_root() -> Path:
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "VOICESUBSEP"
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Caches" / "voicesubsep"
    else:
        root = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "voicesubsep"
    return root / "models" / "nemotron"


def _file_signature(path: Path) -> tuple:
    stat = path.stat()
    return (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_dev, stat.st_ino)


def _nemotron_weights_valid(path: Path) -> bool:
    try:
        if path.is_symlink() or not path.is_file():
            return False
        signature = _file_signature(path)
        if signature[0] != NEMOTRON_WEIGHTS_SIZE:
            return False
        key = path.resolve()
        verification = (signature, NEMOTRON_WEIGHTS_SHA256)
        if _verified_nemotron_weights.get(key) == verification:
            return True
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != NEMOTRON_WEIGHTS_SHA256 or _file_signature(path) != signature:
            return False
        if len(_verified_nemotron_weights) >= 8:
            _verified_nemotron_weights.clear()
        _verified_nemotron_weights[key] = verification
        return True
    except OSError:
        return False


def _nemotron_json_valid(path: Path) -> bool:
    try:
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 1024 * 1024:
            return False
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    if not isinstance(data, dict):
        return False
    if path.name == "config.json":
        audio = data.get("audio_config")
        head = data.get("head_config")
        return (
            data.get("model_type") == "nemotron3_diarization"
            and data.get("architectures") == ["Nemotron3DiarizationForAudioFrameClassification"]
            and isinstance(audio, dict) and audio.get("num_mel_bins") == 128
            and isinstance(head, dict) and head.get("num_speakers") == 8
        )
    feature = data.get("feature_extractor")
    return (
        data.get("processor_class") == "Nemotron3DiarizationProcessor"
        and data.get("subsampling_factor") == 8
        and isinstance(feature, dict)
        and feature.get("feature_extractor_type") == "NemotronAsrStreamingFeatureExtractor"
        and all(feature.get(name) == value for name, value in {
            "feature_size": 128, "sampling_rate": 16000, "hop_length": 160,
            "n_fft": 512, "win_length": 400,
        }.items())
    )


def _invalid_nemotron_files(directory: Path) -> list[str]:
    invalid = [name for name in NEMOTRON_MODEL_FILES[:2] if not _nemotron_json_valid(directory / name)]
    if not _nemotron_weights_valid(directory / "model.safetensors"):
        invalid.append("model.safetensors")
    return invalid


def _download_nemotron_files(directory: Path, filenames: list[str], *, force_download: bool) -> None:
    from huggingface_hub import snapshot_download

    snapshot_download(
        NEMOTRON_MODEL_ID, revision=NEMOTRON_REVISION, local_dir=str(directory),
        allow_patterns=filenames, max_workers=1, force_download=force_download,
    )


def resolve_nemotron_model() -> str:
    """Return this pinned model's verified local directory, fetching missing files.

    Local-dir downloads use ordinary files. Incomplete upstream downloads remain
    resumable; corrupted final files are fetched again even if Hub metadata says
    they are current. No existing files are deleted, and offline mode never calls
    the Hub. The caller loads the returned path with local_files_only=True.
    """
    destination = _nemotron_model_root() / NEMOTRON_REVISION
    invalid = _invalid_nemotron_files(destination)
    if not invalid:
        return str(destination.resolve())
    if any(os.environ.get(name, "").strip().upper() in {"1", "ON", "YES", "TRUE"}
           for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")):
        raise RuntimeError(
            f"오프라인 모드에서 완성된 Nemotron 모델을 찾지 못했습니다: {destination}. "
            f"누락·손상 파일: {', '.join(invalid)}. 온라인 상태에서 모델 준비를 완료한 뒤 다시 실행하세요."
        )
    try:
        destination.mkdir(parents=True, exist_ok=True)
        damaged = [name for name in invalid if (destination / name).exists() or (destination / name).is_symlink()]
        missing = [name for name in invalid if name not in damaged]
        if missing:
            _download_nemotron_files(destination, missing, force_download=False)
        if damaged:
            _download_nemotron_files(destination, damaged, force_download=True)
    except Exception as exc:
        raise RuntimeError(
            f"Nemotron 모델을 준비하지 못했습니다: {destination}. "
            "다운로드 연결·디스크 공간·쓰기 권한을 확인한 뒤 다시 시도하세요. 부분 다운로드는 보존됩니다."
        ) from exc
    invalid = _invalid_nemotron_files(destination)
    if invalid:
        raise RuntimeError(
            f"Nemotron 모델 무결성 검증에 실패했습니다: {', '.join(invalid)}. "
            "불완전한 모델은 실행하지 않습니다. 다운로드 연결과 디스크 상태를 확인한 뒤 다시 시도하세요."
        )
    return str(destination.resolve())
