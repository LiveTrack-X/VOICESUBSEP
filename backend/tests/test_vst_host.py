from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import wave

import pytest

from voicesubsep import vst_host as host


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
