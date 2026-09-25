"""Optional offline RNNoise, with a pinned model and sample-exact time axis.

Only FFmpeg is executed. No plugins, model downloads or personal audio devices
are opened. The 480-sample delay follows FFmpeg's arnndn analysis/history buffer;
padding its tail before trimming preserves the last original samples as well.
"""

from __future__ import annotations

from functools import lru_cache
import hashlib
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from typing import Callable

from .vst_host import _pcm_wav_info

MODEL_ID = "xiph-rnnoise-v0.1"
MODEL_SHA256 = "6b8943dc4a9b6b24425873992a44f29c0577503276456af46a8854774faeb294"
MODEL_BYTES = 302903
MODEL_PATH = Path(__file__).parent / "assets" / "rnnoise" / "std.rnnn"
SAMPLE_RATE = 48000
LATENCY_SAMPLES = 480
MAX_RUNTIME_SECONDS = 24 * 60 * 60
Cancelled = Callable[[], bool]
Progress = Callable[[str, float], None]


class NoiseReductionError(RuntimeError):
    pass


class NoiseReductionCancelled(NoiseReductionError):
    pass


def validate_noise_reduction(value: object) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {"engine", "mix"} or value.get("engine") != "rnnoise":
        raise ValueError("Noise reduction must use the built-in RNNoise engine.")
    mix = value.get("mix", 1.0)
    if type(mix) not in (int, float) or not math.isfinite(mix) or not 0 <= mix <= 1:
        raise ValueError("RNNoise mix must be a finite number between 0 and 1.")
    return {"engine": "rnnoise", "mix": float(mix)}


def _model_bytes() -> bytes:
    try:
        with MODEL_PATH.open("rb") as reader:
            content = reader.read(MODEL_BYTES + 1)
    except OSError as exc:
        raise NoiseReductionError("The bundled RNNoise model is missing or unreadable. Repair the application installation.") from exc
    if len(content) != MODEL_BYTES or hashlib.sha256(content).hexdigest() != MODEL_SHA256:
        raise NoiseReductionError("The bundled RNNoise model failed its integrity check. Repair the application installation.")
    return content


@lru_cache(maxsize=4)
def _filter_available(binary: str, size: int, modified: int) -> bool:
    try:
        checked = subprocess.run([binary, "-hide_banner", "-h", "filter=arnndn"],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), shell=False)
        return checked.returncode == 0 and b"Filter arnndn" in checked.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False


def noise_reduction_status() -> dict:
    issue = None
    try:
        _model_bytes()
        binary = shutil.which("ffmpeg")
        if binary is None:
            raise NoiseReductionError("FFmpeg is required for built-in RNNoise.")
        stat = Path(binary).stat()
        if not _filter_available(binary, stat.st_size, stat.st_mtime_ns):
            raise NoiseReductionError("This FFmpeg runtime does not provide the required arnndn filter.")
    except (OSError, NoiseReductionError) as exc:
        issue = str(exc) if isinstance(exc, NoiseReductionError) else "The FFmpeg runtime could not be inspected."
    return {"available": issue is None, "engine": "rnnoise", "model": MODEL_ID, "issue": issue}


def noise_reduction_available() -> bool:
    return noise_reduction_status()["available"]


def _checkpoint(cancelled: Cancelled) -> None:
    if cancelled():
        raise NoiseReductionCancelled("RNNoise preprocessing was cancelled.")


def _command(binary: str, source: Path, staged: Path, frames: int, mix: float) -> list[str]:
    # Full 480-sample blocks plus one look-ahead block. Model lives in our
    # private working directory, avoiding filter-expression path interpolation.
    padding = (-frames) % LATENCY_SAMPLES + LATENCY_SAMPLES
    filters = (f"apad=pad_len={padding},arnndn=m=std.rnnn:mix={mix:.12g},"
               f"atrim=start_sample={LATENCY_SAMPLES}:end_sample={frames + LATENCY_SAMPLES},"
               "asetpts=PTS-STARTPTS")
    return [binary, "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-nostats",
            "-threads", "1", "-filter_threads", "1", "-protocol_whitelist", "file,pipe",
            "-i", str(source), "-map", "0:a:0", "-vn", "-sn", "-dn", "-af", filters,
            "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", "-rf64", "auto",
            "-progress", "pipe:1", "-stats_period", "1", "-y", str(staged)]


def _run(command: list[str], directory: Path, frames: int, cancelled: Cancelled, progress: Progress) -> None:
    _checkpoint(cancelled)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
    # Disk-backed progress avoids pipe deadlocks; reads and retained text are
    # bounded. Do not expose tool stderr, local filenames or arbitrary output.
    with (directory / "progress.log").open("w+b") as output:
        process = subprocess.Popen(command, cwd=directory, stdin=subprocess.DEVNULL, stdout=output,
                                   stderr=subprocess.DEVNULL, creationflags=flags, shell=False)
        started = time.monotonic()
        try:
            with (directory / "progress.log").open("rb") as reader:
                pending, previous = b"", -1.0
                while process.poll() is None:
                    _checkpoint(cancelled)
                    if time.monotonic() - started > MAX_RUNTIME_SECONDS:
                        raise NoiseReductionError("RNNoise preprocessing exceeded its processing time limit.")
                    pending += reader.read(65536)
                    lines = pending.split(b"\n")
                    pending = lines.pop()[-1024:]
                    for line in lines:
                        if line.startswith(b"out_time_us="):
                            try:
                                current = min(0.99, max(0.0, int(line[12:]) / 1_000_000 * SAMPLE_RATE / frames))
                            except ValueError:
                                continue
                            if current > previous:
                                progress("RNNoise noise reduction", current)
                                previous = current
                    time.sleep(0.05)
            _checkpoint(cancelled)
            if process.returncode:
                raise NoiseReductionError("FFmpeg could not complete RNNoise preprocessing. Check available disk space and the FFmpeg runtime.")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def denoise_rnnoise(source: Path, destination: Path, mix: float, cancelled: Cancelled, progress: Progress) -> dict:
    settings = validate_noise_reduction({"engine": "rnnoise", "mix": mix})
    _checkpoint(cancelled)
    source, destination = Path(source).resolve(strict=True), Path(destination).resolve()
    if source == destination or (destination.exists() and source.samefile(destination)):
        raise ValueError("RNNoise preprocessing must preserve the original source file.")
    if not source.is_file() or source.suffix.lower() != ".wav" or destination.suffix.lower() != ".wav":
        raise ValueError("RNNoise preprocessing requires separate 48 kHz PCM16 WAV files.")
    info = _pcm_wav_info(source)
    content = _model_bytes()
    binary = shutil.which("ffmpeg")
    if not binary:
        raise NoiseReductionError("FFmpeg is required for built-in RNNoise.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="rnnoise-output-", dir=destination.parent) as temporary:
        directory = Path(temporary)
        (directory / "std.rnnn").write_bytes(content)
        staged = directory / "processed.wav"
        progress("RNNoise noise reduction", 0.0)
        _run(_command(binary, source, staged, info["inputFrames"], settings["mix"]), directory,
             info["inputFrames"], cancelled, progress)
        try:
            actual = _pcm_wav_info(staged)
        except (ValueError, OSError) as exc:
            raise NoiseReductionError("RNNoise output failed its source-duration check.") from exc
        if any(actual[key] != info[key] for key in ("sampleRate", "channels", "inputFrames", "outputFrames")):
            raise NoiseReductionError("RNNoise output failed its source-duration check.")
        _checkpoint(cancelled)
        os.replace(staged, destination)
    progress("RNNoise noise reduction complete", 1.0)
    return {**info, **settings, "model": MODEL_ID, "compensatedLatencySamples": LATENCY_SAMPLES,
            "latencyCompensation": "fixed-algorithm-delay", "warnings": []}
