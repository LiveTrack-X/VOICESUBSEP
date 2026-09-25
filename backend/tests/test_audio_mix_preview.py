from __future__ import annotations

import hashlib
import time
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from voicesubsep.audio_mixing import preview_audio
from voicesubsep.audio_mix_api import AudioMixJobManager, AudioMixPreviewManager, register_audio_mixing_routes
from voicesubsep.rendering import RenderCancelled
from voicesubsep.storage import Storage
from test_audio_mixing import source, track, cached_source
from test_rendering import ffmpeg, samples, rms_at, frequency_at


def preview(sources, output, tracks, **options):
    return preview_audio(sources, output, request={"tracks": tracks, "start": 0., "duration": 10., **options},
                         progress=lambda *_: None, cancelled=lambda: False)


def test_actual_obs_selected_stream_and_late_seek(tmp_path):
    path = tmp_path / "obs.mkv"
    ffmpeg("-f", "lavfi", "-i", "color=blue:s=32x32:r=25:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
           "-f", "lavfi", "-i", "sine=frequency=880:duration=4", "-map", "0:v", "-map", "1:a", "-map", "2:a",
           "-c:v", "ffv1", "-c:a", "pcm_s16le", path)
    sources = dict([source(path)]); mid = next(iter(sources)); output = tmp_path / "preview.wav"
    original = hashlib.sha256(path.read_bytes()).hexdigest()
    result = preview(sources, output, [track(sources, mid, audioTrack=2)], start=2.5, duration=.5)
    assert result["start"] == 2.5 and result["duration"] == .5
    assert len(samples(output)) == 24000
    assert abs(frequency_at(samples(output), .1, .15) - 880) < 15
    assert hashlib.sha256(path.read_bytes()).hexdigest() == original


def test_pre_limiter_float_peak_detects_sum_clipping_and_limiter_output(tmp_path):
    sources = dict([source(tmp_path / "one.wav")]); mid = next(iter(sources))
    tracks = [track(sources, mid, gainDb=12.)] * 2
    limited = preview(sources, tmp_path / "limited.wav", tracks, limiter=True)
    raw = preview(sources, tmp_path / "raw.wav", tracks, limiter=False)
    quiet = preview(sources, tmp_path / "quiet.wav", [track(sources, mid, gainDb=-20.)], limiter=False)
    assert limited["clipping"] and limited["clippedSamples"] > 0 and limited["peakDbfs"] > 5
    assert limited["peakDbfs"] == pytest.approx(raw["peakDbfs"])
    assert limited["outputPeakDbfs"] < -.1 and raw["outputPeakDbfs"] == 0
    assert not quiet["clipping"] and quiet["peakDbfs"] < -25


def test_delayed_stream_offsets_silence_and_negative_offset(tmp_path):
    path = tmp_path / "delayed.mkv"
    ffmpeg("-f", "lavfi", "-i", "color=blue:s=32x32:r=25:d=3", "-itsoffset", "0.5",
           "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-map", "0:v", "-map", "1:a",
           "-c:v", "ffv1", "-c:a", "pcm_s16le", path)
    sources = dict([source(path)]); mid = next(iter(sources))
    preview(sources, tmp_path / "delayed.wav", [track(sources, mid, offsetSeconds=.25)], start=.5, duration=.75)
    data = samples(tmp_path / "delayed.wav")
    assert rms_at(data, .02, .2) == 0 and rms_at(data, .3, .6) > 100
    preview(sources, tmp_path / "negative.wav", [track(sources, mid, offsetSeconds=-1.)], start=1., duration=.4)
    assert rms_at(samples(tmp_path / "negative.wav"), .05, .3) > 100
    silent = preview(sources, tmp_path / "silence.wav", [track(sources, mid, offsetSeconds=4.)], duration=1.)
    assert silent["peakDbfs"] is None and silent["outputPeakDbfs"] is None


@pytest.mark.parametrize("options", [{"start": -1.}, {"start": 1.}, {"start": .99999999}, {"duration": 11.}, {"duration": 0.}, {"start": float("nan")}])
def test_invalid_windows_rejected_before_output(tmp_path, options):
    sources = dict([source(tmp_path / "one.wav")]); mid = next(iter(sources)); output = tmp_path / "bad.wav"
    with pytest.raises(ValueError):
        preview(sources, output, [track(sources, mid)], **options)
    assert not output.exists()


def test_preview_api_separate_history_discard_cache_refs_and_restart_cleanup(tmp_path):
    storage = Storage(tmp_path / "data"); storage.initialize(); sources = dict([cached_source(storage)]); mid = next(iter(sources))
    manager = AudioMixJobManager(storage); manager.start()
    app = FastAPI(); register_audio_mixing_routes(app, manager, storage)
    try:
        with TestClient(app) as client:
            payload = {"tracks": [track(sources, mid)], "start": .1, "duration": .5}
            assert client.post("/api/audio-mix-previews", json={**payload, "duration": 11.}).status_code == 422
            response = client.post("/api/audio-mix-previews", json=payload); assert response.status_code == 200, response.text
            job_id = response.json()["id"]
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                job = client.get(f"/api/audio-mix-previews/{job_id}").json()
                if job["status"] in {"completed", "failed"}: break
                time.sleep(.02)
            assert job["status"] == "completed", job
            assert job["result"]["peakDbfs"] < 0
            assert client.get(job["result"]["url"]).content[:4] == b"RIFF"
            assert not manager.history() and not manager.referenced_media_ids()
            assert client.delete(f"/api/audio-mix-previews/{job_id}").status_code == 200
            assert client.get(f"/api/audio-mix-previews/{job_id}").status_code == 404
            leftover = manager.previews.folder("c" * 32)
            storage.write_json(leftover / "job.json", {"status": "interrupted"})
            unrelated = manager.previews.root / "keep-unrelated.txt"
            unrelated.write_text("preserve", encoding="utf-8")
    finally: manager.stop()
    assert not manager.previews._thread.is_alive()
    restored = AudioMixJobManager(storage); restored.start()
    try:
        assert not leftover.exists() and unrelated.read_text(encoding="utf-8") == "preserve"
        assert not restored.previews.referenced_media_ids()
    finally: restored.stop()


def test_discard_running_preview_cancels_and_removes_partial_work(tmp_path):
    storage = Storage(tmp_path / "data"); storage.initialize(); sources = dict([cached_source(storage)]); mid = next(iter(sources))
    entered = threading.Event()
    def renderer(_sources, destination, *, request, progress, cancelled):
        entered.set()
        for _ in range(200):
            if cancelled(): raise RenderCancelled("cancelled")
            time.sleep(.01)
        raise AssertionError("Cancellation was not received")
    manager = AudioMixPreviewManager(storage, renderer); manager.start()
    try:
        job_id = manager.submit({"tracks": [track(sources, mid)], "start": 0., "duration": 1.})
        assert entered.wait(2) and manager.referenced_media_ids() == {mid}
        manager.discard(job_id)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and manager.folder(job_id).exists(): time.sleep(.02)
        assert not manager.folder(job_id).exists() and not manager.referenced_media_ids()
    finally: manager.stop()
