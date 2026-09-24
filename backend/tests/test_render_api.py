from __future__ import annotations

import json
from pathlib import Path
import threading
import time

import pytest
from fastapi.testclient import TestClient

from voicesubsep.app import create_app
from voicesubsep.rendering import RenderCancelled, effective_ranges
from voicesubsep.storage import Storage, new_id


def probe(path):
    assert path.is_file()
    return {"duration": 3.0, "audioTracks": [{"index": 1, "label": "Original", "channels": 2}],
            "hasVideo": True, "frameRate": 30, "videoStream": 0}


def client_for(tmp_path, **kwargs):
    return TestClient(create_app(data_dir=tmp_path / "data", probe=kwargs.pop("probe", probe), **kwargs),
                      base_url="http://127.0.0.1:8787")


def upload(client):
    response = client.post("/api/media", files={"file": ("원본 recording.mkv", b"source recording", "video/x-matroska")})
    assert response.status_code == 201, response.text
    return response.json()


def request(media_id, **kwargs):
    return {"mediaId": media_id, "keepRanges": [{"start": 0.201, "end": 0.701}, {"start": 2.1, "end": 2.6}],
            "format": "mp4", "audioTrack": 1, **kwargs}


def renderer(source, destination, **kwargs):
    assert source.read_bytes() == b"source recording"
    assert destination != source and kwargs["audio_track"] == 1
    kwargs["progress"]("encoding", 0.7)
    kwargs["progress"]("encoding", 0.2)  # Progress must not go backward.
    ranges = effective_ranges(kwargs["keep_ranges"], 3, kwargs["format"])
    destination.write_bytes(b"completed export")
    return {"duration": sum(r["end"] - r["start"] for r in ranges), "keepRanges": ranges, "warnings": ["Grid aligned"]}


def wait(client, job_id, desired=None):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get(f"/api/renders/{job_id}")
        assert response.status_code == 200, response.text
        result = response.json()
        if result["status"] in (desired or {"completed", "failed", "cancelled"}):
            return result
        time.sleep(0.01)
    pytest.fail(f"Export did not reach expected status: {result}")


def test_export_api_result_download_and_persistence_without_models(tmp_path):
    def no_analysis(*args, **kwargs):
        pytest.fail("Rendering must never invoke a speech model")
    with client_for(tmp_path, renderer=renderer, analyzer=no_analysis) as client:
        media = upload(client)
        assert media["hasVideo"] and media["frameRate"] == 30
        created = client.post("/api/renders", json=request(media["id"]))
        assert created.status_code == 202, created.text
        job_id = created.json()["id"]
        done = wait(client, job_id)
        assert done["status"] == "completed" and done["progress"] == 1
        assert "request" not in done
        assert done["result"]["duration"] == pytest.approx(1)
        assert done["result"]["keepRanges"] == [{"start": 0.2, "end": 0.7}, {"start": 2.1, "end": 2.6}]
        assert done["result"]["filename"] == "원본 recording-edited.mp4"
        response = client.get(done["result"]["url"])
        assert response.content == b"completed export"
        assert response.headers["cache-control"] == "private, no-store"
        assert client.get(media["url"]).content == b"source recording"
        assert client.delete(f"/api/renders/{job_id}").json()["status"] == "completed"
    # A fresh process lifecycle can take the same data lock and restore exports.
    with client_for(tmp_path, renderer=renderer) as client:
        assert client.get(f"/api/renders/{job_id}").json() == done
        assert client.get(done["result"]["url"]).content == b"completed export"


@pytest.mark.parametrize("change", [
    {"keepRanges": []}, {"keepRanges": [{"start": 0, "end": 0}]},
    {"keepRanges": [{"start": 0, "end": 4}]}, {"keepRanges": [{"start": "0", "end": 1}]},
    {"keepRanges": [{"start": True, "end": 1}]}, {"keepRanges": [{"start": 0, "end": 1, "file": "x"}]},
    {"keepRanges": [{"start": 2, "end": 3}, {"start": 0, "end": 1}]},
    {"keepRanges": [{"start": 0, "end": 2}, {"start": 1, "end": 3}]},
    {"keepRanges": [{"start": 0.001, "end": 0.002}]},
    {"keepRanges": [{"start": 0, "end": 1}] * 201},
    {"audioTrack": 0}, {"audioTrack": True}, {"format": "../source"},
    {"destination": "C:/elsewhere"}, {"mediaId": "../../outside"},
])
def test_invalid_requests_are_rejected_before_queueing(tmp_path, change):
    with client_for(tmp_path, renderer=lambda *a, **kw: pytest.fail("Invalid request was queued")) as client:
        media = upload(client)
        response = client.post("/api/renders", json=request(media["id"], **change))
        assert response.status_code == 422, response.text
        assert list((tmp_path / "data" / "renders").iterdir()) == []


def test_nonfinite_times_are_rejected_without_fastapi_serialization_failure(tmp_path):
    with client_for(tmp_path, renderer=renderer) as client:
        media = upload(client)
        for invalid in ("NaN", "Infinity", "-Infinity"):
            payload = json.dumps(request(media["id"], keepRanges=[{"start": 0, "end": 1}])).replace('"end": 1', '"end": ' + invalid)
            response = client.post("/api/renders", content=payload, headers={"Content-Type": "application/json"})
            assert response.status_code == 422


def test_audio_only_upload_cannot_export_mp4_and_actual_file_is_reprobed(tmp_path):
    calls = []
    def current_probe(path):
        calls.append(path)
        return {**probe(path), "hasVideo": len(calls) == 1}
    with client_for(tmp_path, renderer=renderer, probe=current_probe) as client:
        media = upload(client)
        assert media["hasVideo"]
        assert client.post("/api/renders", json=request(media["id"])).status_code == 422
        assert len(calls) == 2
        response = client.post("/api/renders", json=request(media["id"], format="wav"))
        assert response.status_code == 202
        assert wait(client, response.json()["id"])["status"] == "completed"


def test_running_cancellation_waits_for_renderer_cleanup_and_never_serves_partial(tmp_path):
    cancel_seen, allow_cleanup, exited = threading.Event(), threading.Event(), threading.Event()
    def blocked(source, destination, **kwargs):
        while not kwargs["cancelled"]():
            time.sleep(0.005)
        cancel_seen.set()
        assert allow_cleanup.wait(5)
        exited.set()
        raise RenderCancelled()
    with client_for(tmp_path, renderer=blocked) as client:
        media = upload(client)
        job_id = client.post("/api/renders", json=request(media["id"])).json()["id"]
        wait(client, job_id, {"running"})
        try:
            response = client.delete(f"/api/renders/{job_id}")
            assert cancel_seen.wait(2)
            assert response.json()["status"] == "running"
            assert client.get(f"/api/renders/{job_id}/file").status_code == 404
        finally:
            allow_cleanup.set()
        assert wait(client, job_id)["status"] == "cancelled"
        assert exited.is_set()


def test_lifespan_cancels_render_before_releasing_shared_storage_lock(tmp_path):
    started, cleaned = threading.Event(), threading.Event()
    def blocked(source, destination, **kwargs):
        started.set()
        while not kwargs["cancelled"]():
            time.sleep(0.005)
        cleaned.set()
        raise RenderCancelled()
    with client_for(tmp_path, renderer=blocked) as client:
        media = upload(client)
        job_id = client.post("/api/renders", json=request(media["id"])).json()["id"]
        assert started.wait(2)
        competitor = Storage(tmp_path / "data")
        with pytest.raises(RuntimeError, match="Another"):
            competitor.acquire()
    assert cleaned.is_set()
    competitor.acquire()
    competitor.release()
    with client_for(tmp_path, renderer=renderer) as client:
        assert client.get(f"/api/renders/{job_id}").json()["status"] == "cancelled"


def test_queue_limit_cancelled_queue_slots_and_queued_cancel_never_invokes_renderer(tmp_path):
    started, release = threading.Event(), threading.Event()
    invocations = []
    def blocked(source, destination, **kwargs):
        invocations.append(destination)
        started.set()
        assert release.wait(5)
        return renderer(source, destination, **kwargs)
    with client_for(tmp_path, renderer=blocked) as client:
        media = upload(client)
        first = client.post("/api/renders", json=request(media["id"])).json()["id"]
        assert started.wait(2)
        try:
            queued = [client.post("/api/renders", json=request(media["id"])).json()["id"] for _ in range(7)]
            assert client.post("/api/renders", json=request(media["id"])).status_code == 429
            for job_id in queued:
                assert client.delete(f"/api/renders/{job_id}").json()["status"] == "cancelled"
            # Cancelled queue entries still occupy bounded queue slots until
            # the worker gets them. Filling one remaining slot must not yield
            # a 500 or leave a saved job that was never actually enqueued.
            extra = client.post("/api/renders", json=request(media["id"]))
            assert extra.status_code == 202
            assert client.delete(f"/api/renders/{extra.json()['id']}").status_code == 200
            assert client.post("/api/renders", json=request(media["id"])).status_code == 429
        finally:
            release.set()
        assert wait(client, first)["status"] == "completed"
    assert len(invocations) == 1


@pytest.mark.parametrize("behavior", ["exception", "missing_output"])
def test_renderer_failure_cannot_report_success_or_serve_a_file(tmp_path, behavior):
    def broken(*args, **kwargs):
        if behavior == "exception":
            raise RuntimeError("encoder failed")
        return {"duration": 1, "keepRanges": [], "warnings": []}
    with client_for(tmp_path, renderer=broken) as client:
        media = upload(client)
        job_id = client.post("/api/renders", json=request(media["id"])).json()["id"]
        done = wait(client, job_id)
        assert done["status"] == "failed" and done["error"]
        assert client.get(f"/api/renders/{job_id}/file").status_code == 404


def test_restart_marks_interrupted_exports_and_ignores_malformed_metadata(tmp_path):
    storage = Storage(tmp_path / "data")
    storage.initialize()
    ids = []
    for status in ("queued", "running"):
        job_id = new_id()
        ids.append(job_id)
        storage.write_json(storage.root / "renders" / job_id / "job.json",
                           {"id": job_id, "status": status, "progress": 0.5, "stage": "encoding",
                            "request": request(new_id())})
    bad = new_id()
    storage.write_json(storage.root / "renders" / bad / "job.json", {"id": bad, "request": []})
    with client_for(tmp_path, renderer=renderer) as client:
        for job_id in ids:
            result = client.get(f"/api/renders/{job_id}").json()
            assert result["status"] == "failed" and result["stage"] == "interrupted"
            assert client.get(f"/api/renders/{job_id}/file").status_code == 404
        assert client.get(f"/api/renders/{bad}").status_code == 404


def test_render_routes_keep_loopback_guard_and_bounded_identifiers(tmp_path):
    with client_for(tmp_path, renderer=renderer) as client:
        media = upload(client)
        assert client.post("/api/renders", json=request(media["id"]), headers={"Origin": "https://external.invalid"}).status_code == 403
        assert client.get("/api/renders/invalid/file").status_code == 422
        assert client.get(f"/api/renders/{new_id()}/file").status_code == 404
        assert client.delete(f"/api/renders/{new_id()}").status_code == 404
        assert client.post("/api/renders", json=request(new_id())).status_code == 404
