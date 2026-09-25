"""Bounded, nondestructive file/OBS audio mixing on the original project clock."""
from __future__ import annotations

import math
from pathlib import Path
import shutil
import tempfile

from .rendering import _run, checkpoint, effective_ranges, render_media, SAMPLE_RATE

MAX_TRACKS = 16
MAX_DURATION = 604800
FORMATS = {"wav", "mp3", "m4a", "mp4"}


def validate_mix(request: dict, sources: dict[str, tuple[dict, Path]]) -> float:
    """Validate against actual cached metadata. Return the original mix duration."""
    tracks = request.get("tracks")
    if not isinstance(tracks, list) or not 1 <= len(tracks) <= MAX_TRACKS:
        raise ValueError("Choose 1 to 16 audio tracks.")
    if request.get("format") not in FORMATS:
        raise ValueError("Choose WAV, MP3, M4A or MP4.")
    ends = []
    for track in tracks:
        info, _ = sources[track["mediaId"]]
        if track.get("sha256") != info.get("sha256"):
            raise ValueError("A source file changed. Reconnect the original file before mixing.")
        if type(track.get("audioTrack")) is not int or track["audioTrack"] not in {s["index"] for s in info["audioTracks"]}:
            raise ValueError("The selected audio track is not present in its source.")
        for field, minimum, maximum in (("gainDb", -60, 12), ("offsetSeconds", -MAX_DURATION, MAX_DURATION)):
            value = track.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
                raise ValueError(f"Invalid {field}.")
        if type(track.get("muted")) is not bool:
            raise ValueError("Invalid mute setting.")
        if not track["muted"]:
            end = info["duration"] + track["offsetSeconds"]
            if end <= 0:
                raise ValueError("An enabled track ends before the mix starts. Change its offset or mute it.")
            ends.append(end)
    if not ends:
        raise ValueError("Enable at least one audio track.")
    duration = request.get("timelineDuration")
    if duration is None:
        duration = max(ends)
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= MAX_DURATION:
        raise ValueError("Mix duration must be positive and no longer than 7 days.")
    if type(request.get("limiter", True)) is not bool:
        raise ValueError("Invalid limiter setting.")
    if request["format"] == "mp4":
        video_id = request.get("videoMediaId")
        if video_id not in sources or not sources[video_id][0].get("hasVideo"):
            raise ValueError("Choose a source with video for MP4 export.")
        if request.get("frameRate", "30") not in {"original", "30", "60"}:
            raise ValueError("Invalid video frame rate.")
    # Grid snapping is repeated by the final renderer, which returns exact ranges.
    effective_ranges(request.get("keepRanges") or [{"start": 0, "end": duration}], duration, "wav")
    return duration


def mix_audio(sources: dict[str, tuple[dict, Path]], destination: Path, *, request: dict,
              progress, cancelled) -> dict:
    duration = validate_mix(request, sources)
    destination = destination.resolve()
    if destination.exists() or destination.suffix != "." + request["format"] or any(destination == p.resolve() for _, p in sources.values()):
        raise ValueError("The mix must be a new output file; originals are never overwritten.")
    binary = shutil.which("ffmpeg")
    if not binary:
        raise RuntimeError("FFmpeg is required for mixing.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Float mix + renderer temporary/output audio; MP4 uses conservative source
    # size plus a 25 Mbit/s video budget. No whole-media arrays enter Python.
    required = math.ceil(duration * (SAMPLE_RATE * 8 * 3 + (3_125_000 if request["format"] == "mp4" else 0))) + 64 * 1024**2
    if request["format"] == "mp4":
        required += sources[request["videoMediaId"]][1].stat().st_size
    if shutil.disk_usage(destination.parent).free < required:
        raise ValueError("Not enough free cache space for the mix and temporary exports.")
    checkpoint(cancelled)
    with tempfile.TemporaryDirectory(prefix=".mix-", dir=destination.parent) as temporary:
        directory = Path(temporary)
        common = [binary, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2",
                  "-filter_threads", "1", "-filter_complex_threads", "1"]
        command = common[:]
        graph, labels = [], []
        total_samples = round(duration * SAMPLE_RATE)
        active = [t for t in request["tracks"] if not t["muted"]]
        for index, track in enumerate(active):
            _, source = sources[track["mediaId"]]
            command += ["-copyts", "-start_at_zero", "-protocol_whitelist", "file,pipe", "-i", str(source)]
            offset = round(track["offsetSeconds"] * SAMPLE_RATE)
            chain = f"[{index}:{track['audioTrack']}]aresample={SAMPLE_RATE}:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo"
            if offset < 0:
                chain += f",atrim=start_sample={-offset},asetpts=PTS-STARTPTS"
            elif offset > 0:
                chain += f",adelay={offset}S:all=1"
            chain += f",volume={track['gainDb']:.9f}dB,apad,atrim=end_sample={total_samples},asetpts=N/SR/TB[a{index}]"
            graph.append(chain)
            labels.append(f"[a{index}]")
        final = "".join(labels) + f"amix=inputs={len(active)}:duration=longest:normalize=0"
        if request.get("limiter", True):
            final += ",alimiter=limit=0.98:level=false:latency=true"
        graph.append(final + f",apad,atrim=end_sample={total_samples},asetpts=N/SR/TB[mix]")
        graph_file = directory / "mix.txt"
        graph_file.write_text(";\n".join(graph), encoding="utf-8")
        mixed = directory / "mixed.wav"
        command += ["-filter_complex_script", str(graph_file), "-map", "[mix]", "-vn", "-c:a", "pcm_f32le",
                    "-ar", str(SAMPLE_RATE), "-ac", "2", "-rf64", "auto", "-map_metadata", "-1", "-map_chapters", "-1",
                    "-progress", "pipe:1", "-nostats", str(mixed)]
        progress("Mixing audio tracks", .01)
        _run(command, cancelled, directory=directory, duration=duration,
             progress=lambda stage, fraction: progress("Mixing audio tracks", .01 + .44 * fraction))
        source, audio_track = mixed, 0
        if request["format"] == "mp4":
            info, video = sources[request["videoMediaId"]]
            source = directory / "video-mix.nut"
            _run(common + ["-copyts", "-start_at_zero", "-protocol_whitelist", "file,pipe", "-i", str(video),
                 "-protocol_whitelist", "file,pipe", "-i", str(mixed), "-map", f"0:{info['videoStream']}",
                 "-map", "1:a:0", "-c:v", "copy", "-c:a", "pcm_f32le", "-t", f"{duration:.9f}",
                 "-map_metadata", "-1", "-map_chapters", "-1", str(source)],
                 cancelled, directory=directory)
            audio_track = 1
        result = render_media(source, destination, keep_ranges=request.get("keepRanges") or [{"start": 0, "end": duration}],
                              format=request["format"], audio_track=audio_track, frame_rate=request.get("frameRate", "30"),
                              cancelled=cancelled, progress=lambda stage, fraction: progress(stage, .45 + .55 * fraction))
        result["warnings"] = [w for w in result["warnings"] if not w.startswith("Only the selected source audio")]
        result["warnings"].append("The enabled tracks are mixed into 48 kHz stereo. Original sources and captions are unchanged.")
        if request.get("limiter", True):
            result["warnings"].append("A peak limiter prevents clipping; its reported lookahead is compensated.")
        else:
            result["warnings"].append("The peak limiter is disabled. Loud combined tracks may clip.")
        return result
