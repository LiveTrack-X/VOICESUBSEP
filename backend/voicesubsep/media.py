"""Read media structure without mixing tracks or invoking a shell."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path
from typing import Any

MEDIA_EXTENSIONS = {
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mp3", ".wav",
    ".m4a", ".aac", ".flac", ".ogg", ".opus", ".mpg", ".mpeg", ".ts",
    ".wma", ".aiff", ".aif", ".mts", ".m2ts",
}


def clean_name(filename: str | None) -> str:
    name = (filename or "media").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(c for c in name if ord(c) >= 32 and ord(c) != 127).strip()
    if not name or len(name) > 255:
        raise ValueError("Media filename must contain 1 to 255 characters.")
    return name


def probe_media(path: Path) -> dict[str, Any]:
    binary = shutil.which("ffprobe")
    if binary is None:
        raise RuntimeError("FFprobe is not installed. Install FFmpeg and add its bin directory to PATH.")
    try:
        result = subprocess.run(
            [binary, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
             "format=duration:stream=index,codec_type,codec_name,channels,duration:stream_tags=title,language",
             "-of", "json", str(path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError("Media inspection timed out. Use a valid local audio or video recording.") from exc
    if result.returncode != 0:
        raise ValueError("This file could not be read as audio or video by FFprobe.")
    try:
        info = json.loads(result.stdout)
        streams = info.get("streams", [])
        durations = [info.get("format", {}).get("duration")]
        durations.extend(stream.get("duration") for stream in streams)
        seconds = []
        for value in durations:
            try:
                duration = float(value)
            except (TypeError, ValueError):
                continue
            if math.isfinite(duration) and duration > 0:
                seconds.append(duration)
        if not seconds:
            raise ValueError("Media has no readable positive duration.")
        tracks = []
        for stream in streams:
            if stream.get("codec_type") != "audio":
                continue
            index = int(stream["index"])
            channels = int(stream.get("channels", 1))
            if not 0 <= index <= 4096 or not 1 <= channels <= 256:
                raise ValueError("Media has invalid audio stream metadata.")
            tags = stream.get("tags", {})
            title = str(tags.get("title", ""))[:120]
            language = str(tags.get("language", ""))[:20]
            label = title or f"Audio {index}"
            if language:
                label += f" · {language}"
            label += f" · {channels} ch"
            tracks.append({"index": index, "label": label, "channels": channels})
        if not tracks:
            raise ValueError("The media contains no audio track.")
        if len(tracks) > 64:
            raise ValueError("At most 64 audio tracks are supported.")
        return {"duration": max(seconds), "audioTracks": tracks}
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ValueError("FFprobe returned invalid media metadata.") from exc
