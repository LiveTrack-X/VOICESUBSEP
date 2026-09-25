"""Packaged loopback server. All writable data lives outside the install tree."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
import secrets
from typing import Callable
from fastapi import Request, HTTPException


def create_desktop_app(*, data_dir: Path, web_dir: Path, port: int, token: str,
                       shutdown: Callable[[], None]):
    from fastapi.staticfiles import StaticFiles
    from voicesubsep.app import create_app

    application = create_app(data_dir=data_dir, allowed_origins={
        f"http://127.0.0.1:{port}", "voicesubsep://app",
    })

    @application.post("/api/desktop/shutdown")
    async def stop_server(request: Request):
        supplied = request.headers.get("x-voicesubsep-token", "")
        if not token or not secrets.compare_digest(supplied, token):
            raise HTTPException(403, "Desktop session authorization required.")
        shutdown()
        return {"status": "stopping"}

    application.mount("/", StaticFiles(directory=web_dir, html=True), name="editor")
    return application


def main() -> int | None:
    # The frozen worker uses this same executable. Dispatch before requiring
    # server arguments, importing uvicorn, opening storage, or binding a port.
    if sys.argv[1:2] == ["--analysis-worker"]:
        from voicesubsep.analysis_worker import main as worker_main

        return worker_main()
    if sys.argv[1:2] == ["--vst-worker"]:
        from voicesubsep.vst_worker import main as worker_main

        return worker_main(sys.argv[2:])
    parser = argparse.ArgumentParser(description="VOICESUBSEP local desktop service")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--web-dir", type=Path, required=True)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    web_root = args.web_dir.resolve()
    if not (web_root / "index.html").is_file():
        parser.error("web-dir must contain the built editor index.html")
    frozen_root = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    bundled_tools = frozen_root / "tools"
    if bundled_tools.is_dir():
        os.environ["PATH"] = str(bundled_tools) + os.pathsep + os.environ.get("PATH", "")
    # Import after process-local DLL/tool paths have been prepared.
    import uvicorn
    def shutdown():
        server.should_exit = True
    application = create_desktop_app(data_dir=args.data_dir.resolve(), web_dir=web_root,
        port=args.port, token=os.environ.get("VOICESUBSEP_DESKTOP_TOKEN", ""), shutdown=shutdown)
    server = uvicorn.Server(uvicorn.Config(application, host="127.0.0.1", port=args.port,
                                         access_log=False, workers=1))
    server.run()


if __name__ == "__main__":
    raise SystemExit(main())
