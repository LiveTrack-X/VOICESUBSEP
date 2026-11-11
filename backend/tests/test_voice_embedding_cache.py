"""Pinned acoustic model cache; only tiny synthetic weights, no network."""
import hashlib
import importlib.util
import sys
from types import SimpleNamespace

import pytest


def test_voice_model_cache_is_available():
    assert importlib.util.find_spec("voicesubsep.voice_embedding_cache") is not None


@pytest.fixture
def fixture_cache(monkeypatch, tmp_path):
    from voicesubsep import voice_embedding_cache as cache
    weights = b"known fixture weights"
    monkeypatch.setattr(cache, "_model_root", lambda: tmp_path / "models")
    monkeypatch.setattr(cache, "MODEL_BYTES", len(weights))
    monkeypatch.setattr(cache, "MODEL_SHA256", hashlib.sha256(weights).hexdigest())
    return cache, weights


def test_missing_local_model_never_downloads_or_creates_directories(fixture_cache, monkeypatch):
    cache, _ = fixture_cache
    monkeypatch.setattr(cache, "_download", lambda **_: pytest.fail("No implicit download"))
    with pytest.raises(RuntimeError, match="준비"):
        cache.verified_model_path()
    assert not cache._model_root().exists()


def test_explicit_prepare_uses_exact_pinned_hub_file_without_token(fixture_cache, monkeypatch):
    cache, weights = fixture_cache
    calls = []
    def download(**kwargs):
        calls.append(kwargs)
        (kwargs["destination"] / cache.MODEL_FILENAME).write_bytes(weights)
    monkeypatch.setattr(cache, "_download", download)
    result = cache.prepare_weights(progress=lambda *_: None, cancelled=lambda: False)
    assert result["ready"] is True
    assert calls == [{"destination": cache._model_root() / cache.MODEL_REVISION, "force_download": False}]
    monkeypatch.setattr(cache, "_download", lambda **_: pytest.fail("Complete model downloaded twice"))
    assert cache.verified_model_path().read_bytes() == weights


def test_hub_boundary_pins_revision_filename_and_disables_auth(fixture_cache, monkeypatch, tmp_path):
    cache, _ = fixture_cache
    calls = []
    monkeypatch.setitem(sys.modules, "huggingface_hub", SimpleNamespace(hf_hub_download=lambda **kwargs: calls.append(kwargs)))
    cache._download(destination=tmp_path, force_download=True)
    assert calls == [{"repo_id": cache.MODEL_ID, "filename": cache.MODEL_FILENAME,
                      "revision": cache.MODEL_REVISION, "local_dir": str(tmp_path),
                      "force_download": True, "token": False}]


def test_same_size_model_mutation_cannot_reuse_verification(fixture_cache):
    cache, weights = fixture_cache
    folder = cache._model_root() / cache.MODEL_REVISION
    folder.mkdir(parents=True)
    path = folder / cache.MODEL_FILENAME
    path.write_bytes(weights)
    assert cache.verified_model_path() == path.resolve()
    path.write_bytes(b"x" * len(weights))
    with pytest.raises(RuntimeError, match="준비"):
        cache.verified_model_path()


def test_invalid_completed_download_is_not_ready(fixture_cache, monkeypatch):
    cache, _ = fixture_cache
    monkeypatch.setattr(cache, "_download", lambda **kwargs: (kwargs["destination"] / cache.MODEL_FILENAME).write_bytes(b"bad"))
    with pytest.raises(RuntimeError, match="검증"):
        cache.prepare_weights(progress=lambda *_: None, cancelled=lambda: False)


def test_failed_download_preserves_resume_data(fixture_cache, monkeypatch):
    cache, _ = fixture_cache
    def failed(**kwargs):
        (kwargs["destination"] / "partial.incomplete").write_bytes(b"partial")
        raise OSError("connection")
    monkeypatch.setattr(cache, "_download", failed)
    with pytest.raises(RuntimeError, match="보존"):
        cache.prepare_weights(progress=lambda *_: None, cancelled=lambda: False)
    assert (cache._model_root() / cache.MODEL_REVISION / "partial.incomplete").read_bytes() == b"partial"


def test_cancelled_preparation_does_not_make_directories(fixture_cache):
    cache, _ = fixture_cache
    with pytest.raises(Exception, match="취소"):
        cache.prepare_weights(progress=lambda *_: None, cancelled=lambda: True)
    assert not cache._model_root().exists()


def test_offline_preparation_never_downloads_or_makes_directory(fixture_cache, monkeypatch):
    cache, _ = fixture_cache
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setattr(cache, "_download", lambda **_: pytest.fail("Offline download"))
    with pytest.raises(RuntimeError, match="오프라인"):
        cache.prepare_weights(progress=lambda *_: None, cancelled=lambda: False)
    assert not cache._model_root().exists()
