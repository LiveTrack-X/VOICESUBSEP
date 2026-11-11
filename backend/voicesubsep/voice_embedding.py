"""Experimental acoustic candidates from user-confirmed local voice references.

Raw cosine thresholds are review policy, not calibrated identity probabilities.
Importing this module loads no numerical runtime, VAD, model, or network client.
"""
from __future__ import annotations

import importlib
import math
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
from typing import Callable
import wave

from . import voice_embedding_cache as cache

SAMPLE_RATE = 16000
SIMILARITY_THRESHOLD = .75
MARGIN_THRESHOLD = .15
MIN_REFERENCE_SECONDS = 3.
MIN_TARGET_SECONDS = 1.5
MAX_SEGMENT_SECONDS = 15.
MAX_REFERENCES = 16
MAX_TARGETS = 50
UNCALIBRATED_WARNING = ("Experimental, uncalibrated raw cosine similarity; thresholds 0.75 and margin 0.15 "
                        "are review policy, not identity probabilities. Listen before applying any candidate.")


def _runtime():
    try:
        np = importlib.import_module("numpy")
        torch = importlib.import_module("torch")
        ort = importlib.import_module("onnxruntime")
        kaldi = importlib.import_module("torchaudio.compliance.kaldi")
        vad = importlib.import_module("faster_whisper.vad")
        if "CPUExecutionProvider" not in ort.get_available_providers():
            raise RuntimeError("ONNX CPUExecutionProvider is unavailable")
        return SimpleNamespace(np=np, torch=torch, ort=ort, kaldi=kaldi, vad=vad)
    except Exception as exc:
        raise RuntimeError("음성 비교 실행환경이 필요합니다. torch·torchaudio·onnxruntime·faster-whisper 설치를 확인하세요.") from exc


def model_status() -> dict:
    try:
        _runtime()
    except RuntimeError as exc:
        return {"runtimeAvailable": False, "ready": False, "issue": str(exc)}
    try:
        cache.verified_model_path()
    except RuntimeError as exc:
        return {"runtimeAvailable": True, "ready": False, "issue": str(exc)}
    return {"runtimeAvailable": True, "ready": True, "issue": None}


def prepare_model(*, progress: Callable[[str, float], None], cancelled: Callable[[], bool]) -> dict:
    cache._checkpoint(cancelled)
    _runtime()
    return cache.prepare_weights(progress=progress, cancelled=cancelled)


def _number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Invalid finite voice reference time.")
    return float(value)


def _id(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,128}", value):
        raise ValueError("Invalid voice reference or caption identifier.")
    return value


def _validate(audio_track: int, references: list[dict], targets: list[dict]) -> tuple[list[dict], list[dict]]:
    if type(audio_track) is not int or not 0 <= audio_track <= 4096:
        raise ValueError("Invalid audio track.")
    if not isinstance(references, list) or not 2 <= len(references) <= MAX_REFERENCES:
        raise ValueError("Select 2 to 16 confirmed voice references.")
    if not isinstance(targets, list) or not 1 <= len(targets) <= MAX_TARGETS:
        raise ValueError("Select 1 to 50 target captions.")
    cleaned = []
    for items, reference in ((references, True), (targets, False)):
        result, ids = [], set()
        key = "id" if reference else "captionId"
        for item in items:
            keys = {key, "start", "end", "speakerId"} if reference else {key, "start", "end"}
            if not isinstance(item, dict) or set(item) != keys:
                raise ValueError("Invalid voice comparison segment.")
            identity, start, end = _id(item[key]), _number(item["start"]), _number(item["end"])
            if identity in ids or not 0 <= start < end <= 7 * 24 * 60 * 60:
                raise ValueError("Invalid or duplicate voice comparison range.")
            ids.add(identity)
            row = {key: identity, "start": start, "end": end}
            if reference:
                row["speakerId"] = _id(item["speakerId"])
                if not MIN_REFERENCE_SECONDS <= end - start <= MAX_SEGMENT_SECONDS:
                    raise ValueError("Confirmed voice references must last 3 to 15 seconds.")
            result.append(row)
        cleaned.append(result)
    refs, cues = cleaned
    if len({ref["speakerId"] for ref in refs}) < 2:
        raise ValueError("Confirm references for at least two distinct speakers before comparison.")
    for index, ref in enumerate(refs):
        if any(other["speakerId"] != ref["speakerId"] and min(ref["end"], other["end"]) > max(ref["start"], other["start"])
               for other in refs[index + 1:]):
            raise ValueError("Confirmed references for different speakers overlap.")
    return refs, cues


def _decode_audio(source: Path, track: int, destination: Path, cancelled: Callable[[], bool]) -> None:
    from .inference import _extract_audio
    _extract_audio(source, track, destination, cancelled)


def _load_session(runtime, path: Path):
    options = runtime.ort.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    session = runtime.ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
    inputs, outputs = session.get_inputs(), session.get_outputs()
    if len(inputs) != 1 or inputs[0].name != "feats" or inputs[0].type != "tensor(float)" or outputs[0].name != "embs":
        raise RuntimeError("Unexpected pinned voice model input/output contract.")
    return session


def _speech_probabilities(samples, runtime):
    padded = runtime.np.pad(samples, (0, (-len(samples)) % 512))
    return runtime.np.asarray(runtime.vad.get_vad_model()(padded)).reshape(-1)


def _quality(samples, runtime, *, reference: bool) -> str | None:
    np = runtime.np
    if not len(samples) or not np.isfinite(samples).all():
        return "invalid_audio"
    if float(np.mean(np.abs(samples) >= .999)) > .01:
        return "clipped"
    if float(np.sqrt(np.mean(samples * samples))) < .0001:
        return "silence"
    try:
        probabilities = _speech_probabilities(samples, runtime)
        if (len(probabilities) != (len(samples) + 511) // 512 or not np.isfinite(probabilities).all()
                or (probabilities < 0).any() or (probabilities > 1).any()):
            return "speech_check_unavailable"
        voiced = float(np.mean(probabilities >= .5))
        if voiced < .5 or voiced * len(samples) / SAMPLE_RATE < (2. if reference else 1.):
            return "insufficient_speech"
    except Exception:
        return "speech_check_unavailable"
    return None


def _embedding(samples, runtime, session):
    """Match the pinned Apache-2.0 official infer_onnx.py feature recipe."""
    torch, np = runtime.torch, runtime.np
    waveform = torch.from_numpy(samples.copy()).unsqueeze(0) * (1 << 15)
    with torch.inference_mode():
        feats = runtime.kaldi.fbank(waveform, num_mel_bins=80, frame_length=25, frame_shift=10,
                                    dither=0., sample_frequency=SAMPLE_RATE, window_type="hamming", use_energy=False)
        feats = feats - torch.mean(feats, dim=0)
        features = feats.unsqueeze(0).numpy().astype("float32", copy=False)
    if features.ndim != 3 or features.shape[0] != 1 or features.shape[2] != 80 or not np.isfinite(features).all():
        raise RuntimeError("Invalid voice model features.")
    output = np.asarray(session.run(["embs"], {"feats": features})[0])
    if output.shape != (1, 256) or not np.isfinite(output).all():
        raise RuntimeError("Invalid voice embedding output.")
    return _unit(output[0], np)


def _unit(embedding, np):
    vector = np.asarray(embedding, dtype="float64")
    norm = float(np.linalg.norm(vector))
    if vector.ndim != 1 or not np.isfinite(vector).all() or not math.isfinite(norm) or norm <= 1e-8:
        raise RuntimeError("Invalid zero or nonfinite voice embedding.")
    return vector / norm


def match_voices(media_path: Path, *, audio_track: int, references: list[dict], targets: list[dict],
                 progress: Callable[[str, float], None], cancelled: Callable[[], bool]) -> dict:
    cache._checkpoint(cancelled)
    refs, cues = _validate(audio_track, references, targets)
    path = cache.verified_model_path(cancelled=cancelled)
    runtime = _runtime()
    np = runtime.np
    cache._checkpoint(cancelled)
    session = _load_session(runtime, path)
    progress("선택한 원본 트랙을 음성 비교용으로 준비", .05)
    with tempfile.TemporaryDirectory(prefix="voicesubsep-voice-") as temporary:
        decoded = Path(temporary) / "source.wav"
        _decode_audio(media_path, audio_track, decoded, cancelled)
        cache._checkpoint(cancelled)
        with wave.open(str(decoded), "rb") as source:
            if (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype()) != (1, 2, SAMPLE_RATE, "NONE"):
                raise ValueError("Expected original-track mono PCM16 at 16 kHz.")
            duration = source.getnframes() / SAMPLE_RATE
            if any(item["end"] > duration + 1 / SAMPLE_RATE for item in refs + cues):
                raise ValueError("Voice comparison range exceeds the decoded source.")
            def read(item):
                first, last = round(item["start"] * SAMPLE_RATE), round(item["end"] * SAMPLE_RATE)
                source.setpos(first)
                raw = source.readframes(last - first)
                if len(raw) != (last - first) * 2:
                    raise ValueError("Incomplete source audio segment.")
                return np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.
            grouped = {}
            total = len(refs) + len(cues)
            for index, ref in enumerate(refs):
                cache._checkpoint(cancelled)
                samples = read(ref)
                reason = _quality(samples, runtime, reference=True)
                cache._checkpoint(cancelled)
                if reason:
                    raise ValueError(f"Confirmed reference {ref['id']}: {reason}. Choose a clean single-speaker reference.")
                grouped.setdefault(ref["speakerId"], []).append(_unit(_embedding(samples, runtime, session), np))
                progress("확인한 기준 음성 비교", .15 + .8 * (index + 1) / total)
            prototypes = {speaker: _unit(np.mean(vectors, axis=0), np) for speaker, vectors in grouped.items()}
            candidates = []
            for index, cue in enumerate(cues):
                cache._checkpoint(cancelled)
                row = {"captionId": cue["captionId"], "scores": [], "recommendedSpeakerId": None, "reason": "too_short"}
                width = cue["end"] - cue["start"]
                if width > MAX_SEGMENT_SECONDS:
                    row["reason"] = "too_long"
                elif width >= MIN_TARGET_SECONDS:
                    if any(min(cue["end"], ref["end"]) > max(cue["start"], ref["start"]) for ref in refs):
                        row["reason"] = "reference_overlap"
                    else:
                        samples = read(cue)
                        reason = _quality(samples, runtime, reference=False)
                        cache._checkpoint(cancelled)
                        if reason:
                            row["reason"] = reason
                        else:
                            vector = _unit(_embedding(samples, runtime, session), np)
                            scores = sorted(({"speakerId": speaker, "similarity": float(np.clip(np.dot(vector, prototype), -1., 1.))}
                                             for speaker, prototype in prototypes.items()), key=lambda item: (-item["similarity"], item["speakerId"]))
                            row["scores"] = scores
                            best, runner = scores[:2]
                            row["reason"] = "low_similarity" if best["similarity"] < SIMILARITY_THRESHOLD else (
                                "ambiguous" if best["similarity"] - runner["similarity"] < MARGIN_THRESHOLD else "candidate")
                            if row["reason"] == "candidate":
                                row["recommendedSpeakerId"] = best["speakerId"]
                candidates.append(row)
                progress("미배정 음성 후보 비교", .15 + .8 * (len(refs) + index + 1) / total)
    cache._checkpoint(cancelled)
    progress("음성 비교 후보 준비 완료", 1.)
    return {"model": cache.MODEL_ID, "revision": cache.MODEL_REVISION, "candidates": candidates,
            "warnings": [UNCALIBRATED_WARNING]}
