"""The packaging gate must fail closed without launching a server or model."""

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


@pytest.fixture
def gate(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[2] / "scripts" / "bundled-runtime-check.py"
    spec = importlib.util.spec_from_file_location("bundled_runtime_check", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    executable = tmp_path / "never-executed.exe"
    executable.write_bytes(b"fake")
    args = SimpleNamespace(executable=executable, web_dir=None, expected_version="0.1.1",
                           output=tmp_path / "report.json")
    process = SimpleNamespace(pid=7654321, returncode=None, poll=lambda: None)
    state = SimpleNamespace(
        module=module, args=args, process=process, spawned=None, routes=[], version="0.1.1",
        ready={"app": "voicesubsep", "status": "ok"},
        health={"app": "voicesubsep", "status": "ok", "engines": {"whisper": True, "nemotron": True},
                "ffmpeg": True, "ffprobe": True, "gpu": {"available": False}},
        cleanup={"requested": True, "clean": True, "forced": False, "exitCode": 0, "portClosed": True},
    )

    def request(port, method, route, **kwargs):
        assert port == 45678 and method == "GET"
        state.routes.append(route)
        if route == "/api/ready":
            assert 0 < kwargs["timeout"] <= 5
            return state.ready
        if route == "/api/health":
            assert kwargs["timeout"] == 120
            return state.health
        assert route == "/openapi.json", "Gate must never create uploads or model jobs"
        return {"info": {"version": state.version}}

    def spawn(argv, **kwargs):
        cwd = Path(kwargs["cwd"])
        assert cwd != module.ROOT
        assert Path(argv[argv.index("--data-dir") + 1]) == cwd / "data"
        web = Path(argv[argv.index("--web-dir") + 1])
        assert web == (args.web_dir if args.web_dir is not None else cwd / "web")
        assert (web / "index.html").is_file()
        assert kwargs["env"]["PATH"] == "SYSTEM_ONLY"
        assert kwargs["env"]["HF_HUB_OFFLINE"] == "1"
        assert kwargs["env"]["TRANSFORMERS_OFFLINE"] == "1"
        assert kwargs["env"]["HTTPS_PROXY"] == "http://127.0.0.1:9"
        assert kwargs["env"]["NO_PROXY"] == "127.0.0.1,localhost"
        assert "https_proxy" not in kwargs["env"]
        assert kwargs["shell"] is False
        assert kwargs["creationflags"] == 3
        state.spawned = kwargs
        return process

    monkeypatch.setattr(module.sys, "platform", "win32")
    monkeypatch.setattr(module.subprocess, "CREATE_NO_WINDOW", 1, raising=False)
    monkeypatch.setattr(module.subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 2, raising=False)
    monkeypatch.setattr(module, "isolated_environment", lambda token: {
        "PATH": "SYSTEM_ONLY", "VOICESUBSEP_DESKTOP_TOKEN": token,
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "https_proxy": "inherited-proxy",
    })
    monkeypatch.setattr(module, "unused_loopback_port", lambda: 45678)
    monkeypatch.setattr(module, "request_json", request)
    state.popen = Mock(side_effect=spawn)
    state.stop = Mock(side_effect=lambda *args: state.cleanup.copy())
    monkeypatch.setattr(module.subprocess, "Popen", state.popen)
    monkeypatch.setattr(module, "stop_owned_process", state.stop)
    return state


def run_gate(gate):
    report = gate.module.run(gate.args)
    if gate.spawned:
        gate.stop.assert_called_once_with(gate.process, 45678,
            gate.spawned["env"]["VOICESUBSEP_DESKTOP_TOKEN"],
            gate.ready.get("app") == "voicesubsep" and gate.ready.get("status") == "ok",
            gate.spawned["env"])
        assert not Path(gate.spawned["cwd"]).exists()
    else:
        gate.popen.assert_not_called()
        gate.stop.assert_not_called()
    return report


def test_runtime_gate_passes_without_gpu_or_frontend_build(gate):
    report = run_gate(gate)
    assert report["passed"] and report["runtimePassed"] and report["shutdown"]["clean"]
    assert report["inferenceRun"] is False and report["gpuRequired"] is False
    assert gate.routes == ["/api/ready", "/api/health", "/openapi.json"]


@pytest.mark.parametrize("component", ["whisper", "nemotron", "ffmpeg", "ffprobe"])
def test_runtime_gate_rejects_missing_engine_or_media_tool_and_cleans(gate, component):
    target = gate.health["engines"] if component in {"whisper", "nemotron"} else gate.health
    target[component] = False
    report = run_gate(gate)
    assert not report["passed"] and not report["runtimePassed"]
    assert report["shutdown"]["clean"] and report["error"]
    assert gate.routes == ["/api/ready", "/api/health"]


def test_runtime_gate_rejects_unclean_shutdown_after_healthy_runtime(gate):
    gate.cleanup.update(clean=False, forced=True, exitCode=1, portClosed=False)
    report = run_gate(gate)
    assert not report["passed"] and report["runtimePassed"]
    assert "close its port cleanly" in report["error"]


def test_runtime_gate_requires_expected_version(gate):
    gate.version = "0.1.0"
    report = run_gate(gate)
    assert not report["passed"] and report["shutdown"]["clean"]
    assert "does not match 0.1.1" in report["error"]


def test_runtime_gate_unknown_identity_does_not_authorize_shutdown(gate):
    gate.ready = {"app": "unrelated", "status": "ok"}
    report = run_gate(gate)
    assert not report["passed"] and "Unexpected backend identity" in report["error"]
    assert gate.routes == ["/api/ready"]


@pytest.mark.parametrize("exists", [True, False])
def test_runtime_gate_honors_explicit_web_directory(gate, tmp_path, exists):
    gate.args.web_dir = tmp_path / "explicit-web"
    if exists:
        gate.args.web_dir.mkdir()
        (gate.args.web_dir / "index.html").write_text("static fixture", encoding="utf-8")
    report = run_gate(gate)
    assert report["passed"] is exists
    if not exists:
        assert "explicitly supplied" in report["error"]


@pytest.mark.parametrize("passed, expected_exit", [(True, 0), (False, 1)])
def test_runtime_gate_cli_writes_json_and_returns_failure_status(gate, monkeypatch, passed, expected_exit):
    report = {"passed": passed, "inferenceRun": False}
    runner = Mock(return_value=report)
    monkeypatch.setattr(gate.module, "run", runner)
    monkeypatch.setattr(gate.module.sys, "argv", ["bundled-runtime-check.py", "--executable",
        str(gate.args.executable), "--output", str(gate.args.output)])
    assert gate.module.main() == expected_exit
    assert json.loads(gate.args.output.read_text(encoding="utf-8")) == report
    assert runner.call_args.args[0].web_dir is None
    assert not gate.args.output.with_name("report.json.tmp").exists()
