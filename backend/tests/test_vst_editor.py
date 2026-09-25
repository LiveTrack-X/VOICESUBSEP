from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import threading
import time
from types import SimpleNamespace
import wave

from fastapi.testclient import TestClient
import pytest

from voicesubsep import vst_api, vst_host, vst_worker
from voicesubsep.app import create_app
from voicesubsep.vst_editor import EditorManager
from voicesubsep.vst_state import MAX_STATE_BYTES, decode_plugin_state, encode_plugin_state


@pytest.fixture
def slot(tmp_path):
    plugin = tmp_path / "Editor.vst3"
    plugin.write_bytes(b"placeholder; no real plugin code")
    return {"path": str(plugin), "enabled": True, "parameters": {}}


def wait(manager, identifier):
    end = time.monotonic() + 3
    while time.monotonic() < end:
        state = manager.get(identifier)
        if state["status"] in {"completed", "failed", "cancelled"}:
            return state
        time.sleep(.005)
    pytest.fail("Synthetic editor failed to settle")


@pytest.mark.parametrize("value", [None, 1, [], "YQ", "YQ===", "YR==", "YQ==\n", "-_==", "日本語", "x" * (350000)],
                         ids=["null", "number", "list", "missing-padding", "excess-padding", "noncanonical-bits", "newline", "urlsafe", "unicode", "oversized"])
def test_raw_state_requires_bounded_canonical_base64(value):
    with pytest.raises(ValueError, match="canonical base64"):
        decode_plugin_state(value)


def test_raw_state_size_exact_boundary_and_chain_copy(slot):
    for raw in [b"", b"\0opaque native state\xff", b"x" * MAX_STATE_BYTES]:
        encoded = encode_plugin_state(raw)
        assert decode_plugin_state(encoded) == raw
        assert vst_host.validate_chain([{**slot, "state": encoded}])[0]["state"] == encoded
        assert vst_api.VstSlot(**slot, state=encoded).state == encoded
    with pytest.raises(ValueError):
        decode_plugin_state(base64.b64encode(b"x" * (MAX_STATE_BYTES + 1)).decode())
    with pytest.raises(ValueError):
        vst_api.VstSlot(**slot, state=None)


class StatefulPlugin:
    name = "Synthetic"
    parameters = {"program": SimpleNamespace(type=str, valid_values=["Default", "Preset"]),
                  "gain": SimpleNamespace(type=float, min_value=-24, max_value=24)}

    def __init__(self):
        self._program, self._gain, self.hidden = "Default", 0., "default"
        self.writes = []

    @property
    def raw_state(self):
        return json.dumps([self._program, self._gain, self.hidden]).encode()

    @raw_state.setter
    def raw_state(self, raw):
        self.writes.append("state")
        self._program, self._gain, self.hidden = json.loads(raw)

    @property
    def program(self):
        return self._program

    @program.setter
    def program(self, value):
        self.writes.append("program")
        self._program, self._gain, self.hidden = value, 0., "RESET"

    @property
    def gain(self):
        return self._gain

    @gain.setter
    def gain(self, value):
        self.writes.append("gain")
        self._gain = value


def test_state_applies_before_changed_parameters_without_unchanged_program_reset():
    plugin = StatefulPlugin()
    state = encode_plugin_state(json.dumps(["Preset", -12., "hidden denoising profile"]).encode())
    result = vst_worker._apply_effect(plugin, {"state": state, "parameters": {"program": "Preset", "gain": -12}})
    assert result == {"program": "Preset", "gain": -12}
    assert plugin.writes == ["state"]
    assert plugin.hidden == "hidden denoising profile"
    vst_worker._apply_effect(plugin, {"state": state, "parameters": {"program": "Default", "gain": -8}})
    assert plugin.writes[-3:] == ["state", "program", "gain"]
    assert plugin.gain == -8


def test_editor_uses_main_thread_and_captures_gui_state_after_graceful_close(slot, tmp_path, monkeypatch):
    plugin = StatefulPlugin()
    marker = tmp_path / "close-editor"
    closed = threading.Event()
    def show_editor(*, close_event):
        assert threading.current_thread() is threading.main_thread()
        marker.touch()
        assert close_event.wait(1)
        plugin.gain, plugin.hidden = -7., "GUI profile"
        closed.set()
    plugin.show_editor = show_editor
    monkeypatch.setattr(vst_worker, "_load_effect", lambda *_: plugin)
    monkeypatch.setattr(vst_worker, "_pedalboard", lambda: SimpleNamespace(VST3Plugin=SimpleNamespace(
        get_plugin_names_for_file=lambda _: ["Synthetic"])))
    result = vst_worker.edit(slot, marker)
    assert closed.is_set() and result["pluginName"] == "Synthetic"
    restored = StatefulPlugin()
    vst_worker._apply_effect(restored, {"state": result["state"],
        "parameters": {item["key"]: item["value"] for item in result["parameters"]}})
    assert restored.gain == -7 and restored.hidden == "GUI profile"
    assert restored.writes == ["state"]


def test_window_placement_cannot_block_explicit_editor_close(slot, tmp_path, monkeypatch):
    from voicesubsep import vst_window
    plugin = StatefulPlugin()
    marker = tmp_path / "close-editor"
    entered, release = threading.Event(), threading.Event()
    def blocked_placement(_):
        entered.set()
        release.wait(3)
        return True
    def show_editor(*, close_event):
        assert entered.wait(1)
        marker.touch()
        assert close_event.wait(1), "Placement must not monopolize the close watcher"
    plugin.show_editor = show_editor
    monkeypatch.setattr(vst_window, "position_editor", blocked_placement)
    monkeypatch.setattr(vst_worker, "_load_effect", lambda *_: plugin)
    monkeypatch.setattr(vst_worker, "_pedalboard", lambda: SimpleNamespace(VST3Plugin=SimpleNamespace(
        get_plugin_names_for_file=lambda _: ["Synthetic"])))
    try:
        assert vst_worker.edit(slot, marker)["pluginName"] == "Synthetic"
    finally:
        release.set()


def test_worker_error_does_not_echo_opaque_state(slot, tmp_path, monkeypatch):
    state = encode_plugin_state(b"private native preset information")
    request, response = tmp_path / "request.json", tmp_path / "response.json"
    start = tmp_path / "start-editor"
    start.touch()
    request.write_text(json.dumps({"operation": "editor", "effect": {**slot, "state": state},
        "progressPath": str(tmp_path / "progress.json"), "startPath": str(start), "closePath": str(tmp_path / "close-editor")}))
    def failure(*_):
        raise ValueError(state)
    monkeypatch.setattr(vst_worker, "edit", failure)
    assert vst_worker.main(["--request", str(request), "--response", str(response)]) == 1
    output = response.read_text()
    assert state not in output and "private native preset" not in output
    assert json.loads(output)["ok"] is False


def test_saved_native_state_affects_processed_samples_and_preserves_source(slot, tmp_path, monkeypatch):
    pytest.importorskip("pedalboard.io")
    class GainPlugin(StatefulPlugin):
        reported_latency_samples = 0
        def reset(self):
            pass
        def __call__(self, audio, *_args, **_kwargs):
            return audio * self.gain
    plugin = GainPlugin()
    monkeypatch.setattr(vst_worker, "_load_effect", lambda *_: plugin)
    monkeypatch.setattr(vst_worker, "_pedalboard", lambda: SimpleNamespace(Pedalboard=lambda plugins: plugins[0]))
    source, destination = tmp_path / "original.wav", tmp_path / "processed.wav"
    with wave.open(str(source), "wb") as writer:
        writer.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
        writer.writeframes((1000).to_bytes(2, "little", signed=True) * 9600)
    before = source.read_bytes()
    state = encode_plugin_state(json.dumps(["Preset", .5, "private profile"]).encode())
    report = vst_worker.process(source, destination, [{**slot, "state": state,
        "parameters": {"program": "Preset", "gain": .5}}], lambda *_: None)
    assert plugin.writes == ["state"]
    assert source.read_bytes() == before
    with wave.open(str(destination), "rb") as reader:
        assert reader.getnframes() == 9600
        assert reader.readframes(9600) == (500).to_bytes(2, "little", signed=True) * 9600
    assert report["inputFrames"] == report["outputFrames"] == 9600
    assert state not in json.dumps(report) and "private profile" not in json.dumps(report)


def test_manager_bounds_cancel_discards_result_and_stale_close_cannot_affect_new_editor(slot):
    entered, returned = threading.Event(), threading.Event()
    calls = []
    def editor(effect, *, cancelled, close_requested):
        calls.append(effect)
        entered.set()
        end = time.monotonic() + 3
        while not cancelled() and not close_requested() and time.monotonic() < end:
            time.sleep(.005)
        returned.set()
        return {"state": "c2Vuc2l0aXZl", "parameters": []}
    manager = EditorManager(editor=editor)
    manager.start()
    try:
        first = manager.submit(slot)["id"]
        assert entered.wait(1)
        with pytest.raises(OverflowError):
            manager.submit(slot)
        assert manager.cancel(first)["cancelRequested"]
        assert wait(manager, first)["status"] == "cancelled"
        assert "result" not in manager.get(first)
        returned.clear()
        second = manager.submit(slot)["id"]
        manager.close(first)
        assert not returned.wait(.05)
        assert manager.close(second)["closeRequested"]
        assert wait(manager, second)["status"] == "completed"
        saved = manager.get(second)
        saved["result"]["parameters"].append("mutate")
        assert manager.get(second)["result"]["parameters"] == []
        manager.cancel(second)
        assert manager.get(second)["status"] == "completed"
    finally:
        manager.stop()


def test_manager_shutdown_waits_for_cancel_and_never_publishes_result(slot):
    entered = threading.Event()
    def editor(_effect, *, cancelled, close_requested):
        entered.set()
        while not cancelled():
            time.sleep(.005)
        raise vst_host.VSTCancelled("cancelled")
    manager = EditorManager(editor=editor)
    manager.start()
    identifier = manager.submit(slot)["id"]
    assert entered.wait(1)
    manager.stop()
    assert manager.get(identifier)["status"] == "cancelled"
    assert not manager._thread.is_alive()
    with pytest.raises(RuntimeError):
        manager.submit(slot)


def test_manager_retains_at_most_sixteen_terminal_snapshots(slot):
    manager = EditorManager(editor=lambda *_args, **_kwargs: {"parameters": []})
    manager.start()
    try:
        ids = []
        for _ in range(18):
            identifier = manager.submit(slot)["id"]
            ids.append(identifier)
            assert wait(manager, identifier)["status"] == "completed"
        assert len(manager._records) == len(manager._close) == len(manager._cancel) == 16
        with pytest.raises(KeyError):
            manager.close(ids[0])
    finally:
        manager.stop()


def test_api_state_bounds_origin_validation_and_lifecycle(slot, tmp_path, monkeypatch):
    monkeypatch.setattr(vst_api, "runtime_status", lambda: {"available": True, "version": "0.9.25", "issue": None})
    app = create_app(data_dir=tmp_path / "data", analyzer=lambda *_args, **_kwargs: {})
    def editor(effect, **_):
        return {"path": effect["path"], "parameters": [], "state": effect.get("state", "")}
    app.state.vst_editors._editor = editor
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        state = encode_plugin_state(b"x" * MAX_STATE_BYTES)
        response = client.post("/api/vst/editors", json={**slot, "state": state})
        assert response.status_code == 202
        identifier = response.json()["id"]
        assert wait(app.state.vst_editors, identifier)["result"]["state"] == state
        assert client.get(f"/api/vst/editors/{identifier}").status_code == 200
        assert client.post(f"/api/vst/editors/{identifier}/close", json={}).status_code == 200
        assert client.post(f"/api/vst/editors/{identifier}/close", json={"path": slot["path"]}).status_code == 422
        assert client.delete(f"/api/vst/editors/{identifier}").status_code == 200
        for invalid in ["not-base64", "YR==", None, encode_plugin_state(b"x" * MAX_STATE_BYTES) + "AAAA"]:
            rejected = client.post("/api/vst/editors", json={**slot, "state": invalid})
            assert rejected.status_code == 422
            assert "input" not in rejected.text and "not-base64" not in rejected.text
        assert client.post("/api/vst/editors", json=slot, headers={"Origin": "https://other.example"}).status_code == 403
        assert client.post("/api/vst/editors", content=b" " * (2 * 1024**2 + 1), headers={"Content-Type": "application/json"}).status_code == 413
        assert client.post("/api/vst/inspect", content=b" " * (64 * 1024 + 1), headers={"Content-Type": "application/json"}).status_code == 413
        assert client.get("/api/vst/editors/" + "a" * 32).status_code == 404
    assert app.state.vst_editors._stopping


def test_atomic_progress_publish_retries_transient_windows_lock(tmp_path, monkeypatch):
    target = tmp_path / "progress.json"
    target.write_text('{"old":true}')
    original = vst_worker.os.replace
    attempts = []
    def flaky(source, destination):
        attempts.append(1)
        if len(attempts) <= 2:
            raise PermissionError(13, "synthetic Windows reader lock")
        original(source, destination)
    monkeypatch.setattr(vst_worker.os, "replace", flaky)
    monkeypatch.setattr(vst_worker.time, "sleep", lambda _: None)
    assert vst_worker._write_json(target, {"fraction": .4}, best_effort=True)
    assert len(attempts) == 3 and json.loads(target.read_text()) == {"fraction": .4}
    assert not target.with_suffix(".json.tmp").exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows delete-denying file handles")
def test_real_windows_reader_lock_skips_progress_then_recovers_without_losing_previous(tmp_path):
    path = tmp_path / "progress.json"
    path.write_text('{"fraction":0.1}')
    with path.open("r") as previous:
        assert not vst_worker._write_json(path, {"fraction": .7}, best_effort=True)
        assert json.load(previous) == {"fraction": .1}
    assert vst_worker._write_json(path, {"fraction": .7}, best_effort=True)
    assert vst_host._read_json(path) == {"fraction": .7}


def test_sustained_progress_lock_is_nonfatal_but_final_response_lock_fails(tmp_path, monkeypatch):
    target = tmp_path / "progress.json"
    target.write_text('{"previous":true}')
    def locked(*_):
        raise PermissionError(13, "synthetic Windows reader lock")
    monkeypatch.setattr(vst_worker.os, "replace", locked)
    monkeypatch.setattr(vst_worker.time, "sleep", lambda _: None)
    assert not vst_worker._write_json(target, {"fraction": .7}, best_effort=True)
    assert json.loads(target.read_text()) == {"previous": True}
    with pytest.raises(RuntimeError, match="Windows kept the result file locked"):
        vst_worker._write_json(tmp_path / "response.json", {"ok": True})
    assert not list(tmp_path.glob("*.tmp"))
