from __future__ import annotations

import copy
import hashlib
from pathlib import Path
import time
import threading
import wave

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from voicesubsep.audio_mixing import mix_audio, validate_mix
from voicesubsep.audio_mix_api import AudioMixJobManager, MixRequest, register_audio_mixing_routes
from voicesubsep.media import probe_media
from voicesubsep.media_cache import MediaCache
from voicesubsep.rendering import RenderCancelled
from voicesubsep.storage import Storage, new_id
from test_rendering import tone_file, ffmpeg, samples, rms_at, frequency_at


def source(path, frequencies=(440,), name="a"):
    if not path.exists():
        tone_file(path, frequencies)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return name * 32, ({**probe_media(path), "sha256": digest, "name": path.name}, path)


def track(sources, mid, **changes):
    return {"mediaId": mid, "sha256": sources[mid][0]["sha256"], "audioTrack": sources[mid][0]["audioTracks"][0]["index"],
            "gainDb": 0., "offsetSeconds": 0., "muted": False, **changes}


def run_mix(sources, output, tracks, **options):
    return mix_audio(sources, output, request={"tracks": tracks, "format": output.suffix[1:], **options},
                     progress=lambda *_: None, cancelled=lambda: False)


def test_offsets_gain_mute_cut_grid_and_originals_are_preserved(tmp_path):
    sources = dict([source(tmp_path / "one.wav", (440, 880)), source(tmp_path / "two.wav", (220,), "b")])
    hashes = {mid: hashlib.sha256(p.read_bytes()).hexdigest() for mid, (_, p) in sources.items()}
    a, b = sources
    output = tmp_path / "mixed.wav"
    result = run_mix(sources, output, [track(sources, a, offsetSeconds=.5, gainDb=-6), track(sources, b, muted=True)],
                     limiter=False, timelineDuration=3., keepRanges=[{"start": 0., "end": 1.}, {"start": 2., "end": 3.}])
    data = samples(output)
    assert len(data) == 96000
    assert rms_at(data, .05, .45) == 0
    assert abs(frequency_at(data, .6) - 440) < 10
    assert abs(frequency_at(data, 1.1) - 880) < 10
    assert rms_at(data, 1.6, 1.9) == 0
    original = samples(sources[a][1])
    # mono->stereo equal-power conversion: downmix amplitude is sqrt(.5).
    assert rms_at(data, .6, .9) / rms_at(original, .1, .4) == pytest.approx(10**(-6/20) * 2**-.5, rel=.01)
    assert result["keepRanges"] == [{"start": 0., "end": 1.}, {"start": 2., "end": 3.}]
    assert hashes == {mid: hashlib.sha256(p.read_bytes()).hexdigest() for mid, (_, p) in sources.items()}


def test_negative_offset_trims_start_and_sum_does_not_normalize_gain(tmp_path):
    sources = dict([source(tmp_path / "one.wav", (440, 880))])
    mid = next(iter(sources))
    single, double = tmp_path / "one-out.wav", tmp_path / "two-out.wav"
    item = track(sources, mid, offsetSeconds=-1., gainDb=-12.)
    run_mix(sources, single, [item], limiter=False)
    run_mix(sources, double, [item, item], limiter=False)
    one, two = samples(single), samples(double)
    assert len(one) == 48000
    assert abs(frequency_at(one, .2) - 880) < 10
    assert rms_at(two, .1, .8) / rms_at(one, .1, .8) == pytest.approx(2, rel=.01)


@pytest.mark.parametrize("format", ["wav", "mp3", "m4a"])
def test_formats_limiter_duration_and_clip_protection(tmp_path, format):
    sources = dict([source(tmp_path / "one.wav")]); mid = next(iter(sources))
    output = tmp_path / f"mixed.{format}"
    result = run_mix(sources, output, [track(sources, mid, gainDb=12.), track(sources, mid, gainDb=12.)])
    assert result["duration"] == pytest.approx(1.)
    assert probe_media(output)["duration"] == pytest.approx(1., abs=.08)
    if format == "wav":
        assert max(abs(n) for n in samples(output)) < 32700


def test_limiter_compensates_lookahead_for_impulse(tmp_path):
    path=tmp_path/"impulse.wav"
    with wave.open(str(path),"wb") as output:
        output.setparams((2,2,48000,0,"NONE","not compressed"))
        output.writeframes(bytes(4800*4)+(15000).to_bytes(2,"little",signed=True)*2+bytes((48000-4801)*4))
    sources=dict([source(path)]); mid=next(iter(sources)); dest=tmp_path/"limited.wav"
    run_mix(sources,dest,[track(sources,mid)])
    data=samples(dest)
    assert max(range(len(data)), key=lambda i:abs(data[i])) == 4800
    assert len(data)==48000


@pytest.mark.parametrize("fps", ["30", "60", "original"])
def test_obs_tracks_and_selected_video_with_cuts(tmp_path, fps):
    path=tmp_path/"obs.mkv"
    ffmpeg("-f","lavfi","-i","color=blue:s=32x32:r=25:d=2", "-f","lavfi","-i","sine=frequency=440:duration=2",
           "-f","lavfi","-i","sine=frequency=880:duration=2", "-map","0:v","-map","1:a","-map","2:a",
           "-c:v","ffv1","-c:a","pcm_s16le",path)
    sources=dict([source(path)]); mid=next(iter(sources)); output=tmp_path/"mixed.mp4"
    result=run_mix(sources,output,[track(sources,mid,audioTrack=1,muted=True),track(sources,mid,audioTrack=2)],
                   videoMediaId=mid,frameRate=fps,timelineDuration=2.,keepRanges=[{"start":.2,"end":.6}])
    assert probe_media(output)["frameRate"]==pytest.approx(25 if fps=="original" else int(fps))
    assert result["duration"]==pytest.approx(.4)
    assert abs(frequency_at(samples(output),.1,.15)-880)<15


def test_internal_delayed_audio_keeps_video_clock(tmp_path):
    path=tmp_path/"delayed.mkv"
    ffmpeg("-f","lavfi","-i","color=blue:s=32x32:r=25:d=2", "-itsoffset","0.5",
           "-f","lavfi","-i","sine=frequency=440:duration=1", "-map","0:v","-map","1:a","-c:v","ffv1","-c:a","pcm_s16le",path)
    sources=dict([source(path)]); mid=next(iter(sources)); output=tmp_path/"delayed.wav"
    run_mix(sources,output,[track(sources,mid)])
    data=samples(output)
    assert rms_at(data,.1,.4)==0
    assert rms_at(data,.6,.8)>100


@pytest.mark.parametrize("change", [
    {"gainDb":float("nan")},{"gainDb":13},{"offsetSeconds":float("inf")},{"offsetSeconds":-10},
    {"audioTrack":999},{"audioTrack":True},{"sha256":"0"*64},{"muted":"false"},
])
def test_invalid_decisions_are_rejected_without_creating_output(tmp_path, change):
    sources=dict([source(tmp_path/"one.wav")]); mid=next(iter(sources)); output=tmp_path/"bad.wav"
    with pytest.raises(ValueError):run_mix(sources,output,[track(sources,mid,**change)])
    assert not output.exists()


def test_cancel_cleanup_and_new_destination_guard(tmp_path):
    sources=dict([source(tmp_path/"one.wav")]); mid=next(iter(sources)); output=tmp_path/"cancel.wav"
    stopped=False
    def progress(*_):
        nonlocal stopped
        stopped=True
    with pytest.raises(RenderCancelled):
        mix_audio(sources,output,request={"tracks":[track(sources,mid)],"format":"wav"},progress=progress,cancelled=lambda:stopped)
    assert not output.exists() and not list(tmp_path.glob(".mix-*"))
    with pytest.raises(ValueError):run_mix(sources,sources[mid][1],[track(sources,mid)])


def cached_source(storage):
    mid=new_id();folder=storage.media/mid;folder.mkdir(parents=True)
    path=folder/"source.wav";tone_file(path,[440]);metadata={**probe_media(path),"id":mid,"name":"tone.wav","storedName":"source.wav","sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"bytes":path.stat().st_size}
    storage.write_json(folder/"metadata.json",metadata)
    return mid, (metadata,path)


def test_api_queue_history_restart_and_cache_protection(tmp_path):
    storage=Storage(tmp_path/"data");storage.initialize();sources=dict([cached_source(storage)]);mid=next(iter(sources))
    manager=AudioMixJobManager(storage);manager.start()
    app=FastAPI();register_audio_mixing_routes(app,manager,storage)
    payload={"tracks":[track(sources,mid)],"format":"wav"}
    cache=MediaCache(storage,manager.referenced_media_ids)
    try:
        with TestClient(app) as client:
            response=client.post("/api/audio-mixes",json=payload);assert response.status_code==200,response.text
            job_id=response.json()["id"]
            with pytest.raises(PermissionError):cache.remove(mid)
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                job=client.get(f"/api/audio-mixes/{job_id}").json()
                if job["status"] in {"completed","failed","cancelled"}:break
                time.sleep(.03)
            assert job["status"]=="completed",job
            assert client.get(f"/api/audio-mixes/{job_id}/file").content[:4]==b"RIFF"
            assert client.get("/api/audio-mixes").json()["jobs"][0]["id"]==job_id
            for invalid in [ {**payload,"path":"C:/private"}, {**payload,"tracks":[{**payload["tracks"][0],"mediaId":"../escape"}]}, {**payload,"tracks":[{**payload["tracks"][0],"audioTrack":False}]}]:
                assert client.post("/api/audio-mixes",json=invalid).status_code==422
    finally:manager.stop()
    restored=AudioMixJobManager(storage);restored.start()
    try:
        assert restored.get(job_id)["status"]=="completed"
        assert restored.referenced_media_ids()=={mid}
        restored.remove(job_id)
        assert not restored.referenced_media_ids()
        cache=MediaCache(storage,restored.referenced_media_ids);cache.remove(mid)
    finally:restored.stop()


def test_schema_refuses_nonfinite_and_empty_ranges():
    payload={"tracks":[{"mediaId":"a"*32,"sha256":"b"*64,"audioTrack":0,"gainDb":0.,"offsetSeconds":0.,"muted":False}]}
    for change in [{"keepRanges":[]},{"timelineDuration":0.},{"tracks":[]},{"tracks":[{**payload["tracks"][0],"gainDb":float("inf")}]}]:
        with pytest.raises(ValueError):MixRequest.model_validate({**payload,**change})


def test_running_cancel_queued_cancel_and_restart_interrupt(tmp_path):
    storage=Storage(tmp_path/"data");storage.initialize();sources=dict([cached_source(storage)]);mid=next(iter(sources))
    entered=threading.Event()
    def blocked_renderer(_sources, _destination, *, request, progress, cancelled):
        entered.set()
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            if cancelled():raise RenderCancelled("cancelled")
            time.sleep(.01)
        raise AssertionError("Cancellation was not received.")
    manager=AudioMixJobManager(storage,blocked_renderer);manager.start()
    payload=MixRequest.model_validate({"tracks":[track(sources,mid)],"format":"wav"}).model_dump()
    try:
        first=manager.submit(payload);assert entered.wait(2)
        second=manager.submit(payload)
        assert manager.cancel(second)["status"]=="cancelled"
        manager.cancel(first)
        deadline=time.monotonic()+3
        while time.monotonic()<deadline and manager.get(first)["status"]=="running":time.sleep(.01)
        assert manager.get(first)["status"]=="cancelled"
        assert not (manager.folder(first)/"edited.wav").exists()
    finally:manager.stop()
    interrupted=new_id();storage.write_json(manager.root/interrupted/"job.json",{"id":interrupted,"request":payload,"status":"running","progress":.5})
    restored=AudioMixJobManager(storage);restored.start()
    try:
        assert restored.get(interrupted)["status"]=="failed"
        assert restored.get(interrupted)["stage"]=="interrupted"
        assert restored.referenced_media_ids()=={mid}
    finally:restored.stop()


def test_host_application_mixer_routes_origin_guard_and_cleanup_reference(tmp_path):
    from voicesubsep.app import create_app
    path=tmp_path/"synthetic.wav";tone_file(path,[440])
    app=create_app(data_dir=tmp_path/"app-data")
    with TestClient(app,base_url="http://127.0.0.1:8787") as client:
        uploaded=client.post("/api/media",files={"file":("synthetic.wav",path.read_bytes(),"audio/wav")})
        assert uploaded.status_code==201,uploaded.text
        media=uploaded.json()
        payload={"tracks":[{"mediaId":media["id"],"sha256":media["sha256"],"audioTrack":media["audioTracks"][0]["index"],"gainDb":0.,"offsetSeconds":0.,"muted":False}],"format":"wav"}
        assert client.post("/api/audio-mixes",json=payload,headers={"Origin":"https://hostile.invalid"}).status_code==403
        created=client.post("/api/audio-mixes",json=payload)
        assert created.status_code==200,created.text
        job_id=created.json()["id"]
        assert client.delete(f"/api/media/{media['id']}").status_code==409
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            job=client.get(f"/api/audio-mixes/{job_id}").json()
            if job["status"] in {"completed","failed","cancelled"}:break
            time.sleep(.025)
        assert job["status"]=="completed",job
        assert client.delete(f"/api/media/{media['id']}").status_code==409
        assert client.delete(f"/api/audio-mixes/{job_id}/history").status_code==200
        assert client.delete(f"/api/media/{media['id']}").status_code==200
    assert not app.state.audio_mixes._thread.is_alive()


def test_host_mixer_start_failure_stops_existing_workers_and_releases_storage(tmp_path,monkeypatch):
    from voicesubsep.app import create_app
    app=create_app(data_dir=tmp_path/"startup-failure")
    def fail_start():raise RuntimeError("synthetic mixer startup failure")
    monkeypatch.setattr(app.state.audio_mixes,"start",fail_start)
    with pytest.raises(RuntimeError,match="synthetic mixer startup failure"):
        with TestClient(app,base_url="http://127.0.0.1:8787"):
            raise AssertionError("Startup should not succeed")
    assert not app.state.vst_previews._thread.is_alive()
    assert not app.state.renders._thread.is_alive()
    assert not app.state.jobs._thread.is_alive()
    other=Storage(tmp_path/"startup-failure");other.acquire();other.release()


def test_host_stop_failure_still_stops_later_workers_and_releases_storage(tmp_path,monkeypatch):
    from voicesubsep.app import create_app
    folder=tmp_path/"stop-failure"
    app=create_app(data_dir=folder)
    actual_stop=app.state.vst_previews.stop
    def fail_after_stop():
        actual_stop()
        raise OSError("synthetic stop persistence failure")
    monkeypatch.setattr(app.state.vst_previews,"stop",fail_after_stop)
    try:
        with pytest.raises(OSError,match="synthetic stop persistence failure"):
            with TestClient(app,base_url="http://127.0.0.1:8787"):
                pass
        assert not app.state.audio_mixes._thread.is_alive()
        assert not app.state.vst_previews._thread.is_alive()
        assert not app.state.renders._thread.is_alive()
        assert not app.state.jobs._thread.is_alive()
        other=Storage(folder);other.acquire();other.release()
    finally:
        # Keep a failing regression from leaving a worker behind in the suite.
        if app.state.renders._thread.is_alive():app.state.renders.stop()
