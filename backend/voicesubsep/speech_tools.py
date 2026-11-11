"""Ephemeral, explicitly requested local speech experiments in owned workers."""
from __future__ import annotations

import copy
from collections import deque
from pathlib import Path
import shutil
import threading

from .analysis_process import AnalysisProcess, AnalysisWorkerCleanupError
from .inference import AnalysisCancelled
from .media_identity import verify_snapshot_source
from .storage import new_id, valid_id

TERMINAL = {"completed", "failed", "cancelled"}
AUDIO_FILES = {"original.wav", "stream-1.wav", "stream-2.wav"}


def run_speech_tool(media_path, *, kind, output_dir, progress, cancelled, **options):
    """Called inside the contained worker; never executes remote model code."""
    if kind == "prepare-voice":
        from .voice_embedding import prepare_model
        return prepare_model(progress=progress, cancelled=cancelled)
    if kind == "prepare-overlap":
        from .overlap_recovery import prepare_model
        from .model_cache import resolve_whisper_model
        result = prepare_model(progress=progress, cancelled=cancelled)
        if cancelled():
            raise AnalysisCancelled()
        progress("Whisper 모델 준비", .8)
        resolve_whisper_model(options["whisper_model"])
        if cancelled():
            raise AnalysisCancelled()
        return result
    if kind == "voice-match":
        from .voice_embedding import match_voices
        return match_voices(Path(media_path), audio_track=options["audio_track"], references=options["references"],
                            targets=options["targets"], progress=progress, cancelled=cancelled)
    if kind == "voice-preview":
        return preview_voice_range(Path(media_path), audio_track=options["audio_track"], start=options["start"],
            end=options["end"], output_dir=Path(output_dir), progress=progress, cancelled=cancelled)
    if kind == "overlap-recovery":
        from .overlap_recovery import recover_overlap
        return recover_overlap(Path(media_path), audio_track=options["audio_track"], start=options["start"],
            end=options["end"], whisper_model=options["whisper_model"], language=options["language"],
            vocabulary=options["vocabulary"], output_dir=Path(output_dir), progress=progress, cancelled=cancelled)
    raise ValueError("Unsupported local speech tool.")


def preview_voice_range(media_path, *, audio_track, start, end, output_dir, progress, cancelled):
    # Reuse the timestamp reconstruction used by separation; the preview is
    # served from the chosen stream rather than a browser's default track.
    from .overlap_recovery import _extract_original, SAMPLE_RATE
    original = output_dir / "original.wav"
    first, last = round(start * SAMPLE_RATE), round(end * SAMPLE_RATE)
    _extract_original(media_path, audio_track, first, last - first, original, cancelled)
    progress("선택 트랙 미리듣기 준비", .95)
    return {"start": first / SAMPLE_RATE, "end": last / SAMPLE_RATE, "originalFile": "original.wav", "warnings": []}


class SpeechToolsManager:
    def __init__(self, storage, runner=None):
        self.storage = storage
        self.runner = runner
        self.root = storage.contained(storage.root / "speech-tools")
        self._condition = threading.Condition(threading.RLock())
        self._records = {}
        self._cancel = {}
        self._pending = deque()
        self._stopping = False
        self._thread = None

    def start(self):
        self.root.mkdir(parents=True, exist_ok=True)
        # Only these tool-owned ID directories are temporary; shared models and
        # original media live elsewhere. Never traverse an arbitrary symlink.
        for path in self.root.iterdir():
            if valid_id(path.name) and path.is_dir() and not path.is_symlink():
                self._cleanup(path.name)
        self._thread = threading.Thread(target=self._work, name="local-speech-tools", daemon=True)
        self._thread.start()

    def _directory(self, identity):
        if not valid_id(identity):
            raise KeyError(identity)
        result = self.storage.contained(self.root / identity)
        if not result.is_relative_to(self.root):
            raise ValueError("Invalid speech tool output directory.")
        return result

    def _cleanup(self, identity):
        directory = self._directory(identity)
        if directory.exists():
            try:
                shutil.rmtree(directory)
            except OSError:
                # A Windows FileResponse can still have a completed preview
                # open. Defer removal to the next start; never abort shutdown
                # or kill the queue because a read-only player owns a handle.
                return False
        return True

    def stop(self):
        with self._condition:
            self._stopping = True
            for event in self._cancel.values():
                event.set()
            self._condition.notify_all()
        if self._thread:
            self._thread.join(timeout=8)
        with self._condition:
            for identity, record in self._records.items():
                # Never delete files while an injected in-process runner owns
                # them. The normal isolated worker is forcibly reaped first.
                if record["status"] != "running" and not record.get("unsafeOwned"):
                    self._cleanup(identity)

    def require_idle(self):
        with self._condition:
            if self._stopping:
                raise RuntimeError("음성 도구 작업자를 다시 시작하세요.")
            if any(row["status"] not in TERMINAL for row in self._records.values()):
                raise PermissionError("음성 도구 작업이 끝나거나 중지된 뒤 분석을 시작하세요.")

    def referenced_media_ids(self):
        with self._condition:
            return {row["mediaId"] for row in self._records.values() if row.get("mediaId") and (row["status"] not in TERMINAL or row.get("unsafeOwned"))}

    def submit(self, payload, metadata=None):
        with self._condition:
            if self._stopping or not self._thread or not self._thread.is_alive():
                raise RuntimeError("음성 도구 작업자를 사용할 수 없습니다.")
            if sum(row["status"] not in TERMINAL for row in self._records.values()) >= 4:
                raise OverflowError("음성 도구 대기열이 가득 찼습니다.")
            # Bound retained candidates/audio even if a client never releases
            # results. Active jobs are never evicted.
            for identity in list(self._records):
                if len(self._records) < 16:
                    break
                if self._records[identity]["status"] in TERMINAL and not self._records[identity].get("unsafeOwned"):
                    self._cleanup(identity)
                    del self._records[identity]
                    del self._cancel[identity]
            identity = new_id()
            self._directory(identity).mkdir()
            record = {"id": identity, "kind": payload["kind"], "status": "queued", "stage": "queued", "progress": 0.,
                      "mediaId": payload.get("mediaId"), "payload": copy.deepcopy(payload), "metadata": copy.deepcopy(metadata)}
            self._records[identity] = record
            self._cancel[identity] = threading.Event()
            self._pending.append(identity)
            self._condition.notify()
            return identity

    def get(self, identity):
        with self._condition:
            row = self._records[identity]
            return copy.deepcopy({key: value for key, value in row.items() if key not in {"payload", "metadata"}})

    def cancel(self, identity):
        with self._condition:
            row = self._records[identity]
            if row["status"] not in TERMINAL:
                self._cancel[identity].set()
                row["cancelRequested"] = True
                if row["status"] == "queued":
                    row.update(status="cancelled", stage="cancelled")
                    self._cleanup(identity)
            return self.get(identity)

    def discard(self, identity):
        with self._condition:
            row = self._records[identity]
            if row["status"] not in TERMINAL:
                raise PermissionError("먼저 음성 도구 작업을 중지하세요.")
            if row.get("unsafeOwned"):
                raise PermissionError("소유한 작업자의 종료를 확인하지 못했습니다. 프로세스가 종료될 때까지 임시 음원과 원본을 보호합니다.")
            self._cleanup(identity)
            del self._records[identity]
            del self._cancel[identity]

    def audio(self, identity, name):
        with self._condition:
            row = self._records[identity]
            if row["status"] != "completed" or name not in AUDIO_FILES:
                raise KeyError(identity)
            path = self._directory(identity) / name
            if path.is_symlink() or not path.is_file() or self.storage.contained(path).parent != self._directory(identity):
                raise KeyError(identity)
            return path

    def _execute(self, identity):
        row, event = self._records[identity], self._cancel[identity]
        payload = row["payload"]
        directory = self._directory(identity)

        def progress(stage, fraction):
            import math
            with self._condition:
                if not event.is_set() and row["status"] == "running" and math.isfinite(float(fraction)):
                    row.update(stage=str(stage)[:512], progress=min(.99, max(0., float(fraction))))

        try:
            path = directory  # Preparation has no media input.
            if payload.get("mediaId"):
                metadata, path = self.storage.get_media(payload["mediaId"])
                verify_snapshot_source({"mediaIdentity": payload["sourceIdentity"]}, metadata, path, event.is_set)
            options = {"kind": payload["kind"], "output_dir": str(directory), "audio_track": payload["audioTrack"],
                "whisper_model": payload["whisperModel"], "language": payload["language"], "vocabulary": payload["vocabulary"],
                "references": payload["references"], "targets": payload["targets"], "start": payload.get("start"), "end": payload.get("end")}
            if self.runner:
                result = self.runner(path, **options, progress=progress, cancelled=event.is_set)
            else:
                result = AnalysisProcess().run(path, options={"_speech_tool": True, **options}, track_speakers=None,
                    progress=progress, recognition_preview=lambda *_: None, cancelled=event.is_set, force_cancelled=event.is_set)
            if event.is_set():
                raise AnalysisCancelled()
            if not isinstance(result, dict):
                raise ValueError("음성 도구 결과 형식이 올바르지 않습니다.")
            result.update(mediaId=payload.get("mediaId"), audioTrack=payload["audioTrack"], sourceIdentity=payload.get("sourceIdentity"))
            if result.get("originalFile"):
                if result["originalFile"] != "original.wav":
                    raise ValueError("Invalid original preview.")
                result["originalUrl"] = f"/api/speech-tools/jobs/{identity}/audio/original.wav"
            for stream in result.get("streams", []):
                name = stream.get("audioFile")
                if name not in {"stream-1.wav", "stream-2.wav"}:
                    raise ValueError("Invalid separated preview.")
                stream["audioUrl"] = f"/api/speech-tools/jobs/{identity}/audio/{name}"
            with self._condition:
                if event.is_set():
                    raise AnalysisCancelled()
                row.update(status="completed", stage="completed", progress=1., result=result)
        except Exception as exc:
            with self._condition:
                if isinstance(exc, AnalysisWorkerCleanupError):
                    self._stopping = True
                    row["unsafeOwned"] = True
                cancelled = event.is_set() or isinstance(exc, AnalysisCancelled)
                row.update(status="cancelled" if cancelled else "failed", stage="cancelled" if cancelled else "failed")
                if not cancelled:
                    row["error"] = (str(exc) or type(exc).__name__)[:2000]
                # A containment failure may still own native output handles.
                if not isinstance(exc, AnalysisWorkerCleanupError):
                    self._cleanup(identity)

    def _work(self):
        while True:
            with self._condition:
                self._condition.wait_for(lambda: self._stopping or bool(self._pending))
                if self._stopping:
                    for identity in self._pending:
                        if identity in self._records:
                            self._records[identity].update(status="cancelled", stage="cancelled")
                    self._pending.clear()
                    return
                identity = self._pending.popleft()
                if identity not in self._records or self._records[identity]["status"] == "cancelled":
                    continue
                self._records[identity].update(status="running", stage="starting")
            self._execute(identity)
