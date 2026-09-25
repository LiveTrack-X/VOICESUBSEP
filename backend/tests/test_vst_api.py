from __future__ import annotations

import hashlib
import base64
import io
from pathlib import Path
import shutil
import threading
import time
import wave

from fastapi.testclient import TestClient
import pytest

from voicesubsep.app import create_app
from voicesubsep import vst_api, vst_host


def audio_bytes(frames=48000):
    result = io.BytesIO()
    with wave.open(result, "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(48000)
        output.writeframes(b"\x10\x00\x20\x00" * frames)
    return result.getvalue()


@pytest.fixture
def setup(tmp_path, monkeypatch):
    plugin = tmp_path / "Effect.vst3"
    plugin.write_bytes(b"fake plugin, tests never execute it")
    monkeypatch.setattr(vst_api, "runtime_status", lambda: {"available": True, "version": "0.9.25", "issue": None})
    monkeypatch.setattr(vst_api, "plugin_roots", lambda: [tmp_path])
    app = create_app(data_dir=tmp_path / "data", probe=lambda _: {
        "duration": 1.0, "audioTracks": [{"index": 0, "label": "Microphone", "channels": 2}]},
        analyzer=lambda _, **kwargs: {"captions": [], "speakers": [], "duration": 1, "warnings": [], "seen": kwargs.get("preprocessing")})
    return app, {"path": str(plugin), "enabled": True, "parameters": {}}


def upload(client):
    response = client.post("/api/media", files={"file": ("test.wav", audio_bytes(), "audio/wav")})
    assert response.status_code == 201
    return response.json()["id"]


def wait(client, identifier):
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        response = client.get(f"/api/vst/previews/{identifier}")
        assert response.status_code == 200
        record = response.json()
        if record["status"] in {"completed", "failed", "cancelled"}:
            return record
        time.sleep(0.01)
    pytest.fail("VST preview failed to settle")


def test_discovery_lists_bundles_once_without_loading(tmp_path, monkeypatch):
    bundle = tmp_path / "Clear.vst3"
    (bundle / "Contents/x86_64-win").mkdir(parents=True)
    (bundle / "Contents/x86_64-win/Clear.vst3").write_bytes(b"never loaded")
    (tmp_path / "Voice.vst3").write_bytes(b"never loaded")
    monkeypatch.setattr(vst_host, "inspect_plugin", lambda *_: pytest.fail("Discovery loaded native code"))
    result = vst_api.discover_plugins([tmp_path])
    assert [item["name"] for item in result["plugins"]] == ["Clear", "Voice"]


def test_inspection_only_on_explicit_request(setup, monkeypatch):
    app, slot = setup
    calls = []
    monkeypatch.setattr(vst_host, "inspect_plugin", lambda path, name: calls.append((path, name)) or {"path": path, "plugins": ["One", "Two"]})
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        assert client.get("/api/vst/status").json()["available"]
        assert client.get("/api/vst/plugins").status_code == 200
        assert calls == []
        assert client.post("/api/vst/inspect", json={"path": slot["path"]}).json()["plugins"] == ["One", "Two"]
        assert calls == [(slot["path"], None)]
        assert client.post("/api/vst/inspect", json={"path": slot["path"]}, headers={"Origin": "https://other.example"}).status_code == 403
        assert len(calls) == 1


@pytest.mark.parametrize("changes", [{"duration": 31}, {"duration": 0}, {"start": -1},
                                      {"audioTrack": True}, {"chain": []}, {"start": 1}])
def test_invalid_preview_cannot_start(setup, changes):
    app, slot = setup
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identifier = upload(client)
        response = client.post("/api/vst/previews", json={"mediaId": identifier, "audioTrack": 0, "chain": [slot], **changes})
        assert response.status_code in {400, 422}
        assert app.state.vst_previews._records == {}


@pytest.mark.parametrize("parameter", [float("inf"), float("nan"), None, [], {}, "x" * 1025])
def test_bad_parameter_values_rejected_before_enqueue(setup, parameter):
    import json
    app, slot = setup
    slot["parameters"] = {"reduction": parameter}
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identifier = upload(client)
        response = client.post("/api/vst/previews", content=json.dumps({"mediaId": identifier, "audioTrack": 0, "chain": [slot]}), headers={"Content-Type": "application/json"})
        assert response.status_code == 422
        assert app.state.vst_previews._records == {}


def test_preview_audio_source_timing_cleanup_and_original_preserved(setup, monkeypatch):
    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg required")
    app, slot = setup
    def process(source, destination, chain, cancelled, progress):
        assert chain[0]["path"] == slot["path"]
        shutil.copyfile(source, destination)
        with wave.open(str(source)) as reader:
            assert reader.getnframes() == 36000
            assert reader.getframerate() == 48000
            assert reader.getnchannels() == 2
            return {"inputFrames": 36000, "outputFrames": 36000, "sampleRate": 48000}
    monkeypatch.setattr(vst_host, "process_chain", process)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identifier = upload(client)
        _, original = app.state.storage.get_media(identifier)
        digest = hashlib.sha256(original.read_bytes()).digest()
        response = client.post("/api/vst/previews", json={"mediaId": identifier, "audioTrack": 0, "start": 0.25, "duration": 30, "chain": [slot]})
        assert response.status_code == 202
        record = wait(client, response.json()["id"])
        assert record["status"] == "completed", record
        assert record["duration"] == 0.75
        assert client.get(record["originalUrl"]).content == client.get(record["processedUrl"]).content
        assert client.get(record["originalUrl"], headers={"Range": "bytes=0-15"}).status_code == 206
        assert hashlib.sha256(original.read_bytes()).digest() == digest
        assert client.get(record["originalUrl"].replace("original", "../source")).status_code in {404, 422}
        folder = app.state.vst_previews._session_root
    assert not folder.exists()


def test_worker_failure_is_visible_and_audio_is_not_published(setup, monkeypatch):
    app, slot = setup
    monkeypatch.setattr(vst_api, "_extract_preview", lambda _s, _t, _a, _d, output, _c: output.write_bytes(b"test"))
    def failure(*_args):
        raise vst_host.VSTError("Plugin crashed")
    monkeypatch.setattr(vst_host, "process_chain", failure)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identifier = upload(client)
        result = client.post("/api/vst/previews", json={"mediaId": identifier, "audioTrack": 0, "chain": [slot]}).json()
        record = wait(client, result["id"])
        assert record["status"] == "failed"
        assert record["error"] == "Plugin crashed"
        assert client.get(f"/api/vst/previews/{record['id']}/processed").status_code == 409
        assert not app.state.vst_previews._folder(record["id"]).exists()


def test_preview_cancellation_releases_worker(setup, monkeypatch):
    app, slot = setup
    started = threading.Event()
    monkeypatch.setattr(vst_api, "_extract_preview", lambda _s, _t, _a, _d, output, _c: output.write_bytes(b"test"))
    def processing(_source, _destination, _chain, cancelled, _progress):
        started.set()
        deadline = time.monotonic() + 5
        while not cancelled() and time.monotonic() < deadline:
            time.sleep(0.01)
        raise vst_host.VSTCancelled("Cancelled")
    monkeypatch.setattr(vst_host, "process_chain", processing)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identifier = upload(client)
        record = client.post("/api/vst/previews", json={"mediaId": identifier, "audioTrack": 0, "chain": [slot]}).json()
        assert started.wait(2)
        assert client.delete(f"/api/vst/previews/{record['id']}").status_code == 200
        assert wait(client, record["id"])["status"] == "cancelled"


def test_preprocessing_snapshot_reaches_analysis_worker(setup):
    app, slot = setup
    slot["state"] = base64.b64encode(b"native preset" * 6000).decode("ascii")
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identifier = upload(client)
        response = client.post("/api/jobs", json={"mediaId": identifier, "speakerCount": 2, "audioTrack": 0,
            "preprocessing": {"chain": [slot], "applyTo": "both"}})
        assert response.status_code == 202, response.text
        for _ in range(300):
            record = client.get(f"/api/jobs/{response.json()['id']}").json()
            if record["status"] in {"failed", "completed"}:
                break
            time.sleep(0.01)
        assert record["status"] == "completed", record
        assert record["result"]["seen"] == {"chain": [slot], "applyTo": "both"}


def test_unavailable_runtime_never_silently_ignores_chain(setup, monkeypatch):
    app, slot = setup
    monkeypatch.setattr(vst_api, "runtime_status", lambda: {"available": False, "version": None, "issue": "Missing runtime"})
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identifier = upload(client)
        result = client.post("/api/jobs", json={"mediaId": identifier, "speakerCount": 1, "audioTrack": 0,
                                              "preprocessing": {"chain": [slot]}})
        assert result.status_code == 422
        assert "Missing runtime" in result.text
        assert app.state.jobs._jobs == {}
