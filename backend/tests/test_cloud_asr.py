from __future__ import annotations

import base64
import copy
import io
import json
from pathlib import Path
import socket
import threading
import time
import wave

import pytest
from fastapi.testclient import TestClient

from voicesubsep import cloud_asr, inference
from voicesubsep.app import create_app
from voicesubsep.cloud_credentials import PROVIDERS, ProviderCredentials

KEY = "test-key-never-persist-123456789"


def wav(path: Path, seconds=1.0):
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        output.writeframes(b"\0\0" * round(16000 * seconds))
    return path


def reply(provider="groq"):
    if provider == "gemini":
        return {"id": "interactions/test", "status": "completed", "steps": [{"type": "model_output", "content": [{
            "type": "text", "text": "Hello world.", "annotations": [
                {"type": "word_info", "text": "Hello", "start_offset": "0.100s", "end_offset": "0.300s"},
                {"type": "word_info", "text": "world", "start_offset": "0.400s", "end_offset": "0.700s"},
            ],
        }]}]}
    field = "word" if provider == "groq" else "text"
    return {"text": "Hello world.", "words": [
        {field: "Hello", "start": 0.1, "end": 0.3},
        {field: "world.", "start": 0.4, "end": 0.7},
    ]}


class FakeConnection:
    def __init__(self, status=200, payload=None):
        self.status = status
        self.raw = io.BytesIO(json.dumps(reply() if payload is None else payload).encode())
        self.headers = {}
        self.sent = []
        self.sock = None
        self.closed = False

    def putrequest(self, method, path):
        self.request = (method, path)

    def connect(self):
        pass

    def putheader(self, name, value):
        self.headers[name] = value

    def endheaders(self):
        pass

    def send(self, content):
        self.sent.append(content)

    def getresponse(self):
        return self

    def read(self, size):
        return self.raw.read(size)

    def close(self):
        self.closed = True


@pytest.mark.parametrize("provider,model", [("groq", "whisper-large-v3"), ("xai", "grok-voice-transcribe-2.0")])
def test_official_multipart_contracts(monkeypatch, tmp_path, provider, model):
    connection = FakeConnection(payload=reply(provider))
    calls = []
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda host, timeout: calls.append((host, timeout)) or connection)
    audio = wav(tmp_path / "private-user-filename.wav")
    result = cloud_asr._post_audio(provider, model, "ko", KEY, audio, lambda: False)
    assert result == reply(provider)
    assert calls == [(cloud_asr.ENDPOINTS[provider][0], 30)]
    assert connection.request == ("POST", cloud_asr.ENDPOINTS[provider][1])
    assert connection.headers["Authorization"] == "Bearer " + KEY
    body = b"".join(connection.sent)
    assert int(connection.headers["Content-Length"]) == len(body)
    assert b"private-user-filename" not in body and KEY.encode() not in body
    assert b'filename="audio.wav"' in body
    if provider == "groq":
        assert b"verbose_json" in body and body.count(b'timestamp_granularities[]') == 2
        assert b'name="language"\r\n\r\nko' in body
    else:
        assert b'name="filler_words"\r\n\r\ntrue' in body
        assert b'name="format"\r\n\r\nfalse' in body
        assert b'name="diarize"\r\n\r\nfalse' in body
        assert b'name="language"' not in body
        assert body.rfind(b"Content-Disposition") == body.index(b'Content-Disposition: form-data; name="file"')
    assert connection.closed


@pytest.mark.parametrize("provider,model", [("groq", "whisper-large-v3"), ("gemini", "gemini-3.5-transcribe")])
@pytest.mark.parametrize("status", [301, 302, 307, 401, 403, 429, 500])
def test_no_redirect_retry_or_remote_error_echo(monkeypatch, tmp_path, status, provider, model):
    connection = FakeConnection(status=status, payload={"error": KEY})
    calls = []
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: calls.append(a) or connection)
    with pytest.raises(cloud_asr.CloudASRError) as caught:
        cloud_asr._post_audio(provider, model, "auto", KEY, wav(tmp_path / "a.wav"), lambda: False)
    assert KEY not in str(caught.value)
    assert len(calls) == 1
    assert connection.closed
    assert connection.raw.tell() == 0


def test_network_exception_and_success_body_cannot_echo_key(monkeypatch, tmp_path):
    connection = FakeConnection(payload={"text": KEY, "words": []})
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: connection)
    audio = wav(tmp_path / "a.wav")
    with pytest.raises(cloud_asr.CloudASRError) as caught:
        cloud_asr._post_audio("groq", "whisper-large-v3", "auto", KEY, audio, lambda: False)
    assert KEY not in str(caught.value)
    def fail():
        raise OSError(KEY)
    connection.endheaders = fail
    with pytest.raises(cloud_asr.CloudASRError) as caught:
        cloud_asr._post_audio("groq", "whisper-large-v3", "auto", KEY, audio, lambda: False)
    assert KEY not in str(caught.value)
    assert caught.value.__suppress_context__


def test_response_size_is_bounded(monkeypatch, tmp_path):
    connection = FakeConnection()
    connection.raw = io.BytesIO(b"x" * (cloud_asr.MAX_RESPONSE + 1))
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: connection)
    with pytest.raises(cloud_asr.CloudASRError, match="너무 큽니다"):
        cloud_asr._post_audio("groq", "whisper-large-v3", "auto", KEY, wav(tmp_path / "a.wav"), lambda: False)


def test_json_escaped_key_cannot_become_a_transcript(monkeypatch, tmp_path):
    connection = FakeConnection()
    escaped = "".join("\\u%04x" % ord(character) for character in KEY)
    connection.raw = io.BytesIO(('{"text":"' + escaped + '","words":[]}').encode())
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: connection)
    with pytest.raises(cloud_asr.CloudASRError, match="안전하게") as caught:
        cloud_asr._post_audio("groq", "whisper-large-v3", "auto", KEY, wav(tmp_path / "a.wav"), lambda: False)
    assert KEY not in str(caught.value)


@pytest.mark.parametrize("raw", [b'{"text":"a","text":"b","words":[]}', b'{"text":"","ignored":NaN}'])
def test_ambiguous_or_nonstandard_json_is_rejected(monkeypatch, tmp_path, raw):
    connection = FakeConnection()
    connection.raw = io.BytesIO(raw)
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: connection)
    with pytest.raises(cloud_asr.CloudASRError):
        cloud_asr._post_audio("groq", "whisper-large-v3", "auto", KEY, wav(tmp_path / "a.wav"), lambda: False)


def test_cancellation_during_connect_sends_no_headers_or_audio(monkeypatch, tmp_path):
    connection = FakeConnection()
    cancelled = threading.Event()
    connection.connect = cancelled.set
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: connection)
    with pytest.raises(cloud_asr.CloudASRCancelled):
        cloud_asr._post_audio("groq", "whisper-large-v3", "auto", KEY, wav(tmp_path / "a.wav"), cancelled.is_set)
    assert connection.sent == [] and connection.headers == {}


def test_overlapping_chunks_keep_cut_words_once_at_source_times(monkeypatch, tmp_path):
    monkeypatch.setattr(cloud_asr, "CHUNK_SECONDS", 4)
    monkeypatch.setattr(cloud_asr, "OVERLAP_SECONDS", 1)
    spans = [("edgeA", 1.7, 2.1), ("edgeB", 2.1, 2.5), ("edgeC", 3.7, 4.1), ("edgeD", 4.1, 4.5)]
    offsets, sizes = iter([0, 1, 3]), []
    def post(provider, model, language, key, path, cancelled):
        start = next(offsets)
        with wave.open(str(path)) as chunk:
            duration = chunk.getnframes() / 16000
        sizes.append(duration)
        words = [{"word": text, "start": left - start, "end": right - start}
                 for text, left, right in spans if start <= left and right <= start + duration]
        return {"text": " ".join(word["word"] for word in words), "words": words}
    monkeypatch.setattr(cloud_asr, "_post_audio", post)
    records = cloud_asr.transcribe_cloud(wav(tmp_path / "a.wav", 6), provider="groq", model="whisper-large-v3", language="auto", consent=True,
        get_key=lambda: KEY, progress=lambda *args: None, cancelled=lambda: False)
    words = [word for record in records for word in record["words"]]
    assert sizes == [3, 4, 3]
    assert [(word["text"].strip(), word["start"], word["end"]) for word in words] == spans


def test_cancel_interrupts_inflight_response_without_retry(monkeypatch, tmp_path):
    connection = FakeConnection()
    stop, closed = threading.Event(), threading.Event()
    def wait_response():
        stop.set()
        assert closed.wait(1)
        raise OSError(KEY)
    connection.getresponse = wait_response
    connection.close = closed.set
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: connection)
    with pytest.raises(cloud_asr.CloudASRCancelled):
        cloud_asr._post_audio("groq", "whisper-large-v3", "auto", KEY, wav(tmp_path / "a.wav"), stop.is_set)


@pytest.mark.parametrize("provider", ["groq", "xai", "gemini"])
def test_word_offsets_and_spacing(provider):
    result = cloud_asr.normalize_response(reply(provider), provider, 1, 600)
    assert result[0]["text"] == "Hello world."
    assert result[0]["words"] == [{"start": 600.1, "end": 600.3, "text": "Hello"}, {"start": 600.4, "end": 600.7, "text": " world."}]


@pytest.mark.parametrize("text,words", [
    ("Hello, world!", ["Hello", "world"]),
    ("I'm here.", ["I", "'m", "here."]),
    ("안녕하세요", ["안녕", "하세요"]),
    ("“你好，世界！”", ["你好", "世界"]),
])
@pytest.mark.parametrize("provider", ["groq", "xai"])
def test_transcript_punctuation_empty_gaps_and_contractions_are_preserved(text, words, provider):
    field = "word" if provider == "groq" else "text"
    value = {"text": text, "words": [{field: word, "start": index * .2, "end": index * .2 + .1}
                                        for index, word in enumerate(words)]}
    records = cloud_asr.normalize_response(value, provider, 1, 0)
    assert records[0]["text"] == text
    assert "".join(word["text"] for word in records[0]["words"]) == text


@pytest.mark.parametrize("text,word", [("Hello skipped world", "world"), ("Hello skipped", "Hello"), ("Hello", "Different")])
def test_unaligned_spoken_text_is_not_silently_omitted(text, word):
    with pytest.raises(cloud_asr.CloudASRError):
        cloud_asr.normalize_response({"text": text, "words": [{"word": word, "start": 0, "end": .1}]}, "groq", 1, 0)


@pytest.mark.parametrize("start,end", [(True, 1), (0, float("inf")), (float("nan"), 1), (-1, 1), (1, 0), (0, 2)])
def test_malformed_word_times_fail_closed(start, end):
    value = {"text": "Hello", "words": [{"text": "Hello", "start": start, "end": end}]}
    with pytest.raises(cloud_asr.CloudASRError):
        cloud_asr.normalize_response(value, "xai", 1, 0)


def test_missing_timestamps_not_invented_and_silence_allowed():
    with pytest.raises(cloud_asr.CloudASRError, match="단어별 시간"):
        cloud_asr.normalize_response({"text": "Transcript with no timings"}, "groq", 1, 0)
    assert cloud_asr.normalize_response({"text": ""}, "groq", 1, 0) == []
    result = cloud_asr.normalize_response({"text": "你好世界。", "words": [
        {"text": "你好", "start": 0, "end": 0.2}, {"text": "世界。", "start": 0.2, "end": 0.4},
    ]}, "xai", 1, 0)
    assert result[0]["text"] == "你好世界。"


def test_chunk_offsets_keys_rechecked_and_preview(monkeypatch, tmp_path):
    monkeypatch.setattr(cloud_asr, "CHUNK_SECONDS", 1)
    monkeypatch.setattr(cloud_asr, "OVERLAP_SECONDS", 0)
    seen, previews, keys = [], [], []
    def post(provider, model, language, key, path, cancelled):
        with wave.open(str(path)) as chunk:
            seen.append(chunk.getnframes())
        return {"text": "Hello", "words": [{"word": "Hello", "start": 0.1, "end": 0.3}]}
    monkeypatch.setattr(cloud_asr, "_post_audio", post)
    result = cloud_asr.transcribe_cloud(wav(tmp_path / "a.wav", 1.5), provider="groq", model="whisper-large-v3", language="auto", consent=True,
        get_key=lambda: keys.append(1) or KEY, progress=lambda *args: None, cancelled=lambda: False, recognition_preview=previews.append)
    assert seen == [16000, 8000]
    assert len(keys) == 2
    assert [record["start"] for record in result] == [0.1, 1.1]
    assert previews == ["Hello", "Hello"]


def test_delete_key_prevents_next_chunk(monkeypatch, tmp_path):
    monkeypatch.setattr(cloud_asr, "CHUNK_SECONDS", 1)
    monkeypatch.setattr(cloud_asr, "OVERLAP_SECONDS", 0)
    credentials = ProviderCredentials(); credentials.set_provider_key("groq", KEY)
    calls = []
    def post(*args):
        calls.append(1); credentials.clear("groq")
        return reply()
    monkeypatch.setattr(cloud_asr, "_post_audio", post)
    with pytest.raises(ValueError, match="API 키"):
        cloud_asr.transcribe_cloud(wav(tmp_path / "a.wav", 2), provider="groq", model="whisper-large-v3", language="auto", consent=True,
            get_key=lambda: credentials.get_provider_key("groq"), progress=lambda *args: None, cancelled=lambda: False)
    assert calls == [1]


@pytest.mark.parametrize("provider,model", [("groq", "whisper-large-v3"), ("gemini", "gemini-3.5-transcribe")])
def test_replaced_key_does_not_switch_an_authorized_job_to_another_account(monkeypatch, tmp_path, provider, model):
    monkeypatch.setattr(cloud_asr, "CHUNK_SECONDS", 1)
    monkeypatch.setattr(cloud_asr, "OVERLAP_SECONDS", 0)
    credentials = ProviderCredentials(); credentials.set_provider_key(provider, KEY)
    bound_key = credentials.bind_provider_key(provider)
    calls = []
    def post(provider, model, language, key, *args):
        calls.append(key)
        credentials.set_provider_key(provider, "another-account-key-123456789")
        return reply(provider)
    monkeypatch.setattr(cloud_asr, "_post_audio", post)
    with pytest.raises(ValueError, match="변경") as caught:
        cloud_asr.transcribe_cloud(wav(tmp_path / "a.wav", 2), provider=provider, model=model, language="auto", consent=True,
            get_key=bound_key, progress=lambda *args: None, cancelled=lambda: False)
    assert calls == [KEY]
    assert KEY not in str(caught.value) and "another-account-key" not in str(caught.value)


def test_missing_consent_or_wrong_model_never_opens_audio(tmp_path):
    for changes in ({"consent": False}, {"model": "grok-4"}, {"provider": "other"}):
        options = dict(provider="groq", model="whisper-large-v3", language="auto", consent=True, get_key=lambda: KEY,
                       progress=lambda *args: None, cancelled=lambda: False)
        options.update(changes)
        with pytest.raises(cloud_asr.CloudASRError):
            cloud_asr.transcribe_cloud(tmp_path / "missing.wav", **options)


@pytest.mark.parametrize("provider,model", [("groq", "whisper-large-v3"), ("gemini", "gemini-3.5-transcribe")])
@pytest.mark.parametrize("diarization", [False, True])
def test_cloud_pipeline_skips_local_whisper_and_preserves_local_diarization(monkeypatch, tmp_path, diarization, provider, model):
    audio = wav(tmp_path / "source.wav")
    calls = []
    monkeypatch.setattr(inference, "_whisper_class", lambda: pytest.fail("Local Whisper was loaded for cloud ASR"))
    monkeypatch.setattr(inference, "_extract_audio", lambda source, track, output, cancelled: (output.write_bytes(audio.read_bytes()) and 1.0, 1))
    monkeypatch.setattr(inference, "_nemotron_classes", lambda: calls.append("classes"))
    monkeypatch.setattr(inference, "_diarize", lambda *args, **kw: calls.append("diarize") or [{"start": 0, "end": 1, "speaker": "A"}])
    monkeypatch.setattr(cloud_asr, "_post_audio", lambda *args: reply(provider))
    result = inference.analyze(audio, audio_track=0, mode="standard", speaker_count=1, whisper_model="large-v3", language="auto",
        device="cuda", diarization=diarization, progress=lambda *args: None, cancelled=lambda: False,
        asr_provider=provider, provider_model=model, cloud_consent=True, get_provider_key=lambda: KEY)
    assert result["captions"][0]["text"] == "Hello world."
    assert calls == (["classes", "diarize"] if diarization else [])
    assert bool(result["speakers"]) == diarization


@pytest.mark.parametrize("provider", ["groq", "xai", "gemini", "deepgram"])
def test_credentials_endpoints_memory_only_and_generic_validation(tmp_path, provider):
    app = create_app(data_dir=tmp_path / "data")
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        assert client.get("/api/provider-credentials").json() == {provider: {"configured": False} for provider in PROVIDERS}
        response = client.post("/api/provider-credentials", json={"provider": provider, "key": KEY})
        assert response.status_code == 200
        assert response.json()[provider]["configured"] is True
        assert len(response.json()[provider]["generation"]) == 32
        assert KEY not in response.text
        for body in ({"provider": KEY, "key": KEY}, {"provider": provider, "key": {"secret": KEY}}, {"provider": provider, "key": KEY, KEY: KEY}):
            rejected = client.post("/api/provider-credentials", json=body)
            assert rejected.status_code == 422 and KEY not in rejected.text
        assert client.post("/api/provider-credentials", json={"provider": provider, "key": KEY}, headers={"Origin": "https://foreign.invalid"}).status_code == 403
        assert client.delete("/api/provider-credentials/" + provider).json()[provider] == {"configured": False}
        client.post("/api/provider-credentials", json={"provider": provider, "key": KEY})
    assert app.state.provider_credentials.status()[provider] == {"configured": False}
    for path in (tmp_path / "data").rglob("*"):
        if path.is_file():
            assert KEY.encode() not in path.read_bytes()


@pytest.mark.parametrize("provider,model", [("groq", "whisper-large-v3"), ("gemini", "gemini-3.5-transcribe")])
def test_cloud_job_contract_and_key_not_in_job_metadata(tmp_path, provider, model):
    seen = []
    def analyze(path, **kwargs):
        assert kwargs["get_provider_key"]() == KEY
        seen.append(kwargs["asr_provider"])
        return {"captions": [], "speakers": [], "duration": 1, "warnings": []}
    app = create_app(data_dir=tmp_path / "data", analyzer=analyze,
        probe=lambda path: {"duration": 1.0, "audioTracks": [{"index": 0, "label": "Audio", "channels": 1}]})
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        media = client.post("/api/media", files={"file": ("audio.wav", b"fixture")}).json()
        request = {"mediaId": media["id"], "speakerCount": 1, "audioTrack": 0, "asrProvider": provider, "providerModel": model, "cloudConsent": True}
        assert client.post("/api/jobs", json=request).status_code == 400
        client.post("/api/provider-credentials", json={"provider": provider, "key": KEY})
        for changes in ({"cloudConsent": False}, {"providerModel": "grok-voice-transcribe-2.0"}, {"asrProvider": "local"},
                        {"trackSpeakers": [{"audioTrack": 0, "speakerId": "a", "name": "A", "color": "#ffffff"}]}):
            assert client.post("/api/jobs", json={**request, **changes}).status_code == 422
        response = client.post("/api/jobs", json=request)
        assert response.status_code == 202
        job_id = response.json()["id"]
        for _ in range(100):
            job = client.get("/api/jobs/" + job_id).json()
            if job["status"] in {"completed", "failed"}:
                break
            time.sleep(0.01)
        assert job["status"] == "completed", job
        assert seen == [provider]
        assert KEY not in json.dumps(job)
        assert KEY not in client.get("/api/diagnostics").text
        stored = json.loads((tmp_path / "data" / "jobs" / (job_id + ".json")).read_text())
        assert stored["request"]["asrProvider"] == provider
        assert KEY not in json.dumps(stored)


def test_queued_cloud_job_stays_bound_to_submitted_credential_and_releases_binding(tmp_path):
    entered, release = threading.Event(), threading.Event()
    calls = []
    def analyze(path, **kwargs):
        calls.append(kwargs.get("asr_provider", "local"))
        entered.set()
        assert release.wait(3)
        return {"captions": [], "speakers": [], "duration": 1, "warnings": []}
    app = create_app(data_dir=tmp_path / "data", analyzer=analyze,
        probe=lambda path: {"duration": 1.0, "audioTracks": [{"index": 0, "label": "Audio", "channels": 1}]})
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        try:
            media = client.post("/api/media", files={"file": ("audio.wav", b"fixture")}).json()
            request = {"mediaId": media["id"], "speakerCount": 1, "audioTrack": 0}
            assert client.post("/api/jobs", json=request).status_code == 202
            assert entered.wait(2)
            client.post("/api/provider-credentials", json={"provider": "groq", "key": KEY})
            cloud_request = {**request, "asrProvider": "groq", "providerModel": "whisper-large-v3", "cloudConsent": True}
            job_id = client.post("/api/jobs", json=cloud_request).json()["id"]
            cancelled_id = client.post("/api/jobs", json=cloud_request).json()["id"]
            app.state.jobs.cancel(cancelled_id)
            app.state.jobs.remove(cancelled_id)
            assert cancelled_id not in app.state.jobs._provider_keys
            client.post("/api/provider-credentials", json={"provider": "groq", "key": "another-account-key-123456789"})
            release.set()
            for _ in range(100):
                job = client.get("/api/jobs/" + job_id).json()
                if job["status"] in {"completed", "failed"}:
                    break
                time.sleep(.01)
            assert job["status"] == "failed"
            assert "변경" in job["error"]
            assert calls == ["local"]
            assert job_id not in app.state.jobs._provider_keys
            assert KEY not in client.get("/api/diagnostics").text
            for path in (tmp_path / "data").rglob("*.json"):
                assert KEY not in path.read_text(encoding="utf-8")
        finally:
            release.set()


@pytest.mark.parametrize("language,code", [("auto", None), ("ko", "ko-KR"), ("en", "en-US"),
                                           ("ja", "ja-JP"), ("zh", "cmn-Hans-CN"), ("es", "es-419")])
def test_gemini_official_inline_interactions_contract(monkeypatch, tmp_path, language, code):
    connection, calls = FakeConnection(payload=reply("gemini")), []
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda host, timeout: calls.append((host, timeout)) or connection)
    audio = wav(tmp_path / "private-name.wav", 30)
    result = cloud_asr._post_audio("gemini", "gemini-3.5-transcribe", language, KEY, audio, lambda: False)
    assert result == reply("gemini")
    assert calls == [("generativelanguage.googleapis.com", 30)]
    assert connection.request == ("POST", "/v1beta/interactions")
    assert connection.headers["x-goog-api-key"] == KEY and "Authorization" not in connection.headers
    assert connection.headers["Content-Type"] == "application/json"
    raw = b"".join(connection.sent)
    assert int(connection.headers["Content-Length"]) == len(raw) < cloud_asr.GEMINI_MAX_REQUEST
    assert all(len(block) <= 1024 * 1024 for block in connection.sent)
    assert KEY.encode() not in raw and b"private-name" not in raw
    body = json.loads(raw)
    assert body["model"] == "gemini-3.5-transcribe" and body["store"] is False and body["stream"] is False
    assert len(body["input"]) == 1
    audio_input = body["input"][0]
    assert set(audio_input) == {"type", "mime_type", "data"}
    assert audio_input["type"] == "audio" and audio_input["mime_type"] == "audio/wav"
    assert base64.b64decode(audio_input["data"], validate=True) == audio.read_bytes()
    config = body["generation_config"]["transcription_config"]
    assert config["mode"] == {"type": "verbatim", "timestamp_granularities": ["word"]}
    assert config.get("language_codes") == ([code] if code else None)
    assert "diarization_mode" not in config and connection.closed


@pytest.mark.parametrize("changes", [{"consent": False}, {"model": "gemini-2.5-pro"}, {"language": "xx"}])
def test_gemini_rejects_unsupported_options_before_audio_or_network(tmp_path, changes):
    options = dict(provider="gemini", model="gemini-3.5-transcribe", language="auto", consent=True,
                   get_key=lambda: pytest.fail("Key should not be requested"), progress=lambda *args: None, cancelled=lambda: False)
    options.update(changes)
    with pytest.raises(cloud_asr.CloudASRError):
        cloud_asr.transcribe_cloud(tmp_path / "missing.wav", **options)


def test_gemini_inline_request_limit_includes_base64_before_connect(monkeypatch, tmp_path):
    audio = tmp_path / "oversized.wav"
    with audio.open("wb") as stream:
        stream.truncate(15_000_000)  # Base64 alone is 20MB; JSON overhead makes it too big.
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: pytest.fail("Oversized request connected"))
    with pytest.raises(cloud_asr.CloudASRError, match="너무 큽니다"):
        cloud_asr._post_audio("gemini", "gemini-3.5-transcribe", "auto", KEY, audio, lambda: False)


@pytest.mark.parametrize("bad_offset", [None, 0.1, True, "NaNs", "Infinitys", "-1s", "1ms", "1e2s", "1.1234567890s", "0.5", "01s"])
def test_gemini_never_invents_missing_or_malformed_timestamps(bad_offset):
    payload = reply("gemini")
    payload["steps"][0]["content"][0]["annotations"][0]["start_offset"] = bad_offset
    with pytest.raises(cloud_asr.CloudASRError):
        cloud_asr.normalize_response(payload, "gemini", 1, 0)


@pytest.mark.parametrize("mutation", ["in_progress", "missing_steps", "no_annotations", "non_word", "wrong_text", "unknown_content", "backward_blocks"])
def test_gemini_incomplete_or_unaligned_response_fails_closed(mutation):
    payload = reply("gemini")
    block = payload["steps"][0]["content"][0]
    if mutation == "in_progress": payload["status"] = "in_progress"
    elif mutation == "missing_steps": payload["steps"] = []
    elif mutation == "no_annotations": block.pop("annotations")
    elif mutation == "non_word": block["annotations"][0]["type"] = "citation"
    elif mutation == "wrong_text": block["text"] = "Invented unaligned words"
    elif mutation == "unknown_content": block["type"] = "audio"
    else: payload["steps"][0]["content"].append(copy.deepcopy(block))
    with pytest.raises(cloud_asr.CloudASRError):
        cloud_asr.normalize_response(payload, "gemini", 1, 0)


def test_gemini_silence_and_native_speaker_metadata_do_not_invent_people():
    payload = reply("gemini")
    block = payload["steps"][0]["content"][0]
    block["text"] = "안녕하세요!"
    block["annotations"][0].update(text="안녕", speaker="spk_7")
    block["annotations"][1].update(text="하세요", speaker="spk_8")
    records = cloud_asr.normalize_response(payload, "gemini", 1, 10)
    assert records[0]["text"] == "안녕하세요!"
    assert records[0]["start"] == 10.1 and records[0]["end"] == 10.7
    assert all("speaker" not in word for word in records[0]["words"])
    block.update(text="", annotations=[])
    assert cloud_asr.normalize_response(payload, "gemini", 1, 10) == []


def test_gemini_chunks_keep_boundaries_and_cleanup_without_remote_uploads(monkeypatch, tmp_path):
    monkeypatch.setattr(cloud_asr, "GEMINI_CHUNK_SECONDS", 4)
    spans = [("edgeA", 1.7, 2.1), ("edgeB", 2.1, 2.5), ("edgeC", 3.7, 4.1), ("edgeD", 4.1, 4.5)]
    offsets, sizes, paths, previews = iter([0, 1, 3]), [], [], []
    def post(provider, model, language, key, path, cancelled):
        assert provider == "gemini" and key == KEY
        start = next(offsets)
        paths.append(path)
        with wave.open(str(path)) as chunk:
            duration = chunk.getnframes() / 16000
        sizes.append(duration)
        annotations = [{"type": "word_info", "text": text, "start_offset": f"{left - start:.3f}s", "end_offset": f"{right - start:.3f}s"}
                       for text, left, right in spans if start <= left and right <= start + duration]
        return {"status": "completed", "steps": [{"type": "model_output", "content": [{"type": "text",
            "text": " ".join(word["text"] for word in annotations), "annotations": annotations}]}]}
    monkeypatch.setattr(cloud_asr, "_post_audio", post)
    records = cloud_asr.transcribe_cloud(wav(tmp_path / "a.wav", 6), provider="gemini", model="gemini-3.5-transcribe", language="auto", consent=True,
        get_key=lambda: KEY, progress=lambda *args: None, cancelled=lambda: False, recognition_preview=previews.append)
    words = [word for record in records for word in record["words"]]
    assert sizes == [3, 4, 3]
    assert [(word["text"].strip(), word["start"], word["end"]) for word in words] == spans
    assert previews and all(not path.exists() and not path.parent.exists() for path in paths)


def test_gemini_cancellation_mid_upload_closes_connection_and_does_not_send_tail(monkeypatch, tmp_path):
    connection, cancelled = FakeConnection(payload=reply("gemini")), threading.Event()
    original_send = connection.send
    def send(block):
        original_send(block)
        if len(connection.sent) == 2: cancelled.set()
    connection.send = send
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: connection)
    with pytest.raises(cloud_asr.CloudASRCancelled):
        cloud_asr._post_audio("gemini", "gemini-3.5-transcribe", "auto", KEY, wav(tmp_path / "a.wav", 30), cancelled.is_set)
    assert len(connection.sent) == 2 and connection.closed


def test_gemini_json_escaped_key_is_not_saved(monkeypatch, tmp_path):
    connection = FakeConnection()
    payload = reply("gemini")
    payload["steps"][0]["content"][0]["text"] = KEY
    connection.raw = io.BytesIO(json.dumps(payload).replace(KEY, "".join("\\u%04x" % ord(character) for character in KEY)).encode())
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *a, **kw: connection)
    with pytest.raises(cloud_asr.CloudASRError, match="안전하게") as caught:
        cloud_asr._post_audio("gemini", "gemini-3.5-transcribe", "auto", KEY, wav(tmp_path / "a.wav"), lambda: False)
    assert KEY not in str(caught.value)


@pytest.mark.parametrize("interrupt_by", ["cancel", "deadline"])
def test_cancel_interrupts_body_after_http_client_detaches_connection_socket(monkeypatch, tmp_path, interrupt_by):
    client, server = socket.socketpair()
    client.settimeout(2)
    server.sendall(b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 100\r\n\r\n{")
    connection, stop = FakeConnection(), threading.Event()
    if interrupt_by == "deadline":
        monkeypatch.setattr(cloud_asr, "REQUEST_TIMEOUT", .05)
    connection.sock = client
    response = cloud_asr.http.client.HTTPResponse(client)
    def getresponse():
        response.begin()
        assert response.will_close
        # HTTPConnection.getresponse() closes/detaches its socket here, while the
        # HTTPResponse's makefile reference still keeps the transport alive.
        client.close()
        connection.sock = None
        if interrupt_by == "cancel": stop.set()
        return response
    connection.getresponse = getresponse
    monkeypatch.setattr(cloud_asr.http.client, "HTTPSConnection", lambda *args, **kwargs: connection)
    started = time.monotonic()
    try:
        expected = cloud_asr.CloudASRCancelled if interrupt_by == "cancel" else cloud_asr.CloudASRError
        with pytest.raises(expected) as caught:
            cloud_asr._post_audio("gemini", "gemini-3.5-transcribe", "auto", KEY, wav(tmp_path / "a.wav"), stop.is_set)
        if interrupt_by == "deadline": assert "초과" in str(caught.value)
        assert time.monotonic() - started < 1, "Cancellation waited for the body socket timeout"
        assert response.isclosed()
    finally:
        response.close()
        client.close()
        server.close()
