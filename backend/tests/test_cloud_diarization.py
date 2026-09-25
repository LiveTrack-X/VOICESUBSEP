from __future__ import annotations

import copy
import io
import json
import struct
import threading
import time
import wave
import socket
import http.client

import pytest

from voicesubsep import cloud_diarization as cd
from voicesubsep.cloud_credentials import ProviderCredentials

KEY="private-fixture-key-12345"


def response(words=None, duration=1.):
    if words is None:words=[{"start":.1,"end":.3,"speaker":0,"speaker_confidence":.9,"word":"discard this"},{"start":.4,"end":.8,"speaker":1,"word":"also discard"}]
    return {"metadata":{"duration":duration,"diarize_info":{"arch":"v2","model_uuid":"unused"}},
            "results":{"channels":[{"alternatives":[{"transcript":"discard provider transcription","words":words}]}],"utterances":[{"transcript":"discard utterance"}]}}


@pytest.fixture
def audio(tmp_path):
    path=tmp_path/"audio.wav"
    with wave.open(str(path),"wb") as output:
        output.setparams((1,2,16000,0,"NONE","not compressed"));output.writeframes(bytes(32000))
    return path


class Socket:
    def __init__(self):self.timeout=None;self.shutdown_called=False
    def settimeout(self,value):self.timeout=value
    def shutdown(self,_):self.shutdown_called=True


class Connection:
    status=200
    raw=None
    instances=[]
    def __init__(self,host,timeout):
        self.host,self.timeout=host,timeout;self.sock=Socket();self.headers={};self.sent=[];self.closed=False;self.auto_open=1
        self.instances.append(self)
    def connect(self):pass
    def putrequest(self,method,path):self.method,self.path=method,path
    def putheader(self,name,value):self.headers[name]=value
    def endheaders(self):pass
    def send(self,data):self.sent.append(data)
    def getresponse(self):
        self.reader=io.BytesIO(self.raw if self.raw is not None else json.dumps(response()).encode())
        return self
    def read(self,size):return self.reader.read(size)
    def close(self):self.closed=True


@pytest.fixture
def network(monkeypatch):
    class Fake(Connection):instances=[]
    monkeypatch.setattr(cd.http.client,"HTTPSConnection",Fake)
    return Fake


def call(path, **options):
    return cd.diarize_cloud(path,**{"language":"ko","consent":True,"get_key":lambda:KEY,"progress":lambda *_:None,"cancelled":lambda:False,**options})


def test_single_file_token_auth_pinned_models_and_provider_text_discard(audio,network):
    result=call(audio)
    assert result==[{"start":.1,"end":.3,"speaker":"deepgram_0"},{"start":.4,"end":.8,"speaker":"deepgram_1"}]
    assert "discard" not in str(result)
    assert len(network.instances)==1
    request=network.instances[0]
    assert request.host=="api.deepgram.com" and request.method=="POST"
    assert request.path=="/v1/listen?model=nova-3&diarize_model=v2&utterances=true&smart_format=false&language=ko"
    assert request.headers["Authorization"]=="Token "+KEY
    assert request.headers["Content-Length"]==str(audio.stat().st_size)
    assert b"".join(request.sent)==audio.read_bytes()
    assert request.closed and request.auto_open==0 and request.sock.timeout==610


def test_auto_language_query_and_no_fake_processing_progress(audio,network):
    updates=[]
    call(audio,language="auto",progress=lambda stage,value:updates.append((stage,value)))
    assert "detect_language=true" in network.instances[0].path and "&language=" not in network.instances[0].path
    assert [value for _,value in updates]==[.01,.25,.25,1.]


@pytest.mark.parametrize("options",[{"consent":False},{"language":"../../evil"},{"language":"xx"},{"get_key":lambda:"invalid\r\nkey"},{"cancelled":lambda:True}])
def test_invalid_consent_language_key_and_pre_cancel_never_connect(audio,network,options):
    with pytest.raises((cd.CloudDiarizationError,cd.CloudDiarizationCancelled)):call(audio,**options)
    assert not network.instances


@pytest.mark.parametrize("status",[301,302,400,401,403,429,500,504])
def test_http_failures_are_sanitized_without_retry_or_redirect(audio,network,status):
    network.status=status;network.raw=(KEY+" private audio contents").encode()
    with pytest.raises(cd.CloudDiarizationError) as error:call(audio)
    assert KEY not in str(error.value) and "private audio" not in str(error.value)
    assert len(network.instances)==1


@pytest.mark.parametrize("mutate",[
    lambda x:x["metadata"].pop("diarize_info"),
    lambda x:x["metadata"]["diarize_info"].update(arch="v1"),
    lambda x:x["metadata"].update(duration=.1),
    lambda x:x["results"].update(channels=[]),
    lambda x:x["results"]["channels"][0]["alternatives"][0].update(words=[]),
    lambda x:x["results"]["channels"][0]["alternatives"][0]["words"][0].pop("speaker"),
    lambda x:x["results"]["channels"][0]["alternatives"][0]["words"][0].update(speaker=True),
    lambda x:x["results"]["channels"][0]["alternatives"][0]["words"][0].update(start=-1),
    lambda x:x["results"]["channels"][0]["alternatives"][0]["words"][0].update(end=2),
    lambda x:x["results"]["channels"][0]["alternatives"][0]["words"][0].update(end=float("nan")),
    lambda x:x["results"]["channels"][0]["alternatives"][0]["words"][0].update(speaker_confidence=2),
])
def test_malformed_or_incomplete_results_do_not_become_speaker_assignments(mutate):
    value=response();mutate(value)
    with pytest.raises(cd.CloudDiarizationError):cd.normalize_diarization(value,1.)


def test_stable_speaker_ids_across_the_whole_long_recording_and_overlaps():
    words=[{"start":3599.9,"end":3600.2,"speaker":7},{"start":.1,"end":.4,"speaker":7},{"start":.2,"end":.5,"speaker":0},{"start":7000.,"end":7000.5,"speaker":7}]
    normalized=cd.normalize_diarization(response(words,7200.),7200.)
    assert [item["speaker"] for item in normalized]==["deepgram_7","deepgram_0","deepgram_7","deepgram_7"]
    assert normalized[0]["end"]>normalized[1]["start"]
    assert normalized[-1]["start"]==7000.


def test_silence_is_valid_only_with_empty_transcript_and_executed_diarizer():
    value=response([]);value["results"]["channels"][0]["alternatives"][0]["transcript"]=""
    assert cd.normalize_diarization(value,1.)==[]


@pytest.mark.parametrize("raw",[
    KEY.encode(),json.dumps({"nested":[{"x":KEY}]}).encode(),
    ('{"x":"'+"".join("\\u%04x"%ord(c) for c in KEY)+'"}').encode(),
    b'{"metadata":1,"metadata":2}',b'{"metadata":NaN}',b'[[[',
])
def test_raw_escaped_keys_duplicate_json_and_nonfinite_json_do_not_leak(audio,network,raw):
    network.raw=raw
    with pytest.raises(cd.CloudDiarizationError) as error:call(audio)
    assert KEY not in str(error.value)


def test_response_limit_is_checked_before_json_parse(audio,network,monkeypatch):
    monkeypatch.setattr(cd,"MAX_RESPONSE_BYTES",30)
    with pytest.raises(cd.CloudDiarizationError,match="너무 큽니다"):call(audio)


def test_audio_duration_and_upload_size_limits_before_key_lookup(audio,network,monkeypatch):
    def no_key():raise AssertionError("Key must not be read")
    monkeypatch.setattr(cd,"MAX_AUDIO_BYTES",10)
    with pytest.raises(cd.CloudDiarizationError):call(audio,get_key=no_key)
    monkeypatch.setattr(cd,"MAX_AUDIO_BYTES",256*1024*1024)
    data=bytearray(audio.read_bytes());struct.pack_into("<I",data,40,16000*2*7201);audio.write_bytes(data)
    with pytest.raises(cd.CloudDiarizationError):call(audio,get_key=no_key)
    assert not network.instances


def test_mono_16k_pcm_requirement(audio,network):
    data=bytearray(audio.read_bytes());struct.pack_into("<I",data,24,48000);audio.write_bytes(data)
    with pytest.raises(cd.CloudDiarizationError,match="16 kHz"):call(audio)
    assert not network.instances


def test_key_rotation_during_upload_stops_the_same_request(audio,network):
    store=ProviderCredentials();store.set_provider_key("groq",KEY)
    getter=store.bind_provider_key("groq")
    def progress(_stage,value):
        if value>=.25:store.set_provider_key("groq","replacement-key-67890")
    with pytest.raises(cd.CloudDiarizationError,match="변경"):call(audio,get_key=getter,progress=progress)
    assert len(network.instances)==1 and network.instances[0].closed
    assert "replacement-key-67890" not in str(network.instances[0].headers)


def test_cancel_during_blocking_response_shuts_down_socket(audio,monkeypatch):
    cancel=threading.Event()
    class Blocking(Connection):
        def getresponse(self):
            cancel.set()
            deadline=time.monotonic()+2
            while not self.closed and time.monotonic()<deadline:time.sleep(.01)
            raise OSError("private provider details "+KEY)
    monkeypatch.setattr(cd.http.client,"HTTPSConnection",Blocking)
    with pytest.raises(cd.CloudDiarizationCancelled):call(audio,cancelled=cancel.is_set)
    assert Blocking.instances[-1].sock.shutdown_called


def test_total_deadline_is_bounded_and_no_automatic_reconnect(audio,monkeypatch):
    monkeypatch.setattr(cd,"REQUEST_TIMEOUT",.05)
    class Blocking(Connection):
        def getresponse(self):
            deadline=time.monotonic()+2
            while not self.closed and time.monotonic()<deadline:time.sleep(.01)
            raise OSError("private details")
    monkeypatch.setattr(cd.http.client,"HTTPSConnection",Blocking)
    started=time.monotonic()
    with pytest.raises(cd.CloudDiarizationError):call(audio)
    assert time.monotonic()-started<1
    assert Blocking.instances[-1].auto_open==0 and Blocking.instances[-1].sock.shutdown_called


def test_cancel_closes_detached_connection_close_response_socket(audio,monkeypatch):
    client_socket, server_socket=socket.socketpair()
    cancel=threading.Event(); server_done=threading.Event(); read_started=threading.Event()
    class Detached(http.client.HTTPConnection):
        instance=None
        def __init__(self,*args,**kwargs):
            super().__init__(*args,**kwargs);Detached.instance=self
        def connect(self):self.sock=client_socket
        def getresponse(self):
            result=super().getresponse()
            assert self.sock is None  # HTTPResponse now owns Connection: close.
            read_started.set()
            return result
    def server():
        try:
            reader=server_socket.makefile("rb")
            assert reader.readline().startswith(b"POST /v1/listen?")
            headers={}
            while line:=reader.readline():
                if line==b"\r\n":break
                key,value=line.decode().split(":",1);headers[key.lower()]=value.strip()
            assert len(reader.read(int(headers["content-length"])))==audio.stat().st_size
            server_socket.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 50000\r\nConnection: close\r\n\r\n{\"partial\":")
            assert read_started.wait(2)
            cancel.set()
            server_done.wait(3)
            reader.close()
        finally:server_socket.close()
    worker=threading.Thread(target=server,daemon=True);worker.start()
    monkeypatch.setattr(cd.http.client,"HTTPSConnection",Detached)
    started=time.monotonic()
    try:
        with pytest.raises(cd.CloudDiarizationCancelled):call(audio,cancelled=cancel.is_set)
        assert time.monotonic()-started<2
        assert client_socket.fileno()==-1
    finally:
        server_done.set();client_socket.close();worker.join(timeout=3)
