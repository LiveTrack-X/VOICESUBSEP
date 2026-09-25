import json
from pathlib import Path
import threading
import time

from fastapi.testclient import TestClient
import pytest

from voicesubsep.app import create_app
from voicesubsep.inference import AnalysisCancelled
from voicesubsep.multitrack import analyze_tracks


def probe(_):
    return {"duration": 4.0, "audioTracks": [{"index": i, "label": f"Track {i}", "channels": 1} for i in (1, 2)],
            "hasVideo": True, "videoStream": 0, "frameRate": 60, "frameRateFraction": "60"}


def client(root, **kwargs):
    return TestClient(create_app(data_dir=root, probe=probe, **kwargs), base_url="http://127.0.0.1:8787")


def upload(c, content=b"recording", name="recording.mkv"):
    response = c.post("/api/media", files={"file": (name, content, "video/x-matroska")})
    assert response.status_code == 201, response.text
    return response.json()


def wait(c, path):
    for _ in range(100):
        value = c.get(path).json()
        if value["status"] not in {"queued", "running"}:
            return value
        time.sleep(.01)
    pytest.fail("Job did not finish")


def test_identical_uploads_reused_across_dialogs_names_and_server_restart(tmp_path):
    with client(tmp_path) as c:
        first = upload(c)
        assert upload(c, name="renamed.mkv")["id"] == first["id"]
        assert upload(c, b"different")["id"] != first["id"]
        assert len(c.get("/api/cache").json()["items"]) == 2
    with client(tmp_path) as c:
        assert upload(c)["id"] == first["id"]
        assert c.get(f"/api/media/{first['id']}").json()["sha256"] == first["sha256"]
    assert len(list((tmp_path / "media").glob("*/source.mkv"))) == 2


def test_changed_cached_bytes_never_inherit_old_hash(tmp_path):
    with client(tmp_path) as c:
        first = upload(c)
        (tmp_path / "media" / first["id"] / "source.mkv").write_bytes(b"changed!!")
        assert upload(c)["id"] != first["id"]


def test_bulk_cache_endpoint_preserves_completed_results_and_rejects_invalid_snapshot(tmp_path):
    def analyzer(*args, **kwargs):
        return {"captions": [], "speakers": [], "duration": 4, "warnings": []}
    with client(tmp_path, analyzer=analyzer) as c:
        retained = upload(c, b"retained")
        unused = upload(c, b"unused")
        job = c.post("/api/jobs", json={"mediaId": retained["id"], "audioTrack": 1, "speakerCount": 2}).json()["id"]
        assert wait(c, f"/api/jobs/{job}")["status"] == "completed"
        before = c.get(f"/api/jobs/{job}").json()
        assert c.post("/api/cache/cleanup", json={"mediaIds": [unused["id"], "../jobs"]}).status_code == 422
        assert c.get(f"/api/media/{unused['id']}").status_code == 200
        result = c.post("/api/cache/cleanup", json={"mediaIds": [retained["id"], unused["id"]]})
        assert result.status_code == 200
        assert result.json() == {"removedCount": 1, "removedBytes": 6, "skippedCount": 1, "failedCount": 0}
        assert c.get(f"/api/jobs/{job}").json() == before
        assert c.get(f"/api/media/{retained['id']}").status_code == 200
        assert c.get(f"/api/media/{unused['id']}").status_code == 404


def test_legacy_cache_without_hash_is_verified_and_reused(tmp_path):
    with client(tmp_path) as c:
        first = upload(c)
        path = tmp_path / "media" / first["id"] / "metadata.json"
        value = json.loads(path.read_text())
        value.pop("sha256"); value.pop("fileSignature")
        path.write_text(json.dumps(value), encoding="utf-8")
        assert upload(c)["id"] == first["id"]
        assert json.loads(path.read_text())["sha256"] == first["sha256"]


def test_cache_cleanup_protects_running_and_completed_job_until_explicit_history_removal(tmp_path):
    started, release = threading.Event(), threading.Event()
    def analyzer(*args, **kwargs):
        started.set(); assert release.wait(3)
        return {"captions": [], "speakers": [], "duration": 4, "warnings": []}
    with client(tmp_path, analyzer=analyzer) as c:
        media = upload(c)
        response = c.post("/api/jobs", json={"mediaId": media["id"], "audioTrack": 1, "speakerCount": 2,
                                           "projectId": "project-1", "projectName": "QA"})
        job = response.json()["id"]
        assert started.wait(2)
        assert c.delete(f"/api/media/{media['id']}").status_code == 409
        assert c.delete(f"/api/history/analysis/{job}").status_code == 409
        release.set()
        assert wait(c, f"/api/jobs/{job}")["status"] == "completed"
        assert c.delete(f"/api/media/{media['id']}").status_code == 409
        history = c.get("/api/history").json()["items"]
        assert history[0]["projectId"] == "project-1" and history[0]["mediaId"] == media["id"]
        assert c.delete(f"/api/history/analysis/{job}").status_code == 200
        assert c.delete(f"/api/media/{media['id']}").status_code == 200
        assert c.get(f"/api/media/{media['id']}").status_code == 404


def test_render_snapshot_retained_and_history_deleted_only_explicitly(tmp_path):
    def renderer(source, destination, **kwargs):
        destination.write_bytes(b"output")
        assert kwargs["frame_rate"] == "60"
        return {"duration": 4, "keepRanges": [{"start": 0, "end": 4}], "warnings": []}
    snapshot = {"schemaVersion": 2, "captions": [{"id": "old", "text": "original revision"}], "notes": []}
    with client(tmp_path, renderer=renderer) as c:
        media = upload(c)
        response = c.post("/api/renders", json={"mediaId": media["id"], "audioTrack": 1, "format": "mp4",
            "keepRanges": [{"start": 0, "end": 4}], "frameRate": "60", "projectSnapshot": snapshot,
            "projectId": "p1", "projectName": "P1"})
        assert response.status_code == 202, response.text
        job = response.json()["id"]
        assert wait(c, f"/api/renders/{job}")["status"] == "completed"
        stored=json.loads((tmp_path/"renders"/job/"job.json").read_text(encoding="utf-8"))
        assert "projectSnapshot" not in stored["request"] and stored["request"]["hasSnapshot"] is True
    with client(tmp_path) as c:
        assert c.get(f"/api/renders/{job}/snapshot").json()["project"] == snapshot
        assert c.get("/api/history").json()["items"][0]["hasResult"]
        assert c.delete(f"/api/media/{media['id']}").status_code == 409
        assert c.delete(f"/api/history/render/{job}").status_code == 200
        assert not (tmp_path / "renders" / job).exists()
        assert c.delete(f"/api/media/{media['id']}").status_code == 200


def test_tracks_use_sequential_asr_explicit_identity_and_keep_overlapping_source_times(tmp_path):
    seen = []
    def analyzer(path, **kwargs):
        seen.append(kwargs)
        return {"duration": 4, "speakers": [], "warnings": [], "captions": [
            {"id": "caption-1", "start": 1, "end": 2, "text": f"track {kwargs['audio_track']}",
             "speakerId": None, "reasons": ["unassigned", "timing"], "reviewed": False}]}
    with client(tmp_path, analyzer=analyzer) as c:
        media = upload(c)
        request = {"mediaId": media["id"], "audioTrack": 1, "speakerCount": 2, "trackSpeakers": [
            {"audioTrack": 2, "speakerId": "b", "name": "B", "color": "#0000ff"},
            {"audioTrack": 1, "speakerId": "a", "name": "A", "color": "#ff0000"}]}
        response = c.post("/api/jobs", json=request)
        assert response.status_code == 202, response.text
        done = wait(c, f"/api/jobs/{response.json()['id']}")
        assert done["status"] == "completed", done
        result = done["result"]
        assert [item["audio_track"] for item in seen] == [2, 1]
        assert all(item["diarization"] is False for item in seen)
        assert {item["speakerId"] for item in result["captions"]} == {"a", "b"}
        assert all(item["start"] == 1 and item["end"] == 2 and item["reasons"] == ["timing"] for item in result["captions"])
        request["trackSpeakers"][1]["audioTrack"] = 2
        assert c.post("/api/jobs", json=request).status_code == 422


def test_multitrack_cancellation_discards_partial_result_and_does_not_start_next_track():
    stop = threading.Event(); calls = []
    def analyzer(*args, **kwargs):
        calls.append(kwargs["audio_track"]); stop.set()
        return {"duration": 1, "captions": [], "warnings": []}
    selection = {"audioTrack": 1, "speakerId": "a", "name": "A", "color": "#ff0000"}
    with pytest.raises(AnalysisCancelled):
        analyze_tracks(analyzer, Path("unused"), selections=[selection, {**selection, "audioTrack": 2}],
                       options={}, progress=lambda *args: None, cancelled=stop.is_set)
    assert calls == [1]
