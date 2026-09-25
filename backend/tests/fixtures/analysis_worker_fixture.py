"""Disposable offline process fixture. Never imported by application code."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from voicesubsep.analysis_worker import run_worker
from voicesubsep.inference import AnalysisCancelled


def analyze(path, **kwargs):
    request = json.loads(path.read_text(encoding="utf-8"))
    folder = Path(request["folder"])
    mode = request.get("mode", "complete")
    child = None
    if mode == "block":
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(180)"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    (folder / "started.json").write_text(json.dumps({"pid": os.getpid(), "child": child.pid if child else None, "temporary": os.environ.get("TEMP")}), encoding="utf-8")
    kwargs["recognition_preview"]("첫 번째 시험 발언")
    kwargs["recognition_preview"]("second test line")
    kwargs["progress"]("native-block" if mode == "block" else "fixture-working", .5)
    if mode == "block":
        while True:
            time.sleep(.1)  # Intentionally ignores cooperative cancellation.
    if mode in {"cooperate", "late-complete"}:
        while not kwargs["cancelled"]():
            time.sleep(.01)
        if mode == "cooperate":
            raise AnalysisCancelled("fixture cancelled")
    if mode == "crash":
        os._exit(17)
    if mode == "native-import":
        import numpy as np
        assert np.dot(np.array([2.0, 3.0]), np.array([4.0, 5.0])) == 23.0
    if mode in {"keys", "echo", "escaped-echo"}:
        key = kwargs["get_provider_key"]()
        (folder / "first-key").write_text("received", encoding="utf-8")
        if mode == "echo":
            return {"captions": [{"text": key}]}
        if mode == "escaped-echo":
            raise RuntimeError(json.dumps(key))
        while not (folder / "next-key").exists() and not kwargs["cancelled"]():
            time.sleep(.01)
        kwargs["get_provider_key"]()
    return {"captions": [{"id": "caption-1", "text": "안녕하세요 & hello", "start": .1, "end": 1.5, "speakerId": "speaker-1", "reasons": []}],
            "speakers": [{"id": "speaker-1", "name": "Person", "color": "#2563eb"}], "duration": 2, "warnings": []}


from voicesubsep import analysis_worker
analysis_worker.run_worker = lambda incoming, outgoing: run_worker(incoming, outgoing, analyze)
raise SystemExit(analysis_worker.main())
