from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from voicesubsep.app import create_app
from voicesubsep.inference import AnalysisCancelled


def client_for(app):
    return TestClient(app, base_url="http://127.0.0.1:8787")


def probe(_path):
    return {"duration": 30.0, "audioTracks": [{"index": 1, "label": "Audio", "channels": 1}]}


def source(client):
    response = client.post("/api/media", files={"file": ("voices.wav", b"test-audio", "audio/wav")})
    assert response.status_code == 201
    media = response.json()
    return {"mediaId": media["id"], "sourceIdentity": {"sha256": media["sha256"], "bytes": media["bytes"]}, "audioTrack": 1}


def wait(client, identity):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        record = client.get(f"/api/speech-tools/jobs/{identity}").json()
        if record["status"] in {"completed", "failed", "cancelled"}:
            return record
        time.sleep(.01)
    pytest.fail(f"Tool did not finish: {record}")


def test_candidate_result_bound_to_original_audio_and_allowlisted_outputs(tmp_path):
    seen = {}

    def runner(path, *, kind, output_dir, progress, cancelled, **options):
        seen.update(options, kind=kind)
        assert path.read_bytes() == b"test-audio"
        Path(output_dir, "original.wav").write_bytes(b"RIFF-original")
        Path(output_dir, "stream-1.wav").write_bytes(b"RIFF-separated")
        return {"originalFile": "original.wav", "start": 2., "end": 5., "streams": [
            {"index": 0, "audioFile": "stream-1.wav", "captions": []}], "warnings": []}

    with client_for(create_app(data_dir=tmp_path, probe=probe, speech_tool_runner=runner)) as client:
        payload = {**source(client), "kind": "overlap-recovery", "start": 2., "end": 5., "vocabulary": ["용어"]}
        response = client.post("/api/speech-tools/jobs", json=payload)
        assert response.status_code == 202, response.text
        identity = response.json()["id"]
        done = wait(client, identity)
        assert done["status"] == "completed", done
        assert done["result"]["mediaId"] == payload["mediaId"]
        assert done["result"]["sourceIdentity"] == payload["sourceIdentity"]
        assert seen["vocabulary"] == ["용어"]
        assert "output_dir" not in done and "request" not in done
        audio = done["result"]["streams"][0]["audioUrl"]
        assert client.get(audio).content == b"RIFF-separated"
        assert client.get(f"/api/speech-tools/jobs/{identity}/audio/not-allowed.wav").status_code == 404
        assert client.delete(f"/api/speech-tools/jobs/{identity}").status_code == 200
        assert client.get(audio).status_code == 404


@pytest.mark.parametrize("changes", [
    {"start": float("inf")}, {"start": 0., "end": 21.}, {"start": 29., "end": 32.},
    {"audioTrack": 0}, {"sourceIdentity": {"sha256": "0" * 64, "bytes": 10}},
    {"whisperModel": "arbitrary-path"}, {"vocabulary": ["bad\nterm"]},
])
def test_invalid_or_mismatched_request_never_runs(tmp_path, changes):
    calls = []
    with client_for(create_app(data_dir=tmp_path, probe=probe, speech_tool_runner=lambda *a, **k: calls.append(1))) as client:
        payload = {**source(client), "kind": "overlap-recovery", "start": 2., "end": 5., **changes}
        # JSON encoders correctly reject Infinity; send the nonstandard wire form to test server validation.
        if changes.get("start") == float("inf"):
            import json
            response = client.post("/api/speech-tools/jobs", content=json.dumps(payload), headers={"Content-Type": "application/json"})
        else:
            response = client.post("/api/speech-tools/jobs", json=payload)
        assert response.status_code in {409, 422}, response.text
        assert calls == []


def test_tools_and_regular_analysis_exclude_each_other_and_cache_is_leased(tmp_path):
    started, finish = threading.Event(), threading.Event()

    def runner(_path, *, cancelled, **_options):
        started.set()
        while not finish.wait(.01):
            if cancelled():
                raise AnalysisCancelled()
        return {"candidates": [], "warnings": []}

    with client_for(create_app(data_dir=tmp_path, probe=probe, speech_tool_runner=runner,
                               analyzer=lambda *_a, **_k: {"captions": [], "speakers": [], "duration": 30., "warnings": []})) as client:
        media = source(client)
        payload = {**media, "kind": "voice-match", "references": [
            {"id": "r1", "speakerId": "a", "start": 0., "end": 3.},
            {"id": "r2", "speakerId": "b", "start": 4., "end": 7.}],
            "targets": [{"captionId": "c1", "start": 8., "end": 10.}]}
        identity = client.post("/api/speech-tools/jobs", json=payload).json()["id"]
        assert started.wait(2)
        assert client.post("/api/jobs", json={"mediaId": media["mediaId"], "mode": "standard", "speakerCount": 2,
            "audioTrack": 1, "whisperModel": "tiny", "language": "ko", "device": "cpu", "diarization": False}).status_code == 409
        assert client.post("/api/live/sessions", json={"device": "cpu"}).status_code == 409
        assert client.delete(f"/api/media/{media['mediaId']}").status_code == 409
        assert client.post(f"/api/speech-tools/jobs/{identity}/cancel").status_code == 200
        assert wait(client, identity)["status"] == "cancelled"
        finish.set()


def test_shutdown_cancels_owned_tool_and_drops_partial_output(tmp_path):
    started = threading.Event()

    def runner(_path, *, output_dir, cancelled, **_options):
        Path(output_dir, "stream-1.wav").write_bytes(b"partial")
        started.set()
        while not cancelled():
            time.sleep(.01)
        raise AnalysisCancelled()

    app = create_app(data_dir=tmp_path, probe=probe, speech_tool_runner=runner)
    with client_for(app) as client:
        payload = {**source(client), "kind": "overlap-recovery", "start": 2., "end": 5.}
        client.post("/api/speech-tools/jobs", json=payload)
        assert started.wait(2)
    assert not list((tmp_path / "speech-tools").glob("*/stream-1.wav"))


def test_cancelled_queued_result_can_be_discarded_without_killing_worker(tmp_path):
    from voicesubsep.speech_tools import SpeechToolsManager
    from voicesubsep.speech_tools_api import SpeechToolRequest
    from voicesubsep.storage import Storage
    entered, release = threading.Event(), threading.Event()
    calls = []

    def runner(*_args, **_kwargs):
        calls.append(1)
        if len(calls) == 1:
            entered.set()
            release.wait(3)
        return {"ready": True}

    storage = Storage(tmp_path)
    storage.initialize()
    manager = SpeechToolsManager(storage, runner)
    manager.start()
    payload = SpeechToolRequest(kind="prepare-voice").model_dump()
    try:
        first = manager.submit(payload)
        assert entered.wait(2)
        second = manager.submit(payload)
        manager.cancel(second)
        manager.discard(second)
        release.set()
        deadline = time.monotonic() + 3
        while manager.get(first)["status"] != "completed" and time.monotonic() < deadline:
            time.sleep(.01)
        third = manager.submit(payload)
        while manager.get(third)["status"] not in {"completed", "failed"} and time.monotonic() < deadline:
            time.sleep(.01)
        assert manager.get(third)["status"] == "completed"
    finally:
        release.set()
        manager.stop()


def test_containment_failure_keeps_source_lease_and_output_even_during_shutdown(tmp_path):
    from voicesubsep.analysis_process import AnalysisWorkerCleanupError
    from voicesubsep.speech_tools import SpeechToolsManager
    from voicesubsep.speech_tools_api import SpeechToolRequest
    from voicesubsep.storage import Storage

    def failed(*_args, output_dir, **_kwargs):
        Path(output_dir, "stream-1.wav").write_bytes(b"still-owned")
        raise AnalysisWorkerCleanupError("owned worker could not exit")

    storage = Storage(tmp_path)
    storage.initialize()
    manager = SpeechToolsManager(storage, failed)
    manager.start()
    payload = SpeechToolRequest(kind="prepare-voice").model_dump()
    identity = manager.submit(payload)
    deadline = time.monotonic() + 3
    while manager.get(identity)["status"] != "failed" and time.monotonic() < deadline:
        time.sleep(.01)
    with pytest.raises(PermissionError):
        manager.discard(identity)
    manager.stop()
    assert (tmp_path / "speech-tools" / identity / "stream-1.wav").is_file()


def test_completed_audio_file_lock_does_not_interrupt_shutdown(tmp_path, monkeypatch):
    from voicesubsep import speech_tools
    from voicesubsep.speech_tools import SpeechToolsManager
    from voicesubsep.speech_tools_api import SpeechToolRequest
    from voicesubsep.storage import Storage
    storage = Storage(tmp_path)
    storage.initialize()
    manager = SpeechToolsManager(storage, lambda *_a, **_k: {"ready": True})
    manager.start()
    identity = manager.submit(SpeechToolRequest(kind="prepare-voice").model_dump())
    deadline = time.monotonic() + 3
    while manager.get(identity)["status"] != "completed" and time.monotonic() < deadline:
        time.sleep(.01)
    monkeypatch.setattr(speech_tools.shutil, "rmtree", lambda *_a, **_k: (_ for _ in ()).throw(PermissionError("open audio")))
    manager.stop()
    assert not manager._thread.is_alive()


def test_tool_stop_exception_still_releases_regular_worker_storage(tmp_path, monkeypatch):
    app = create_app(data_dir=tmp_path)
    original = app.state.speech_tools.stop

    def failed_stop():
        original()
        raise OSError("unexpected stop error")

    monkeypatch.setattr(app.state.speech_tools, "stop", failed_stop)
    with pytest.raises(OSError):
        with client_for(app):
            pass
    assert app.state.storage._lock_file is None
    assert not app.state.jobs._thread.is_alive()


def test_actual_contained_worker_previews_selected_source_clock(tmp_path):
    import io
    import shutil
    import wave
    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg required for an actual contained preview.")
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\x01\x00" * 64000)
    with client_for(create_app(data_dir=tmp_path)) as client:
        media = client.post("/api/media", files={"file": ("source.wav", output.getvalue(), "audio/wav")}).json()
        payload = {"kind": "voice-preview", "mediaId": media["id"], "sourceIdentity": {"sha256": media["sha256"], "bytes": media["bytes"]},
                   "audioTrack": media["audioTracks"][0]["index"], "start": .5, "end": 2.5}
        response = client.post("/api/speech-tools/jobs", json=payload)
        assert response.status_code == 202, response.text
        record = wait(client, response.json()["id"])
        assert record["status"] == "completed", record
        assert record["result"]["start"] == .5
        with wave.open(io.BytesIO(client.get(record["result"]["originalUrl"]).content)) as audio:
            assert audio.getnframes() == 16000
            assert audio.getframerate() == 8000
