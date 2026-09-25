"""Bounded file protocol for optional, process-isolated Windows VST3 effects.

No plugin code is imported into the API process. Isolation contains crashes; it
is not a security sandbox for untrusted native plugins.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading
import time
from typing import Callable

from .vst_process_lock import vst_process_lock

MAX_EFFECTS = 4
MAX_PARAMETERS = 256
MAX_JSON_BYTES = 512 * 1024
Cancelled = Callable[[], bool]
Progress = Callable[[str, float], None]
_WORKER_LOCK = threading.Lock()


class VSTError(RuntimeError):
    pass


class VSTCancelled(VSTError):
    pass


def validate_plugin_path(value: str) -> str:
    if (not isinstance(value, str) or not value or len(value) > 4096
            or any(ord(char) < 32 for char in value)
            or value.startswith(("\\\\", "//")) or "://" in value):
        raise ValueError("Choose an installed local VST3 file or bundle.")
    path = Path(value)
    if not path.is_absolute() or path.suffix.lower() != ".vst3":
        raise ValueError("Choose an absolute local .vst3 file or bundle path.")
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise ValueError("The selected VST3 file or bundle is not installed.") from exc
    if str(resolved).startswith(("\\\\", "//")) or not (resolved.is_file() or resolved.is_dir()):
        raise ValueError("Network VST3 paths are not supported.")
    return str(resolved)


def _plugin_name(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not 1 <= len(value) <= 512 or any(ord(c) < 32 for c in value):
        raise ValueError("Invalid plugin name.")
    return value


def validate_chain(chain: list[dict]) -> list[dict]:
    if not isinstance(chain, list) or len(chain) > MAX_EFFECTS:
        raise ValueError("A VST chain may contain at most four effects.")
    result = []
    for effect in chain:
        if not isinstance(effect, dict) or set(effect) - {"path", "pluginName", "enabled", "parameters"}:
            raise ValueError("Invalid VST effect settings.")
        enabled = effect.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError("VST enabled must be a boolean.")
        path = effect.get("path")
        # Bypassed plugins may have been uninstalled; their path still must be
        # structurally local. Only active effects are required to exist.
        if enabled:
            path = validate_plugin_path(path)
        elif (not isinstance(path, str) or not path or len(path) > 4096
              or any(ord(c) < 32 for c in path) or path.startswith(("\\\\", "//"))
              or "://" in path or not Path(path).is_absolute() or Path(path).suffix.lower() != ".vst3"):
            raise ValueError("Invalid bypassed VST3 path.")
        parameters = effect.get("parameters", {})
        if not isinstance(parameters, dict) or len(parameters) > MAX_PARAMETERS:
            raise ValueError("Too many VST parameters.")
        for key, value in parameters.items():
            if (not isinstance(key, str) or not key or len(key) > 256 or key.startswith("_")
                    or any(ord(c) < 32 for c in key)):
                raise ValueError("Invalid VST parameter key.")
            if isinstance(value, str):
                if len(value) > 1024 or any(ord(c) < 32 for c in value):
                    raise ValueError("Invalid VST parameter value.")
            elif isinstance(value, bool):
                pass
            elif not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError("VST parameter numbers must be finite.")
        result.append({"path": path, "pluginName": _plugin_name(effect.get("pluginName")),
                       "enabled": enabled, "parameters": dict(parameters)})
    return result


def runtime_available() -> bool:
    return (sys.platform == "win32" and struct.calcsize("P") == 8
            and importlib.util.find_spec("pedalboard") is not None)


def _checkpoint(cancelled: Cancelled) -> None:
    if cancelled():
        raise VSTCancelled("VST preprocessing was cancelled.")


def _worker_command(request: Path, response: Path) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--vst-worker", "--request", str(request), "--response", str(response)]
    return [sys.executable, "-m", "voicesubsep.vst_worker", "--request", str(request), "--response", str(response)]


def _read_json(path: Path) -> dict:
    if path.stat().st_size > MAX_JSON_BYTES:
        raise VSTError("VST worker response exceeded its size limit.")
    with path.open("r", encoding="utf-8") as file:
        result = json.load(file, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON")))
    if not isinstance(result, dict):
        raise VSTError("VST worker returned an invalid response.")
    return result


def _run_worker(request: dict, *, timeout: float, cancelled: Cancelled,
                progress: Progress | None = None, directory: Path | None = None,
                stall_timeout: float = 180) -> dict:
    _checkpoint(cancelled)
    if not _WORKER_LOCK.acquire(blocking=False):
        raise VSTError("Another VST operation is running. Wait for it to finish or cancel it first.")
    try:
        try:
            with vst_process_lock():
                return _run_worker_locked(request, timeout=timeout, cancelled=cancelled, progress=progress,
                                          directory=directory, stall_timeout=stall_timeout)
        except RuntimeError as exc:
            if isinstance(exc, VSTError):
                raise
            raise VSTError(str(exc)) from exc
    finally:
        _WORKER_LOCK.release()


def _run_worker_locked(request: dict, *, timeout: float, cancelled: Cancelled,
                       progress: Progress | None = None, directory: Path | None = None,
                       stall_timeout: float = 180) -> dict:
    _checkpoint(cancelled)
    if not runtime_available():
        raise VSTError("VST preprocessing requires the optional Pedalboard runtime on Windows x64.")
    with tempfile.TemporaryDirectory(prefix="vst-worker-", dir=directory) as temporary:
        folder = Path(temporary)
        request_path, response_path = folder / "request.json", folder / "response.json"
        progress_path = folder / "progress.json"
        request = {**request, "progressPath": str(progress_path)}
        encoded = json.dumps(request, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_JSON_BYTES:
            raise ValueError("VST worker request exceeded its size limit.")
        request_path.write_bytes(encoded)
        environment = dict(os.environ)
        environment["PYTHONPATH"] = os.pathsep.join(filter(None, [str(Path(__file__).resolve().parent.parent),
                                                                 environment.get("PYTHONPATH", "")]))
        environment.update({"OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2"})
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
        # Native plugins can write unlimited or malformed stdout/stderr. Discard
        # both; the bounded atomic response is the sole result/error channel.
        process = subprocess.Popen(_worker_command(request_path, response_path), stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=False,
                                   env=environment, creationflags=flags)
        started = heartbeat = time.monotonic()
        last_progress = -1.0
        try:
            while process.poll() is None:
                _checkpoint(cancelled)
                now = time.monotonic()
                if now - started > timeout or now - heartbeat > stall_timeout:
                    raise VSTError("VST worker timed out. Disable this effect or use a compatible offline VST3.")
                if progress_path.exists():
                    try:
                        state = _read_json(progress_path)
                        fraction = state.get("fraction")
                        if (isinstance(fraction, (int, float)) and not isinstance(fraction, bool)
                                and math.isfinite(fraction) and 0 <= fraction <= 1 and fraction > last_progress):
                            heartbeat, last_progress = now, fraction
                            if progress:
                                progress(str(state.get("stage", "VST preprocessing"))[:160], fraction)
                    except (OSError, ValueError):
                        pass  # An atomic replace may race an antivirus/file reader.
                time.sleep(0.05)
            _checkpoint(cancelled)
            if not response_path.exists():
                raise VSTError(f"VST worker exited without a response (exit {process.returncode}). The plugin may have crashed.")
            try:
                response = _read_json(response_path)
            except (OSError, ValueError) as exc:
                raise VSTError("VST worker returned an invalid response.") from exc
            if response.get("ok") is not True or process.returncode:
                raise VSTError(str(response.get("error", "VST worker failed."))[:2000])
            result = response.get("result")
            if not isinstance(result, dict):
                raise VSTError("VST worker returned an invalid result.")
            return result
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            else:
                process.wait()


def inspect_plugin(path: str, plugin_name: str | None = None, *, timeout: float = 45,
                   cancelled: Cancelled = lambda: False) -> dict:
    return _run_worker({"operation": "inspect", "path": validate_plugin_path(path),
                        "pluginName": _plugin_name(plugin_name)}, timeout=timeout, cancelled=cancelled)


def _pcm_wav_info(path: Path) -> dict:
    """Read only PCM16 WAV/RF64 headers, so a bypass needs no optional runtime."""
    with path.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12 or header[:4] not in (b"RIFF", b"RF64") or header[8:] != b"WAVE":
            raise ValueError("VST bypass requires a PCM16 WAV source.")
        total_bytes, rf64_size, fmt = path.stat().st_size, None, None
        for _ in range(128):
            chunk = stream.read(8)
            if len(chunk) != 8:
                break
            name, size = struct.unpack("<4sI", chunk)
            if name == b"ds64":
                if size < 28 or size > 4096:
                    raise ValueError("Invalid RF64 metadata.")
                metadata = stream.read(28)
                if len(metadata) != 28:
                    raise ValueError("Truncated RF64 metadata.")
                rf64_size = struct.unpack("<QQQI", metadata)[1]
                stream.seek(size - 28 + (size % 2), 1)
            elif name == b"fmt ":
                if size < 16 or size > 4096:
                    raise ValueError("Invalid WAV format metadata.")
                data = stream.read(size)
                if len(data) != size:
                    raise ValueError("Invalid WAV format metadata.")
                format_code, channels, rate, _, alignment, bits = struct.unpack("<HHIIHH", data[:16])
                pcm = format_code == 1 or (format_code == 0xFFFE and len(data) >= 40 and data[24:40] ==
                                          bytes.fromhex("0100000000001000800000aa00389b71"))
                if not pcm or rate != 48000 or channels not in (1, 2) or bits != 16 or alignment != channels * 2:
                    raise ValueError("VST preprocessing requires 48 kHz mono/stereo PCM16 WAV audio.")
                fmt = {"sampleRate": rate, "channels": channels}
                stream.seek(size % 2, 1)
            elif name == b"data":
                if size == 0xFFFFFFFF and header[:4] == b"RF64":
                    size = rf64_size
                if fmt is None or size is None or size <= 0 or size % (fmt["channels"] * 2) or stream.tell() + size > total_bytes:
                    raise ValueError("Invalid or truncated WAV audio data.")
                return {**fmt, "inputFrames": size // (fmt["channels"] * 2),
                        "outputFrames": size // (fmt["channels"] * 2)}
            else:
                stream.seek(size + size % 2, 1)
    raise ValueError("The source WAV has no supported PCM16 audio data.")


def _copy_bypass(source: Path, staged: Path, cancelled: Cancelled, progress: Progress) -> dict:
    result = _pcm_wav_info(source)
    size, copied = source.stat().st_size, 0
    with source.open("rb") as reader, staged.open("wb") as writer:
        while True:
            _checkpoint(cancelled)
            chunk = reader.read(1024 * 1024)
            if not chunk:
                break
            writer.write(chunk)
            copied += len(chunk)
            progress("Bypassing VST preprocessing", min(0.99, copied / size))
    return {**result, "plugins": [], "bypassed": True, "warnings": [],
            "totalReportedLatencySamples": 0, "compensatedLatencySamples": 0}


def process_chain(source: Path, destination: Path, chain: list[dict], cancelled: Cancelled,
                  progress: Progress) -> dict:
    source, destination = Path(source).resolve(strict=True), Path(destination).resolve()
    if source == destination:
        raise ValueError("VST preprocessing must preserve the original source file.")
    if not source.is_file() or source.suffix.lower() != ".wav" or destination.suffix.lower() != ".wav":
        raise ValueError("VST preprocessing requires separate 48 kHz WAV paths.")
    effects = validate_chain(chain)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # A same-directory temporary result is committed only after a successful,
    # sample-count-verified worker response. Existing destinations survive errors.
    with tempfile.TemporaryDirectory(prefix="vst-output-", dir=destination.parent) as temporary:
        staged = Path(temporary) / "processed.wav"
        if any(effect["enabled"] for effect in effects):
            result = _run_worker({"operation": "process", "source": str(source), "destination": str(staged),
                                  "chain": effects}, timeout=24 * 60 * 60, cancelled=cancelled,
                                 progress=progress, directory=destination.parent)
        else:
            result = _copy_bypass(source, staged, cancelled, progress)
        if (not staged.is_file() or result.get("sampleRate") != 48000
                or type(result.get("inputFrames")) is not int or result["inputFrames"] <= 0
                or result.get("outputFrames") != result["inputFrames"]):
            raise VSTError("VST output failed its source-duration check.")
        _validate_residual_report(result)
        _checkpoint(cancelled)
        os.replace(staged, destination)
        progress("VST preprocessing complete", 1.0)
        return result


def _validate_residual_report(result: dict) -> None:
    """Do not commit an output that makes an inconsistent measurement claim."""
    if result.get("latencyCompensation") != "plugin-reported+verified-residual":
        return  # Older reports and the byte-preserving bypass remain valid.
    def integer(value, maximum):
        return type(value) is int and 0 <= value <= maximum
    def invalid():
        raise VSTError("VST output failed its residual-latency verification report check.")
    plugins = result.get("plugins")
    if not isinstance(plugins, list) or not 1 <= len(plugins) <= MAX_EFFECTS:
        invalid()
    reported = measured = 0
    for plugin in plugins:
        if not isinstance(plugin, dict) or not integer(plugin.get("reportedLatencySamples"), 480000):
            invalid()
        measurement = plugin.get("residualMeasurement")
        if not isinstance(measurement, dict):
            invalid()
        status, applied, confidence = measurement.get("status"), measurement.get("appliedSamples"), measurement.get("confidence")
        matched, examined = measurement.get("matchedWindows"), measurement.get("examinedWindows")
        if (status not in ("uncertain", "verified", "corrected") or not integer(applied, 11999)
                or type(confidence) not in (float, int) or not math.isfinite(confidence) or not 0 <= confidence <= 1
                or not integer(matched, 7) or not integer(examined, 7) or matched > examined
                or measurement.get("maxSearchSamples") != 12000):
            invalid()
        if status == "uncertain":
            if applied != 0 or measurement.get("measuredSamples") is not None:
                invalid()
        elif (not integer(measurement.get("measuredSamples"), 11999) or measurement.get("measuredSamples") != applied or confidence < .9 or matched < 3
              or (status == "verified" and applied != 0) or (status == "corrected" and applied == 0)):
            invalid()
        reported += plugin["reportedLatencySamples"]
        measured += applied
    if (any(not integer(result.get(name), 527996) for name in ("totalReportedLatencySamples", "compensatedLatencySamples", "totalMeasuredResidualSamples", "totalCompensatedLatencySamples"))
            or reported > 480000 or result.get("totalReportedLatencySamples") != reported
            or result.get("compensatedLatencySamples") != reported
            or result.get("totalMeasuredResidualSamples") != measured
            or result.get("totalCompensatedLatencySamples") != reported + measured):
        invalid()
