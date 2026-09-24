from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import time

from fastapi.testclient import TestClient
import pytest

from voicesubsep.app import create_app
from voicesubsep.diagnostics import Diagnostics, MAX_RECORD_BYTES, sanitize_text
from voicesubsep.storage import Storage
from voicesubsep import vst_api, vst_host
from voicesubsep.rendering import RenderCancelled


def recorder(tmp_path, **kwargs):
    return Diagnostics(Storage(tmp_path / "data"), "test-version", **kwargs)


def test_rotation_restart_and_latest_bounded_export(tmp_path):
    log = recorder(tmp_path, max_file_bytes=4096, file_count=3, max_entries=7)
    for index in range(80):
        log.record("analysis", "failed", f"Failure number {index}: " + "Korean 한글 오류 " * 20)
    files = list((tmp_path / "data/logs").iterdir())
    assert len(files) == 3
    assert all(path.stat().st_size <= 4096 for path in files)
    for path in files:
        for line in path.read_bytes().splitlines():
            assert len(line) + 1 <= MAX_RECORD_BYTES
            assert json.loads(line)["level"] == "error"
    restored = recorder(tmp_path, max_file_bytes=4096, file_count=3, max_entries=7).export()
    assert len(restored["entries"]) == 7
    assert restored["entries"][-1]["message"].startswith("Failure number 79:")
    assert restored["appVersion"] == "test-version"
    assert restored["persistence"] == {"available": True}


@pytest.mark.parametrize("message,private", [
    (r"Could not read 'C:\Users\Alice\Private Folder\meeting.wav'", "Alice"),
    (r"Could not read C:\Users\Alice\Private Folder\meeting.wav", "Alice"),
    (r"Could not open \\office\private\recording.wav", "office"),
    ("Failed: '/Users/alice/Documents/private.wav'", "alice"),
    ("Failed /home/alice/private.wav: unsupported", "alice"),
    ("Authorization: Bearer private-secret", "private-secret"),
    ('{"password":"test-secret","access_token":"test-access"}', "test-"),
    ('password = "test secret with spaces"', "test secret"),
    ("'refresh_token': 'test secret with spaces'", "test secret"),
    ('{"password":"test \\"secret\\" with spaces"}', "secret"),
    ('{"Authorization":"Basic dXNlcjpwYXNzd29yZA=="}', "dXNlcjpwYXNzd29yZA"),
    ("Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA"),
    ("Plugin activation failed for private.user+tag@example.co.kr", "private.user"),
    ("access_token='a special secret'", "special"),
    ("token=my-private-token", "my-private-token"),
    ("hf_abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyz"),
    ("https://alice:secret@service.test/?token=private", "alice"),
    ("Failed plugin\nTRANSCRIPT SHOULD NEVER BE HERE", "TRANSCRIPT"),
])
def test_redacts_paths_credentials_and_multiline_details(message, private):
    assert private not in sanitize_text(message)


def test_records_allowlisted_context_and_no_nested_payloads(tmp_path):
    log = recorder(tmp_path)
    log.record("vst", "failed", "한글 " * 10000, jobId="a" * 32,
               route="/api/vst/inspect", errorType="ValueError", parameters={"voice": 12},
               transcript="never store me", request={"audio": "never store me"}, status=400)
    entry = log.export()["entries"][0]
    assert entry["context"] == {"jobId": "a" * 32, "route": "/api/vst/inspect", "errorType": "ValueError", "status": 400}
    assert "never store me" not in json.dumps(entry)
    assert (tmp_path / "data/logs/diagnostics.jsonl").stat().st_size <= MAX_RECORD_BYTES


def test_concurrent_records_are_complete_json_lines(tmp_path):
    log = recorder(tmp_path)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda index: log.record("analysis", "failed", f"Error {index}"), range(200)))
    entries = log.export()["entries"]
    assert len(entries) == 200
    assert len({entry["message"] for entry in entries}) == 200


def test_storage_failure_keeps_bounded_memory_and_does_not_raise(tmp_path, monkeypatch):
    log = recorder(tmp_path, max_entries=2)
    monkeypatch.setattr(log, "_path", lambda *_: (_ for _ in ()).throw(OSError("Disk error")))
    for index in range(3):
        log.exception("api", "failed", RuntimeError(f"Error {index}"))
    report = log.export()
    assert not report["persistence"]["available"]
    assert [entry["message"] for entry in report["entries"]] == ["Error 1", "Error 2"]


def test_symlink_cannot_redirect_logs_to_an_unrelated_file(tmp_path):
    log = recorder(tmp_path)
    folder = tmp_path / "data/logs"
    folder.mkdir(parents=True)
    other = tmp_path / "unrelated.txt"
    other.write_text("Leave this file alone")
    try:
        (folder / "diagnostics.jsonl").symlink_to(other)
    except OSError:
        pytest.skip("This Windows account cannot create symbolic links.")
    log.record("analysis", "failed", "Failed")
    assert other.read_text() == "Leave this file alone"
    report = log.export()
    assert not report["persistence"]["available"]
    assert report["entries"][0]["message"] == "Failed"


def test_corrupt_oversized_or_nested_history_is_bounded_and_filtered(tmp_path):
    log = recorder(tmp_path)
    target = tmp_path / "data/logs/diagnostics.jsonl"
    target.parent.mkdir(parents=True)
    target.write_text("bad json\n" + "x" * 20000 + "\n" + json.dumps({"timestamp": "now", "level": "error",
        "source": "api", "event": "failed", "message": "Error C:/Users/Secret/file.wav", "audio": "private", "context": {"status": 10 ** 100}}) + "\n")
    report = log.export()
    assert len(report["entries"]) == 1
    assert "Secret" not in json.dumps(report)
    assert "audio" not in report["entries"][0]
    assert report["entries"][0]["context"] == {}


def probe(_path):
    return {"duration": 1.0, "audioTracks": [{"index": 0, "label": "Audio", "channels": 2}], "hasVideo": False}


def upload(client):
    response = client.post("/api/media", files={"file": ("secret-recording.wav", b"private-audio", "audio/wav")})
    assert response.status_code == 201
    return response.json()["id"]


def await_status(client, route, identifier):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        result = client.get(f"/api/{route}/{identifier}").json()
        if result["status"] in {"completed", "failed", "cancelled"}:
            return result
        time.sleep(0.01)
    pytest.fail("Background job did not settle")


def test_actual_failed_analysis_persisted_across_app_restart_and_polling_not_logged(tmp_path):
    def failed(_path, **_kwargs):
        raise RuntimeError("Failed loading C:/Users/Alice/secret/model.bin")
    data_dir = tmp_path / "data"
    with TestClient(create_app(data_dir=data_dir, probe=probe, analyzer=failed), base_url="http://127.0.0.1:8787") as client:
        empty = client.get("/api/diagnostics")
        assert empty.status_code == 200 and empty.json()["entries"] == []
        assert empty.headers["cache-control"] == "no-store"
        media = upload(client)
        response = client.post("/api/jobs", json={"mediaId": media, "audioTrack": 0, "speakerCount": 2, "device": "cpu"})
        assert response.status_code == 202
        identifier = response.json()["id"]
        assert await_status(client, "jobs", identifier)["status"] == "failed"
        for _ in range(3):
            assert client.get("/api/jobs/" + "a" * 32).status_code == 404
        report = client.get("/api/diagnostics").json()
        assert len(report["entries"]) == 1
        entry = report["entries"][0]
        assert entry["source"] == "analysis" and entry["context"]["jobId"] == identifier
        assert "Alice" not in json.dumps(report) and "private-audio" not in json.dumps(report)
        assert "secret-recording" not in json.dumps(report)
        assert client.get("/api/diagnostics", headers={"Origin": "https://unrelated.test"}).status_code == 403
    with TestClient(create_app(data_dir=data_dir, probe=probe), base_url="http://127.0.0.1:8787") as client:
        assert client.get("/api/diagnostics").json()["entries"] == report["entries"]


def test_unexpected_api_error_is_logged_once_without_query_or_body(tmp_path):
    app = create_app(data_dir=tmp_path / "data", probe=probe)
    @app.post("/api/test-diagnostic")
    def broken():
        raise ValueError("Unexpected failure password=my-secret")
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        result = client.post("/api/test-diagnostic?token=do-not-log", json={"transcript": "private words"})
        assert result.status_code == 500
        report = client.get("/api/diagnostics").json()
        assert len(report["entries"]) == 1
        entry = report["entries"][0]
        assert entry["context"] == {"method": "POST", "route": "/api/test-diagnostic", "errorType": "ValueError"}
        assert all(private not in json.dumps(report) for private in ["my-secret", "do-not-log", "private words"])


def test_analysis_cancellation_is_not_an_error_log(tmp_path):
    class AnalysisCancelled(Exception):
        pass
    def cancelled(*_args, **_kwargs):
        raise AnalysisCancelled("Cancelled")
    app = create_app(data_dir=tmp_path / "data", probe=probe, analyzer=cancelled)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        media = upload(client)
        response = client.post("/api/jobs", json={"mediaId": media, "audioTrack": 0, "speakerCount": 2, "device": "cpu"})
        assert response.status_code == 202
        assert await_status(client, "jobs", response.json()["id"])["status"] == "cancelled"
        assert client.get("/api/diagnostics").json()["entries"] == []


@pytest.mark.parametrize("cancelled", [False, True])
def test_render_failure_recorded_but_cancel_not_recorded(tmp_path, cancelled):
    def render(*_args, **_kwargs):
        if cancelled:
            raise RenderCancelled("Cancelled")
        raise RuntimeError("Encoder failed")
    app = create_app(data_dir=tmp_path / "data", probe=probe, renderer=render)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identifier = upload(client)
        response = client.post("/api/renders", json={"mediaId": identifier, "keepRanges": [{"start": 0.0, "end": 0.5}], "format": "wav", "audioTrack": 0})
        assert response.status_code == 202, response.text
        assert await_status(client, "renders", response.json()["id"])["status"] == ("cancelled" if cancelled else "failed")
        entries = client.get("/api/diagnostics").json()["entries"]
        assert len(entries) == (0 if cancelled else 1)
        if entries:
            assert entries[0]["source"] == "render"


def test_vst_inspect_and_preview_failures_recorded(tmp_path, monkeypatch):
    plugin = tmp_path / "Effect.vst3"
    plugin.write_bytes(b"never loaded")
    monkeypatch.setattr(vst_api, "runtime_status", lambda: {"available": True, "issue": None})
    def failed(*_args, **_kwargs):
        raise RuntimeError("Plugin could not load token=private-token")
    monkeypatch.setattr(vst_host, "inspect_plugin", failed)
    monkeypatch.setattr(vst_api, "_extract_preview", failed)
    app = create_app(data_dir=tmp_path / "data", probe=probe)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        assert client.post("/api/vst/inspect", json={"path": str(plugin)}).status_code == 400
        identifier = upload(client)
        response = client.post("/api/vst/previews", json={"mediaId": identifier, "audioTrack": 0, "chain": [{"path": str(plugin), "parameters": {}}]})
        assert response.status_code == 202, response.text
        assert await_status(client, "vst/previews", response.json()["id"])["status"] == "failed"
        entries = client.get("/api/diagnostics").json()["entries"]
        assert [entry["event"] for entry in entries] == ["inspect_failed", "preview_failed"]
        assert all(entry["source"] == "vst" for entry in entries)
        assert "private-token" not in json.dumps(entries)
