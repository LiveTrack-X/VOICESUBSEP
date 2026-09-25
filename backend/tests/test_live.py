import io
import threading
import time
import wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from voicesubsep.app import create_app
from voicesubsep.inference import AnalysisCancelled, build_result
from voicesubsep.live import LiveManager, MAX_SAMPLES
from voicesubsep.live_native import NativeLiveEngine, cached_model_paths
from voicesubsep.storage import Storage


class FakeEngine:
    instances = []
    def __init__(self, request, cancelled, stage):
        self.instances.append(self)
        self.cancelled = cancelled
        self.closed = False
        self.calls = []
    def advance(self, path, samples, final=False):
        self.calls.append((samples, final))
        if self.cancelled():
            raise AnalysisCancelled()
        duration = samples / 16000
        records = [{"start": 0., "end": duration, "text": "실제 API 흐름 검증용 합성 초안"}]
        return build_result(records, [{"speaker": "persistent-0", "start": 0., "end": duration}],
                            duration=duration, speaker_count=1, mode="standard"), duration
    def close(self):
        self.closed = True


def wait_state(client, identity, predicate):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        state = client.get(f"/api/live/sessions/{identity}").json()
        if predicate(state):
            return state
        time.sleep(.01)
    raise AssertionError(state)


def create(client):
    response = client.post("/api/live/sessions", json={"speakerCount": 1, "device": "cpu", "diarization": True})
    assert response.status_code == 202, response.text
    return response.json()["id"]


def send(client, identity, seq, payload=b"\x01\x00" * 8000):
    return client.post(f"/api/live/sessions/{identity}/audio?seq={seq}", content=payload,
                       headers={"Content-Type": "application/octet-stream"})


def test_incremental_before_stop_single_engine_original_pcm_and_history(tmp_path):
    FakeEngine.instances.clear()
    app = create_app(data_dir=tmp_path, live_engine_factory=FakeEngine)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identity = create(client)
        assert send(client, identity, 0).status_code == 200
        assert send(client, identity, 1).status_code == 200
        interim = wait_state(client, identity, lambda s: s["processedSeconds"] == 1.)
        assert interim["status"] == "running" and interim["captions"]
        assert "result" not in interim
        assert len(FakeEngine.instances) == 1
        assert client.post(f"/api/live/sessions/{identity}/stop").status_code == 202
        final = wait_state(client, identity, lambda s: s["status"] == "completed")
        assert final["result"]["duration"] == 1.
        assert final["result"]["captions"][0]["start"] == 0
        assert FakeEngine.instances[0].closed
        source = client.get(final["sourceUrl"])
        with wave.open(io.BytesIO(source.content)) as wav:
            assert wav.getparams()[:4] == (1, 2, 16000, 16000)
            assert wav.readframes(16000) == b"\x01\x00" * 16000
        assert "result" not in client.get("/api/live/sessions").json()["items"][0]
    restored = create_app(data_dir=tmp_path, live_engine_factory=FakeEngine)
    with TestClient(restored, base_url="http://127.0.0.1:8787") as client:
        assert client.get(f"/api/live/sessions/{identity}").json()["result"] == final["result"]


def test_sequence_retry_gaps_size_origin_and_abort_preserves_original(tmp_path):
    app = create_app(data_dir=tmp_path, live_engine_factory=FakeEngine)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        assert client.post("/api/live/sessions", json={}, headers={"Origin": "https://evil.invalid"}).status_code == 403
        identity = create(client)
        assert send(client, identity, 0).status_code == 200
        assert send(client, identity, 0).json()["receivedSeconds"] == .5
        assert send(client, identity, 0, b"\x02\x00" * 8000).status_code == 422
        assert send(client, identity, 2).status_code == 422
        for bad in [b"", b"0"]:
            assert send(client, identity, 1, bad).status_code == 422
        assert send(client, identity, 1, b"0" * 64002).status_code == 413
        assert send(client, identity, 1, b"0" * 65538).status_code == 413
        client.delete(f"/api/live/sessions/{identity}")
        final = wait_state(client, identity, lambda s: s["status"] == "cancelled")
        assert "result" not in final and final["receivedSeconds"] == .5
        assert send(client, identity, 1).status_code == 409
        assert len(client.get(final["sourceUrl"]).content) == 16044


def test_overlay_read_only_token_mute_clear_and_terminal_removal(tmp_path):
    app = create_app(data_dir=tmp_path, live_engine_factory=FakeEngine)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identity = create(client)
        send(client, identity, 0)
        state = wait_state(client, identity, lambda s: bool(s["captions"]))
        overlay = state["overlayUrl"]
        assert overlay.startswith("http://127.0.0.1:8787/live-overlay/")
        assert client.get(overlay).status_code == 200
        assert client.get(overlay + "/state").json()["captions"]
        assert client.get(f"/live-overlay/{identity}/wrong/state").status_code == 404
        assert client.post(overlay + "/state", json={"muted": True}).status_code == 405
        client.post(f"/api/live/sessions/{identity}/overlay", json={"muted": True})
        assert client.get(overlay + "/state").json()["captions"] == []
        client.post(f"/api/live/sessions/{identity}/overlay", json={"muted": False, "clear": True})
        assert client.get(overlay + "/state").json()["captions"] == []
        client.post(f"/api/live/sessions/{identity}/stop")
        wait_state(client, identity, lambda s: s["status"] == "completed")
        assert client.get(overlay + "/state").json()["captions"] == []


def test_file_jobs_and_live_are_mutually_exclusive(tmp_path, monkeypatch):
    app = create_app(data_dir=tmp_path, live_engine_factory=FakeEngine)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        monkeypatch.setattr(app.state.jobs, "history", lambda: [{"status": "queued"}])
        assert client.post("/api/live/sessions", json={}).status_code == 409
        monkeypatch.setattr(app.state.jobs, "history", lambda: [])
        identity = create(client)
        assert client.post("/api/live/sessions", json={}).status_code == 409
        assert client.post("/api/jobs", json={"mediaId": "a" * 32, "speakerCount": 1, "audioTrack": 0}).status_code == 409
        client.delete(f"/api/live/sessions/{identity}")


def test_model_loading_cancel_error_overload_and_recovery(tmp_path):
    entered = threading.Event()
    def blocked(_request, cancelled, _stage):
        entered.set()
        while not cancelled():
            time.sleep(.005)
        raise AnalysisCancelled()
    app = create_app(data_dir=tmp_path, live_engine_factory=blocked)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identity = create(client)
        assert entered.wait(1)
        for seq in range(11):
            assert send(client, identity, seq, b"\0\0" * 32000).status_code == 200
        state = client.get(f"/api/live/sessions/{identity}").json()
        assert state["overloaded"] and state["lagSeconds"] == 22
        client.delete(f"/api/live/sessions/{identity}")
        wait_state(client, identity, lambda s: s["status"] == "cancelled")
    metadata = app.state.live.folder(identity) / "session.json"
    record = app.state.storage.read_json(metadata)
    record["status"] = "running"
    app.state.storage.write_json(metadata, record)
    restored = LiveManager(Storage(tmp_path)); restored.start()
    assert restored.get(identity)["status"] == "interrupted"
    assert restored.get(identity)["receivedSeconds"] == 22
    def broken(*_args):
        raise RuntimeError("cached weights missing")
    restored.factory = broken
    other = restored.create({})["id"]
    restored.thread.join(2)
    assert restored.get(other)["status"] == "failed"
    assert "cached weights" in restored.get(other)["error"]
    restored.stop()


def test_cache_lookup_cannot_download_missing_models(monkeypatch, tmp_path):
    from voicesubsep import model_cache
    monkeypatch.setattr(model_cache, "_local_model_root", lambda: tmp_path)
    calls = []
    def offline(name, **kwargs):
        calls.append(kwargs)
        raise OSError("not cached")
    monkeypatch.setattr(model_cache, "_download_model", offline)
    with pytest.raises(RuntimeError, match="다운로드하지"):
        cached_model_paths("tiny")
    assert calls == [{"local_files_only": True}]


def test_native_activity_retains_channel_identity_and_original_time():
    engine = NativeLiveEngine.__new__(NativeLiveEngine)
    engine.np = np
    engine.processor = SimpleNamespace(feature_extractor=SimpleNamespace(hop_length=160))
    engine.intervals = []; engine.last_interval = {}; engine.frame_cursor = 0
    engine._append_activity(np.array([[True, False], [True, True], [False, True]]))
    engine._append_activity(np.array([[False, True], [True, False]]))
    assert engine.intervals == [
        {"speaker": "live-0", "start": 0., "end": .02},
        {"speaker": "live-1", "start": .01, "end": .04},
        {"speaker": "live-0", "start": .04, "end": .05}]


def test_source_limit_is_enforced_without_allocating_two_hours(tmp_path, monkeypatch):
    import voicesubsep.live as live
    monkeypatch.setattr(live, "MAX_SAMPLES", 8000)
    app = create_app(data_dir=tmp_path, live_engine_factory=FakeEngine)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identity = create(client)
        assert send(client, identity, 0).status_code == 200
        assert send(client, identity, 1).status_code == 413
        assert client.get(f"/api/live/sessions/{identity}").json()["receivedSeconds"] == .5


def test_native_persistent_speaker_cache_and_whisper_boundary_ownership(tmp_path):
    from contextlib import nullcontext
    class Tensor:
        def __init__(self, value): self.value = value
        def __getitem__(self, i): return Tensor(self.value[i])
        def detach(self): return self
        def cpu(self): return self
        def numpy(self): return self.value
    class Batch(dict):
        def to(self, *_args, **_kwargs): return self
    class Processor:
        feature_extractor = SimpleNamespace(hop_length=160)
        num_samples_first_audio_chunk = 6400
        num_samples_per_audio_chunk = 6400
        num_mel_frames_per_step = 40
        def audio_chunk_start(self, cursor): return cursor * 160
        def __call__(self, audio, **kwargs):
            return Batch(frames=len(audio) // 160, flags=kwargs)
    cache = object(); seen = []
    class Model:
        device = "cpu"; dtype = "float32"
        def __call__(self, frames, flags, speaker_cache=None, **_kwargs):
            seen.append(speaker_cache)
            return SimpleNamespace(speaker_cache=cache, logits=Tensor(np.ones((1, frames, 2))))
    class Whisper:
        calls = 0
        def transcribe(self, _audio, **_kwargs):
            self.calls += 1
            # Same word is seen in both windows, owned by its source midpoint.
            values = [(.5, 1., "A"), (3.8, 4.2, " boundary")] if self.calls == 1 else [(.8, 1.2, " boundary"), (2., 3., " C")]
            words = [SimpleNamespace(start=a, end=b, word=text, probability=.9) for a, b, text in values]
            return iter([SimpleNamespace(words=words)]), None
    engine = NativeLiveEngine.__new__(NativeLiveEngine)
    engine.np = np; engine.processor = Processor(); engine.model = Model(); engine.whisper = Whisper()
    engine.torch = SimpleNamespace(inference_mode=nullcontext)
    engine.cancelled = lambda: False; engine.request = {"language": "auto", "speakerCount": 2}
    engine.cache = None; engine.records = []; engine.intervals = []; engine.last_interval = {}
    engine.frame_cursor = 0; engine.chunk_cursor = 0; engine.first = True; engine.committed = 0
    engine.detected_language = None
    path = tmp_path / "synthetic.pcm"; path.write_bytes(b"\x00\x10" * 128000)
    early, processed = engine.advance(path, 80000)
    assert processed == 4. and [c["text"] for c in early["captions"]] == ["A"]
    final, processed = engine.advance(path, 128000, True)
    assert processed == 8.
    assert " ".join(c["text"] for c in final["captions"]).count("boundary") == 1
    boundary = next(w for c in final["captions"] for w in c["words"] if "boundary" in w["text"])
    assert boundary["start"] == 3.8 and boundary["end"] == 4.2
    assert seen[0] is None and all(value is cache for value in seen[1:])
    assert engine.whisper.calls == 2


def _language_test_engine(tmp_path, results, language="auto"):
    """Isolate ASR language policy after sufficient diarization lookahead."""
    class Whisper:
        def __init__(self): self.options = []
        def transcribe(self, _audio, **options):
            text, detected, probability = results[len(self.options)]
            self.options.append(options)
            words = [] if text is None else [SimpleNamespace(start=1., end=1.5, word=text, probability=.9)]
            return iter([SimpleNamespace(words=words)]), SimpleNamespace(
                language=detected, language_probability=probability)
    engine = NativeLiveEngine.__new__(NativeLiveEngine)
    engine.np = np; engine.whisper = Whisper()
    # No new diarization chunk is due in this unit fixture. Its lookahead is
    # already available; the integration fixture above covers persistent caches.
    engine.processor = SimpleNamespace(num_samples_first_audio_chunk=1 << 30,
                                      feature_extractor=SimpleNamespace(hop_length=160))
    engine.cancelled = lambda: False; engine.request = {"language": language, "speakerCount": 2}
    engine.records = []; engine.intervals = []; engine.frame_cursor = 2000
    engine.chunk_cursor = 0; engine.first = True; engine.committed = 0; engine.detected_language = None
    path = tmp_path / "language-policy.pcm"
    path.write_bytes(b"\x00\x10" * (13 * 16000))
    return engine, path


def test_live_auto_keeps_first_confident_language_without_filtering_other_text(tmp_path):
    engine, path = _language_test_engine(tmp_path, [
        ("한국어", "ko", .9), (" I don't know.", "en", .99), (" 日本語", "ja", .99)])
    for seconds in (5, 9, 13):
        engine.advance(path, seconds * 16000)
    assert [options["language"] for options in engine.whisper.options] == [None, "ko", "ko"]
    assert all(options["multilingual"] is False and options["task"] == "transcribe"
               for options in engine.whisper.options)
    assert [record["text"] for record in engine.records] == ["한국어", " I don't know.", " 日本語"]
    assert engine.detected_language == "ko"
    fresh, path = _language_test_engine(tmp_path, [("Hello", "en", .9)])
    fresh.advance(path, 5 * 16000)
    assert fresh.whisper.options[0]["language"] is None
    assert fresh.detected_language == "en"


@pytest.mark.parametrize("text,probability", [
    ("uncertain", .49), ("uncertain", float("nan")), ("uncertain", None),
    ("uncertain", True), (None, .99), ("   ", .99)])
def test_live_auto_retries_uncertain_or_empty_detection_without_language_fallback(tmp_path, text, probability):
    engine, path = _language_test_engine(tmp_path, [
        (text, "en", probability), ("こんにちは", "ja", .8), ("Hello", "en", .99)])
    engine.advance(path, 5 * 16000)
    assert engine.detected_language is None
    engine.advance(path, 9 * 16000)
    engine.advance(path, 13 * 16000)
    assert [options["language"] for options in engine.whisper.options] == [None, None, "ja"]
    assert engine.detected_language == "ja"


def test_live_explicit_language_is_not_replaced_by_auto_detection(tmp_path):
    engine, path = _language_test_engine(tmp_path, [("Hello", "en", .99)] * 2, language="ko")
    engine.advance(path, 5 * 16000)
    engine.advance(path, 9 * 16000)
    assert [options["language"] for options in engine.whisper.options] == ["ko", "ko"]
    assert all(options["multilingual"] is False and options["task"] == "transcribe"
               for options in engine.whisper.options)
    assert engine.detected_language is None


def test_shutdown_finishes_native_close_before_releasing_storage(tmp_path):
    entered = threading.Event()
    class SlowEngine(FakeEngine):
        def advance(self, *_args):
            entered.set()
            while not self.cancelled(): time.sleep(.005)
            raise AnalysisCancelled()
    app = create_app(data_dir=tmp_path, live_engine_factory=SlowEngine)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identity = create(client); send(client, identity, 0)
        assert entered.wait(1)
    assert not app.state.live.thread.is_alive()
    assert FakeEngine.instances[-1].closed
    other = Storage(tmp_path); other.acquire(); other.release()
    assert app.state.live.get(identity)["status"] == "cancelled"


def test_history_removal_refuses_active_and_only_removes_selected_recording(tmp_path):
    app = create_app(data_dir=tmp_path, live_engine_factory=FakeEngine)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        identity = create(client)
        assert client.delete(f"/api/live/sessions/{identity}/history").status_code == 409
        send(client, identity, 0)
        client.delete(f"/api/live/sessions/{identity}")
        wait_state(client, identity, lambda s: s["status"] == "cancelled")
        other = create(client)
        assert client.delete(f"/api/live/sessions/{identity}/history").status_code == 200
        assert not app.state.live.folder(identity).exists()
        assert app.state.live.folder(other).exists()
        assert client.get(f"/api/live/sessions/{identity}").status_code == 404


def test_live_start_failure_stops_existing_workers(tmp_path, monkeypatch):
    app = create_app(data_dir=tmp_path, live_engine_factory=FakeEngine)
    def failure(): raise OSError("synthetic live startup failure")
    monkeypatch.setattr(app.state.live, "start", failure)
    with pytest.raises(OSError, match="synthetic live startup"):
        with TestClient(app, base_url="http://127.0.0.1:8787"):
            pass
    assert not app.state.audio_mixes._thread.is_alive()
    assert not app.state.renders._thread.is_alive()
    assert not app.state.vst_previews._thread.is_alive()
    assert not app.state.jobs._thread.is_alive()
