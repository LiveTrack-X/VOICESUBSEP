import json
from pathlib import Path
import threading

import pytest

from voicesubsep.media_cache import MediaCache
from voicesubsep.storage import Storage, new_id


def entry(storage, data=b"cached-copy"):
    media_id = new_id()
    folder = storage.media / media_id
    folder.mkdir()
    (folder / "source.wav").write_bytes(data)
    storage.write_json(folder / "metadata.json", {"id": media_id, "name": "original.wav", "duration": 1, "storedName": "source.wav"})
    return media_id


def setup(tmp_path, protected=None):
    storage = Storage(tmp_path / "app"); storage.initialize()
    retained = protected if protected is not None else set()
    return storage, MediaCache(storage, lambda: retained)


def test_cleanup_only_reviewed_unused_copies_and_keeps_original_results_models_recordings(tmp_path):
    retained = set(); storage, cache = setup(tmp_path, retained)
    original = tmp_path / "original.wav"; original.write_bytes(b"original")
    for folder in ["jobs", "renders", "models", "recordings"]:
        target = storage.root / folder; target.mkdir(exist_ok=True); (target / "keep").write_text("keep")
    unused = entry(storage, b"12345"); reserved = entry(storage); retained.add(reserved)
    selection = [item["id"] for item in cache.summary()["items"] if not item["protected"]]
    newer = entry(storage)
    assert cache.cleanup(selection) == {"removedCount": 1, "removedBytes": 5, "skippedCount": 0, "failedCount": 0}
    assert original.read_bytes() == b"original"
    assert not (storage.media / unused).exists()
    assert (storage.media / reserved).is_dir() and (storage.media / newer).is_dir()
    assert all((storage.root / folder / "keep").read_text() == "keep" for folder in ["jobs", "renders", "models", "recordings"])


def test_cleanup_rechecks_protection_after_confirmation_and_handles_already_removed_ids(tmp_path):
    retained = set(); storage, cache = setup(tmp_path, retained)
    media_id = entry(storage)
    assert cache.summary()["reclaimableBytes"] > 0
    retained.add(media_id)
    result = cache.cleanup([media_id, media_id, new_id()])
    assert result == {"removedCount": 0, "removedBytes": 0, "skippedCount": 2, "failedCount": 0}
    assert (storage.media / media_id).exists()


@pytest.mark.parametrize("invalid", [[], ["../original.wav"], ["a" * 32, "../../jobs"], [None], "a" * 32, ["a" * 32] * 1001])
def test_cleanup_validates_entire_snapshot_before_any_removal(tmp_path, invalid):
    storage, cache = setup(tmp_path); media_id = entry(storage)
    with pytest.raises(ValueError): cache.cleanup(invalid)
    assert (storage.media / media_id).exists()


def test_cleanup_refuses_redirected_folder_and_metadata_identity(tmp_path, monkeypatch):
    storage, cache = setup(tmp_path); media_id = entry(storage)
    real = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda path: path == storage.media / media_id or real(path))
    assert cache.cleanup([media_id])["skippedCount"] == 1
    monkeypatch.setattr(Path, "is_symlink", real)
    metadata = storage.media / media_id / "metadata.json"
    value = json.loads(metadata.read_text()); value["id"] = new_id(); metadata.write_text(json.dumps(value))
    assert cache.cleanup([media_id])["skippedCount"] == 1
    assert (storage.media / media_id / "source.wav").exists()


def test_cleanup_holds_media_lock_from_reservation_check_through_delete(tmp_path, monkeypatch):
    storage, cache = setup(tmp_path); media_id = entry(storage)
    from voicesubsep import media_cache
    remove = media_cache.shutil.rmtree
    entered, acquired = threading.Event(), threading.Event()
    def reserve():
        assert entered.wait(2)
        with storage.media_lock: acquired.set()
    thread = threading.Thread(target=reserve); thread.start()
    def guarded(path):
        entered.set()
        assert not acquired.wait(.05)
        remove(path)
    monkeypatch.setattr(media_cache.shutil, "rmtree", guarded)
    assert cache.cleanup([media_id])["removedCount"] == 1
    thread.join(2); assert acquired.is_set()


@pytest.mark.parametrize("failure", [OSError, PermissionError])
def test_failed_entry_does_not_prevent_other_selected_copies_cleanup(tmp_path, monkeypatch, failure):
    storage, cache = setup(tmp_path); first = entry(storage); second = entry(storage)
    from voicesubsep import media_cache
    remove = media_cache.shutil.rmtree
    def unavailable(path):
        if path.name == first: raise failure("private path detail")
        remove(path)
    monkeypatch.setattr(media_cache.shutil, "rmtree", unavailable)
    result = cache.cleanup([first, second])
    assert result["removedCount"] == 1 and result["failedCount"] == 1
    assert "private" not in json.dumps(result)
