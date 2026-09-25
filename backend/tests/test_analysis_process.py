import io
import json
import os
from pathlib import Path
import struct
import sys
import threading
import time

import pytest
from fastapi.testclient import TestClient

from voicesubsep.analysis_ipc import MAX_CONTROL_BYTES, read_frame, send_frame
from voicesubsep.analysis_process import AnalysisProcess, AnalysisWorkerCleanupError, worker_command
from voicesubsep.app import create_app
from voicesubsep.cloud_credentials import ProviderCredentials
from voicesubsep.inference import AnalysisCancelled
from voicesubsep import jobs

FIXTURE = Path(__file__).parent / "fixtures" / "analysis_worker_fixture.py"


def wait_for(check, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(.01)
    pytest.fail("Timed out waiting for the isolated fixture.")


def alive(pid):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes as w
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes, kernel.OpenProcess.restype = [w.DWORD, w.BOOL, w.DWORD], w.HANDLE
        kernel.WaitForSingleObject.argtypes, kernel.WaitForSingleObject.restype = [w.HANDLE, w.DWORD], w.DWORD
        kernel.CloseHandle.argtypes = [w.HANDLE]
        handle = kernel.OpenProcess(0x100000, False, pid)
        if not handle:
            return False
        try:
            return kernel.WaitForSingleObject(handle, 0) == 258
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        stat = Path(f"/proc/{pid}/stat")
        return not stat.exists() or stat.read_text().split()[2] != "Z"
    except ProcessLookupError:
        return False


def fixture_source(tmp_path, mode="complete"):
    source = tmp_path / "source.wav"
    source.write_text(json.dumps({"folder": str(tmp_path), "mode": mode}), encoding="utf-8")
    return source


def launch(source, **extra):
    cancel, force = threading.Event(), threading.Event()
    output, previews, progress = {}, [], []
    runner = AnalysisProcess(command=[sys.executable, str(FIXTURE)])
    def run():
        try:
            output["result"] = runner.run(source, options=extra, track_speakers=None,
                                          progress=lambda *value: progress.append(value), recognition_preview=previews.append,
                                          cancelled=cancel.is_set, force_cancelled=force.is_set)
        except BaseException as exc:
            output["error"] = exc
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread, output, cancel, force, previews, progress, runner


def test_process_transports_unicode_preview_progress_and_final_result(tmp_path):
    source = fixture_source(tmp_path)
    original = source.read_bytes()
    thread, output, _, force, previews, progress, runner = launch(source)
    try:
        thread.join(8)
        assert not thread.is_alive()
        assert "error" not in output, output
        assert output["result"]["captions"][0]["text"] == "안녕하세요 & hello"
        assert previews == ["첫 번째 시험 발언", "second test line"]
        assert progress == [("fixture-working", .5)]
        assert source.read_bytes() == original
        report = json.loads((tmp_path / "started.json").read_text())
        assert not Path(report["temporary"]).exists()
        assert not alive(runner.pid)
    finally:
        force.set(); thread.join(8)


def test_real_numpy_native_import_does_not_deadlock_with_control_pipe_reader(tmp_path):
    pytest.importorskip("numpy")
    thread, output, _, force, _, progress, runner = launch(fixture_source(tmp_path, "native-import"))
    try:
        wait_for(lambda: progress)
        thread.join(8)
        assert not thread.is_alive(), "Native import deadlocked while control stdin was being read."
        assert "result" in output and "error" not in output
        assert not alive(runner.pid)
    finally:
        force.set(); thread.join(8)


def test_force_stop_reaps_uncooperative_native_worker_and_its_child(tmp_path):
    source = fixture_source(tmp_path, "block")
    original = source.read_bytes()
    thread, output, cancel, force, _, progress, runner = launch(source)
    try:
        wait_for(lambda: progress)
        report = json.loads((tmp_path / "started.json").read_text())
        assert alive(runner.pid) and alive(report["child"])
        cancel.set()
        time.sleep(.15)
        assert thread.is_alive()  # A cooperative request cannot interrupt this native fixture.
        started = time.monotonic(); force.set(); thread.join(5)
        assert not thread.is_alive() and time.monotonic() - started < 5
        assert isinstance(output["error"], AnalysisCancelled)
        assert not alive(runner.pid) and not alive(report["child"])
        assert not Path(report["temporary"]).exists()
        assert source.read_bytes() == original
    finally:
        force.set(); thread.join(8)


@pytest.mark.parametrize("mode,exception", [("cooperate", AnalysisCancelled), ("crash", RuntimeError)])
def test_cooperative_cancel_and_worker_crash_release_the_process(tmp_path, mode, exception):
    thread, output, cancel, force, _, progress, runner = launch(fixture_source(tmp_path, mode))
    try:
        wait_for(lambda: progress)
        cancel.set()
        thread.join(8)
        assert not thread.is_alive()
        assert isinstance(output["error"], exception)
        assert not alive(runner.pid)
    finally:
        force.set(); thread.join(8)


def test_key_binding_rechecked_in_parent_before_each_child_request(tmp_path):
    credentials = ProviderCredentials()
    secret = 'fixture-secret-12345'
    credentials.set_provider_key("groq", secret)
    getter = credentials.bind_provider_key("groq")
    thread, output, _, force, _, _, runner = launch(fixture_source(tmp_path, "keys"), get_provider_key=getter)
    try:
        wait_for(lambda: (tmp_path / "first-key").exists())
        credentials.set_provider_key("groq", "replacement-secret-12345")
        (tmp_path / "next-key").write_text("continue")
        thread.join(8)
        assert isinstance(output["error"], RuntimeError)
        assert "removed or replaced" in str(output["error"])
        assert secret not in str(output)
        assert not any(secret in file.read_text(errors="ignore") for file in tmp_path.glob("*"))
        assert not alive(runner.pid)
    finally:
        force.set(); thread.join(8)


def test_fully_completed_result_wins_late_graceful_cancellation(tmp_path):
    thread, output, cancel, force, _, progress, _ = launch(fixture_source(tmp_path, "late-complete"))
    try:
        wait_for(lambda: progress)
        cancel.set(); thread.join(8)
        assert not thread.is_alive()
        assert "result" in output and "error" not in output
    finally:
        force.set(); thread.join(8)


@pytest.mark.parametrize("mode", ["echo", "escaped-echo"])
def test_worker_response_cannot_echo_provider_key(tmp_path, mode):
    secret = 'fixture-escaped-\\secret-"-12345'
    thread, output, _, force, _, _, _ = launch(fixture_source(tmp_path, mode), get_provider_key=lambda: secret)
    try:
        thread.join(8)
        assert "result" not in output and isinstance(output["error"], RuntimeError)
        assert secret not in str(output) and json.dumps(secret)[1:-1] not in str(output)
    finally:
        force.set(); thread.join(8)


def test_frames_reject_oversize_before_read_and_handle_short_writes():
    with pytest.raises(ValueError, match="size limit"):
        read_frame(io.BytesIO(struct.pack("!I", MAX_CONTROL_BYTES + 1)), limit=MAX_CONTROL_BYTES)
    class ShortWriter(io.BytesIO):
        def write(self, data):
            return super().write(data[:3])
    stream = ShortWriter()
    send_frame(stream, {"unicode": "긴 한국어 내용"})
    stream.seek(0)
    assert read_frame(stream) == {"unicode": "긴 한국어 내용"}


def test_frozen_command_and_entry_dispatch_without_server_arguments(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert worker_command() == [sys.executable, "--analysis-worker"]
    from voicesubsep import desktop_server, analysis_worker
    monkeypatch.setattr(sys, "argv", ["server.exe", "--analysis-worker"])
    monkeypatch.setattr(analysis_worker, "main", lambda: 23)
    assert desktop_server.main() == 23


def test_real_worker_module_handles_invalid_source_without_model_access(tmp_path):
    options = dict(audio_track=0, mode="standard", speaker_count=1, whisper_model="tiny", language="auto", device="cpu", diarization=False)
    with pytest.raises(RuntimeError, match="원본 미디어"):
        AnalysisProcess().run(tmp_path / "missing.wav", options=options, track_speakers=None,
                              progress=lambda *_: None, recognition_preview=lambda _: None,
                              cancelled=lambda: False, force_cancelled=lambda: False)


def test_force_stop_interrupts_stalled_pipe_writer_before_worker_reads_request(tmp_path):
    force = threading.Event()
    output = {}
    runner = AnalysisProcess(command=[sys.executable, "-c", "import time; time.sleep(180)"])
    def run():
        try:
            runner.run(tmp_path / "unused.wav", options={"large": "x" * 100_000}, track_speakers=None,
                       progress=lambda *_: None, recognition_preview=lambda _: None,
                       cancelled=lambda: False, force_cancelled=force.is_set)
        except BaseException as exc:
            output["error"] = exc
    thread = threading.Thread(target=run, daemon=True); thread.start()
    try:
        wait_for(lambda: runner.pid)
        time.sleep(.15)
        force.set(); thread.join(5)
        assert not thread.is_alive()
        assert isinstance(output["error"], AnalysisCancelled)
        assert not alive(runner.pid)
        assert not any(t.name in {"analysis-messages", "analysis-commands"} for t in threading.enumerate())
    finally:
        force.set(); thread.join(8)


def test_temp_cleanup_failure_cannot_mask_process_cleanup_failure(tmp_path, monkeypatch):
    from voicesubsep import analysis_process
    original_tree = analysis_process.ProcessTree
    original_directory = analysis_process.tempfile.TemporaryDirectory
    class Tree(original_tree):
        def close(self):
            super().close()
            raise OSError("injected exit confirmation failure")
    class Directory(original_directory):
        def cleanup(self):
            super().cleanup()
            raise PermissionError("injected locked temporary file")
    monkeypatch.setattr(analysis_process, "ProcessTree", Tree)
    monkeypatch.setattr(analysis_process.tempfile, "TemporaryDirectory", Directory)
    thread, output, _, force, _, _, runner = launch(fixture_source(tmp_path))
    try:
        thread.join(8)
        assert isinstance(output["error"], AnalysisWorkerCleanupError)
        assert not alive(runner.pid)
    finally:
        force.set(); thread.join(8)


def probe(_):
    return {"duration": 2, "audioTracks": [{"index": 0, "label": "Audio", "channels": 1}]}


def submit(client, folder, name, mode="complete"):
    folder.mkdir()
    raw = json.dumps({"folder": str(folder), "mode": mode}).encode()
    media = client.post("/api/media", files={"file": (name + ".wav", raw, "audio/wav")}).json()
    response = client.post("/api/jobs", json={"mediaId": media["id"], "projectId": name, "projectName": name,
                           "audioTrack": 0, "speakerCount": 1, "device": "cpu", "diarization": False})
    assert response.status_code == 202, response.text
    return response.json()["id"], media["id"]


def state(client, identifier):
    return client.get(f"/api/jobs/{identifier}").json()


@pytest.fixture
def isolated_api(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "AnalysisProcess", lambda: AnalysisProcess(command=[sys.executable, str(FIXTURE)]))
    app = create_app(data_dir=tmp_path / "data", probe=probe)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        yield client, app


def test_force_prioritize_exact_blocker_then_next_job_runs_server_and_history_survive(tmp_path, isolated_api):
    client, app = isolated_api
    first, source_id = submit(client, tmp_path / "first", "first", "block")
    wait_for(lambda: state(client, first)["stage"] == "native-block")
    assert client.post("/api/live/sessions", json={"device": "cpu"}).status_code == 409
    second, _ = submit(client, tmp_path / "second", "second", "block")
    chosen, _ = submit(client, tmp_path / "chosen", "chosen", "block")
    blocker = state(client, chosen)["queue"]["blockingJob"]
    assert blocker["canForceCancel"] and not blocker["forceCancelRequested"]
    response = client.post(f"/api/jobs/{chosen}/prioritize", json={"cancelRunning": True, "forceRunning": True, "expectedRunningJobId": first})
    assert response.status_code == 200, response.text
    wait_for(lambda: state(client, chosen)["stage"] == "native-block")
    assert state(client, first)["status"] == "cancelled"
    assert "result" not in state(client, first)
    assert state(client, second)["status"] == "queued"
    report = json.loads((tmp_path / "first" / "started.json").read_text())
    assert not alive(report["pid"]) and not alive(report["child"])
    assert client.get("/api/health").status_code == 200
    assert app.state.jobs.storage.get_media(source_id)[1].is_file()
    assert app.state.jobs.storage.job_path(first).exists()
    assert client.post(f"/api/jobs/{chosen}/force-cancel", json={}).status_code == 200
    wait_for(lambda: state(client, second)["stage"] == "native-block")
    client.post(f"/api/jobs/{second}/force-cancel", json={})
    wait_for(lambda: state(client, second)["status"] == "cancelled")


def test_stale_force_priority_request_never_terminates_new_running_job(tmp_path, isolated_api):
    client, _ = isolated_api
    first, _ = submit(client, tmp_path / "first", "first", "block")
    wait_for(lambda: state(client, first)["stage"] == "native-block")
    second, _ = submit(client, tmp_path / "second", "second", "block")
    chosen, _ = submit(client, tmp_path / "chosen", "chosen")
    client.post(f"/api/jobs/{first}/force-cancel", json={})
    wait_for(lambda: state(client, second)["stage"] == "native-block")
    stale = client.post(f"/api/jobs/{chosen}/prioritize", json={"cancelRunning": True, "forceRunning": True, "expectedRunningJobId": first})
    assert stale.status_code == 409
    assert not state(client, second)["cancelRequested"]
    assert client.post(f"/api/jobs/{chosen}/force-cancel", json={}).status_code == 409
    assert client.post(f"/api/jobs/{second}/force-cancel", json={"id": first}).status_code == 422
    assert client.post(f"/api/jobs/{chosen}/prioritize", json={"forceRunning": True}).status_code == 422
    client.post(f"/api/jobs/{second}/force-cancel", json={})
    wait_for(lambda: state(client, chosen)["status"] == "completed")
    completed = state(client, chosen)
    assert not completed["canForceCancel"]
    assert client.post(f"/api/jobs/{chosen}/force-cancel", json={}).json()["result"] == completed["result"]


def test_shutdown_terminates_owned_worker_tree_and_releases_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "AnalysisProcess", lambda: AnalysisProcess(command=[sys.executable, str(FIXTURE)]))
    app = create_app(data_dir=tmp_path / "data", probe=probe)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        first, _ = submit(client, tmp_path / "first", "first", "block")
        wait_for(lambda: state(client, first)["stage"] == "native-block")
        report = json.loads((tmp_path / "first" / "started.json").read_text())
    assert not alive(report["pid"]) and not alive(report["child"])
    assert not app.state.jobs._thread.is_alive()
    with TestClient(create_app(data_dir=tmp_path / "data", probe=probe), base_url="http://127.0.0.1:8787") as client:
        assert state(client, first)["status"] == "cancelled"


def test_cleanup_failure_pauses_queue_and_does_not_start_another_analysis(tmp_path, monkeypatch):
    started, fail = threading.Event(), threading.Event()
    calls = []
    class Runner:
        def run(self, *args, **kwargs):
            calls.append(True); started.set(); assert fail.wait(5)
            raise AnalysisWorkerCleanupError("injected cleanup failure")
    monkeypatch.setattr(jobs, "AnalysisProcess", Runner)
    with TestClient(create_app(data_dir=tmp_path / "data", probe=probe), base_url="http://127.0.0.1:8787") as client:
        try:
            first, _ = submit(client, tmp_path / "first", "first")
            assert started.wait(2)
            second, _ = submit(client, tmp_path / "second", "second")
            fail.set()
            wait_for(lambda: state(client, first)["status"] == "failed")
            assert calls == [True]
            assert state(client, second)["status"] == "queued"
            assert not state(client, second)["queue"]["workerAvailable"]
            client.delete(f"/api/jobs/{second}")
            assert client.post("/api/live/sessions", json={"device": "cpu"}).status_code == 503
        finally:
            fail.set()


def test_result_arriving_after_confirmed_force_stop_is_discarded(tmp_path, monkeypatch):
    started, finish = threading.Event(), threading.Event()
    class Runner:
        def run(self, *args, **kwargs):
            started.set(); assert finish.wait(5)
            return {"captions": [], "speakers": [], "duration": 2, "warnings": []}
    monkeypatch.setattr(jobs, "AnalysisProcess", Runner)
    with TestClient(create_app(data_dir=tmp_path / "data", probe=probe), base_url="http://127.0.0.1:8787") as client:
        try:
            first, _ = submit(client, tmp_path / "first", "first")
            assert started.wait(2)
            response = client.post(f"/api/jobs/{first}/force-cancel", json={})
            assert response.json()["forceCancelRequested"] is True
            finish.set()
            wait_for(lambda: state(client, first)["status"] == "cancelled")
            assert "result" not in state(client, first)
        finally:
            finish.set()
