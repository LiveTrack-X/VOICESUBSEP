"""Removed text-generation endpoints stay unavailable; speech APIs remain usable."""
import http.client

import pytest
from fastapi.testclient import TestClient

from voicesubsep.app import create_app


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/translation/batch"),
    ("GET", "/api/translation/status"),
    ("GET", "/api/translation/models?provider=groq"),
    ("GET", "/api/text/status"),
    ("GET", "/api/text/models?provider=xai"),
    ("POST", "/api/documents/generate"),
])
def test_removed_text_generation_routes_never_contact_a_model(tmp_path, monkeypatch, method, path):
    def unexpected_network(*args, **kwargs):
        pytest.fail("A removed text feature attempted a network connection")
    monkeypatch.setattr(http.client, "HTTPConnection", unexpected_network)
    monkeypatch.setattr(http.client, "HTTPSConnection", unexpected_network)
    app = create_app(data_dir=tmp_path)
    with TestClient(app, base_url="http://127.0.0.1:8787") as client:
        response = client.request(method, path, json={"captions": [{"id": "c", "text": "Original speech"}]})
        assert response.status_code == 404
        assert client.get("/api/provider-credentials").json() == {"groq": {"configured": False}, "xai": {"configured": False}, "gemini": {"configured": False}, "deepgram": {"configured": False}}
    assert not any(path.startswith(("/api/translation", "/api/text", "/api/documents")) for path in app.openapi()["paths"])
