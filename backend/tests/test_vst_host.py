from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
import subprocess
import sys
import wave

import pytest

from voicesubsep import vst_host as host


@pytest.fixture(autouse=True)
def isolated_vst_lock(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))


def wav(path: Path, frames: int = 3000) -> Path:
    with wave.open(str(path), "wb") as writer:
        writer.setparams((2, 2, 48000, 0, "NONE", "not compressed"))
        writer.writeframes(b"\x01\x00\x02\x00" * frames)
    return path


@pytest.fixture
def plugin(tmp_path):
    path = tmp_path / "Test.vst3"
    path.write_bytes(b"test plugin placeholder; never loaded")
    return str(path)


@pytest.mark.parametrize("value", ["relative.vst3", "https://host/Test.vst3", "\\\\server\\Test.vst3",
                                   "//server/Test.vst3", "C:\\x\x00.vst3", "", 1])
def test_nonlocal_or_invalid_path_rejected(value):
    with pytest.raises(ValueError):
        host.validate_plugin_path(value)


def test_path_requires_existing_vst3_file_or_bundle(tmp_path):
    with pytest.raises(ValueError, match="not installed"):
        host.validate_plugin_path(str(tmp_path / "missing.vst3"))
    bundle = tmp_path / "Bundle.vst3"
    bundle.mkdir()
    assert host.validate_plugin_path(str(bundle)) == str(bundle.resolve())


@pytest.mark.parametrize("change", [
    {"enabled": 1}, {"parameters": {"gain": float("nan")}}, {"parameters": {"gain": float("inf")}},
    {"parameters": {"raw_state": []}}, {"parameters": {"_private": 1}}, {"pluginName": ""},
    {"parameters": {"gain": "x" * 1025}}, {"unexpected": True},
])
def test_chain_rejects_invalid_settings(plugin, change):
    with pytest.raises(ValueError):
        host.validate_chain([{"path": plugin, **change}])


def test_chain_copies_values_and_preserves_order(plugin):
    original = [{"path": plugin, "parameters": {"gain": -12}}, {"path": plugin, "enabled": False}]
    result = host.validate_chain(original)
    result[0]["parameters"]["gain"] = 1
    assert original[0]["parameters"]["gain"] == -12
    assert [entry["enabled"] for entry in result] == [True, False]
    with pytest.raises(ValueError, match="four"):
        host.validate_chain(original * 3)


def test_bypass_uninstalled_effect_is_bit_identical_without_runtime(tmp_path, monkeypatch):
    source, destination = wav(tmp_path / "source.wav"), tmp_path / "output.wav"
    monkeypatch.setattr(host, "_run_worker", lambda *args, **kwargs: pytest.fail("Bypass spawned a worker"))
    report = host.process_chain(source, destination,
                                [{"path": str(tmp_path / "Uninstalled.vst3"), "enabled": False}],
                                lambda: False, lambda *_: None)
    assert source.read_bytes() == destination.read_bytes()
    assert report == {"sampleRate": 48000, "channels": 2, "inputFrames": 3000, "outputFrames": 3000,
                      "plugins": [], "bypassed": True, "warnings": [],
                      "totalReportedLatencySamples": 0, "compensatedLatencySamples": 0}


def test_bypass_cancel_preserves_existing_destination(tmp_path):
    source, destination = wav(tmp_path / "source.wav"), tmp_path / "output.wav"
    destination.write_bytes(b"existing result")
    with pytest.raises(host.VSTCancelled):
        host.process_chain(source, destination, [], lambda: True, lambda *_: None)
    assert destination.read_bytes() == b"existing result"
    assert not list(tmp_path.glob("vst-output-*"))


def test_source_cannot_be_overwritten(tmp_path):
    source = wav(tmp_path / "source.wav")
    with pytest.raises(ValueError, match="preserve"):
        host.process_chain(source, source, [], lambda: False, lambda *_: None)


@pytest.fixture
def fake_worker(monkeypatch):
    monkeypatch.setattr(host, "runtime_available", lambda: True)
    created = []
    original_popen = subprocess.Popen

    def record(*args, **kwargs):
        process = original_popen(*args, **kwargs)
        created.append(process)
        return process

    monkeypatch.setattr(host.subprocess, "Popen", record)

    def configure(code):
        monkeypatch.setattr(host, "_worker_command", lambda request, response:
                            [sys.executable, "-c", code, str(request), str(response)])
        return created
    return configure


def test_crashing_plugin_worker_cannot_crash_host(fake_worker, tmp_path):
    processes = fake_worker("import os; os._exit(37)")
    with pytest.raises(host.VSTError, match="exit 37"):
        host._run_worker({}, timeout=2, cancelled=lambda: False, directory=tmp_path)
    assert processes[0].poll() == 37
    assert not list(tmp_path.glob("vst-worker-*"))


def test_timeout_terminates_and_reaps_owned_worker(fake_worker, tmp_path):
    processes = fake_worker("import time; time.sleep(60)")
    with pytest.raises(host.VSTError, match="timed out"):
        host._run_worker({}, timeout=0.1, cancelled=lambda: False, directory=tmp_path)
    assert processes[0].poll() is not None


def test_cancel_terminates_and_reaps_owned_worker(fake_worker, tmp_path):
    processes = fake_worker("import time; time.sleep(60)")
    calls = 0

    def cancelled():
        nonlocal calls
        calls += 1
        return calls > 4

    with pytest.raises(host.VSTCancelled):
        host._run_worker({}, timeout=5, cancelled=cancelled, directory=tmp_path)
    assert processes and processes[0].poll() is not None


def test_editor_close_marker_returns_result_without_three_minute_stall(monkeypatch, plugin):
    captured = {}
    def worker(request, **kwargs):
        captured.update(kwargs)
        assert request["operation"] == "editor" and request["effect"]["state"] == "YWJj"
        return {"state": "YWJj"}
    monkeypatch.setattr(host, "_run_worker", worker)
    close = lambda: False
    assert host.edit_plugin({"path": plugin, "state": "YWJj"}, close_requested=close) == {"state": "YWJj"}
    assert captured["timeout"] == captured["stall_timeout"] == 1800
    assert captured["close_requested"] is close


def test_editor_owned_worker_gracefully_closes_and_removes_private_state(fake_worker, tmp_path):
    code = """import json,sys,time
from pathlib import Path
request=json.loads(Path(sys.argv[1]).read_text())
while not Path(request['startPath']).exists(): time.sleep(.01)
while not Path(request['closePath']).exists(): time.sleep(.01)
Path(sys.argv[2]).write_text(json.dumps({'ok':True,'result':{'state':'YWJj'}}))
"""
    processes = fake_worker(code)
    result = host._run_worker({"operation": "editor"}, timeout=3, cancelled=lambda: False,
                              close_requested=lambda: True, directory=tmp_path)
    assert result == {"state": "YWJj"} and processes[0].returncode == 0
    assert not list(tmp_path.glob("vst-worker-*"))


def test_editor_cancel_reaps_worker_even_when_native_editor_ignores_close(fake_worker, tmp_path):
    import time
    processes = fake_worker("import time; time.sleep(60)")
    start = time.monotonic()
    with pytest.raises(host.VSTCancelled):
        host._run_worker({"operation": "editor"}, timeout=3, cancelled=lambda: time.monotonic() - start > .3,
                         close_requested=lambda: False, directory=tmp_path)
    assert processes[0].poll() is not None
    assert not list(tmp_path.glob("vst-worker-*"))


def test_editor_open_timeout_reaps_worker_before_full_edit_session(fake_worker, tmp_path):
    processes = fake_worker("import time; time.sleep(60)")
    with pytest.raises(host.VSTError, match="window did not open"):
        host._run_worker({"operation": "editor"}, timeout=30, cancelled=lambda: False,
                         close_requested=lambda: False, open_timeout=.2, directory=tmp_path)
    assert processes[0].poll() is not None


def test_editor_close_timeout_never_returns_partial_settings(fake_worker, tmp_path):
    processes = fake_worker("import time; time.sleep(60)")
    with pytest.raises(host.VSTError, match="unsaved changes were not applied"):
        host._run_worker({"operation": "editor"}, timeout=30, cancelled=lambda: False,
                         close_requested=lambda: True, close_timeout=.2, directory=tmp_path)
    assert processes[0].poll() is not None


def test_visible_editor_survives_open_deadline_and_focus_reuses_worker(fake_worker, tmp_path):
    code = """import json,sys,time
from pathlib import Path
r=json.loads(Path(sys.argv[1]).read_text())
while not Path(r['startPath']).exists(): time.sleep(.01)
Path(r['progressPath']).write_text(json.dumps({'stage':'open','fraction':1.0}))
while not Path(r['focusPath']).exists(): time.sleep(.01)
time.sleep(.5)
Path(sys.argv[2]).write_text(json.dumps({'ok':True,'result':{'focused':True}}))
"""
    processes = fake_worker(code)
    result = host._run_worker({'operation':'editor'}, timeout=3, cancelled=lambda:False,
        close_requested=lambda:False, focus_requested=lambda:True, open_timeout=.4, directory=tmp_path)
    assert result == {'focused':True} and len(processes) == 1


def test_native_stdout_does_not_corrupt_file_protocol(fake_worker):
    fake_worker("import json,sys; print('NATIVE NOISE'); print('error noise',file=sys.stderr); "
                "open(sys.argv[2],'w').write(json.dumps({'ok':True,'result':{'value':3}}))")
    assert host._run_worker({}, timeout=5, cancelled=lambda: False) == {"value": 3}


@pytest.mark.parametrize("body", ["'{'", "'[]'", "'{\"ok\": true, \"result\": NaN}'", "'x'*600000"])
def test_invalid_worker_protocol_rejected(fake_worker, body):
    fake_worker(f"import sys; open(sys.argv[2],'w').write({body})")
    with pytest.raises(host.VSTError):
        host._run_worker({}, timeout=5, cancelled=lambda: False)


def test_worker_busy_never_starts_second_native_process(fake_worker):
    processes = fake_worker("import time; time.sleep(60)")
    assert host._WORKER_LOCK.acquire(blocking=False)
    try:
        with pytest.raises(host.VSTError, match="Another VST"):
            host._run_worker({}, timeout=1, cancelled=lambda: False)
    finally:
        host._WORKER_LOCK.release()
    assert not processes


def test_os_lock_busy_is_a_vst_error_and_releases_thread_lock(monkeypatch):
    @contextmanager
    def unavailable():
        raise RuntimeError("Another VST operation is running. Wait for it to finish or cancel it first.")
        yield
    monkeypatch.setattr(host,"vst_process_lock",unavailable)
    monkeypatch.setattr(host,"_run_worker_locked",lambda *args,**kwargs:pytest.fail("A busy OS slot cannot spawn a worker"))
    with pytest.raises(host.VSTError,match="Another VST operation"):
        host._run_worker({},timeout=1,cancelled=lambda:False)
    assert host._WORKER_LOCK.acquire(blocking=False)
    host._WORKER_LOCK.release()


def test_failed_sample_count_does_not_replace_existing_output(tmp_path, plugin, monkeypatch):
    source, destination = wav(tmp_path / "source.wav"), tmp_path / "output.wav"
    destination.write_bytes(b"previous")

    def wrong_count(request, **kwargs):
        Path(request["destination"]).write_bytes(b"invalid")
        return {"inputFrames": 100, "outputFrames": 99, "sampleRate": 48000}

    monkeypatch.setattr(host, "_run_worker", wrong_count)
    with pytest.raises(host.VSTError, match="duration"):
        host.process_chain(source, destination, [{"path": plugin}], lambda: False, lambda *_: None)
    assert destination.read_bytes() == b"previous"


def test_frozen_worker_command_dispatch(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert host._worker_command(tmp_path / "in", tmp_path / "out")[1:] == [
        "--vst-worker", "--request", str(tmp_path / "in"), "--response", str(tmp_path / "out")]


def test_stall_timeout_terminates_worker_despite_long_total_timeout(fake_worker):
    processes = fake_worker("import time; time.sleep(60)")
    with pytest.raises(host.VSTError, match="timed out"):
        host._run_worker({}, timeout=60, stall_timeout=0.1, cancelled=lambda: False)
    assert processes[0].poll() is not None
