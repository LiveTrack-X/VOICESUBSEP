"""Loopback live capture API and a narrowly scoped read-only OBS page."""
from __future__ import annotations

from typing import Literal

from fastapi import HTTPException, Query, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .live import LiveManager, MAX_PACKET_BYTES


class LiveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    whisperModel: Literal["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo", "turbo"] = "large-v3-turbo"
    language: str = Field(default="auto", pattern=r"^(?:auto|[a-z]{2,3})$")
    device: Literal["cpu", "cuda"] = "cuda"
    diarization: Literal[True] = True
    speakerCount: int = Field(default=2, ge=1, le=4)


class OverlayControl(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    muted: bool | None = None
    clear: bool = False


OVERLAY_HTML = """<!doctype html><meta charset="utf-8"><title>VOICESUBSEP Live</title>
<style>html,body{margin:0;background:transparent;color:white;font:600 32px sans-serif}
#captions{position:fixed;bottom:5%;left:5%;right:5%;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;text-shadow:0 2px 4px #000}
.line{background:#000a;border-radius:8px;padding:8px 14px;margin:4px auto;width:fit-content;max-width:95%}</style>
<div id="captions" aria-live="polite"></div><script>
let timer;async function tick(){try{const r=await fetch(location.pathname+'/state',{cache:'no-store'});if(!r.ok)throw Error();
const s=await r.json();const root=document.getElementById('captions');root.replaceChildren();
for(const c of s.captions){const line=document.createElement('div');line.className='line';const p=s.speakers.find(p=>p.id===c.speakerId);
line.textContent=(p?p.name+': ':'')+c.text;root.appendChild(line)}}catch(e){document.getElementById('captions').replaceChildren()}
timer=setTimeout(tick,500)}tick();</script>"""


def register_live_routes(app, manager: LiveManager, storage, jobs):
    def public(state, request):
        return {**state, "overlayUrl": str(request.base_url).rstrip("/") + state["overlayUrl"]}

    def invoke(action):
        try:
            return action()
        except KeyError:
            raise HTTPException(404, "Live session was not found.") from None
        except PermissionError as exc:
            raise HTTPException(409, str(exc)) from None
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except OverflowError as exc:
            raise HTTPException(413, str(exc)) from None

    @app.post("/api/live/sessions", status_code=202)
    def create_live(payload: LiveRequest, request: Request):
        with storage.media_lock:
            try:
                jobs.require_idle()
            except PermissionError as exc:
                raise HTTPException(409, str(exc)) from None
            except RuntimeError as exc:
                raise HTTPException(503, str(exc)) from None
            return public(invoke(lambda: manager.create(payload.model_dump())), request)

    @app.get("/api/live/sessions")
    def history(request: Request):
        return {"items": [public({k: v for k, v in row.items() if k != "result"}, request) for row in manager.history()]}

    @app.get("/api/live/sessions/{identity}")
    def state(identity: str, request: Request):
        return public(invoke(lambda: manager.get(identity)), request)

    @app.post("/api/live/sessions/{identity}/audio")
    async def audio(identity: str, request: Request, seq: int = Query(ge=0)):
        if request.headers.get("content-type", "").split(";", 1)[0] != "application/octet-stream":
            raise HTTPException(415, "Send PCM16LE 16 kHz mono with application/octet-stream.")
        payload = bytearray()
        async for chunk in request.stream():
            if len(payload) + len(chunk) > MAX_PACKET_BYTES:
                raise HTTPException(413, "Live PCM packets must be at most 64000 bytes (2 seconds).")
            payload.extend(chunk)
        from starlette.concurrency import run_in_threadpool
        result = await run_in_threadpool(lambda: invoke(lambda: manager.audio(identity, seq, bytes(payload))))
        return public(result, request)

    @app.post("/api/live/sessions/{identity}/stop", status_code=202)
    def stop(identity: str, request: Request):
        return public(invoke(lambda: manager.finish(identity)), request)

    @app.delete("/api/live/sessions/{identity}")
    def abort(identity: str, request: Request):
        return public(invoke(lambda: manager.finish(identity, True)), request)

    @app.delete("/api/live/sessions/{identity}/history")
    def remove(identity: str):
        invoke(lambda: manager.remove(identity))
        return {"removed": identity}

    @app.post("/api/live/sessions/{identity}/overlay")
    def control(identity: str, payload: OverlayControl, request: Request):
        return public(invoke(lambda: manager.overlay_control(identity, **payload.model_dump())), request)

    @app.get("/api/live/sessions/{identity}/source.wav")
    def source(identity: str):
        chunks, length = invoke(lambda: manager.source(identity))
        return StreamingResponse(chunks, media_type="audio/wav", headers={"Content-Length": str(length),
            "Content-Disposition": f'attachment; filename="live-{identity}.wav"'})

    @app.get("/live-overlay/{identity}/{token}", response_class=HTMLResponse)
    def overlay(identity: str, token: str):
        invoke(lambda: manager.overlay_state(identity, token))
        return HTMLResponse(OVERLAY_HTML, headers={"Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"})

    @app.get("/live-overlay/{identity}/{token}/state")
    def overlay_state(identity: str, token: str):
        return invoke(lambda: manager.overlay_state(identity, token))
