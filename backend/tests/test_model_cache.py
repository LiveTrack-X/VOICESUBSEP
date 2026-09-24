"""Exercise Windows download routing with tiny synthetic files; no downloads."""

import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from voicesubsep import inference as infer
from voicesubsep import model_cache as cache


def complete(directory: Path, *, preprocessor: bool = True) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for name in ("model.bin", "config.json", "tokenizer.json", "vocabulary.json"):
        (directory / name).write_bytes(b"fixture")
    if preprocessor:
        (directory / "preprocessor_config.json").write_text('{"feature_size": 128}', encoding="utf-8")
    return directory


@pytest.fixture
def windows_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(cache.sys, "platform", "win32")
    monkeypatch.setattr(cache, "_local_model_root", lambda: tmp_path / "app-models")
    return tmp_path / "app-models"


def test_complete_application_model_is_reused_without_hub_access(monkeypatch, windows_cache):
    path = complete(windows_cache / "large-v3")
    monkeypatch.setattr(cache, "_download_model", lambda *_args, **_kwargs: pytest.fail("No Hub call needed"))
    assert cache.resolve_whisper_model("large-v3") == str(path.resolve())


def test_complete_shared_snapshot_is_reused_without_copy_or_download(monkeypatch, tmp_path, windows_cache):
    snapshot = complete(tmp_path / "existing-hf" / "snapshot")
    original = {file.name: file.read_bytes() for file in snapshot.iterdir()}
    calls = []

    def download(name, **kwargs):
        calls.append((name, kwargs))
        return str(snapshot)

    monkeypatch.setattr(cache, "_download_model", download)
    assert cache.resolve_whisper_model("large-v3") == str(snapshot.resolve())
    assert calls == [("large-v3", {"local_files_only": True})]
    assert {file.name: file.read_bytes() for file in snapshot.iterdir()} == original
    assert not windows_cache.exists()


@pytest.mark.parametrize("existing_snapshot", [False, True])
def test_missing_or_partial_snapshot_downloads_to_normal_local_files(monkeypatch, tmp_path, windows_cache, existing_snapshot):
    snapshot = tmp_path / "partial-hf"
    snapshot.mkdir()
    (snapshot / "config.json").write_bytes(b"preserve cached metadata")
    calls = []

    def download(name, **kwargs):
        calls.append((name, kwargs))
        if kwargs.get("local_files_only"):
            if existing_snapshot:
                return str(snapshot)
            raise FileNotFoundError("not cached")
        assert "output_dir" in kwargs, "Never download through the shared symlink snapshot route"
        return str(complete(Path(kwargs["output_dir"])))

    monkeypatch.setattr(cache, "_download_model", download)
    path = cache.resolve_whisper_model("large-v3")
    assert path == str((windows_cache / "large-v3").resolve())
    assert calls[1] == ("large-v3", {"output_dir": str(windows_cache / "large-v3")})
    assert (snapshot / "config.json").read_bytes() == b"preserve cached metadata"


def test_failed_download_preserves_partial_files_for_upstream_resume(monkeypatch, windows_cache):
    def download(name, **kwargs):
        if kwargs.get("local_files_only"):
            raise FileNotFoundError()
        destination = Path(kwargs["output_dir"])
        (destination / "model.incomplete").write_bytes(b"partial download")
        raise OSError("connection interrupted")

    monkeypatch.setattr(cache, "_download_model", download)
    with pytest.raises(RuntimeError, match="기존 모델 캐시는 보존"):
        cache.resolve_whisper_model("large-v3")
    assert (windows_cache / "large-v3" / "model.incomplete").read_bytes() == b"partial download"


def test_download_must_finish_required_files_before_loading_model(monkeypatch, windows_cache):
    monkeypatch.setattr(cache, "_download_model", lambda *_, **__: str(windows_cache / "large-v3"))
    with pytest.raises(RuntimeError, match="완료되지"):
        cache.resolve_whisper_model("large-v3")


def test_empty_model_file_is_not_ready(tmp_path):
    path = complete(tmp_path / "model")
    (path / "model.bin").write_bytes(b"")
    assert cache._complete_model(path, "large-v3") is False


@pytest.mark.parametrize("model_name", ["large-v3", "large-v3-turbo"])
@pytest.mark.parametrize("location", ["application", "shared"])
@pytest.mark.parametrize("preprocessor", [None, b"{", b"[]", b"{}", b'{"feature_size": 80}',
                                        b'{"feature_size": "128"}', b"\xff"])
def test_large_model_invalid_preprocessor_is_not_reused(
    monkeypatch, tmp_path, windows_cache, model_name, location, preprocessor
):
    destination = windows_cache / model_name
    snapshot = tmp_path / "shared-snapshot"
    existing = complete(destination if location == "application" else snapshot, preprocessor=False)
    if preprocessor is not None:
        (existing / "preprocessor_config.json").write_bytes(preprocessor)
    original = {file.name: file.read_bytes() for file in existing.iterdir()}
    calls = []

    def download(name, **kwargs):
        calls.append((name, kwargs))
        if kwargs.get("local_files_only"):
            if location == "shared":
                return str(snapshot)
            raise FileNotFoundError("No complete shared snapshot")
        assert kwargs == {"output_dir": str(destination)}
        return str(complete(destination))

    monkeypatch.setattr(cache, "_download_model", download)
    assert cache.resolve_whisper_model(model_name) == str(destination.resolve())
    assert calls == [(model_name, {"local_files_only": True}),
                     (model_name, {"output_dir": str(destination)})]
    assert cache._complete_model(destination, model_name)
    if location == "shared":
        assert {file.name: file.read_bytes() for file in snapshot.iterdir()} == original


@pytest.mark.parametrize("model_name", ["large-v3", "large-v3-turbo"])
def test_large_model_download_without_preprocessor_cannot_reach_inference(monkeypatch, windows_cache, model_name):
    def download(name, **kwargs):
        if kwargs.get("local_files_only"):
            raise FileNotFoundError("Not cached")
        return str(complete(Path(kwargs["output_dir"]), preprocessor=False))

    monkeypatch.setattr(cache, "_download_model", download)
    with pytest.raises(RuntimeError, match="다운로드가 완료되지"):
        cache.resolve_whisper_model(model_name)


@pytest.mark.parametrize("model_name", ["tiny", "base", "small", "medium"])
def test_80_mel_models_keep_upstream_default_without_preprocessor(monkeypatch, windows_cache, model_name):
    destination = complete(windows_cache / model_name, preprocessor=False)
    monkeypatch.setattr(cache, "_download_model", lambda *_args, **_kwargs: pytest.fail("No Hub call needed"))
    assert cache.resolve_whisper_model(model_name) == str(destination.resolve())


def test_turbo_alias_uses_one_canonical_cache(monkeypatch, windows_cache):
    path = complete(windows_cache / "large-v3-turbo")
    assert cache.resolve_whisper_model("turbo") == str(path.resolve())


def test_unix_keeps_upstream_model_resolution(monkeypatch):
    monkeypatch.setattr(cache.sys, "platform", "linux")
    monkeypatch.setattr(cache, "_download_model", lambda *_args, **_kwargs: pytest.fail("Do not download here"))
    assert cache.resolve_whisper_model("large-v3") == "large-v3"


@pytest.mark.parametrize("name", ["../private", "C:/private", "some/repository"])
def test_model_name_cannot_redirect_download_directory(name, windows_cache):
    with pytest.raises(ValueError, match="Unsupported"):
        cache.resolve_whisper_model(name)
    assert not windows_cache.exists()


def test_upstream_output_dir_maps_to_local_dir_without_any_network(monkeypatch, tmp_path):
    utils = pytest.importorskip("faster_whisper.utils")
    calls = []

    def snapshot(repo_id, **kwargs):
        calls.append((repo_id, kwargs))
        return kwargs["local_dir"]

    monkeypatch.setattr(utils.huggingface_hub, "snapshot_download", snapshot)
    assert cache._download_model("large-v3", output_dir=str(tmp_path)) == str(tmp_path)
    assert calls[0][0] == "Systran/faster-whisper-large-v3"
    assert calls[0][1]["local_dir"] == str(tmp_path)
    assert calls[0][1]["local_dir_use_symlinks"] is False


def test_inference_passes_resolved_directory_to_whisper(monkeypatch, tmp_path):
    path = complete(tmp_path / "model")
    seen = []

    class Model:
        def __init__(self, model_path, **kwargs):
            seen.append((model_path, kwargs))
            self.model = SimpleNamespace(unload_model=lambda: None)

        def transcribe(self, *args, **kwargs):
            return iter([]), None

    monkeypatch.setattr(infer, "_whisper_class", lambda: Model)
    monkeypatch.setattr(infer, "resolve_whisper_model", lambda name: str(path))
    infer._transcribe(tmp_path / "unused.wav", model_name="large-v3", language="ko", device="cpu", duration=1,
                      progress=lambda *_: None, cancelled=lambda: False)
    assert seen == [(str(path), {"device": "cpu", "compute_type": "int8"})]


NEMOTRON_FIXTURE = b"Synthetic model weights for cache routing tests only."


def nemotron_files() -> dict[str, bytes]:
    return {
        "config.json": json.dumps({
            "model_type": "nemotron3_diarization",
            "architectures": ["Nemotron3DiarizationForAudioFrameClassification"],
            "audio_config": {"num_mel_bins": 128}, "head_config": {"num_speakers": 8},
        }).encode(),
        "processor_config.json": json.dumps({
            "processor_class": "Nemotron3DiarizationProcessor", "subsampling_factor": 8,
            "feature_extractor": {
                "feature_extractor_type": "NemotronAsrStreamingFeatureExtractor",
                "feature_size": 128, "sampling_rate": 16000, "hop_length": 160,
                "n_fft": 512, "win_length": 400,
            },
        }).encode(),
        "model.safetensors": NEMOTRON_FIXTURE,
    }


def complete_nemotron(directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in nemotron_files().items():
        (directory / name).write_bytes(content)
    return directory


@pytest.fixture
def nemotron_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(cache, "_nemotron_model_root", lambda: tmp_path / "nemotron")
    monkeypatch.setattr(cache, "NEMOTRON_WEIGHTS_SIZE", len(NEMOTRON_FIXTURE))
    monkeypatch.setattr(cache, "NEMOTRON_WEIGHTS_SHA256", hashlib.sha256(NEMOTRON_FIXTURE).hexdigest())
    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)
    monkeypatch.delenv("TRANSFORMERS_OFFLINE", raising=False)
    cache._verified_nemotron_weights.clear()
    yield tmp_path / "nemotron" / cache.NEMOTRON_REVISION
    cache._verified_nemotron_weights.clear()


def test_nemotron_pins_official_model_identity():
    assert cache.NEMOTRON_MODEL_ID == "nvidia/Nemotron-3-Diarization"
    assert cache.NEMOTRON_REVISION == "f667ed73aee57d40cc39428eb768b4fd87a0a29e"
    assert cache.NEMOTRON_WEIGHTS_SIZE == 396954592
    assert cache.NEMOTRON_WEIGHTS_SHA256 == "c074d86335b3b794f8fa5edc25594558f128bdb3914d27806a3a5a2e44963cb6"


def test_nemotron_cached_weights_are_hashed_once_per_unchanged_file(monkeypatch, nemotron_cache):
    complete_nemotron(nemotron_cache)
    monkeypatch.setattr(cache, "_download_nemotron_files", lambda *_, **__: pytest.fail("No Hub access"))
    original = cache.hashlib.sha256
    calls = []

    def digest(*args, **kwargs):
        calls.append(True)
        return original(*args, **kwargs)

    monkeypatch.setattr(cache.hashlib, "sha256", digest)
    assert cache.resolve_nemotron_model() == str(nemotron_cache.resolve())
    assert cache.resolve_nemotron_model() == str(nemotron_cache.resolve())
    assert calls == [True]
    assert not (nemotron_cache / "preprocessor_config.json").exists(), "The real processor embeds its feature extractor"


@pytest.mark.parametrize("offline_env,value", [("HF_HUB_OFFLINE", "1"), ("TRANSFORMERS_OFFLINE", "true"),
                                              ("HF_HUB_OFFLINE", "YES"), ("TRANSFORMERS_OFFLINE", "ON")])
def test_nemotron_complete_cache_works_offline(monkeypatch, nemotron_cache, offline_env, value):
    complete_nemotron(nemotron_cache)
    monkeypatch.setenv(offline_env, value)
    monkeypatch.setattr(cache, "_download_nemotron_files", lambda *_, **__: pytest.fail("No Hub access"))
    assert cache.resolve_nemotron_model() == str(nemotron_cache.resolve())


@pytest.mark.parametrize("offline_env", ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE"])
def test_nemotron_missing_cache_offline_does_not_create_or_download(monkeypatch, nemotron_cache, offline_env):
    monkeypatch.setenv(offline_env, "1")
    monkeypatch.setattr(cache, "_download_nemotron_files", lambda *_, **__: pytest.fail("Offline means no Hub access"))
    with pytest.raises(RuntimeError, match="오프라인.*완성된 Nemotron"):
        cache.resolve_nemotron_model()
    assert not nemotron_cache.exists()


def test_nemotron_offline_detects_rewritten_same_size_weights_after_verified_reuse(monkeypatch, nemotron_cache):
    complete_nemotron(nemotron_cache)
    assert cache.resolve_nemotron_model() == str(nemotron_cache.resolve())
    weights = nemotron_cache / "model.safetensors"
    before = weights.stat()
    weights.write_bytes(b"x" * len(NEMOTRON_FIXTURE))
    os.utime(weights, ns=(before.st_atime_ns, before.st_mtime_ns + 2_000_000_000))
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setattr(cache, "_download_nemotron_files", lambda *_, **__: pytest.fail("No Hub access"))
    with pytest.raises(RuntimeError, match="model.safetensors"):
        cache.resolve_nemotron_model()


def test_nemotron_download_uses_pinned_local_dir_single_worker_and_required_files(monkeypatch, nemotron_cache):
    calls = []

    def snapshot(repo_id, **kwargs):
        calls.append((repo_id, kwargs))
        complete_nemotron(Path(kwargs["local_dir"]))
        return kwargs["local_dir"]

    monkeypatch.setitem(cache.sys.modules, "huggingface_hub", SimpleNamespace(snapshot_download=snapshot))
    assert cache.resolve_nemotron_model() == str(nemotron_cache.resolve())
    assert calls == [(cache.NEMOTRON_MODEL_ID, {
        "revision": cache.NEMOTRON_REVISION, "local_dir": str(nemotron_cache),
        "allow_patterns": list(cache.NEMOTRON_MODEL_FILES), "max_workers": 1, "force_download": False,
    })]
    assert all(not path.is_symlink() for path in nemotron_cache.iterdir())


@pytest.mark.parametrize("filename,damaged", [
    ("model.safetensors", b"partial"),
    ("model.safetensors", b"x" * len(NEMOTRON_FIXTURE)),
    ("config.json", b"{"), ("config.json", b"[]"), ("config.json", b"{}"),
    ("processor_config.json", b""), ("processor_config.json", b"\xff"),
    ("processor_config.json", b'{"processor_class":"Nemotron3DiarizationProcessor"}'),
])
def test_nemotron_repairs_only_damaged_final_file(monkeypatch, nemotron_cache, filename, damaged):
    complete_nemotron(nemotron_cache)
    (nemotron_cache / filename).write_bytes(damaged)
    calls = []

    def download(directory, filenames, *, force_download):
        calls.append((filenames, force_download))
        for name in filenames:
            (directory / name).write_bytes(nemotron_files()[name])

    monkeypatch.setattr(cache, "_download_nemotron_files", download)
    assert cache.resolve_nemotron_model() == str(nemotron_cache.resolve())
    assert calls == [([filename], True)], "Valid weights must not be downloaded again for a broken small config"


@pytest.mark.parametrize("filename,field,value", [("config.json", "num_mel_bins", 80),
                                                 ("processor_config.json", "sampling_rate", 8000)])
def test_nemotron_rejects_valid_json_with_wrong_model_geometry(monkeypatch, nemotron_cache, filename, field, value):
    complete_nemotron(nemotron_cache)
    data = json.loads((nemotron_cache / filename).read_bytes())
    data["audio_config" if filename == "config.json" else "feature_extractor"][field] = value
    (nemotron_cache / filename).write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    with pytest.raises(RuntimeError, match=filename):
        cache.resolve_nemotron_model()


def test_nemotron_failed_download_keeps_upstream_partial_for_resume(monkeypatch, nemotron_cache):
    complete_nemotron(nemotron_cache)
    (nemotron_cache / "model.safetensors").unlink()
    partial = nemotron_cache / ".cache" / "huggingface" / "download" / "weights.incomplete"
    partial.parent.mkdir(parents=True)
    partial.write_bytes(b"partial transfer")

    def download(directory, filenames, *, force_download):
        assert directory == nemotron_cache
        assert filenames == ["model.safetensors"] and force_download is False
        assert partial.read_bytes() == b"partial transfer"
        raise OSError("connection interrupted")

    monkeypatch.setattr(cache, "_download_nemotron_files", download)
    with pytest.raises(RuntimeError, match="부분 다운로드는 보존"):
        cache.resolve_nemotron_model()
    assert partial.read_bytes() == b"partial transfer"


def test_nemotron_download_success_without_verified_weights_is_rejected(monkeypatch, nemotron_cache):
    def download(directory, *_args, **_kwargs):
        complete_nemotron(directory)
        (directory / "model.safetensors").write_bytes(b"x" * len(NEMOTRON_FIXTURE))

    monkeypatch.setattr(cache, "_download_nemotron_files", download)
    with pytest.raises(RuntimeError, match="무결성.*model.safetensors"):
        cache.resolve_nemotron_model()


@pytest.mark.parametrize("platform", ["win32", "linux", "darwin"])
def test_nemotron_cache_root_matches_platform(monkeypatch, tmp_path, platform):
    monkeypatch.setattr(cache.sys, "platform", platform)
    monkeypatch.setattr(cache.Path, "home", lambda: tmp_path / "home")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "xdg"))
    expected = {
        "win32": tmp_path / "local" / "VOICESUBSEP",
        "linux": tmp_path / "xdg" / "voicesubsep",
        "darwin": tmp_path / "home" / "Library" / "Caches" / "voicesubsep",
    }[platform]
    assert cache._nemotron_model_root() == expected / "models" / "nemotron"
