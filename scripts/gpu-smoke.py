"""Explicit real-model CUDA smoke. Downloads uncached weights; never uploads audio."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import time

from voicesubsep.inference import analyze


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--models", nargs="+", default=["large-v3", "large-v3-turbo"])
    parser.add_argument("--language", default="en")
    parser.add_argument("--output", type=Path, default=Path("tmp/gpu-smoke.json"))
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    reports = []
    for model in args.models:
        started = time.monotonic()
        last_stage = None
        def progress(stage, fraction):
            nonlocal last_stage
            if stage != last_stage:
                print(f"{model}: {stage} ({fraction:.0%})", flush=True)
                last_stage = stage
        result = analyze(source, audio_track=0, mode="standard", speaker_count=1,
                         whisper_model=model, language=args.language, device="cuda",
                         diarization=False, progress=progress, cancelled=lambda: False)
        captions = result["captions"]
        assert captions, "Expected recognized speech in the explicit spoken fixture"
        assert all(c["speakerId"] is None and 0 <= c["start"] < c["end"] <= result["duration"] + .1 for c in captions)
        reports.append({"model": model, "device": "cuda", "computeType": "float16",
                        "elapsedIncludingDownloadSeconds": round(time.monotonic() - started, 3),
                        "sourceDurationSeconds": result["duration"], "captionCount": len(captions),
                        "wordCount": sum(len(c.get("words", [])) for c in captions),
                        "text": " ".join(c["text"] for c in captions), "warnings": result["warnings"]})
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(reports[-1], ensure_ascii=False), flush=True)
    probe = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version,memory.total,memory.free", "--format=csv,noheader"], capture_output=True, text=True)
    print(probe.stdout.strip(), flush=True)


if __name__ == "__main__":
    main()
