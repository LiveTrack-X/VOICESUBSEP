"""Pinned model preparation with tiny fixtures, never real downloads."""
import hashlib
from pathlib import Path
import sys
from types import ModuleType

import pytest

from voicesubsep import overlap_model_cache as cache
from voicesubsep.inference import AnalysisCancelled


@pytest.fixture
def fixture_cache(monkeypatch, tmp_path):
    files = {name: name.encode() for name in cache.FILES}
    monkeypatch.setattr(cache, "FILES", {name: (len(data), hashlib.sha256(data).hexdigest()) for name, data in files.items()})
    directory = tmp_path / "models" / cache.REVISION
    monkeypatch.setattr(cache, "model_directory", lambda: directory)
    cache._verified.clear()
    for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE"):
        monkeypatch.delenv(name, raising=False)
    return directory, files


def populate(directory, files):
    directory.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (directory / name).write_bytes(data)


def test_require_model_never_downloads_and_checks_same_length_corruption(fixture_cache, monkeypatch):
    directory, files = fixture_cache
    monkeypatch.setattr(cache, "_download", lambda *args: pytest.fail("Implicit download"))
    with pytest.raises(RuntimeError, match="준비"):
        cache.require_model()
    populate(directory, files)
    assert cache.require_model() == directory.resolve()
    path = directory / "masknet.ckpt"
    path.write_bytes(b"x" * len(files[path.name]))
    assert cache.invalid_files() == [path.name]


def test_prepare_promotes_only_verified_files_and_keeps_existing_good_files(fixture_cache, monkeypatch):
    directory, files = fixture_cache
    populate(directory, {"encoder.ckpt": files["encoder.ckpt"]})
    original = (directory / "encoder.ckpt").stat()
    calls = []
    def download(name, staging):
        calls.append(name)
        path = staging / name
        path.write_bytes(files[name])
        return path
    monkeypatch.setattr(cache, "_download", download)
    assert cache.prepare_model_files(progress=lambda *_: None, cancelled=lambda: False) == directory.resolve()
    assert calls == ["decoder.ckpt", "masknet.ckpt"]
    assert (directory / "encoder.ckpt").stat() == original
    assert list(directory.parent.glob(".overlap-prepare-*")) == []


def test_bad_hash_is_not_promoted_and_good_cache_survives(fixture_cache, monkeypatch):
    directory, files = fixture_cache
    populate(directory, {"encoder.ckpt": files["encoder.ckpt"]})
    def download(name, staging):
        path = staging / name
        path.write_bytes(b"x" * len(files[name]))
        return path
    monkeypatch.setattr(cache, "_download", download)
    with pytest.raises(RuntimeError, match="무결성"):
        cache.prepare_model_files(progress=lambda *_: None, cancelled=lambda: False)
    assert (directory / "encoder.ckpt").read_bytes() == files["encoder.ckpt"]
    assert not (directory / "decoder.ckpt").exists()
    assert list(directory.parent.glob(".overlap-prepare-*")) == []


def test_cancelled_download_never_promotes_result(fixture_cache, monkeypatch):
    directory, files = fixture_cache
    flag = [False]
    def download(name, staging):
        path = staging / name
        path.write_bytes(files[name])
        flag[0] = True
        return path
    monkeypatch.setattr(cache, "_download", download)
    with pytest.raises(AnalysisCancelled):
        cache.prepare_model_files(progress=lambda *_: None, cancelled=lambda: flag[0])
    assert not any((directory / name).exists() for name in files)
    assert list(directory.parent.glob(".overlap-prepare-*")) == []


def test_offline_prepare_is_readonly(fixture_cache, monkeypatch):
    directory, _ = fixture_cache
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setattr(cache, "_download", lambda *_: pytest.fail("Offline download"))
    with pytest.raises(RuntimeError, match="오프라인"):
        cache.prepare_model_files(progress=lambda *_: None, cancelled=lambda: False)
    assert not directory.exists()


def test_download_uses_only_pinned_revision_ordinary_files_and_no_token(monkeypatch, tmp_path):
    calls = []
    module = ModuleType("huggingface_hub")
    module.hf_hub_download = lambda *args, **kwargs: calls.append((args, kwargs)) or str(tmp_path / "encoder.ckpt")
    monkeypatch.setitem(sys.modules, "huggingface_hub", module)
    assert cache._download("encoder.ckpt", tmp_path) == tmp_path / "encoder.ckpt"
    assert calls == [((cache.MODEL_ID,), {"filename": "encoder.ckpt", "revision": cache.REVISION,
                     "local_dir": str(tmp_path), "token": False})]


def test_prepare_does_not_run_download_for_already_ready_cache(fixture_cache, monkeypatch):
    directory, files = fixture_cache
    populate(directory, files)
    monkeypatch.setattr(cache, "_download", lambda *_: pytest.fail("Already ready"))
    assert cache.prepare_model_files(progress=lambda *_: None, cancelled=lambda: False) == directory.resolve()
