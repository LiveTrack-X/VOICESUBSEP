import threading
import time

import pytest
from fastapi.testclient import TestClient

from voicesubsep.app import create_app
from voicesubsep.inference import AnalysisCancelled


def probe(path):
    return {"duration": 2, "audioTracks": [{"index": 0, "label": "Audio", "channels": 1}]}


def submit(client, name):
    media = client.post("/api/media", files={"file": (name + ".wav", name.encode(), "audio/wav")}).json()
    response = client.post("/api/jobs", json={"mediaId": media["id"], "projectId": name, "projectName": name + " project", "audioTrack": 0, "speakerCount": 1, "device": "cpu", "diarization": False})
    assert response.status_code == 202, response.text
    return response.json()["id"]


def wait(client, identifier, status="completed"):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        value = client.get(f"/api/jobs/{identifier}").json()
        if value["status"] == status:
            return value
        time.sleep(.005)
    pytest.fail(f"Job did not become {status}: {value}")


def result():
    return {"captions": [], "speakers": [], "duration": 2, "warnings": []}


def test_reorder_next_preserves_every_other_pending_order_and_reports_blocker(tmp_path):
    release, started = threading.Event(), threading.Event()
    seen = []
    def analyzer(path, **kwargs):
        name = path.read_text(); seen.append(name)
        if name == "first":
            kwargs["progress"]("recognizing", .42); started.set(); assert release.wait(4)
        return result()
    app = create_app(data_dir=tmp_path, probe=probe, analyzer=analyzer)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        try:
            first = submit(client, "first"); assert started.wait(2)
            second, selected, fourth = [submit(client, name) for name in ["second", "selected", "fourth"]]
            queue = client.get(f"/api/jobs/{selected}").json()["queue"]
            assert queue == {"position": 2, "waitingCount": 3, "workerAvailable": True,
                             "blockingJob": {"id": first, "projectName": "first project", "mediaName": "first.wav", "stage": "recognizing", "progress": .42, "cancelRequested": False}}
            response = client.post(f"/api/jobs/{selected}/prioritize", json={"cancelRunning": False})
            assert response.status_code == 200 and response.json()["queue"]["position"] == 1
            assert client.get(f"/api/jobs/{second}").json()["queue"]["position"] == 2
            assert client.get(f"/api/jobs/{fourth}").json()["queue"]["position"] == 3
            assert client.get(f"/api/jobs/{first}").json()["cancelRequested"] is False
            release.set(); wait(client, fourth)
            assert seen == ["first", "selected", "second", "fourth"]
            assert client.get(f"/api/jobs/{first}").json()["result"] == result()
        finally: release.set()


def test_cancel_then_prioritize_waits_for_native_return_and_never_runs_concurrently(tmp_path):
    release, started = threading.Event(), threading.Event()
    seen = []; in_native = threading.Event()
    def analyzer(path, **kwargs):
        name = path.read_text(); seen.append(name)
        if name == "first":
            in_native.set(); started.set(); assert release.wait(4)
            in_native.clear()
            if kwargs["cancelled"](): raise AnalysisCancelled("cancelled")
        else: assert not in_native.is_set()
        return result()
    with TestClient(create_app(data_dir=tmp_path, probe=probe, analyzer=analyzer), base_url="http://127.0.0.1:8787") as client:
        try:
            first = submit(client, "first"); assert started.wait(2)
            second, selected = submit(client, "second"), submit(client, "selected")
            response = client.post(f"/api/jobs/{selected}/prioritize", json={"cancelRunning": True, "expectedRunningJobId": first})
            assert response.status_code == 200
            assert response.json()["queue"]["blockingJob"]["cancelRequested"] is True
            blocking = client.get(f"/api/jobs/{first}").json()
            assert blocking["status"] == "running" and blocking["stage"] == "cancellation requested" and blocking["cancelRequested"] is True
            assert client.get(f"/api/jobs/{selected}").json()["status"] == "queued"
            assert seen == ["first"]
            release.set(); wait(client, second)
            assert wait(client, first, "cancelled")["cancelRequested"] is False
            assert seen == ["first", "selected", "second"]
        finally: release.set()


def test_changed_running_snapshot_does_not_cancel_or_reorder_anything(tmp_path):
    first_release, second_release, first_started, second_started = [threading.Event() for _ in range(4)]
    def analyzer(path, **kwargs):
        name = path.read_text()
        if name == "first": first_started.set(); assert first_release.wait(4)
        if name == "second": second_started.set(); assert second_release.wait(4)
        return result()
    with TestClient(create_app(data_dir=tmp_path, probe=probe, analyzer=analyzer), base_url="http://127.0.0.1:8787") as client:
        try:
            first = submit(client, "first"); assert first_started.wait(2)
            second, third, selected = [submit(client, name) for name in ["second", "third", "selected"]]
            first_release.set(); assert second_started.wait(2)
            stale = client.post(f"/api/jobs/{selected}/prioritize", json={"cancelRunning": True, "expectedRunningJobId": first})
            assert stale.status_code == 409
            assert client.get(f"/api/jobs/{second}").json()["cancelRequested"] is False
            assert client.get(f"/api/jobs/{third}").json()["queue"]["position"] == 1
            assert client.get(f"/api/jobs/{selected}").json()["queue"]["position"] == 2
            assert client.post(f"/api/jobs/{second}/prioritize", json={"cancelRunning": False}).status_code == 409
            assert client.post(f"/api/jobs/{'f' * 32}/prioritize", json={"cancelRunning": False}).status_code == 404
        finally: first_release.set(); second_release.set()


@pytest.mark.parametrize("body", [{"cancelRunning": True}, {"cancelRunning": "true"}, {"cancelRunning": True, "expectedRunningJobId": "../bad"}, {"cancelRunning": False, "force": True}])
def test_prioritize_rejects_unreviewed_or_malformed_requests(tmp_path, body):
    with TestClient(create_app(data_dir=tmp_path, probe=probe, analyzer=lambda *a, **k: result()), base_url="http://127.0.0.1:8787") as client:
        assert client.post(f"/api/jobs/{'a' * 32}/prioritize", json=body).status_code == 422


def test_shutdown_disables_prioritization_and_queue_status_reports_worker_unavailable(tmp_path):
    release, started = threading.Event(), threading.Event()
    def analyzer(*args, **kwargs):
        started.set(); assert release.wait(4); return result()
    app = create_app(data_dir=tmp_path, probe=probe, analyzer=analyzer)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        try:
            submit(client, "first"); assert started.wait(2)
            selected = submit(client, "selected")
            app.state.jobs._stopping.set()
            response = client.post(f"/api/jobs/{selected}/prioritize", json={"cancelRunning": False})
            assert response.status_code == 503
            assert client.get(f"/api/jobs/{selected}").json()["queue"]["workerAvailable"] is False
        finally: release.set()


def test_cancelled_pending_job_is_removed_from_position_count(tmp_path):
    release, started = threading.Event(), threading.Event()
    def analyzer(*args, **kwargs):
        started.set(); assert release.wait(4); return result()
    with TestClient(create_app(data_dir=tmp_path, probe=probe, analyzer=analyzer), base_url="http://127.0.0.1:8787") as client:
        try:
            submit(client, "first"); assert started.wait(2)
            cancelled, selected = submit(client, "cancelled"), submit(client, "selected")
            assert client.delete(f"/api/jobs/{cancelled}").json()["status"] == "cancelled"
            queue = client.get(f"/api/jobs/{selected}").json()["queue"]
            assert queue["position"] == 1 and queue["waitingCount"] == 1
            assert client.post(f"/api/jobs/{cancelled}/prioritize", json={"cancelRunning": False}).status_code == 409
        finally: release.set()
