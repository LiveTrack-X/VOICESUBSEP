"""Bounded peak summaries; full recordings never enter browser or Python RAM."""
from __future__ import annotations
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading

from .media_cache import signature


class Waveforms:
    def __init__(self, storage):
        self.storage = storage
        self._active: set[str] = set()
        self._mutex = threading.RLock()
        self._worker = threading.Lock()

    def referenced_media_ids(self):
        with self._mutex:
            return set(self._active)

    def get(self, media_id: str, audio_track: int, points: int = 2000):
        if not 128 <= points <= 4000:
            raise ValueError("Choose between 128 and 4000 waveform points.")
        with self.storage.media_lock:
            metadata, source = self.storage.get_media(media_id)
            if audio_track not in {t["index"] for t in metadata["audioTracks"]}:
                raise ValueError("Select an audio track in this recording.")
            cache = source.parent / f"waveform-{audio_track}-{points}.json"
            source_signature = signature(source)
            try:
                saved = self.storage.read_json(cache)
                if saved.get("sourceSignature") == source_signature:
                    return saved["waveform"]
            except (OSError, ValueError, KeyError):
                pass
            if not self._worker.acquire(blocking=False):
                raise OverflowError("Another waveform is being prepared. Try again shortly.")
            with self._mutex:
                self._active.add(media_id)
        try:
            result = extract_peaks(source, duration=metadata["duration"], audio_track=audio_track, points=points)
            value = {"mediaId": media_id, "audioTrack": audio_track, "duration": metadata["duration"], "peaks": result}
            with self.storage.media_lock:
                if signature(source) != source_signature:
                    raise ValueError("The source changed while preparing its waveform.")
                self.storage.write_json(cache, {"sourceSignature": source_signature, "waveform": value})
            return value
        finally:
            with self._mutex:
                self._active.discard(media_id)
            self._worker.release()


def extract_peaks(source: Path, *, duration: float, audio_track: int, points: int):
    binary = shutil.which("ffmpeg")
    if not binary:
        raise RuntimeError("FFmpeg is required to prepare waveforms.")
    # FFmpeg computes a peak for each time bin. Only at most 4000 metadata
    # records are retained; file-backed pipes keep long recordings bounded.
    samples_per_bin = max(1, math.ceil(duration * 8000 / points))
    filters = (f"aresample=8000:async=1:first_pts=0,aformat=channel_layouts=mono,"
               f"apad=whole_dur={duration:.9f},atrim=duration={duration:.9f},"
               f"asetnsamples=n={samples_per_bin}:p=1,astats=metadata=1:reset=1,"
               "ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=-")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        try:
            completed = subprocess.run([binary, "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2",
                "-copyts", "-start_at_zero", "-protocol_whitelist", "file,pipe", "-i", str(source),
                "-map", f"0:{audio_track}", "-vn", "-sn", "-dn", "-filter_threads", "1",
                "-af", filters, "-f", "null", "-"], stdout=output, stderr=errors, timeout=180,
                creationflags=flags, check=False)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Waveform preparation timed out. The recording can still be edited.") from exc
        if completed.returncode:
            raise ValueError("The waveform could not be decoded for this recording.")
        if output.tell() > 2 * 1024**2:
            raise ValueError("The waveform response exceeded its bounded size.")
        output.seek(0)
        values = re.findall(rb"lavfi\.astats\.Overall\.Peak_level=([^\r\n]+)", output.read())
    peaks = []
    for raw in values[:points]:
        try:
            db = float(raw)
            amplitude = min(1.0, max(0.0, 10 ** (db / 20))) if math.isfinite(db) else 0.0
        except (ValueError, OverflowError):
            amplitude = 0.0
        peaks.append(round(amplitude, 5))
    if not values:
        raise ValueError("The waveform contained no audio samples.")
    # Bins use a rounded sample count; expose their actual duration so drawing
    # remains on the original timeline rather than stretching the last bin.
    return {"values": peaks, "secondsPerPoint": samples_per_bin / 8000, "requestedPoints": points}
