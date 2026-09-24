"""CPU-only, non-destructive cuts on one source's original time axis."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from fractions import Fraction
from typing import Any, Callable

from .media import DURATION_SCAN_TIMEOUT, duration_from_progress, duration_probe_command, media_info

FORMATS = {"mp4", "wav", "mp3", "m4a"}
SAMPLE_RATE = 48000
VIDEO_RATE = 30
Progress = Callable[[str, float], None]
Cancelled = Callable[[], bool]


class RenderCancelled(Exception):
    pass


def checkpoint(cancelled: Cancelled) -> None:
    if cancelled():
        raise RenderCancelled("Render was cancelled.")


def selected_frame_rate(info: dict, requested: str = "30") -> Fraction:
    if requested not in {"original", "30", "60"}:
        raise ValueError("Choose original, 30 or 60 fps.")
    if requested != "original":
        return Fraction(requested)
    try:
        rate = Fraction(str(info.get("frameRateFraction") or info.get("frameRate") or "0"))
    except (ValueError, ZeroDivisionError):
        rate = Fraction(0)
    if not 0 < rate <= 1000:
        raise ValueError("The source frame rate is unknown. Choose 30 or 60 fps.")
    return rate.limit_denominator(100000)


def effective_ranges(keep_ranges: list[dict], duration: float, format: str, video_rate=VIDEO_RATE) -> list[dict]:
    """Nearest grid, half-up; final boundary never extends beyond the source.

    MP4 is CFR 30 fps with 1600 audio samples per frame. Audio-only exports use
    the 48 kHz sample grid. Returned ranges, not the requested floats, define
    both the render and subtitle mapping. Collapsed ranges are rejected.
    """
    if format not in FORMATS or not math.isfinite(duration) or duration <= 0:
        raise ValueError("Invalid output format or source duration.")
    if not isinstance(keep_ranges, list) or not 1 <= len(keep_ranges) <= 200:
        raise ValueError("Keep between 1 and 200 source ranges.")
    grid = float(video_rate) if format == "mp4" else SAMPLE_RATE
    if not math.isfinite(grid) or grid <= 0:
        raise ValueError("Invalid output frame rate.")
    maximum = math.floor(duration * grid + 1e-8)
    result, previous = [], 0.0
    for item in keep_ranges:
        if not isinstance(item, dict) or set(item) != {"start", "end"}:
            raise ValueError("Each range must contain only start and end.")
        start, end = item["start"], item["end"]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
               for v in (start, end)):
            raise ValueError("Range times must be finite numbers.")
        if not 0 <= start < end <= duration or start < previous:
            raise ValueError("Ranges must be sorted, disjoint and within the source duration.")
        previous = end
        first = min(maximum, math.floor(start * grid + 0.5))
        last = min(maximum, math.floor(end * grid + 0.5))
        if first >= last:
            raise ValueError("A retained range is shorter than the output time grid. Widen the cut.")
        result.append({"start": first / grid, "end": last / grid})
    return result


def validate_request(info: dict, keep_ranges: list[dict], format: str, audio_track: int, frame_rate: str = "30") -> list[dict]:
    if isinstance(audio_track, bool) or not isinstance(audio_track, int) or audio_track not in {
        item["index"] for item in info.get("audioTracks", [])
    }:
        raise ValueError("Select an audio track that exists in this recording.")
    if format == "mp4" and not info.get("hasVideo"):
        raise ValueError("MP4 export requires a source video track. Choose an audio format.")
    rate = selected_frame_rate(info, frame_rate) if format == "mp4" else VIDEO_RATE
    return effective_ranges(keep_ranges, float(info["duration"]), format, rate)


def _run(command: list[str], cancelled: Cancelled, *, directory: Path,
         progress: Progress | None = None, duration: float = 0, timeout: float | None = None) -> str:
    """File-backed pipes cannot deadlock or prevent cooperative cancellation."""
    checkpoint(cancelled)
    stdout_path, stderr_path = directory / "stdout.log", directory / "stderr.log"
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
    with stdout_path.open("w+b") as stdout, stderr_path.open("w+b") as stderr:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                   creationflags=flags, shell=False)
        started, last_progress = time.monotonic(), 0.0
        try:
            with stdout_path.open("r", encoding="utf-8", errors="replace") as reader:
                while process.poll() is None:
                    checkpoint(cancelled)
                    if timeout is not None and time.monotonic() - started > timeout:
                        raise RuntimeError("Media inspection timed out.")
                    if progress and duration:
                        for line in reader:
                            if line.startswith("out_time_us="):
                                try:
                                    fraction = float(line.split("=", 1)[1]) / 1_000_000 / duration
                                except ValueError:
                                    continue
                                last_progress = max(last_progress, min(0.95, max(0.0, fraction) * 0.95))
                                progress("Encoding edited media", last_progress)
                    time.sleep(0.05)
            checkpoint(cancelled)
            if process.returncode:
                stderr.seek(0, os.SEEK_END)
                stderr.seek(max(0, stderr.tell() - 4000))
                detail = stderr.read().decode("utf-8", errors="replace").strip()
                raise RuntimeError("FFmpeg/FFprobe failed: " + detail)
            stdout.seek(0)
            return stdout.read().decode("utf-8", errors="replace")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def _probe(path: Path, cancelled: Cancelled, directory: Path) -> dict:
    binary = shutil.which("ffprobe")
    if not binary:
        raise RuntimeError("FFprobe is required to validate the export.")
    raw = _run([binary, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams",
                "-show_format", "-of", "json", str(path)], cancelled, directory=directory, timeout=60)
    data = json.loads(raw)
    info = media_info(data, duration_fallback=lambda: duration_from_progress(
        _run(duration_probe_command(path), cancelled, directory=directory, timeout=DURATION_SCAN_TIMEOUT)))
    video = next((stream for stream in data.get("streams", []) if stream.get("index") == info["videoStream"]), {})
    count = str(video.get("nb_frames", ""))
    if count.isdigit():
        info["videoFrames"] = int(count)
    return info


def filter_graph(item: dict, format: str, audio_track: int, video_track: int, video_rate=VIDEO_RATE) -> str:
    """One segment at a time: no split branches can retain hours of frames.

    The input retains its common source timestamps. first_pts fills any delay
    or gap from the cut boundary BEFORE resetting this segment to zero.
    """
    start, end = item["start"], item["end"]
    first_sample, last_sample = round(start * SAMPLE_RATE), round(end * SAMPLE_RATE)
    parts = [f"[0:{audio_track}]aresample={SAMPLE_RATE}:async=1:first_pts={first_sample},"
             f"aformat=sample_fmts=fltp:channel_layouts=stereo,apad,"
             f"atrim=end_sample={last_sample - first_sample},asetpts=PTS-STARTPTS[audio]"]
    if format == "mp4":
        frames = round(end * video_rate) - round(start * video_rate)
        parts.append(f"[0:{video_track}]tpad=stop_mode=clone:stop_duration={end:.9f},"
                     f"fps={video_rate}:start_time={start:.9f}:round=near,"
                     f"trim=end_frame={frames},setpts=PTS-STARTPTS,"
                     "scale=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p[video]")
    return ";\n".join(parts)


def render_media(source: Path, destination: Path, *, keep_ranges: list[dict], format: str,
                 audio_track: int, progress: Progress, cancelled: Cancelled,
                 probe: Callable[[Path], dict] | None = None, frame_rate: str = "30") -> dict[str, Any]:
    source, destination = source.resolve(), destination.resolve()
    if source == destination or destination.exists() or destination.suffix != f".{format}":
        raise ValueError("The export must be a new file with the selected format; the source is never overwritten.")
    if not source.is_file():
        raise ValueError("Source media is missing.")
    binary = shutil.which("ffmpeg")
    if not binary:
        raise RuntimeError("FFmpeg is required for media export.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    checkpoint(cancelled)
    with tempfile.TemporaryDirectory(prefix=".render-", dir=destination.parent) as temporary:
        directory = Path(temporary)
        inspect = probe or (lambda path: _probe(path, cancelled, directory))
        info = inspect(source)
        ranges = validate_request(info, keep_ranges, format, audio_track, frame_rate)
        video_rate = selected_frame_rate(info, frame_rate) if format == "mp4" else Fraction(VIDEO_RATE)
        duration = sum(item["end"] - item["start"] for item in ranges)
        warnings = []
        if ranges != keep_ranges:
            warnings.append("Cut boundaries were aligned to the output grid; use the returned keepRanges for subtitles.")
        if format == "mp4":
            warnings.append(f"Video is re-encoded at {float(video_rate):g} fps (constant rate); timestamp gaps are held frames and missing audio is silence.")
        if format in {"mp3", "m4a"}:
            warnings.append("Compressed audio may include codec padding; duration describes retained content, not container padding.")
        warnings.append("Only the selected source audio track is exported as 48 kHz stereo.")
        common = [binary, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                  "-threads", "2", "-filter_threads", "1", "-filter_complex_threads", "1"]
        playlist, elapsed = ["ffconcat version 1.0"], 0.0
        for index, item in enumerate(ranges):
            checkpoint(cancelled)
            length = item["end"] - item["start"]
            graph = directory / "cut.txt"
            graph.write_text(filter_graph(item, format, audio_track, info.get("videoStream", 0) or 0, video_rate), encoding="utf-8")
            segment = directory / f"segment-{index:03d}.{'nut' if format == 'mp4' else 'wav'}"
            # Seek with preroll, retaining the source's timestamp origin. The
            # exact sample/frame cuts happen in filters, never by keyframe copy.
            seek = max(0.0, item["start"] - 1.0)
            command = common + ["-ss", f"{seek:.9f}", "-noaccurate_seek", "-copyts", "-start_at_zero",
                      "-protocol_whitelist", "file,pipe", "-i", str(source), "-filter_complex_script", str(graph)]
            if format == "mp4":
                command += ["-map", "[video]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                            "-threads:v", "2", "-r", str(video_rate), "-pix_fmt", "yuv420p"]
            else:
                command += ["-vn"]
            command += ["-map", "[audio]", "-c:a", "pcm_s16le", "-ar", str(SAMPLE_RATE), "-ac", "2",
                        "-threads:a", "1"]
            if format != "mp4":
                command += ["-rf64", "auto"]
            command += ["-map_metadata", "-1", "-map_chapters", "-1",
                        "-progress", "pipe:1", "-nostats", str(segment)]
            def segment_progress(_stage, fraction):
                progress(f"Encoding retained range {index + 1}/{len(ranges)}", 0.8 * (elapsed + length * fraction) / duration)
            segment_progress("", 0)
            try:
                _run(command, cancelled, directory=directory, progress=segment_progress, duration=length)
            except RuntimeError:
                if format != "mp4" or seek == 0:
                    raise
                # A container may seek past the last packet of a shorter video
                # stream while its audio continues. Retry that segment from the
                # beginning so tpad can hold the actual last decoded frame.
                command[command.index("-ss") + 1] = "0"
                _run(command, cancelled, directory=directory, progress=segment_progress, duration=length)
            playlist.extend([f"file {segment.name}", f"duration {length:.9f}"])
            elapsed += length
        manifest = directory / "segments.ffconcat"
        manifest.write_text("\n".join(playlist) + "\n", encoding="utf-8")
        partial = directory / f"edited.{format}"
        command = common + ["-protocol_whitelist", "file,pipe", "-f", "concat", "-safe", "1", "-i", str(manifest)]
        if format == "mp4":
            # Each temporary video was already exactly cut and re-encoded with
            # identical settings. Copying these does not approximate source cuts.
            timescale = video_rate.numerator * max(1, 1000 // video_rate.numerator)
            command += ["-map", "0:v:0", "-c:v", "copy", "-video_track_timescale", str(timescale)]
        else:
            command += ["-vn"]
        total_samples = sum(round(r["end"] * SAMPLE_RATE) - round(r["start"] * SAMPLE_RATE) for r in ranges)
        command += ["-map", "0:a:0", "-af", f"asetpts=N/SR/TB,apad,atrim=end_sample={total_samples}",
                    "-ar", str(SAMPLE_RATE), "-ac", "2", "-threads:a", "1"]
        command += {"wav": ["-c:a", "pcm_s16le", "-rf64", "auto"], "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
                    "m4a": ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
                    "mp4": ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]}[format]
        command += ["-map_metadata", "-1", "-map_chapters", "-1", "-progress", "pipe:1", "-nostats", str(partial)]
        progress("Joining retained ranges", 0.8)
        _run(command, cancelled, directory=directory,
             progress=lambda stage, fraction: progress("Joining retained ranges", 0.8 + 0.15 * fraction), duration=duration)
        checkpoint(cancelled)
        progress("Validating exported media", 0.97)
        output = inspect(partial)
        tolerance = 1 / SAMPLE_RATE + 1e-6 if format == "wav" else 0.08
        if not partial.is_file() or partial.stat().st_size == 0 or abs(output["duration"] - duration) > tolerance:
            raise RuntimeError("Export duration does not match the retained source ranges.")
        if format == "mp4" and not output.get("hasVideo"):
            raise RuntimeError("The exported MP4 has no video stream.")
        expected_frames = sum(round(r["end"] * video_rate) - round(r["start"] * video_rate) for r in ranges)
        if format == "mp4" and output.get("videoFrames", expected_frames) != expected_frames:
            raise RuntimeError("Export frame count does not match the retained source ranges.")
        checkpoint(cancelled)
        if destination.exists():
            raise ValueError("An export already exists at the destination.")
        os.replace(partial, destination)
        return {"duration": duration, "keepRanges": ranges, "warnings": warnings,
                **({"frameRate": float(video_rate), "frameRateFraction": str(video_rate)} if format == "mp4" else {})}
