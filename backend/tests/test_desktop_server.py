from pathlib import Path

from fastapi.testclient import TestClient

from voicesubsep.desktop_server import create_desktop_app


def desktop_client(tmp_path: Path, stopped: list, token="session-secret"):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html>editor</html>", encoding="utf-8")
    app = create_desktop_app(data_dir=tmp_path / "data", web_dir=web, port=19987,
                             token=token, shutdown=lambda: stopped.append(True))
    return TestClient(app, base_url="http://127.0.0.1:19987")


def test_desktop_routes_and_shutdown_require_session_secret(tmp_path):
    stopped = []
    with desktop_client(tmp_path, stopped) as client:
        assert client.get("/").text == "<html>editor</html>"
        response = client.get("/api/health", headers={"Origin": "voicesubsep://app"})
        assert response.status_code == 200
        assert response.json()["app"] == "voicesubsep"
        assert client.post("/api/desktop/shutdown").status_code == 403
        assert client.post("/api/desktop/shutdown", headers={"X-VoiceSubSep-Token": "wrong"}).status_code == 403
        assert stopped == []
        assert client.post("/api/desktop/shutdown", headers={"X-VoiceSubSep-Token": "session-secret"}).json() == {"status": "stopping"}
        assert stopped == [True]


def test_shutdown_disabled_without_token_and_foreign_origin_blocked(tmp_path):
    stopped = []
    with desktop_client(tmp_path, stopped, token="") as client:
        assert client.post("/api/desktop/shutdown", headers={"X-VoiceSubSep-Token": ""}).status_code == 403
        assert client.get("/api/health", headers={"Origin": "https://example.org"}).status_code == 403
        assert stopped == []
