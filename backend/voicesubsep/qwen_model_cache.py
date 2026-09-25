"""Pinned native Qwen ASR snapshots in ordinary files, fetched only on request."""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import struct
import sys


@dataclass(frozen=True)
class QwenSnapshot:
    repo: str
    revision: str
    weights_size: int
    architecture: str


# Official HF API metadata, pinned 2026-09-25. Never resolve mutable main at runtime.
QWEN_MODELS = {
    "qwen3-asr-1.7b": QwenSnapshot("Qwen/Qwen3-ASR-1.7B-hf", "bcd2b5b7f32b480ab5790554cfa8347f246a14f3",
                                  4_076_193_080, "Qwen3ASRForConditionalGeneration"),
    "qwen3-asr-0.6b": QwenSnapshot("Qwen/Qwen3-ASR-0.6B-hf", "7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c",
                                  1_564_928_088, "Qwen3ASRForConditionalGeneration"),
}
QWEN_ALIGNER = QwenSnapshot("Qwen/Qwen3-ForcedAligner-0.6B-hf", "c07281df297b9905d24a508279258cccf987a064",
                           1_835_545_960, "Qwen3ASRForTokenClassification")
COMMON_FILES = ("config.json", "processor_config.json", "tokenizer_config.json", "tokenizer.json",
                "chat_template.jinja", "model.safetensors")


def _model_root() -> Path:
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "VOICESUBSEP"
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Caches" / "voicesubsep"
    else:
        root = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "voicesubsep"
    return root / "models" / "qwen"


def _files(snapshot: QwenSnapshot) -> tuple[str, ...]:
    return COMMON_FILES + (("generation_config.json",) if snapshot.architecture.endswith("ConditionalGeneration") else ())


def _json_file(path: Path, limit: int = 1024 * 1024) -> dict | None:
    try:
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
            return None
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, UnicodeError, ValueError):
        return None


def _weights_complete(path: Path, expected_size: int) -> bool:
    """Check pinned length and safetensors table coverage without rereading GBs.

    Hub validates downloads. This is a completeness check, not an independent
    full-file digest audit; a same-length payload bit flip is not detected here.
    """
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size != expected_size:
            return False
        with path.open("rb") as stream:
            header_size = struct.unpack("<Q", stream.read(8))[0]
            if not 2 <= header_size <= min(16 * 1024 * 1024, expected_size - 8):
                return False
            header = json.loads(stream.read(header_size))
        if not isinstance(header, dict):
            return False
        spans = []
        widths = {"F64": 8, "F32": 4, "F16": 2, "BF16": 2, "I64": 8, "I32": 4,
                  "I16": 2, "I8": 1, "U8": 1, "BOOL": 1, "F8_E4M3": 1, "F8_E5M2": 1}
        for name, tensor in header.items():
            if name == "__metadata__":
                continue
            if not isinstance(tensor, dict) or tensor.get("dtype") not in widths:
                return False
            shape, offsets = tensor.get("shape"), tensor.get("data_offsets")
            if not isinstance(shape, list) or not all(type(value) is int and value >= 0 for value in shape):
                return False
            if not isinstance(offsets, list) or len(offsets) != 2 or not all(type(value) is int for value in offsets):
                return False
            length = widths[tensor["dtype"]]
            for value in shape:
                length *= value
            if offsets[0] < 0 or offsets[1] - offsets[0] != length:
                return False
            spans.append(tuple(offsets))
        end = 0
        for start, stop in sorted(spans):
            if start != end:
                return False
            end = stop
        return bool(spans) and end == expected_size - 8 - header_size
    except (OSError, ValueError, TypeError, struct.error, OverflowError):
        return False


def _invalid_files(directory: Path, snapshot: QwenSnapshot) -> list[str]:
    invalid = []
    for name in _files(snapshot):
        path = directory / name
        if name == "model.safetensors":
            valid = _weights_complete(path, snapshot.weights_size)
        elif name == "chat_template.jinja":
            try:
                valid = not path.is_symlink() and path.is_file() and 0 < path.stat().st_size < 1024 * 1024
            except OSError:
                valid = False
        else:
            data = _json_file(path, 64 * 1024 * 1024 if name == "tokenizer.json" else 1024 * 1024)
            valid = data is not None and bool(data)
            if valid and name == "config.json":
                valid = (data.get("model_type") == "qwen3_asr"
                         and data.get("architectures") == [snapshot.architecture]
                         and data.get("timestamp_token_id") == 151705
                         and isinstance(data.get("audio_config"), dict)
                         and data["audio_config"].get("num_mel_bins") == 128
                         and isinstance(data.get("text_config"), dict)
                         and data["text_config"].get("model_type", "qwen3") == "qwen3")
            elif valid and name == "processor_config.json":
                feature = data.get("feature_extractor")
                valid = (data.get("processor_class") == "Qwen3ASRProcessor"
                         and data.get("timestamp_segment_time") == 80
                         and isinstance(feature, dict)
                         and feature.get("feature_extractor_type") == "Qwen3ASRFeatureExtractor"
                         and feature.get("sampling_rate") == 16000 and feature.get("feature_size") == 128)
            elif valid and name == "tokenizer.json":
                valid = isinstance(data.get("model"), dict) and bool(data["model"].get("vocab"))
        if not valid:
            invalid.append(name)
    return invalid


def _download(snapshot: QwenSnapshot, directory: Path, files: list[str], *, force_download: bool):
    from huggingface_hub import snapshot_download

    snapshot_download(snapshot.repo, revision=snapshot.revision, local_dir=str(directory),
                      allow_patterns=files, max_workers=1, force_download=force_download)


def _resolve(snapshot: QwenSnapshot) -> str:
    directory = _model_root() / snapshot.repo.split("/")[1] / snapshot.revision
    invalid = _invalid_files(directory, snapshot)
    if not invalid:
        return str(directory.resolve())
    if any(os.environ.get(name, "").strip().upper() in {"1", "ON", "YES", "TRUE"}
           for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")):
        raise RuntimeError("오프라인 모드에서 완성된 Qwen 모델을 찾지 못했습니다. 온라인에서 모델 준비를 완료하세요.")
    try:
        directory.mkdir(parents=True, exist_ok=True)
        damaged = [name for name in invalid if (directory / name).exists() or (directory / name).is_symlink()]
        missing = [name for name in invalid if name not in damaged]
        if missing:
            _download(snapshot, directory, missing, force_download=False)
        if damaged:
            _download(snapshot, directory, damaged, force_download=True)
    except Exception as exc:
        raise RuntimeError("Qwen 모델을 준비하지 못했습니다. 연결·디스크 공간·쓰기 권한을 확인하세요. 부분 다운로드는 보존됩니다.") from exc
    if _invalid_files(directory, snapshot):
        raise RuntimeError("Qwen 모델 다운로드가 불완전하거나 모델 구성이 다릅니다. 불완전한 모델은 실행하지 않습니다.")
    return str(directory.resolve())


def resolve_qwen_model(name: str) -> str:
    if name not in QWEN_MODELS:
        raise ValueError("지원하지 않는 Qwen 모델입니다.")
    return _resolve(QWEN_MODELS[name])


def resolve_qwen_aligner() -> str:
    return _resolve(QWEN_ALIGNER)
