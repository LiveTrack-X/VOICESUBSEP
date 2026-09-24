from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from voicesubsep.app import create_app
from voicesubsep.storage import Storage, new_id


def client_for(tmp_path, **kwargs):
    return TestClient(create_app(data_dir=tmp_path / "data", **kwargs), base_url="http://127.0.0.1:8787")


def fake_probe(path):
    assert path.is_file()
    return {"duration": 4.0, "audioTracks": [{"index": 1, "label": "Audio 1", "channels": 2}]}


def upload(client, name="recording.wav", content=b"fixture"):
    response = client.post("/api/media", files={"file": (name, content, "audio/wav")})
    assert response.status_code == 201, response.text
    return response.json()


def request_for(media_id, **changes):
    return {"mediaId": media_id, "mode": "overlap", "speakerCount": 2, "audioTrack": 1,
            "whisperModel": "tiny", "language": "ko", "device": "cpu", "diarization": True, **changes}


def result_for(duration=4.0):
    return {"captions": [], "speakers": [], "duration": duration, "warnings": []}


def wait_job(client, job_id, desired=None):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200
        job = response.json()
        if job["status"] in (desired or {"completed", "failed", "cancelled"}):
            return job
        time.sleep(0.01)
    pytest.fail(f"Job did not reach expected state: {job}")


@pytest.fixture
def actual_media(tmp_path):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not shutil.which("ffprobe"):
        pytest.skip("FFmpeg and FFprobe are required for the real media integration fixture.")
    path = tmp_path / "two-tracks.mkv"
    subprocess.run(
        [ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=0.4",
         "-f", "lavfi", "-i", "sine=frequency=550:duration=0.4", "-map", "0:a", "-map", "1:a",
         "-c:a", "pcm_s16le", "-metadata:s:a:0", "title=Microphone", "-metadata:s:a:1", "title=Chat", str(path)],
        check=True, capture_output=True,
        creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
    )
    return path


def test_real_media_probe_range_and_selected_stream(tmp_path, actual_media):
    seen = {}

    def analyze(path, **kwargs):
        seen.update(kwargs)
        assert path.read_bytes() == actual_media.read_bytes()
        kwargs["progress"]("transcribing", 0.5)
        return result_for(0.4)

    with client_for(tmp_path, analyzer=analyze) as client:
        media = upload(client, "fixture.mkv", actual_media.read_bytes())
        assert 0.39 <= media["duration"] <= 0.5
        assert [track["index"] for track in media["audioTracks"]] == [0, 1]
        assert media["audioTracks"][1]["label"].startswith("Chat")
        response = client.get(media["url"], headers={"Range": "bytes=10-29"})
        assert response.status_code == 206
        assert response.content == actual_media.read_bytes()[10:30]
        assert response.headers["content-range"].startswith("bytes 10-29/")
        assert response.headers["accept-ranges"] == "bytes"
        assert client.get(media["url"], headers={"Range": "bytes=999999999-"}).status_code == 416
        response = client.post("/api/jobs", json=request_for(media["id"], audioTrack=1))
        assert response.status_code == 202
        done = wait_job(client, response.json()["id"])
        assert done["status"] == "completed"
        assert seen["audio_track"] == 1
        assert seen["mode"] == "overlap"
        assert done["progress"] == 1
        assert "request" not in done


def test_media_rejects_invalid_and_oversized_files(tmp_path):
    with client_for(tmp_path, probe=fake_probe, max_upload_bytes=10) as client:
        assert client.post("/api/media", files={"file": ("file.html", b"hi")}).status_code == 415
        assert client.post("/api/media", files={"file": ("file.wav", b"")}).status_code == 422
        assert client.post("/api/media", files={"file": ("file.wav", b"a" * 11)}).status_code == 413
        assert list((tmp_path / "data" / "media").iterdir()) == []


def test_streaming_body_limit_before_multipart_parser(tmp_path):
    with client_for(tmp_path, probe=fake_probe, max_upload_bytes=10) as client:
        body = b'--test\r\nContent-Disposition: form-data; name="file"; filename="x.wav"\r\n\r\n' + b"x" * 70000 + b"\r\n--test--\r\n"
        response = client.post("/api/media", content=iter([body[:100], body[100:]]), headers={"Content-Type": "multipart/form-data; boundary=test"})
        assert response.status_code == 413
        assert list((tmp_path / "data" / "media").iterdir()) == []
        assert client.post("/api/jobs", content=b"x" * 70000, headers={"Content-Type": "application/json"}).status_code == 413


def test_actual_invalid_media_is_rejected(tmp_path):
    if not shutil.which("ffprobe"):
        pytest.skip("FFprobe is required")
    with client_for(tmp_path) as client:
        response = client.post("/api/media", files={"file": ("bad.wav", b"not a recording")})
        assert response.status_code == 422
        assert list((tmp_path / "data" / "media").iterdir()) == []


def test_health_exposes_only_import_capability(tmp_path, monkeypatch):
    calls = []

    def capabilities():
        calls.append(True)
        return {"whisper": True, "nemotron": False}

    monkeypatch.setitem(sys.modules, "voicesubsep.inference", SimpleNamespace(capabilities=capabilities))
    with client_for(tmp_path) as client:
        assert calls == []
        response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert response.status_code == 200
        assert response.json()["engines"] == {"whisper": True, "nemotron": False}
        assert response.json()["status"] == "ok"
        assert calls == [True]


@pytest.mark.parametrize("changes", [
    {"speakerCount": 0}, {"speakerCount": 5}, {"speakerCount": True}, {"speakerCount": "2"},
    {"audioTrack": -1}, {"audioTrack": 4097}, {"audioTrack": 0},
    {"whisperModel": "../../elsewhere"}, {"device": "auto"}, {"mode": "unknown"},
    {"mediaId": "../private"}, {"language": "ko; del"}, {"diarization": "false"}, {"path": "C:/private.wav"},
])
def test_job_request_validation(tmp_path, changes):
    with client_for(tmp_path, probe=fake_probe) as client:
        media = upload(client)
        response = client.post("/api/jobs", json=request_for(media["id"], **changes))
        assert response.status_code == 422, response.text


def test_unknown_ids_and_external_requests_are_rejected(tmp_path):
    with client_for(tmp_path, probe=fake_probe) as client:
        assert client.get(f"/api/media/{new_id()}/file").status_code == 404
        assert client.get("/api/media/not-an-id/file").status_code == 422
        assert client.get(f"/api/jobs/{new_id()}").status_code == 404
        assert client.delete(f"/api/jobs/{new_id()}").status_code == 404
        assert client.post("/api/jobs", json=request_for(new_id())).status_code == 404
        assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
        assert client.get("/api/health", headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.get("/api/health", headers={"Origin": "null"}).status_code == 403
        assert client.get("/api/health", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403


def test_metadata_cannot_redirect_file_access(tmp_path):
    with client_for(tmp_path, probe=fake_probe) as client:
        media = upload(client, "../../recording.wav")
        assert media["name"] == "recording.wav"
        metadata = tmp_path / "data" / "media" / media["id"] / "metadata.json"
        value = json.loads(metadata.read_text(encoding="utf-8"))
        value["storedName"] = "../../private.txt"
        metadata.write_text(json.dumps(value), encoding="utf-8")
        assert client.get(media["url"]).status_code == 404
    storage = Storage(tmp_path / "data")
    with pytest.raises(ValueError):
        storage.contained(tmp_path / "private.txt")


def test_queue_running_cancel_and_single_worker(tmp_path):
    started = threading.Event()
    calls = []

    class AnalysisCancelled(Exception):
        pass

    def analyze(path, **kwargs):
        calls.append(path)
        started.set()
        deadline = time.monotonic() + 5
        while not kwargs["cancelled"]():
            if time.monotonic() > deadline:
                raise RuntimeError("Test timed out waiting for cancellation")
            time.sleep(0.01)
        raise AnalysisCancelled()

    with client_for(tmp_path, analyzer=analyze, probe=fake_probe) as client:
        media = upload(client)
        first = client.post("/api/jobs", json=request_for(media["id"])).json()["id"]
        assert started.wait(2)
        second = client.post("/api/jobs", json=request_for(media["id"])).json()["id"]
        assert client.get(f"/api/jobs/{second}").json()["status"] == "queued"
        assert client.delete(f"/api/jobs/{second}").json()["status"] == "cancelled"
        client.delete(f"/api/jobs/{first}")
        assert wait_job(client, first)["status"] == "cancelled"
        assert len(calls) == 1


def test_cancel_does_not_overwrite_completed_or_late_result(tmp_path):
    started = threading.Event()
    finish = threading.Event()

    def analyze(path, **kwargs):
        started.set()
        assert finish.wait(5)
        return result_for()

    with client_for(tmp_path, analyzer=analyze, probe=fake_probe) as client:
        media = upload(client)
        job_id = client.post("/api/jobs", json=request_for(media["id"])).json()["id"]
        assert started.wait(2)
        cancelling = client.delete(f"/api/jobs/{job_id}").json()
        assert cancelling["status"] == "running"
        finish.set()
        assert wait_job(client, job_id)["status"] == "completed"
        assert client.delete(f"/api/jobs/{job_id}").json()["status"] == "completed"


def test_missing_engine_error_no_fake_result(tmp_path):
    def analyze(path, **kwargs):
        raise RuntimeError("Install faster-whisper to enable local transcription.")

    with client_for(tmp_path, analyzer=analyze, probe=fake_probe) as client:
        media = upload(client)
        job_id = client.post("/api/jobs", json=request_for(media["id"])).json()["id"]
        job = wait_job(client, job_id)
        assert job["status"] == "failed"
        assert "Install faster-whisper" in job["error"]
        assert "result" not in job


def test_completed_jobs_survive_restart_without_reexecution(tmp_path):
    calls = []

    def analyze(path, **kwargs):
        calls.append(path)
        return result_for()

    with client_for(tmp_path, analyzer=analyze, probe=fake_probe) as client:
        media = upload(client)
        job_id = client.post("/api/jobs", json=request_for(media["id"])).json()["id"]
        assert wait_job(client, job_id)["status"] == "completed"
    with client_for(tmp_path, analyzer=analyze, probe=fake_probe) as client:
        assert client.get(f"/api/jobs/{job_id}").json()["status"] == "completed"
        assert client.get(media["url"]).status_code == 200
    assert len(calls) == 1


def test_interrupted_jobs_fail_on_startup_and_duplicate_worker_blocked(tmp_path):
    storage = Storage(tmp_path / "data")
    storage.initialize()
    job_id = new_id()
    storage.write_json(storage.job_path(job_id), {"id": job_id, "status": "running", "stage": "transcribing", "progress": 0.2})
    with client_for(tmp_path, probe=fake_probe) as client:
        job = client.get(f"/api/jobs/{job_id}").json()
        assert job["status"] == "failed"
        assert job["stage"] == "interrupted"
        with pytest.raises(RuntimeError, match="Another VOICESUBSEP process"):
            with client_for(tmp_path, probe=fake_probe):
                pass


def test_atomic_json_failure_preserves_previous_value(tmp_path):
    storage = Storage(tmp_path / "data")
    storage.initialize()
    path = storage.job_path(new_id())
    storage.write_json(path, {"progress": 0.5})
    with pytest.raises(ValueError):
        storage.write_json(path, {"progress": float("nan")})
    assert storage.read_json(path) == {"progress": 0.5}
    assert not list(storage.jobs.glob("*.tmp"))
