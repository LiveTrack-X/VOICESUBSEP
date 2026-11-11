"""Offline frozen Windows speech-tool integration with synthetic SAPI fixtures.

Run after building with scripts/build-backend.ps1 -IncludeSpeechToolsRuntime:
  python scripts/bundled-speech-tools-smoke.py --output tmp/bundled-speech-tools.json

Requires the existing tmp/speech-tools-smoke fixtures/result.json and already
prepared local WeSpeaker, SepFormer and tiny Whisper weights. No downloads or
cloud calls are requested. Only the standard library is used by this driver;
the child uses its bundled dependencies, isolated data/CWD and system-only PATH.
This checks executable integration, not Korean separation/recognition quality.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
import wave


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("bundled_backend_smoke", ROOT / "scripts/bundled-backend-smoke.py")
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)


def require(condition, message):
    if not condition:
        raise base.SmokeError(message)


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def wait_job(port, identity, timeout, *, expected="completed"):
    deadline = time.monotonic() + timeout
    previous = None
    while time.monotonic() < deadline:
        job = base.request_json(port, "GET", f"/api/speech-tools/jobs/{identity}")
        current = (job.get("status"), job.get("stage"))
        if current != previous:
            print(f"[{current[0]}] {current[1]}", flush=True)
            previous = current
        if job.get("status") in {"completed", "failed", "cancelled"}:
            require(job["status"] == expected, f"Speech tool expected {expected}: {job.get('error') or job['status']}")
            return job
        time.sleep(.25)
    base.request_json(port, "POST", f"/api/speech-tools/jobs/{identity}/cancel")
    raise base.SmokeError(f"Speech tool exceeded {timeout}s.")


def submit(port, payload, timeout):
    reply = base.request_json(port, "POST", "/api/speech-tools/jobs", payload)
    identity = reply.get("id")
    require(isinstance(identity, str) and re.fullmatch(r"[a-f0-9]{32}", identity), "Unexpected tool job ID.")
    return identity, wait_job(port, identity, timeout)


def source_fields(media):
    tracks = media.get("audioTracks") or []
    require(bool(tracks), "Uploaded synthetic WAV has no audio track.")
    return {"mediaId": media["id"], "sourceIdentity": {"sha256": media["sha256"], "bytes": media["bytes"]},
            "audioTrack": tracks[0]["index"]}


def audio(port, route, identity, *, expected_status=200):
    require(isinstance(route, str) and re.fullmatch(
        rf"/api/speech-tools/jobs/{re.escape(identity)}/audio/(original|stream-[12])\.wav", route),
        "Unexpected audio URL; only this local job may be read.")
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        connection.request("GET", route)
        response = connection.getresponse()
        raw = response.read(4 * 1024 * 1024 + 1)
        require(response.status == expected_status, f"Audio HTTP {response.status}, expected {expected_status}.")
        require(len(raw) <= 4 * 1024 * 1024, "Audio response exceeded 4 MiB.")
        return raw
    finally:
        connection.close()


def wav_record(raw):
    with wave.open(io.BytesIO(raw), "rb") as source:
        record = {"sampleRate": source.getframerate(), "frames": source.getnframes(),
                  "channels": source.getnchannels(), "sampleWidth": source.getsampwidth()}
        samples = source.readframes(source.getnframes())
    require((record["sampleRate"], record["frames"], record["channels"], record["sampleWidth"])
            == (8000, 48000, 1, 2), f"Unexpected candidate WAV geometry: {record}")
    require(len(samples) == 96000 and any(samples), "Empty or truncated candidate WAV.")
    return {**record, "sha256": hashlib.sha256(raw).hexdigest()}


def check_captions(stream, start, end):
    captions = stream.get("captions")
    require(isinstance(captions, list) and captions, "Synthetic stream has no retranscribed captions.")
    previous = start
    text = []
    for cue in captions:
        left, right = cue.get("start"), cue.get("end")
        require(all(isinstance(n, (float, int)) and not isinstance(n, bool) and math.isfinite(n)
                    for n in (left, right)), "Nonfinite caption time.")
        require(start <= left < right <= end and left >= previous, "Caption leaves original selected clock.")
        require(cue.get("speakerId") is None and cue.get("reviewed") is False
                and {"overlap", "unassigned"}.issubset(cue.get("reasons") or []), "Candidate was automatically assigned/reviewed.")
        require(isinstance(cue.get("text"), str) and cue["text"].strip(), "Candidate text is empty.")
        previous = left
        text.append(cue["text"])
        for word in cue.get("words") or []:
            require(all(isinstance(word.get(k), (float, int)) and not isinstance(word[k], bool)
                        and math.isfinite(word[k]) for k in ("start", "end")), "Nonfinite word time.")
            require(left <= word["start"] < word["end"] <= right, "Word leaves its caption interval.")
    return " ".join(text)


def run(args):
    started = time.monotonic()
    report = {"passed": False, "startedAt": datetime.now(timezone.utc).isoformat(),
              "executable": str(args.executable), "offline": True, "systemOnlyChildPath": True,
              "syntheticFixtures": str(args.fixtures), "cloudCalls": False,
              "qualityLimit": "Operational frozen integration only. Two synthetic voices are not a Korean/broadcast benchmark; previous source smoke did not recover the Korean phrase."}
    log_path = args.output.with_suffix(".server.log")
    report["serverLog"] = str(log_path)
    try:
        require(sys.platform == "win32", "This frozen integration smoke requires Windows.")
        require(args.executable.is_file(), "Frozen executable is missing.")
        report["executableSha256"] = digest(args.executable)
        require((args.web_dir / "index.html").is_file(), "Production web build is missing.")
        previous = json.loads((args.fixtures / "result.json").read_text(encoding="utf-8"))
        fixture = previous["steps"]["localSyntheticFixtures"]["result"]
        require(previous["steps"]["localSyntheticFixtures"]["status"] == "passed", "Synthetic fixture provenance is incomplete.")
        comparison, overlap = args.fixtures / "voice-comparison-source.wav", args.fixtures / "overlap-source.wav"
        before = {path.name: digest(path) for path in (comparison, overlap)}
        require(before[comparison.name] == fixture["comparisonSource"]["sha256"]
                and before[overlap.name] == fixture["overlapSource"]["sha256"], "Synthetic fixture hash changed.")
        report["sourceHashesBefore"] = before
        token = secrets.token_urlsafe(32)
        environment = base.isolated_environment(token)
        port = base.unused_loopback_port()
        report["childPath"] = environment["PATH"]
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="voicesubsep-frozen-speech-tools-") as temporary, log_path.open("wb") as log:
            workspace = Path(temporary)
            process = subprocess.Popen([str(args.executable), "--port", str(port), "--data-dir", str(workspace / "data"),
                                        "--web-dir", str(args.web_dir)], cwd=workspace, env=environment,
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                       shell=False, creationflags=subprocess.CREATE_NO_WINDOW)
            identified = False
            try:
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    require(process.poll() is None, "Frozen server exited during startup; see server log.")
                    try:
                        ready = base.request_json(port, "GET", "/api/ready", timeout=5)
                        if ready.get("app") == "voicesubsep" and ready.get("status") == "ok":
                            identified = True
                            break
                    except (OSError, http.client.HTTPException, base.SmokeError):
                        pass
                    time.sleep(.25)
                require(identified, "Frozen server readiness timed out.")
                report["status"] = status = base.request_json(port, "GET", "/api/speech-tools/status", timeout=120)
                for kind in ("voice", "overlap"):
                    require(status.get(kind, {}).get("runtimeAvailable") is True and status[kind].get("ready") is True,
                            f"Frozen {kind} runtime/weights unavailable: {status.get(kind)}")

                voice_media = base.upload_wav(port, comparison)
                voice_fields = source_fields(voice_media)
                voice_id, voice_job = submit(port, {**voice_fields, "kind": "voice-match",
                    "references": fixture["references"], "targets": fixture["targets"]}, args.timeout)
                voice = voice_job["result"]
                require(voice.get("sourceIdentity") == voice_fields["sourceIdentity"], "Voice source identity was not preserved.")
                rows = voice.get("candidates") or []
                require(len(rows) == 2, "Expected two independent synthetic voice targets.")
                expected = {"heami-target": "heami", "zira-target": "zira"}
                for row in rows:
                    scores = row.get("scores") or []
                    require(len(scores) == 2 and all(isinstance(s.get("similarity"), (float, int))
                        and math.isfinite(s["similarity"]) and -1 <= s["similarity"] <= 1 for s in scores),
                        "Expected two finite actual ONNX scores per target.")
                    require(scores[0].get("speakerId") == expected.get(row.get("captionId")), "Synthetic voice ranked another reference first.")
                report["voiceMatch"] = voice
                base.request_json(port, "DELETE", f"/api/speech-tools/jobs/{voice_id}")

                overlap_media = base.upload_wav(port, overlap)
                overlap_fields = source_fields(overlap_media)
                payload = {**overlap_fields, "kind": "overlap-recovery", "start": 1.25, "end": 7.25,
                           "whisperModel": "tiny", "language": "auto", "vocabulary": []}
                overlap_id, overlap_job = submit(port, payload, args.timeout)
                recovered = overlap_job["result"]
                require(recovered.get("sourceIdentity") == overlap_fields["sourceIdentity"], "Overlap source identity was not preserved.")
                require(recovered.get("start") == 1.25 and recovered.get("end") == 7.25, "Selected source clock changed.")
                streams = recovered.get("streams") or []
                require(len(streams) == 2, "Frozen SepFormer did not return two streams.")
                records = [wav_record(audio(port, recovered.get("originalUrl"), overlap_id))]
                transcripts = []
                for stream in streams:
                    transcripts.append(check_captions(stream, 1.25, 7.25))
                    records.append(wav_record(audio(port, stream.get("audioUrl"), overlap_id)))
                require(records[1]["sha256"] != records[2]["sha256"], "Separated outputs are identical files.")
                report["overlapRecovery"] = recovered
                report["audioFiles"] = records
                report["candidateTranscripts"] = transcripts
                original_route = recovered["originalUrl"]
                base.request_json(port, "DELETE", f"/api/speech-tools/jobs/{overlap_id}")
                audio(port, original_route, overlap_id, expected_status=404)
                report["discardRevokesAudio"] = True

                cancelled = base.request_json(port, "POST", "/api/speech-tools/jobs", payload)["id"]
                cancel_deadline = time.monotonic() + args.timeout
                while time.monotonic() < cancel_deadline:
                    running = base.request_json(port, "GET", f"/api/speech-tools/jobs/{cancelled}")
                    require(running.get("status") not in {"completed", "failed", "cancelled"},
                            "Cancellation fixture ended before a running worker could be stopped.")
                    if running.get("status") == "running" and running.get("progress", 0) > 0:
                        report["cancelAtStage"] = {"stage": running["stage"], "progress": running["progress"]}
                        break
                    time.sleep(.1)
                else:
                    raise base.SmokeError("Cancellation fixture worker made no progress.")
                base.request_json(port, "POST", f"/api/speech-tools/jobs/{cancelled}/cancel")
                cancelled_job = wait_job(port, cancelled, args.timeout, expected="cancelled")
                require("result" not in cancelled_job or cancelled_job["result"] is None, "Cancelled job retained a candidate result.")
                base.request_json(port, "DELETE", f"/api/speech-tools/jobs/{cancelled}")
                report["cancelledJobReapedAndDiscarded"] = True
                require(base.request_json(port, "GET", "/api/ready").get("status") == "ok", "Server unavailable after cancellation.")
                report["sourceHashesAfter"] = {path.name: digest(path) for path in (comparison, overlap)}
                require(before == report["sourceHashesAfter"], "Synthetic source changed during frozen execution.")
                require(digest(args.executable) == report["executableSha256"], "Frozen executable changed during the smoke.")
            finally:
                report["shutdown"] = base.stop_owned_process(process, port, token, identified, environment)
            require(report["shutdown"]["clean"], "Frozen backend did not shut down cleanly.")
            report["passed"] = True
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
    report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, default=ROOT / "build/backend/voicesubsep-server/voicesubsep-server.exe")
    parser.add_argument("--web-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--fixtures", type=Path, default=ROOT / "tmp/speech-tools-smoke")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/bundled-speech-tools-smoke.json")
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()
    for field in ("executable", "web_dir", "fixtures", "output"):
        setattr(args, field, getattr(args, field).resolve())
    if args.timeout <= 0 or args.output.suffix.lower() != ".json":
        parser.error("Use a positive timeout and .json output path.")
    report = run(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    staging = args.output.with_name(args.output.name + ".tmp")
    staging.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(staging, args.output)
    print(json.dumps({"passed": report["passed"], "report": str(args.output), "error": report.get("error")}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
