"""Exercise Windows download routing with tiny synthetic files; no downloads."""

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
