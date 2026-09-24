"""CUDA discovery and execution guards, without a GPU/model/download requirement."""

import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from voicesubsep import gpu_runtime as gpu
from voicesubsep import inference as infer


def mock_device(monkeypatch, *, count=1, compute_types=None):
    imports = []
    ct2 = SimpleNamespace(
        get_cuda_device_count=lambda: count,
        get_supported_compute_types=lambda *args: compute_types or {"float16", "int8_float16", "float32"},
    )

    def load(name):
        imports.append(name)
        assert name == "ctranslate2", "GPU probing must not import a model or torch"
        return ct2

    monkeypatch.setattr(gpu.importlib, "import_module", load)
    monkeypatch.setattr(gpu, "_register_windows_directories", lambda: [])
    monkeypatch.setattr(gpu, "_device_name", lambda: "NVIDIA test GPU")
    monkeypatch.setattr(gpu, "_load_runtime_libraries", lambda: None)
    return imports


def test_device_and_runtime_produce_download_free_readiness(monkeypatch):
    imports = mock_device(monkeypatch)
    status = gpu.probe_gpu()
    assert status == {"available": True, "name": "NVIDIA test GPU", "deviceCount": 1,
                      "computeTypes": ["float16", "float32", "int8_float16"], "reason": None}
    assert imports == ["ctranslate2"]


def test_no_device_skips_loading_cuda_libraries(monkeypatch):
    mock_device(monkeypatch, count=0)
    monkeypatch.setattr(gpu, "_load_runtime_libraries", lambda: pytest.fail("No device should not load CUDA libraries"))
    status = gpu.probe_gpu()
    assert status["available"] is False and status["deviceCount"] == 0
    assert status["computeTypes"] == [] and status["name"] is None
    assert "CPU" in status["reason"]


def test_missing_runtime_keeps_device_evidence_and_explains_failure(monkeypatch):
    mock_device(monkeypatch)
    monkeypatch.setattr(gpu, "_load_runtime_libraries", lambda: (_ for _ in ()).throw(RuntimeError("cudnn64_9.dll missing")))
    status = gpu.probe_gpu()
    assert status["available"] is False and status["deviceCount"] == 1
    assert status["name"] == "NVIDIA test GPU"
    assert "cudnn64_9.dll" in status["reason"]


def test_ctranslate2_absent_is_actionable(monkeypatch):
    mock_device(monkeypatch)
    monkeypatch.setattr(gpu.importlib, "import_module", lambda _: (_ for _ in ()).throw(ImportError("absent")))
    status = gpu.probe_gpu()
    assert status["available"] is False
    assert "faster-whisper" in status["reason"]


def test_driver_query_error_does_not_break_health(monkeypatch):
    mock_device(monkeypatch)
    ct2 = SimpleNamespace(get_cuda_device_count=lambda: (_ for _ in ()).throw(RuntimeError("driver not ready")))
    monkeypatch.setattr(gpu.importlib, "import_module", lambda _: ct2)
    assert gpu.probe_gpu()["reason"] == "driver not ready"


def test_windows_search_is_bounded_includes_frozen_packages_and_never_changes_path(monkeypatch, tmp_path):
    root = tmp_path / "project"
    prefix = root / ".venv"
    frozen = tmp_path / "bundle"
    site = prefix / "Lib" / "site-packages"
    expected = [site / "nvidia" / name / "bin" for name in ("cublas", "cudnn", "cuda_runtime", "cuda_nvrtc")]
    expected.extend([root / "runtime" / "cuda" / "bin", frozen / "nvidia" / "cudnn" / "bin"])
    explicit_path = tmp_path / "system-cuda"
    expected.append(explicit_path)
    for directory in expected:
        directory.mkdir(parents=True)
    (explicit_path / "cublas64_12.dll").touch()
    unrelated = root / "untrusted"
    unrelated.mkdir()
    (unrelated / "cublas64_12.dll").touch()
    value = os.pathsep.join([str(explicit_path), ".", "relative", "", str(tmp_path / "empty")])
    monkeypatch.setenv("PATH", value)
    monkeypatch.setattr(gpu, "_project_root", lambda: root)
    monkeypatch.setattr(gpu.sys, "prefix", str(prefix))
    monkeypatch.setattr(gpu.sys, "_MEIPASS", str(frozen), raising=False)
    assert set(gpu._windows_directories()) == {directory.resolve() for directory in expected}
    assert os.environ["PATH"] == value


def test_windows_directory_handles_stay_alive_and_are_registered_once(monkeypatch, tmp_path):
    retained = []
    monkeypatch.setattr(gpu, "_DIRECTORY_HANDLES", {})
    monkeypatch.setattr(gpu, "_windows_directories", lambda: [tmp_path])

    def register(directory):
        handle = object()
        retained.append(handle)
        return handle

    monkeypatch.setattr(gpu.os, "add_dll_directory", register, raising=False)
    gpu._register_windows_directories()
    gpu._register_windows_directories()
    assert list(gpu._DIRECTORY_HANDLES.values()) == retained
    assert len(retained) == 1


def test_windows_loader_uses_absolute_file_and_keeps_library_handle(monkeypatch, tmp_path):
    library = tmp_path / "cublas64_12.dll"
    library.touch()
    loads = []
    monkeypatch.setattr(gpu.sys, "platform", "win32")
    monkeypatch.setattr(gpu, "_WINDOWS_LIBRARIES", (library.name,))
    monkeypatch.setattr(gpu, "_LIBRARY_HANDLES", {})
    monkeypatch.setattr(gpu, "_register_windows_directories", lambda: [tmp_path])
    monkeypatch.setattr(gpu.ctypes, "WinDLL", lambda source, **kwargs: loads.append((source, kwargs)) or object(), raising=False)
    gpu._load_runtime_libraries()
    gpu._load_runtime_libraries()
    assert loads == [(str(library), {"winmode": 0x1100})]
    assert len(gpu._LIBRARY_HANDLES) == 1


def test_windows_library_error_identifies_missing_component(monkeypatch):
    monkeypatch.setattr(gpu.sys, "platform", "win32")
    monkeypatch.setattr(gpu, "_WINDOWS_LIBRARIES", ("cudnn64_9.dll",))
    monkeypatch.setattr(gpu, "_LIBRARY_HANDLES", {})
    monkeypatch.setattr(gpu, "_register_windows_directories", lambda: [])
    monkeypatch.setattr(gpu.ctypes, "WinDLL", lambda *_, **__: (_ for _ in ()).throw(OSError("cannot load")), raising=False)
    with pytest.raises(RuntimeError, match="cudnn64_9.dll"):
        gpu._load_runtime_libraries()


@pytest.mark.parametrize("status,match", [
    ({"available": False, "reason": "GPU runtime missing"}, "GPU runtime missing"),
    ({"available": True, "computeTypes": ["float32"]}, "float16"),
])
def test_cuda_guard_fails_before_loading_model(monkeypatch, tmp_path, status, match):
    monkeypatch.setattr(gpu, "probe_gpu", lambda: status)
    monkeypatch.setattr(infer, "_whisper_class", lambda: pytest.fail("Must fail before loading a model class"))
    with pytest.raises(RuntimeError, match=match):
        infer._transcribe(tmp_path / "unused.wav", model_name="large-v3", language="ko", device="cuda",
                          duration=1, progress=lambda *_: None, cancelled=lambda: False)


@pytest.mark.parametrize("device,compute_type", [("cpu", "int8"), ("cuda", "float16")])
def test_transcription_preserves_compute_type_and_canonical_turbo(monkeypatch, tmp_path, device, compute_type):
    monkeypatch.setattr(infer, "resolve_whisper_model", lambda name: name)
    events = []

    class Model:
        def __init__(self, name, **options):
            events.append((name, options))
            self.model = SimpleNamespace(unload_model=lambda: None)

        def transcribe(self, *args, **kwargs):
            return iter([]), None

    monkeypatch.setattr(infer, "_whisper_class", lambda: Model)
    monkeypatch.setattr(gpu, "ensure_cuda_runtime", lambda: events.append("cuda-ready"))
    infer._transcribe(tmp_path / "unused.wav", model_name="turbo", language="ko", device=device,
                      duration=1, progress=lambda *_: None, cancelled=lambda: False)
    assert events == (["cuda-ready"] if device == "cuda" else []) + [
        ("large-v3-turbo", {"device": device, "compute_type": compute_type})]
