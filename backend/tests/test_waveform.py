import array
import io
import math
import shutil
import threading
import wave

from fastapi.testclient import TestClient
import pytest

from voicesubsep.app import create_app
from voicesubsep import waveform


def tone():
    values = array.array("h", [round(12000 * math.sin(2 * math.pi * 440 * i / 8000)) for i in range(8000)] + [0] * 8000)
    stream = io.BytesIO()
    with wave.open(stream,"wb") as out:
        out.setparams((1,2,8000,0,"NONE","not compressed"));out.writeframes(values.tobytes())
    return stream.getvalue()


def test_waveform_bounded_bins_silence_original_time_and_cache(tmp_path, monkeypatch):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("FFmpeg required")
    with TestClient(create_app(data_dir=tmp_path),base_url="http://127.0.0.1:8787") as client:
        source=tone()
        info=client.post("/api/media",files={"file":("source.wav",source,"audio/wav")}).json()
        path=f"/api/media/{info['id']}/waveform?audioTrack=0&points=128"
        response=client.get(path)
        assert response.status_code==200,response.text
        value=response.json()
        assert value["duration"]==pytest.approx(2)
        assert value["peaks"]["secondsPerPoint"]==pytest.approx(2/128)
        peaks=value["peaks"]["values"]
        assert len(peaks)==128 and max(peaks)<1
        assert min(peaks[2:60])>.25
        assert max(peaks[70:])<.001
        monkeypatch.setattr(waveform,"extract_peaks",lambda *a,**kw: pytest.fail("Cache was not reused"))
        assert client.get(path).json()==value
        assert client.get(info["url"]).content==source
        assert client.get(path.replace("points=128","points=100000")).status_code==422


def test_active_waveform_protects_cache_without_holding_up_other_requests(tmp_path,monkeypatch):
    entered,release=threading.Event(),threading.Event()
    def extract(*args,**kwargs):
        entered.set();assert release.wait(3)
        return {"values":[0]*128,"secondsPerPoint":1/128,"requestedPoints":128}
    monkeypatch.setattr(waveform,"extract_peaks",extract)
    probe=lambda _: {"duration":1,"audioTracks":[{"index":0,"channels":1,"label":"A"}]}
    with TestClient(create_app(data_dir=tmp_path,probe=probe),base_url="http://127.0.0.1:8787") as client:
        info=client.post("/api/media",files={"file":("test.wav",b"fixture","audio/wav")}).json()
        path=f"/api/media/{info['id']}/waveform?audioTrack=0&points=128"
        results=[]
        thread=threading.Thread(target=lambda:results.append(client.get(path)));thread.start()
        try:
            assert entered.wait(2)
            assert client.delete(f"/api/media/{info['id']}").status_code==409
            assert client.get(path).status_code==429
        finally:
            release.set();thread.join(3)
        assert results[0].status_code==200
        assert client.delete(f"/api/media/{info['id']}").status_code==200
