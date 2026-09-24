"""Inspect CUDA dependencies without importing torch or downloading model weights.

Windows DLL directories and loaded handles live only in this Python process.
No PATH, registry, package installation, or machine configuration is changed.
Availability is a dependency check, not an inference or model quality benchmark.
"""

from __future__ import annotations

import ctypes
import importlib
import os
from pathlib import Path
import sys
import threading
from typing import Any


_WINDOWS_LIBRARIES = (
    "cudart64_12.dll", "nvrtc64_120_0.dll",
    "cublasLt64_12.dll", "cublas64_12.dll",
    "cudnn64_9.dll", "cudnn_ops64_9.dll", "cudnn_cnn64_9.dll",
    "cudnn_adv64_9.dll", "cudnn_graph64_9.dll",
    "cudnn_engines_precompiled64_9.dll", "cudnn_engines_runtime_compiled64_9.dll",
    "cudnn_heuristic64_9.dll",
)
_LINUX_LIBRARIES = ("libcublasLt.so.12", "libcublas.so.12", "libcudnn.so.9")
_DIRECTORY_HANDLES: dict[str, Any] = {}
_LIBRARY_HANDLES: dict[str, Any] = {}
_LOCK = threading.RLock()


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _windows_directories() -> list[Path]:
    root = _project_root()
    sites = [Path(sys.prefix) / "Lib" / "site-packages", root / ".venv" / "Lib" / "site-packages"]
    if getattr(sys, "_MEIPASS", None):
        sites.append(Path(sys._MEIPASS))
    # Nemotron's CUDA PyTorch distribution already includes the CUDA 12/cuDNN
    # libraries used by CTranslate2. Prefer that same set to avoid two runtimes
    # with identical DLL names and several gigabytes of duplicate bundle data.
    shared = [site / "torch" / "lib" for site in sites]
    candidates = [directory for directory in shared
                  if all((directory / name).is_file() for name in _WINDOWS_LIBRARIES)]
    candidates += [site / "nvidia" / library / "bin" for site in sites
                  for library in ("cublas", "cudnn", "cuda_runtime", "cuda_nvrtc")]
    candidates.append(root / "runtime" / "cuda" / "bin")
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).resolve().parent / "runtime" / "cuda" / "bin")
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        entry = entry.strip().strip('"')
        if not entry:
            continue
        directory = Path(entry)
        # Do not add CWD through an empty or relative PATH entry.
        if directory.is_absolute() and any((directory / name).is_file() for name in _WINDOWS_LIBRARIES):
            candidates.append(directory)
    unique = {}
    for directory in candidates:
        if directory.is_dir():
            resolved = directory.resolve()
            unique.setdefault(os.path.normcase(str(resolved)), resolved)
    return list(unique.values())


def _register_windows_directories() -> list[Path]:
    directories = _windows_directories()
    for directory in directories:
        key = os.path.normcase(str(directory))
        if key not in _DIRECTORY_HANDLES:
            # Retain the returned handle: closing/garbage collecting it removes
            # this process-local DLL search directory.
            _DIRECTORY_HANDLES[key] = os.add_dll_directory(str(directory))
    return directories


def _load_runtime_libraries() -> None:
    with _LOCK:
        directories = _register_windows_directories() if sys.platform == "win32" else []
        names = _WINDOWS_LIBRARIES if sys.platform == "win32" else _LINUX_LIBRARIES
        for name in names:
            if name in _LIBRARY_HANDLES:
                continue
            source = next((str(directory / name) for directory in directories if (directory / name).is_file()), name)
            try:
                if sys.platform == "win32":
                    # Absolute library: search its siblings and registered/system
                    # directories. Bare name: system/registered directories only.
                    flags = 0x1100 if Path(source).is_absolute() else 0x1000
                    handle = ctypes.WinDLL(source, winmode=flags)
                else:
                    handle = ctypes.CDLL(source)
            except (OSError, AttributeError) as exc:
                raise RuntimeError(
                    f"CUDA 필수 라이브러리 {name}을 불러오지 못했습니다. "
                    "CUDA 12용 cuBLAS와 cuDNN 9를 준비한 뒤 서버를 다시 시작하세요. "
                    "Windows에서는 .venv의 NVIDIA 패키지 bin, runtime/cuda/bin 또는 기존 PATH를 확인하세요. "
                    "docs/MODEL-SETUP.md를 참고하거나 CPU를 선택하세요."
                ) from exc
            _LIBRARY_HANDLES[name] = handle


def _device_name() -> str | None:
    """Ask the CUDA driver for the first device name; no CUDA context/model."""
    try:
        if sys.platform == "win32":
            driver = ctypes.WinDLL("nvcuda.dll", winmode=0x800)  # System32 only.
        else:
            driver = ctypes.CDLL("libcuda.so.1")
        driver.cuInit.argtypes = [ctypes.c_uint]
        driver.cuInit.restype = ctypes.c_int
        driver.cuDeviceGet.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_int]
        driver.cuDeviceGet.restype = ctypes.c_int
        driver.cuDeviceGetName.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
        driver.cuDeviceGetName.restype = ctypes.c_int
        device = ctypes.c_int()
        name = ctypes.create_string_buffer(256)
        if driver.cuInit(0) or driver.cuDeviceGet(ctypes.byref(device), 0):
            return None
        if driver.cuDeviceGetName(name, len(name), device):
            return None
        return name.value.decode("utf-8", errors="replace") or None
    except (OSError, AttributeError):
        return None


def probe_gpu() -> dict[str, Any]:
    """Return serializable device/runtime evidence, with actionable failures."""
    result = {"available": False, "name": None, "deviceCount": 0, "computeTypes": [], "reason": None}
    try:
        # Register directories before CTranslate2 imports native extensions.
        if sys.platform == "win32":
            with _LOCK:
                _register_windows_directories()
        ct2 = importlib.import_module("ctranslate2")
        result["deviceCount"] = max(0, int(ct2.get_cuda_device_count()))
        if not result["deviceCount"]:
            result["reason"] = "사용 가능한 NVIDIA CUDA 장치가 없습니다. GPU 드라이버를 확인하거나 CPU를 선택하세요."
            return result
        result["name"] = _device_name()
        result["computeTypes"] = sorted(str(value) for value in ct2.get_supported_compute_types("cuda", 0))
        _load_runtime_libraries()
        result["available"] = True
    except (ImportError, AttributeError) as exc:
        result["reason"] = (
            "CTranslate2 CUDA 실행 모듈을 불러올 수 없습니다. 이 서버 가상환경의 faster-whisper 설치를 확인하세요. "
            f"({type(exc).__name__})"
        )
    except (RuntimeError, OSError, ValueError) as exc:
        result["reason"] = str(exc) or "CUDA 실행 환경을 확인하지 못했습니다. CPU를 선택하거나 서버 설정을 확인하세요."
    return result


def ensure_cuda_runtime() -> dict[str, Any]:
    """Fail before a CUDA model download if dependencies/FP16 are unavailable."""
    status = probe_gpu()
    if not status["available"]:
        raise RuntimeError(status["reason"] or "CUDA 실행 환경이 준비되지 않았습니다. CPU를 선택하세요.")
    if "float16" not in status["computeTypes"]:
        raise RuntimeError("이 GPU에서 float16 연산을 지원하지 않습니다. CPU를 선택하세요.")
    return status
