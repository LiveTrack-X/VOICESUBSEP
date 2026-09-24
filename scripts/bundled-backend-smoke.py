"""Offline Windows bundle smoke: real CUDA ASR, upload, timestamps, shutdown.

Run only when GPU load is acceptable and the selected model is already cached:
  python scripts/bundled-backend-smoke.py --source tmp/whisper-tiny-smoke.wav

Uses only the Python standard library as a test driver. The child executable gets
an isolated data directory/CWD and a system-only PATH; its bundled FFmpeg, Python,
and CUDA libraries must suffice. Model downloads are disabled in the child.
This script verifies executable integration, not speech recognition accuracy.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import http.client
import json
import math
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import wave


ROOT = Path(__file__).resolve().parents[1]
MAX_RESPONSE = 4 * 1024 * 1024


class SmokeError(RuntimeError):
    pass


def request_json(port: int, method: str, route: str, body=None, *, token: str | None = None,
                 timeout: float = 10) -> dict:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    headers = {}
    payload = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token is not None:
        headers["x-voicesubsep-token"] = token
    try:
        connection.request(method, route, body=payload, headers=headers)
        return read_json(connection.getresponse())
    finally:
        connection.close()


def read_json(response: http.client.HTTPResponse) -> dict:
    raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise SmokeError("Backend response exceeded the smoke's 4 MiB limit.")
    text = raw.decode("utf-8", errors="replace")
    if not 200 <= response.status < 300:
        raise SmokeError(f"HTTP {response.status}: {text[:2000]}")
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SmokeError("Backend did not return JSON.") from exc
    if not isinstance(value, dict):
        raise SmokeError("Backend JSON must be an object.")
    return value


def upload_wav(port: int, source: Path) -> dict:
    boundary = "voicesubsep-smoke-" + secrets.token_hex(16)
    prefix = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"smoke-source.wav\"\r\n"
        "Content-Type: audio/wav\r\n\r\n"
    ).encode("ascii")
    suffix = f"\r\n--{boundary}--\r\n".encode("ascii")
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    try:
        connection.putrequest("POST", "/api/media")
        connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        connection.putheader("Content-Length", str(len(prefix) + source.stat().st_size + len(suffix)))
        connection.endheaders()
        connection.send(prefix)
        with source.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                connection.send(chunk)
        connection.send(suffix)
        return read_json(connection.getresponse())
    finally:
        connection.close()


def isolated_environment(token: str) -> dict[str, str]:
    environment = os.environ.copy()
    windows = Path(environment.get("SYSTEMROOT") or environment.get("SystemRoot") or r"C:\Windows")
    if not (windows / "System32").is_dir():
        raise SmokeError("Windows System32 was not found.")
    for key in list(environment):
        if key.upper() in {"PATH", "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "CONDA_PREFIX", "CONDA_DEFAULT_ENV", "CUDA_HOME", "CUDNN_PATH"} or key.upper().startswith("CUDA_PATH"):
            environment.pop(key)
    environment["PATH"] = os.pathsep.join((str(windows / "System32"), str(windows)))
    environment["VOICESUBSEP_DESKTOP_TOKEN"] = token
    environment["HF_HUB_OFFLINE"] = "1"
    environment["TRANSFORMERS_OFFLINE"] = "1"
    environment["HF_HUB_DISABLE_TELEMETRY"] = "1"
    environment["DO_NOT_TRACK"] = "1"
    return environment


def unused_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
        reservation.bind(("127.0.0.1", 0))
        return reservation.getsockname()[1]


def validate_result(job: dict, source_duration: float) -> dict:
    if job.get("status") != "completed" or job.get("progress") != 1:
        raise SmokeError(f"CUDA job did not complete: {job.get('error') or job.get('status')}")
    result = job.get("result") or {}
    duration = result.get("duration")
    if isinstance(duration, bool) or not isinstance(duration, (float, int)) or not math.isfinite(duration) or duration <= 0:
        raise SmokeError("Result duration must be finite and positive.")
    if abs(duration - source_duration) > 0.15:
        raise SmokeError(f"Source/result duration mismatch: {source_duration:.3f}s vs {duration:.3f}s.")
    captions = result.get("captions")
    if not isinstance(captions, list) or not captions:
        raise SmokeError("Expected nonempty captions from the supplied spoken English WAV.")
    text = " ".join(str(caption.get("text", "")).strip() for caption in captions).strip()
    if not text:
        raise SmokeError("All captions were empty.")
    previous_start = -1.0
    word_count = 0
    for caption in captions:
        start, end = caption.get("start"), caption.get("end")
        for value in (start, end):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise SmokeError("Caption timestamps must be finite numbers.")
        if not 0 <= start < end <= duration + 0.05 or start < previous_start:
            raise SmokeError(f"Invalid or unsorted caption interval: {start}..{end}.")
        previous_start = start
        if caption.get("speakerId") is not None:
            raise SmokeError("Transcription-only job must not invent a speaker assignment.")
        for word in caption.get("words") or []:
            word_start, word_end = word.get("start"), word.get("end")
            if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                   for value in (word_start, word_end)):
                raise SmokeError("Word timestamps must be finite numbers.")
            if not 0 <= word_start < word_end <= duration + 0.05:
                raise SmokeError(f"Invalid word interval: {word_start}..{word_end}.")
            word_count += 1
    if not word_count:
        raise SmokeError("Expected word timestamps from the real Whisper transcription.")
    return {"captionCount": len(captions), "wordCount": word_count, "duration": duration,
            "text": text, "warnings": result.get("warnings", [])}


def stop_owned_process(process: subprocess.Popen, port: int, token: str, identified: bool,
                       environment: dict[str, str]) -> dict:
    result = {"requested": False, "clean": False, "forced": False, "exitCode": process.poll()}
    if process.poll() is None and identified:
        try:
            reply = request_json(port, "POST", "/api/desktop/shutdown", token=token)
            result["requested"] = reply.get("status") == "stopping"
        except Exception as exc:
            result["error"] = str(exc)
    try:
        process.wait(timeout=40 if result["requested"] else 2)
    except subprocess.TimeoutExpired:
        result["forced"] = True
        # Scope cleanup strictly to the process tree spawned by this script.
        windows = environment.get("SYSTEMROOT") or environment.get("SystemRoot") or r"C:\Windows"
        taskkill = Path(windows) / "System32" / "taskkill.exe"
        try:
            subprocess.run([str(taskkill), "/PID", str(process.pid), "/T", "/F"],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW, timeout=10, check=False)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
    result["exitCode"] = process.returncode
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as check:
        check.settimeout(1)
        result["portClosed"] = check.connect_ex(("127.0.0.1", port)) != 0
    result["clean"] = bool(result["requested"] and not result["forced"] and process.returncode == 0 and result["portClosed"])
    return result


def run(args) -> dict:
    started = time.monotonic()
    report = {"passed": False, "startedAt": datetime.now(timezone.utc).isoformat(),
              "executable": str(args.executable), "source": str(args.source), "model": args.model,
              "offline": True, "device": "cuda", "diarization": False}
    log_path = args.output.with_suffix(".server.log")
    report["serverLog"] = str(log_path)
    try:
        if sys.platform != "win32":
            raise SmokeError("This bundle smoke targets Windows.")
        if not args.executable.is_file():
            raise SmokeError(f"Bundled executable not found: {args.executable}")
        if not (args.web_dir / "index.html").is_file():
            raise SmokeError(f"Built editor index.html not found: {args.web_dir}")
        with wave.open(str(args.source), "rb") as wav:
            duration = wav.getnframes() / wav.getframerate()
            report["sourceAudio"] = {"duration": duration, "channels": wav.getnchannels(), "sampleRate": wav.getframerate()}
        if duration <= 0:
            raise SmokeError("Source WAV is empty.")
        token = secrets.token_urlsafe(32)
        environment = isolated_environment(token)
        report["childPath"] = environment["PATH"]
        port = unused_loopback_port()
        report["port"] = port
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="voicesubsep-bundled-smoke-") as temporary, log_path.open("wb") as log:
            workspace = Path(temporary)
            process = subprocess.Popen(
                [str(args.executable), "--port", str(port), "--data-dir", str(workspace / "data"),
                 "--web-dir", str(args.web_dir)],
                cwd=workspace, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                shell=False, creationflags=subprocess.CREATE_NO_WINDOW,
            )
            report["processId"] = process.pid
            identified = False
            try:
                deadline = time.monotonic() + 120
                last_error = "Startup pending"
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise SmokeError(f"Bundled backend exited during startup ({process.returncode}). See server log.")
                    try:
                        health = request_json(port, "GET", "/api/health", timeout=5)
                        break
                    except (OSError, http.client.HTTPException, SmokeError) as exc:
                        last_error = str(exc)
                        time.sleep(0.5)
                else:
                    raise SmokeError(f"Backend readiness timed out: {last_error}")
                report["health"] = health
                if health.get("app") != "voicesubsep" or health.get("status") != "ok":
                    raise SmokeError("Unexpected backend application identity.")
                identified = True
                if not health.get("ffmpeg") or not health.get("ffprobe"):
                    raise SmokeError("Bundled FFmpeg/FFprobe is unavailable with the system-only PATH.")
                if not health.get("engines", {}).get("whisper"):
                    raise SmokeError("Bundled Whisper import is unavailable.")
                if not health.get("gpu", {}).get("available") or "float16" not in health["gpu"].get("computeTypes", []):
                    raise SmokeError(f"Bundled CUDA is unavailable: {health.get('gpu', {}).get('reason')}")
                media = upload_wav(port, args.source)
                tracks = media.get("audioTracks") or []
                if not tracks:
                    raise SmokeError("Uploaded WAV has no audio stream.")
                job = request_json(port, "POST", "/api/jobs", {
                    "mediaId": media["id"], "mode": "standard", "speakerCount": 1,
                    "audioTrack": tracks[0]["index"], "whisperModel": args.model,
                    "language": "en", "device": "cuda", "diarization": False,
                })
                report["jobId"] = job["id"]
                deadline = time.monotonic() + args.timeout
                last_stage = None
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise SmokeError(f"Bundled backend exited during analysis ({process.returncode}).")
                    job = request_json(port, "GET", f"/api/jobs/{report['jobId']}")
                    if job.get("stage") != last_stage:
                        last_stage = job.get("stage")
                        print(f"[{job.get('status')}] {last_stage}", flush=True)
                    if job.get("status") in {"completed", "failed", "cancelled"}:
                        break
                    time.sleep(1)
                else:
                    request_json(port, "DELETE", f"/api/jobs/{report['jobId']}")
                    raise SmokeError(f"CUDA job timed out after {args.timeout}s.")
                report["job"] = job
                report["validation"] = validate_result(job, duration)
                report["analysisPassed"] = True
            finally:
                report["shutdown"] = stop_owned_process(process, port, token, identified, environment)
            if not report["shutdown"]["clean"]:
                raise SmokeError("Backend did not acknowledge shutdown and exit cleanly.")
            report["passed"] = True
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Generated spoken English PCM WAV; not silence")
    parser.add_argument("--executable", type=Path, default=ROOT / "build/backend/voicesubsep-server/voicesubsep-server.exe")
    parser.add_argument("--web-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--model", default="large-v3-turbo", choices=["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo", "turbo"])
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/bundled-backend-smoke.json")
    parser.add_argument("--timeout", type=int, default=900, help="Maximum analysis seconds (default: 900)")
    args = parser.parse_args()
    for field in ("source", "executable", "web_dir", "output"):
        setattr(args, field, getattr(args, field).resolve())
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.source.suffix.lower() != ".wav" or not args.source.is_file():
        parser.error("--source must be an existing spoken English WAV")
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
