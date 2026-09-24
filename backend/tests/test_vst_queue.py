"""Deterministic preview queue races; no native plugin is loaded."""
from pathlib import Path
import shutil
import threading
import time
from types import SimpleNamespace

import pytest

from voicesubsep import vst_api, vst_host
from voicesubsep.storage import Storage, new_id


def wait_until(predicate, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.005)
    pytest.fail("Preview worker failed to reach expected state")


@pytest.fixture
def previews(tmp_path, monkeypatch):
    storage = Storage(tmp_path / "data")
    storage.initialize()
    source = tmp_path / "source.wav"
    source.write_bytes(b"original")
    monkeypatch.setattr(storage, "get_media", lambda _: ({"duration": 1.0, "audioTracks": [{"index": 0}]}, source))
    monkeypatch.setattr(vst_api, "_extract_preview", lambda _s, _t, _a, _d, path, _c: path.write_bytes(b"preview"))
    started, release = threading.Event(), threading.Event()
    calls = []

    def process(source_path, destination, chain, cancelled, progress):
        calls.append(destination)
        if len(calls) == 1:
            started.set()
            assert release.wait(5), "Test must release the blocked fake plugin"
        shutil.copyfile(source_path, destination)
        return {"inputFrames": 1, "outputFrames": 1}

    monkeypatch.setattr(vst_host, "process_chain", process)
    manager = vst_api.PreviewManager(storage)
    manager.start()
    state = SimpleNamespace(manager=manager, started=started, release=release, calls=calls,
                            request={"mediaId": new_id(), "audioTrack": 0, "start": 0, "duration": 1, "chain": []})
    try:
        yield state
    finally:
        release.set()
        manager.stop()


def test_cancelled_queue_burst_stays_bounded_and_worker_survives_eviction(previews):
    manager = previews.manager
    first = manager.submit(previews.request)["id"]
    assert previews.started.wait(2)
    cancelled_ids = []
    for _ in range(64):
        identifier = manager.submit(previews.request)["id"]
        cancelled_ids.append(identifier)
        assert manager.cancel(identifier)["status"] == "cancelled"
        assert manager._queue.qsize() <= 1
        assert len(manager._records) <= 16
    assert cancelled_ids[0] not in manager._records
    previews.release.set()
    wait_until(lambda: manager.get(first)["status"] == "completed")
    final = manager.submit(previews.request)["id"]
    wait_until(lambda: manager.get(final)["status"] == "completed")
    assert len(previews.calls) == 2
    assert manager._thread.is_alive()
    manager.stop()
    assert manager._queue.unfinished_tasks == 0


def test_missing_cancelled_record_already_dequeued_is_skipped(previews):
    # Models an entry claimed by the worker just before cancel/eviction removes
    # the record, so pruning the queue can no longer remove that entry.
    manager = previews.manager
    with manager._lock:
        manager._queue.put_nowait((new_id(), Path("unused.wav"), previews.request))
        wait_until(lambda: manager._queue.qsize() == 0)
        identifier = manager.submit(previews.request)["id"]
    assert previews.started.wait(2)
    previews.release.set()
    wait_until(lambda: manager.get(identifier)["status"] == "completed")
    assert manager._thread.is_alive()
    assert len(previews.calls) == 1


def test_two_pending_previews_limit_remains_after_pruning(previews):
    manager = previews.manager
    manager.submit(previews.request)
    assert previews.started.wait(2)
    queued = manager.submit(previews.request)["id"]
    with pytest.raises(OverflowError):
        manager.submit(previews.request)
    manager.cancel(queued)
    replacement = manager.submit(previews.request)
    assert replacement["status"] == "queued"
    assert manager._queue.qsize() <= 1


def test_dead_worker_rejects_new_jobs(previews):
    manager = previews.manager
    real_thread = manager._thread
    manager._thread = SimpleNamespace(is_alive=lambda: False)
    try:
        with pytest.raises(RuntimeError, match="작업기"):
            manager.submit(previews.request)
        assert manager._records == {}
    finally:
        manager._thread = real_thread


def test_cancellation_before_result_publication_wins_and_cleans_audio(previews):
    manager = previews.manager
    identifier = manager.submit(previews.request)["id"]
    assert previews.started.wait(2)
    with manager._lock:
        previews.release.set()
        manager.cancel(identifier)
    wait_until(lambda: manager.get(identifier)["status"] == "cancelled")
    wait_until(lambda: not manager._folder(identifier).exists())
    assert "processedUrl" not in manager.get(identifier)


def test_stop_marks_queued_cancelled_and_eventual_worker_exit_cleans_session(previews):
    manager = previews.manager
    active = manager.submit(previews.request)["id"]
    assert previews.started.wait(2)
    queued = manager.submit(previews.request)["id"]
    real_thread = manager._thread
    # Simulate a native call outlasting stop's join deadline without making the
    # regression test sleep for six seconds.
    manager._thread = SimpleNamespace(join=lambda timeout: None, is_alive=real_thread.is_alive)
    try:
        manager.stop()
        assert manager.get(queued)["status"] == "cancelled"
        assert manager._session_root.exists()
        with pytest.raises(RuntimeError, match="작업기"):
            manager.submit(previews.request)
        previews.release.set()
        real_thread.join(3)
        assert not real_thread.is_alive()
        assert not manager._session_root.exists()
        assert manager.get(active)["status"] == "cancelled"
        assert manager._queue.unfinished_tasks == 0
        manager.stop()  # Idempotent; no extra sentinel or unfinished queue task.
        assert manager._queue.unfinished_tasks == 0
    finally:
        manager._thread = real_thread


def test_worker_cannot_be_started_twice(previews):
    with pytest.raises(RuntimeError, match="already"):
        previews.manager.start()
