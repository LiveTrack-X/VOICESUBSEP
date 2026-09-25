"""Progressive ASR previews with fake streams; no GPU, model or media download."""

from __future__ import annotations

import copy
from datetime import datetime
from pathlib import Path
import threading
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest

from voicesubsep import inference as infer
from voicesubsep import jobs
from voicesubsep.app import create_app
from voicesubsep.jobs import JobManager
from voicesubsep.recognition_preview import preview_line, preview_options
from voicesubsep.storage import Storage, new_id


def request(**changes):
    return {"mediaId": new_id(), "audioTrack": 0, "mode": "standard", "speakerCount": 1,
            "whisperModel": "tiny", "language": "auto", "device": "cpu", "diarization": False,
            **changes}


def result():
    return {"captions": [], "speakers": [], "duration": 10, "warnings": []}


def selection(track):
    return {"audioTrack": track, "speakerId": f"person-{track}", "name": f"Person {track}", "color": "#2563eb"}


def segment(text, start=0):
    return SimpleNamespace(start=start, end=start + 1, text=text, words=[])


def fake_whisper(monkeypatch, stream):
    class Model:
        def __init__(self, *args, **kwargs):
            pass

        def transcribe(self, *args, **kwargs):
            return stream(), None

    monkeypatch.setattr(infer, "_whisper_class", lambda: Model)
    monkeypatch.setattr(infer, "resolve_whisper_model", lambda _: "no-download-fixture")
    monkeypatch.setattr(infer, "_release_memory", lambda: None)


def prepared_manager(tmp_path, monkeypatch, analyzer, **changes):
    storage = Storage(tmp_path / "data")
    storage.initialize()
    source = tmp_path / "fixture.wav"
    source.write_bytes(b"not decoded by mocked ASR")
    monkeypatch.setattr(storage, "get_media", lambda _: ({}, source))
    manager = JobManager(storage, analyzer)
    identifier = new_id()
    manager._jobs[identifier] = {"id": identifier, "status": "queued", "stage": "queued", "progress": 0,
                                 "createdAt": jobs.timestamp(), "request": request(**changes)}
    manager._cancellations[identifier] = threading.Event()
    return manager, identifier


def test_whisper_emits_preview_before_generator_is_consumed_and_preserves_final_records(monkeypatch, tmp_path):
    previews, progress = [], []

    def stream():
        yield segment(" first")
        assert previews == [" first"]  # Called before requesting the next native segment.
        yield segment(" second", 1)
        assert previews == [" first", " second"]

    fake_whisper(monkeypatch, stream)
    records = infer._transcribe(tmp_path / "unused.wav", model_name="tiny", language="auto", device="cpu",
        duration=10, progress=lambda stage, fraction: progress.append((stage, fraction)),
        cancelled=lambda: False, recognition_preview=previews.append)
    assert [item["text"] for item in records] == previews
    assert [item["start"] for item in records] == [0, 1]
    assert progress[-1][0] == "대사 전사"


def test_whisper_preview_is_optional_for_existing_two_argument_progress(monkeypatch, tmp_path):
    fake_whisper(monkeypatch, lambda: iter([segment("legacy")]))
    observed = []
    assert infer._transcribe(tmp_path / "unused.wav", model_name="tiny", language="ko", device="cpu",
        duration=10, progress=lambda stage, fraction: observed.append(stage), cancelled=lambda: False)[0]["text"] == "legacy"
    assert "대사 전사" in observed


@pytest.mark.parametrize("multitrack", [False, True])
def test_api_exposes_last_two_segments_while_real_analysis_pipeline_is_still_running(tmp_path, monkeypatch, multitrack):
    entered, release = threading.Event(), threading.Event()
    track_streams = []

    def stream():
        track_streams.append(len(track_streams))
        yield segment("oldest")
        yield segment("  안녕\n\tworld\x00\u202e  ", 1)
        yield segment("가" * 700, 2)
        entered.set()
        assert release.wait(5)
        yield segment("last", 3)

    fake_whisper(monkeypatch, stream)
    monkeypatch.setattr(infer, "_extract_audio", lambda *args: (10.0, 1))
    app = create_app(data_dir=tmp_path / "data", probe=lambda _: {
        "duration": 10.0, "audioTracks": [{"index": index, "label": f"Track {index}", "channels": 1} for index in (0, 1)]})
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        try:
            media = client.post("/api/media", files={"file": ("fixture.wav", b"fixture", "audio/wav")}).json()
            parameters = request(mediaId=media["id"])
            if multitrack:
                parameters["trackSpeakers"] = [selection(0), selection(1)]
            identifier = client.post("/api/jobs", json=parameters).json()["id"]
            assert entered.wait(3)
            current = client.get(f"/api/jobs/{identifier}").json()
            assert current["status"] == "running"
            assert "result" not in current and "request" not in current
            assert current["recognitionPreview"]["lines"] == ["안녕 world", "가" * 500]
            assert datetime.fromisoformat(current["createdAt"]).tzinfo is not None
            assert datetime.fromisoformat(current["updatedAt"]).tzinfo is not None
            assert datetime.fromisoformat(current["recognitionPreview"]["updatedAt"]).tzinfo is not None
            if multitrack:
                assert current["stage"].startswith("Track 1/2")
            # A queued, distinct analysis never inherits another job's preview.
            second = client.post("/api/jobs", json=parameters).json()["id"]
            assert "recognitionPreview" not in client.get(f"/api/jobs/{second}").json()
            assert client.delete(f"/api/jobs/{second}").json()["status"] == "cancelled"
            release.set()
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                done = client.get(f"/api/jobs/{identifier}").json()
                if done["status"] != "running":
                    break
                time.sleep(.01)
            assert done["status"] == "completed", done
            assert len(track_streams) == (2 if multitrack else 1)
            # The preview limit must not truncate the actual result.
            assert any("가" * 700 == caption["text"] for caption in done["result"]["captions"])
            assert done["recognitionPreview"]["lines"] == ["가" * 500, "last"]
        finally:
            release.set()


def test_preview_updates_are_in_memory_and_progress_writes_are_throttled(tmp_path, monkeypatch):
    clock, writes, observed = [10.0], [], []
    monkeypatch.setattr(jobs, "time", SimpleNamespace(monotonic=lambda: clock[0]))

    def analyzer(_path, *, progress, recognition_preview, **kwargs):
        for index in range(200):
            recognition_preview(f"line {index}")
            progress("ASR", index / 1000)
        observed.append(manager.get(identifier))
        clock[0] += 1.1
        recognition_preview("after interval")
        progress("ASR", .8)
        observed.append(manager.storage.read_json(manager.storage.job_path(identifier)))
        recognition_preview("last unsaved segment")
        progress("ASR", .9)
        return result()

    manager, identifier = prepared_manager(tmp_path, monkeypatch, analyzer)
    original_write = manager.storage.write_json

    def write(path, value):
        writes.append(copy.deepcopy(value))
        original_write(path, value)

    monkeypatch.setattr(manager.storage, "write_json", write)
    manager._run(identifier)
    assert len(writes) == 4  # Running, stage change, one-second checkpoint, terminal.
    assert observed[0]["recognitionPreview"]["lines"] == ["line 198", "line 199"]
    assert observed[1]["recognitionPreview"]["lines"] == ["line 199", "after interval"]
    persisted = manager.storage.read_json(manager.storage.job_path(identifier))
    assert persisted["recognitionPreview"]["lines"] == ["after interval", "last unsaved segment"]
    assert persisted["status"] == "completed"
    # API snapshots are detached and cannot mutate the next poll's preview.
    public = manager.get(identifier)
    public["recognitionPreview"]["lines"].clear()
    assert len(manager.get(identifier)["recognitionPreview"]["lines"]) == 2


@pytest.mark.parametrize("multitrack", [False, True])
def test_strict_legacy_analyzer_is_not_given_new_keyword_or_retried(tmp_path, monkeypatch, multitrack):
    calls = []

    def analyzer(path, *, audio_track, mode, speaker_count, whisper_model, language, device,
                 speaker_boundary_ms, diarization, progress, cancelled):
        calls.append(audio_track)
        progress("legacy", .5)
        return result()

    changes = {"trackSpeakers": [selection(0), selection(1)]} if multitrack else {}
    manager, identifier = prepared_manager(tmp_path, monkeypatch, analyzer, **changes)
    manager._run(identifier)
    assert manager.get(identifier)["status"] == "completed"
    assert "recognitionPreview" not in manager.get(identifier)
    assert calls == ([0, 1] if multitrack else [0])


def test_compatibility_does_not_retry_inference_after_internal_type_error(tmp_path, monkeypatch):
    calls = []

    def analyzer(_path, **kwargs):
        calls.append(kwargs)
        raise TypeError("Engine internal error")

    manager, identifier = prepared_manager(tmp_path, monkeypatch, analyzer)
    manager._run(identifier)
    assert manager.get(identifier)["status"] == "failed"
    assert len(calls) == 1


def test_cancelled_and_empty_segments_do_not_replace_preview(tmp_path, monkeypatch):
    def analyzer(_path, *, recognition_preview, progress, **kwargs):
        recognition_preview("before cancellation")
        before = manager.get(identifier)["recognitionPreview"]
        recognition_preview("\x00\u202e\n  ")
        assert manager.get(identifier)["recognitionPreview"] == before
        manager._cancellations[identifier].set()
        recognition_preview("after cancellation")
        progress("ignored", .9)
        raise infer.AnalysisCancelled()

    manager, identifier = prepared_manager(tmp_path, monkeypatch, analyzer)
    manager._run(identifier)
    done = manager.get(identifier)
    assert done["status"] == "cancelled" and "result" not in done
    assert done["recognitionPreview"]["lines"] == ["before cancellation"]


def test_old_jobs_without_preview_and_new_previews_survive_restart(tmp_path, monkeypatch):
    def analyzer(_path, *, recognition_preview, **kwargs):
        recognition_preview("saved recognition")
        return result()

    manager, identifier = prepared_manager(tmp_path, monkeypatch, analyzer)
    manager._run(identifier)
    old_id = new_id()
    manager.storage.write_json(manager.storage.job_path(old_id), {
        "id": old_id, "status": "completed", "stage": "completed", "progress": 1, "result": result()})
    restored = JobManager(manager.storage, analyzer)
    restored.start()
    try:
        assert restored.get(identifier)["recognitionPreview"]["lines"] == ["saved recognition"]
        assert "recognitionPreview" not in restored.get(old_id)
        assert "createdAt" not in restored.get(old_id)
    finally:
        restored.stop()


@pytest.mark.parametrize("value,expected", [
    (None, ""), (42, ""), ("\n\x00\u202e\ud800", ""),
    ("  Hello\tworld\r\n다음  ", "Hello world 다음"),
    ("😀" * 700, "😀" * 500), ("a" * 499 + " b", "a" * 499),
    ("<script>literal text</script>", "<script>literal text</script>"),
])
def test_preview_text_is_bounded_plain_text(value, expected):
    assert preview_line(value) == expected


def test_uninspectable_or_positional_only_legacy_callback_is_not_injected():
    assert preview_options(bool, lambda text: None) == {}

    def legacy(recognition_preview, /):
        pass

    assert preview_options(legacy, lambda text: None) == {}
