"""Gate Windows bundle engine readiness and clean shutdown; never run model jobs.

Uses only stdlib and the existing bundled-backend-smoke isolation/cleanup helpers.
No GPU is required. Health means import readiness, not model or quality validation.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import runpy
import secrets
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
_helpers = runpy.run_path(str(ROOT / "scripts" / "bundled-backend-smoke.py"))
SmokeError = _helpers["SmokeError"]
request_json = _helpers["request_json"]
isolated_environment = _helpers["isolated_environment"]
unused_loopback_port = _helpers["unused_loopback_port"]
stop_owned_process = _helpers["stop_owned_process"]


def run(args) -> dict:
    started = time.monotonic()
    report = {"passed": False, "runtimePassed": False, "inferenceRun": False, "offline": True,
              "gpuRequired": False, "startedAt": datetime.now(timezone.utc).isoformat(),
              "executable": str(args.executable), "serverLog": str(args.output.with_suffix(".server.log"))}
    try:
        if sys.platform != "win32":
            raise SmokeError("This bundle gate targets Windows.")
        if not args.executable.is_file():
            raise SmokeError("The bundled executable must exist.")
        if args.web_dir is not None and not (args.web_dir / "index.html").is_file():
            raise SmokeError("The explicitly supplied web-dir/index.html must exist.")
        expected = args.expected_version or json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
        report["expectedVersion"] = expected
        token = secrets.token_urlsafe(32)
        environment = isolated_environment(token)
        for key in list(environment):
            if key.upper() in {"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"}:
                environment.pop(key)
        environment.update(HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9",
                           ALL_PROXY="http://127.0.0.1:9", NO_PROXY="127.0.0.1,localhost")
        report["childPath"] = environment["PATH"]
        port = unused_loopback_port()
        report["port"] = port
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="voicesubsep-runtime-check-") as temporary, \
                Path(report["serverLog"]).open("wb") as log:
            workspace = Path(temporary)
            web_dir = args.web_dir
            if web_dir is None:
                web_dir = workspace / "web"
                web_dir.mkdir()
                (web_dir / "index.html").write_text("<!doctype html><title>VOICESUBSEP runtime check</title>", encoding="utf-8")
            process = subprocess.Popen(
                [str(args.executable), "--port", str(port), "--data-dir", str(workspace / "data"),
                 "--web-dir", str(web_dir)], cwd=workspace, env=environment,
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, shell=False,
                creationflags=subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS,
            )
            report["processId"] = process.pid
            identified = False
            try:
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise SmokeError(f"Backend exited during startup ({process.returncode}).")
                    try:
                        ready = request_json(port, "GET", "/api/ready", timeout=max(0.1, min(5, deadline - time.monotonic())))
                    except OSError:
                        time.sleep(0.25)
                        continue
                    if ready.get("app") != "voicesubsep" or ready.get("status") != "ok":
                        raise SmokeError("Unexpected backend identity at /api/ready.")
                    report["ready"] = ready
                    identified = True
                    break
                else:
                    raise SmokeError("Backend readiness timed out after 60 seconds.")
                health = request_json(port, "GET", "/api/health", timeout=120)
                report["health"] = health
                if health.get("app") != "voicesubsep" or health.get("status") != "ok":
                    raise SmokeError("Unexpected backend identity at /api/health.")
                engines = health.get("engines") or {}
                if any(engines.get(name) is not True for name in ("whisper", "nemotron")):
                    raise SmokeError(f"Required bundled engines are unavailable: {health.get('engineIssues') or engines}")
                if any(health.get(name) is not True for name in ("ffmpeg", "ffprobe")):
                    raise SmokeError("Bundled FFmpeg/FFprobe are unavailable with the system-only PATH.")
                report["apiVersion"] = request_json(port, "GET", "/openapi.json")["info"]["version"]
                if report["apiVersion"] != expected:
                    raise SmokeError(f"Backend version {report['apiVersion']} does not match {expected}.")
                report["runtimePassed"] = True
            finally:
                report["shutdown"] = stop_owned_process(process, port, token, identified, environment)
            if not report["shutdown"]["clean"]:
                raise SmokeError("Backend did not acknowledge shutdown, exit 0 and close its port cleanly.")
            report["passed"] = True
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
    report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, default=ROOT / "build/backend/voicesubsep-server/voicesubsep-server.exe")
    parser.add_argument("--web-dir", type=Path, help="Existing web directory; defaults to a temporary probe page")
    parser.add_argument("--expected-version", help="Defaults to the root package.json version")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/bundled-runtime-check.json")
    args = parser.parse_args()
    for field in ("executable", "web_dir", "output"):
        if getattr(args, field) is not None:
            setattr(args, field, getattr(args, field).resolve())
    if args.output.suffix.lower() != ".json":
        parser.error("--output must use the .json extension")
    report = run(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    staging = args.output.with_name(args.output.name + ".tmp")
    staging.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(staging, args.output)
    print(json.dumps({"passed": report["passed"], "report": str(args.output), "error": report.get("error")}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
