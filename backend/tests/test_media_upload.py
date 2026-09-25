from __future__ import annotations

import asyncio
import errno
import hashlib
import tempfile

import pytest
import starlette.formparsers
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from voicesubsep.app import create_app
from voicesubsep.media_upload import uploaded_media


BOUNDARY = "media-upload-test"
PART = (
    f"--{BOUNDARY}\r\n"
    'Content-Disposition: form-data; name="file"; filename="fixture.wav"\r\n'
    "Content-Type: audio/wav\r\n\r\n"
).encode()
ENDING = f"\r\n--{BOUNDARY}--\r\n".encode()


@pytest.fixture
def spools(monkeypatch, tmp_path):
    opened = []

    def tracked_spool(*args, **kwargs):
        spool = tempfile.SpooledTemporaryFile(*args, dir=tmp_path, **kwargs)
        opened.append(spool)
        return spool

    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", tracked_spool)
    yield opened
    # Even a failed assertion must not leave test-owned temporary handles open.
    for spool in opened:
        spool.close()


def client_for(tmp_path, probe=None):
    def fake_probe(path):
        assert path.is_file()
        return {"duration": 1.0, "audioTracks": [{"index": 0, "label": "Audio", "channels": 1}]}

    return TestClient(
        create_app(data_dir=tmp_path / "data", probe=probe or fake_probe),
        base_url="http://127.0.0.1:8787",
    )


def request_from(events):
    iterator = iter(events)

    async def receive():
        event = next(iterator)
        if isinstance(event, BaseException):
            raise event
        return event

    return Request(
        {
            "type": "http", "method": "POST", "path": "/api/media",
            "headers": [(b"content-type", f"multipart/form-data; boundary={BOUNDARY}".encode())],
        },
        receive=receive,
    )


def assert_closed(spools):
    assert spools, "The test must reach multipart temporary-file allocation."
    assert all(spool.closed for spool in spools)


def test_actual_route_streams_past_spool_threshold_and_closes_tempfile(tmp_path, spools):
    payload = b"sample" * (256 * 1024)
    with client_for(tmp_path) as client:
        response = client.post("/api/media", files={"file": ("fixture.wav", payload, "audio/wav")})
        assert response.status_code == 201, response.text
        result = response.json()
        assert result["bytes"] == len(payload)
        assert result["sha256"] == hashlib.sha256(payload).hexdigest()
        assert client.get(result["url"]).content == payload
    assert_closed(spools)
    assert spools[0]._rolled  # An actual disk spool, not only a BytesIO fixture.


def test_actual_route_spool_disk_full_is_507_without_leaking_tempfile(tmp_path, spools, monkeypatch):
    tracked = starlette.formparsers.SpooledTemporaryFile

    def failing_spool(*args, **kwargs):
        spool = tracked(*args, **kwargs)
        spool.rollover()

        def full(_data):
            raise OSError(errno.ENOSPC, "synthetic secret temporary path")

        spool.write = full
        return spool

    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", failing_spool)

    def probe_must_not_run(_path):
        pytest.fail("Incomplete uploads must not reach media inspection.")

    with client_for(tmp_path, probe_must_not_run) as client:
        response = client.post("/api/media", files={"file": ("fixture.wav", b"sample")})
    assert response.status_code == 507
    assert "synthetic secret" not in response.text
    assert_closed(spools)
    assert list((tmp_path / "data" / "media").iterdir()) == []


@pytest.mark.parametrize("filename,status", [("fixture.exe", 415), ("fixture.wav", 422)])
def test_actual_route_rejection_also_closes_spool(tmp_path, spools, filename, status):
    with client_for(tmp_path) as client:
        response = client.post("/api/media", files={"file": (filename, b"")})
    assert response.status_code == status
    assert_closed(spools)


@pytest.mark.parametrize("extra", ["file", "field"])
def test_actual_route_extra_parts_rejected_and_allocated_spool_closed(tmp_path, spools, extra):
    files = [("file", ("fixture.wav", b"sample"))]
    files.append(("file", ("second.wav", b"second")) if extra == "file" else ("metadata", (None, "extra")))
    with client_for(tmp_path) as client:
        response = client.post("/api/media", files=files)
    assert response.status_code == 400
    assert_closed(spools)


def test_actual_route_wrong_field_rejected_and_spool_closed(tmp_path, spools):
    with client_for(tmp_path) as client:
        response = client.post("/api/media", files={"not-file": ("fixture.wav", b"sample")})
    assert response.status_code == 422
    assert_closed(spools)


@pytest.mark.parametrize("ending", [b"", b"\r\n--media-upload-test\r\n"])
def test_actual_route_truncated_multipart_closes_spool(tmp_path, spools, ending):
    with client_for(tmp_path) as client:
        response = client.post(
            "/api/media", content=PART + b"sample" + ending,
            headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"},
        )
    assert response.status_code == 400
    assert_closed(spools)
    assert list((tmp_path / "data" / "media").iterdir()) == []


@pytest.mark.parametrize(
    "headers,body,status",
    [
        ({"Content-Type": "application/json"}, b"{}", 415),
        ({"Content-Type": "multipart/form-data"}, b"bad", 400),
        ({"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"}, b"bad", 400),
    ],
)
def test_invalid_content_type_or_multipart_is_safe_error(tmp_path, headers, body, status):
    with client_for(tmp_path) as client:
        response = client.post("/api/media", content=body, headers=headers)
    assert response.status_code == status


@pytest.mark.parametrize("failure", ["disconnect", "cancel", "disk", "receive-error"])
def test_partial_receive_failure_closes_parser_owned_spool(spools, failure):
    second = {
        "disconnect": {"type": "http.disconnect"},
        "cancel": asyncio.CancelledError(),
        "disk": OSError(errno.ENOSPC, "synthetic secret receive failure"),
        "receive-error": RuntimeError("synthetic receive failure"),
    }[failure]
    request = request_from([{"type": "http.request", "body": PART + b"sample", "more_body": True}, second])

    async def parse():
        generator = uploaded_media(request)
        try:
            if failure == "cancel":
                with pytest.raises(asyncio.CancelledError):
                    await anext(generator)
            elif failure == "receive-error":
                with pytest.raises(RuntimeError, match="synthetic receive failure"):
                    await anext(generator)
            else:
                with pytest.raises(HTTPException) as error:
                    await anext(generator)
                assert error.value.status_code == (507 if failure == "disk" else 400)
                assert "synthetic secret" not in error.value.detail
        finally:
            await generator.aclose()

    asyncio.run(parse())
    assert_closed(spools)


def test_endpoint_cancellation_closes_yielded_spool(spools):
    request = request_from([{"type": "http.request", "body": PART + b"sample" + ENDING, "more_body": False}])

    async def run_endpoint():
        generator = uploaded_media(request)
        file = await anext(generator)
        assert await file.read() == b"sample"
        assert not file.file.closed
        with pytest.raises(asyncio.CancelledError):
            await generator.athrow(asyncio.CancelledError())
        assert file.file.closed

    asyncio.run(run_endpoint())
    assert_closed(spools)


def test_generator_close_closes_yielded_spool_without_async_file_close(spools, monkeypatch):
    request = request_from([{"type": "http.request", "body": PART + b"sample" + ENDING, "more_body": False}])

    async def run_endpoint():
        generator = uploaded_media(request)
        file = await anext(generator)

        async def cancelled_close():
            raise asyncio.CancelledError()

        monkeypatch.setattr(file, "close", cancelled_close)
        await generator.aclose()
        assert file.file.closed

    asyncio.run(run_endpoint())
    assert_closed(spools)
