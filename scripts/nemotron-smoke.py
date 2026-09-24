"""Local two-voice fixture preparation and explicit offline Nemotron smoke.

--prepare-only uses installed Windows SAPI voices and never imports model code.
--mode diarize or --mode analyze explicitly enables real CUDA inference. Prepare
model packages/weights separately before running: this script stays offline.
Synthetic voice/turn results do not establish real conversational accuracy.
"""

from __future__ import annotations

import argparse
from array import array
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import itertools
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import wave


ROOT = Path(__file__).resolve().parents[1]
RATE = 16000
LIMITATION = "Synthetic installed TTS voices; planned turn/mix windows are not phonetic annotations or real Korean/overlap quality evidence."
UTTERANCES = [
    ("A", "안녕하세요. 오늘은 두 사람의 목소리를 구분하는 자막 프로그램을 확인하겠습니다."),
    ("B", "Hello. I am the second speaker. Please keep my subtitles separate from the first speaker."),
    ("A", "저는 첫 번째 화자입니다. 앞의 말과 같은 사람으로 이어지는지 확인해 주세요."),
    ("B", "Now it is my turn again. The next sentence will overlap with the other voice."),
    ("A", "지금은 두 사람이 동시에 말하고 있습니다. 겹치는 구간을 확인해 주세요."),
    ("B", "I am also speaking at the same time. Both voices should be active in this interval."),
    ("A", "동시에 말하는 구간이 끝났습니다. 다시 첫 번째 화자가 마무리하겠습니다."),
    ("B", "This is the final answer from the second speaker. The local test is now complete."),
]


def save_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def read_pcm(path: Path) -> array:
    with wave.open(str(path), "rb") as audio:
        if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (RATE, 1, 2):
            raise ValueError(f"Expected 16 kHz mono PCM16: {path}")
        samples = array("h", audio.readframes(audio.getnframes()))
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def write_pcm(path: Path, samples) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = array("h", samples)
    if sys.byteorder != "little":
        pcm.byteswap()
    with wave.open(str(path), "wb") as audio:
        audio.setparams((1, 2, RATE, len(pcm), "NONE", "not compressed"))
        audio.writeframes(pcm.tobytes())


def run_powershell(script: str, arguments: list[str], directory: Path) -> str:
    executable = shutil.which("powershell.exe")
    if not executable:
        raise RuntimeError("Windows PowerShell and installed System.Speech voices are required.")
    path = directory / "sapi.ps1"
    path.write_text(script, encoding="utf-8")
    result = subprocess.run([executable, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(path), *arguments],
                            capture_output=True, text=True, encoding="utf-8", errors="replace",
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr[-3000:])
    return result.stdout.strip()


def prepare(source: Path, truth_path: Path) -> dict:
    if sys.platform != "win32":
        raise RuntimeError("Fixture preparation requires locally installed Windows SAPI voices.")
    with tempfile.TemporaryDirectory(prefix="voicesubsep-sapi-") as temporary:
        folder = Path(temporary)
        catalog = json.loads(run_powershell(r'''
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
        @{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name }
    }) | ConvertTo-Json -Compress
} finally { $synth.Dispose() }
''', [], folder))
        if isinstance(catalog, dict):
            catalog = [catalog]
        korean = next((voice for voice in catalog if voice["culture"] == "ko-KR"), None)
        english = next((voice for voice in catalog if voice["culture"].startswith("en")), None)
        if not korean or not english or korean["name"] == english["name"]:
            raise RuntimeError("This fixture requires two distinct installed Korean and English SAPI voices; none are downloaded.")
        voices = {"A": korean, "B": english}
        plan = [{"speaker": speaker, "voice": voices[speaker]["name"], "text": text,
                 "path": str(folder / f"turn-{index + 1}.wav")} for index, (speaker, text) in enumerate(UTTERANCES)]
        plan_path = folder / "plan.json"
        save_json(plan_path, plan)
        run_powershell(r'''
param([string]$Plan)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo -ArgumentList @(
    16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)
try {
    $synth.Rate = 1
    foreach ($entry in (Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json)) {
        $synth.SelectVoice($entry.voice)
        $synth.SetOutputToWaveFile($entry.path, $format)
        $synth.Speak($entry.text)
        $synth.SetOutputToNull()
    }
} finally { $synth.Dispose() }
''', [str(plan_path)], folder)
        snippets = []
        for entry in plan:
            samples = read_pcm(Path(entry["path"]))
            active = [index for index, value in enumerate(samples) if abs(value) >= 128]
            if not active:
                raise RuntimeError(f"SAPI produced silence: {entry['voice']}")
            # Only trim outer padding, retaining 30 ms. Internal pauses remain.
            snippets.append(samples[max(0, active[0] - 480):min(len(samples), active[-1] + 481)])

    turns = []
    cursor = RATE // 2
    for index, (entry, samples) in enumerate(zip(plan, snippets)):
        if index == 5:  # Second voice enters 0.8 s after the first overlap turn.
            start = turns[4]["startSample"] + int(0.8 * RATE)
        else:
            start = cursor
        end = start + len(samples)
        turns.append({"id": f"turn-{index + 1}", "speaker": entry["speaker"], "text": entry["text"],
                      "startSample": start, "endSample": end, "start": start / RATE, "end": end / RATE,
                      "overlapTest": index in (4, 5)})
        cursor = max(cursor, end + int(0.35 * RATE))
    size = cursor + RATE // 2
    channels = {speaker: array("h", [0]) * size for speaker in voices}
    for turn, samples in zip(turns, snippets):
        for offset, sample in enumerate(samples):
            channels[turn["speaker"]][turn["startSample"] + offset] = int(sample * 0.5)
    mixed = array("h", (max(-32768, min(32767, a + b)) for a, b in zip(channels["A"], channels["B"])))
    write_pcm(source, mixed)
    components = {}
    for speaker, samples in channels.items():
        path = source.with_name(source.stem + f"-speaker-{speaker}.wav")
        write_pcm(path, samples)
        components[speaker] = str(path.resolve())
    overlap = {"start": max(turns[4]["start"], turns[5]["start"]), "end": min(turns[4]["end"], turns[5]["end"])}
    truth = {"schemaVersion": 1, "synthetic": True, "limitation": LIMITATION,
             "source": str(source.resolve()), "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
             "duration": size / RATE, "sampleRate": RATE, "format": "mono PCM16", "gainPerVoice": 0.5,
             "voices": voices, "isolatedComponents": components, "turns": turns,
             "plannedOverlap": [overlap], "annotation": "Exact placed utterance windows, including internal TTS pauses; not phonetic VAD."}
    save_json(truth_path, truth)
    return {"prepared": True, "source": str(source), "truth": str(truth_path), "duration": truth["duration"], "voices": voices,
            "plannedOverlap": [overlap], "withinTarget30To45Seconds": 30 <= truth["duration"] <= 45}


def union(spans):
    merged = []
    for start, end in sorted(spans):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def span_seconds(spans) -> float:
    return sum(end - start for start, end in union(spans))


def intersect(left, right):
    return union((max(a, c), min(b, d)) for a, b in left for c, d in right if min(b, d) > max(a, c))


def inspect_activity(raw: list[dict], truth: dict) -> dict:
    intervals = []
    timing_errors = []
    for index, item in enumerate(raw):
        start, end = float(item.get("Start", item.get("start"))), float(item.get("End", item.get("end")))
        speaker = item.get("Speaker", item.get("speaker"))
        if speaker is None or not all(math.isfinite(value) for value in (start, end)) or not 0 <= start < end <= truth["duration"] + 0.1:
            timing_errors.append(index)
            continue
        intervals.append({"start": start, "end": end, "speaker": str(speaker)})
    identities = sorted({item["speaker"] for item in intervals})
    by_speaker = {speaker: union((item["start"], item["end"]) for item in intervals if item["speaker"] == speaker)
                  for speaker in identities}
    solo_turns = [turn for turn in truth["turns"] if not turn["overlapTest"]]
    scores = {speaker: {identity: 0.0 for identity in identities} for speaker in ("A", "B")}
    rows = []
    for turn in solo_turns:
        window = [(turn["start"] + 0.15, turn["end"] - 0.15)]
        coverage = {identity: span_seconds(intersect(window, spans)) for identity, spans in by_speaker.items()}
        for identity, seconds in coverage.items():
            scores[turn["speaker"]][identity] += seconds
        dominant = max(coverage, key=coverage.get) if coverage and max(coverage.values()) > 0 else None
        rows.append({"turnId": turn["id"], "expected": turn["speaker"], "start": turn["start"], "end": turn["end"],
                     "dominantDetected": dominant, "coverageSeconds": coverage,
                     "dominantTurnWindowCoverage": coverage.get(dominant, 0) / max(0.001, span_seconds(window))})
    mapping = {}
    if len(identities) >= 2:
        best = max(itertools.permutations(identities, 2), key=lambda pair: scores["A"][pair[0]] + scores["B"][pair[1]])
        mapping = dict(zip(("A", "B"), best))
    for row in rows:
        row["consistent"] = row["dominantDetected"] == mapping.get(row["expected"]) and row["dominantTurnWindowCoverage"] >= 0.3
    predicted_overlap = union((max(left["start"], right["start"]), min(left["end"], right["end"]))
                              for left, right in itertools.combinations(intervals, 2)
                              if left["speaker"] != right["speaker"] and min(left["end"], right["end"]) > max(left["start"], right["start"]))
    planned = [(item["start"], item["end"]) for item in truth["plannedOverlap"]]
    matching_overlap = span_seconds(intersect(planned, predicted_overlap))
    checks = {"finiteSourceTimeIntervals": not timing_errors and bool(intervals), "exactlyTwoDetectedSpeakers": len(identities) == 2,
              "soloTurnAlternationConsistent": bool(mapping) and all(row["consistent"] for row in rows),
              "overlapDetectedInsidePlannedMix": matching_overlap >= 0.2}
    return {"checks": checks, "detectedSpeakerCount": len(identities), "speakerMappingByBestSoloTurnCoverage": mapping,
            "soloTurns": rows, "invalidIntervalIndexes": timing_errors, "intervals": intervals,
            "overlap": {"plannedWindows": truth["plannedOverlap"], "detectedWindows": predicted_overlap,
                        "intersectionSeconds": matching_overlap,
                        "plannedMixWindowCoverage": matching_overlap / max(0.001, span_seconds(planned)),
                        "detectedOverlapSeconds": span_seconds(predicted_overlap)},
            "metricNote": "Turn-window coverage includes pauses and is not DER/JER, phonetic VAD, or a real-world quality score."}


def run_models(args) -> dict:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["DO_NOT_TRACK"] = "1"
    started = time.monotonic()
    report = {"passed": False, "runtimeCompleted": False, "mode": args.mode, "device": "cuda", "offline": True,
              "whisperModel": args.whisper_model, "language": args.language,
              "synthetic": True, "limitation": LIMITATION, "startedAt": datetime.now(timezone.utc).isoformat()}
    try:
        truth = json.loads(args.truth.read_text(encoding="utf-8"))
        digest = hashlib.sha256(args.source.read_bytes()).hexdigest()
        if digest != truth["sha256"]:
            raise RuntimeError("Source WAV differs from the fixture truth SHA256.")
        samples = read_pcm(args.source)
        if abs(len(samples) / RATE - truth["duration"]) > 1 / RATE:
            raise RuntimeError("Source/truth duration mismatch.")
        report["fixture"] = {"source": str(args.source), "truth": str(args.truth), "sha256": digest,
                             "duration": truth["duration"], "voices": truth["voices"]}
        report["packages"] = {}
        for package in ("torch", "transformers", "faster-whisper", "huggingface-hub"):
            try:
                report["packages"][package] = importlib.metadata.version(package)
            except importlib.metadata.PackageNotFoundError:
                report["packages"][package] = None
        from voicesubsep import inference as infer

        stages = []
        report["stages"] = stages
        def progress(stage, fraction):
            if not stages or stages[-1]["stage"] != stage:
                stages.append({"stage": stage, "progress": fraction, "elapsedSeconds": round(time.monotonic() - started, 3)})
                print(f"{stage} ({fraction:.0%})", flush=True)
        raw = []
        if args.mode == "diarize":
            raw = infer._diarize(args.source, device="cuda", progress=progress, cancelled=lambda: False)
        else:
            original = infer._diarize
            def observe_diarization(*positional, **keywords):
                actual = original(*positional, **keywords)
                raw.extend(actual)
                return actual
            # Observe the real function once; no model or result is replaced.
            infer._diarize = observe_diarization
            try:
                report["analysis"] = infer.analyze(args.source, audio_track=0, mode="overlap", speaker_count=2,
                    whisper_model=args.whisper_model, language=args.language, device="cuda", diarization=True,
                    progress=progress, cancelled=lambda: False)
            finally:
                infer._diarize = original
        report["stages"] = stages
        report["activity"] = inspect_activity(raw, truth)
        if args.mode == "analyze":
            captions = report["analysis"]["captions"]
            report["activity"]["checks"]["nonemptyCaptionText"] = bool(captions) and any(c["text"].strip() for c in captions)
            report["activity"]["checks"]["captionSourceTimesValid"] = all(
                all(isinstance(c.get(key), (int, float)) and math.isfinite(c[key]) for key in ("start", "end"))
                and 0 <= c["start"] < c["end"] <= truth["duration"] + 0.1 for c in captions)
            caption_activity = inspect_activity([
                {"start": c["start"], "end": c["end"], "speaker": c["speakerId"]}
                for c in captions if c["speakerId"] is not None
            ], truth)
            report["activity"]["checks"]["captionSoloTurnAlternationConsistent"] = caption_activity["checks"]["soloTurnAlternationConsistent"]
            report["captionEvidence"] = {"count": len(captions), "assignedCount": sum(c["speakerId"] is not None for c in captions),
                                         "overlapReviewCount": sum("overlap" in c["reasons"] for c in captions),
                                         "speakerMapping": caption_activity["speakerMappingByBestSoloTurnCoverage"],
                                         "soloTurns": caption_activity["soloTurns"]}
        report["runtimeCompleted"] = True
        report["passed"] = all(report["activity"]["checks"].values())
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare-only", action="store_true")
    mode.add_argument("--mode", choices=("diarize", "analyze"))
    parser.add_argument("--whisper-model", default="large-v3-turbo",
                        help="Whisper model for analyze mode (default: large-v3-turbo).")
    parser.add_argument("--language", default="auto",
                        help="Whisper language code or auto for analyze mode (default: auto).")
    parser.add_argument("--source", type=Path, default=ROOT / "tmp/nemotron-two-voices.wav")
    parser.add_argument("--truth", type=Path, default=ROOT / "tmp/nemotron-two-voices.truth.json")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/nemotron-smoke.json")
    args = parser.parse_args()
    args.source, args.truth, args.output = args.source.resolve(), args.truth.resolve(), args.output.resolve()
    if args.prepare_only:
        report = prepare(args.source, args.truth)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    report = run_models(args)
    save_json(args.output, report)
    print(json.dumps({"passed": report["passed"], "runtimeCompleted": report["runtimeCompleted"], "output": str(args.output),
                      "error": report.get("error")}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
