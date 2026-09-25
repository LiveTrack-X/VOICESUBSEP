"""One persistent local live session, durable PCM and bounded ingestion."""
from __future__ import annotations

import copy
import hashlib
import io
import os
import json
import shutil
import secrets
import threading
import wave
from datetime import datetime, timezone
from pathlib import Path

from .inference import AnalysisCancelled
from .live_native import NativeLiveEngine, RATE
from .storage import Storage, new_id, valid_id

ACTIVE = {"loading", "running", "stopping"}
MAX_SAMPLES = RATE * 7200
MAX_PACKET_BYTES = RATE * 2 * 2


def now():
    return datetime.now(timezone.utc).isoformat()


class LiveManager:
    def __init__(self, storage: Storage, engine_factory=None):
        self.storage = storage
        self.root = storage.contained(storage.root / "live")
        self.factory = engine_factory or NativeLiveEngine
        self.lock = threading.RLock()
        self.changed = threading.Condition(self.lock)
        self.records = {}
        self.tokens = {}
        self.cancelled = {}
        self.retries = {}
        self.thread = None
        self.closing = False

    def folder(self, identity):
        if not valid_id(identity):
            raise KeyError(identity)
        return self.storage.contained(self.root / identity)

    def start(self):
        self.root.mkdir(parents=True, exist_ok=True)
        # Only our bounded metadata and original PCM are read, never user files.
        for folder in self.root.iterdir():
            if not folder.is_dir() or not valid_id(folder.name):
                continue
            try:
                record = self.storage.read_json(folder / "session.json")
                if record.get("id") != folder.name:
                    continue
                samples = self.storage.contained(folder / "source.pcm").stat().st_size // 2
                if samples > MAX_SAMPLES:
                    continue
                record["receivedSeconds"] = samples / RATE
                if record["status"] in ACTIVE:
                    record.update(status="interrupted", stage="서버 재시작으로 중단됨. 원본 녹음을 복구할 수 있습니다.")
                self.records[folder.name] = record
                self.tokens[folder.name] = secrets.token_urlsafe(32)
                self._save(record)
            except (OSError, ValueError, KeyError, TypeError):
                continue

    def _save(self, record):
        self.storage.write_json(self.folder(record["id"]) / "session.json", record)

    def busy(self):
        with self.lock:
            return self.thread is not None and self.thread.is_alive()

    def create(self, request):
        with self.lock:
            if self.closing or self.busy():
                raise PermissionError("현재 라이브 세션을 먼저 종료하세요.")
            if len(self.records) >= 100:
                raise OverflowError("저장된 라이브 녹음이 100개입니다. 복구할 원본을 내려받은 뒤 이전 기록을 정리하세요.")
            identity = new_id()
            folder = self.folder(identity)
            folder.mkdir()
            (folder / "source.pcm").touch()
            record = {"id": identity, "status": "loading", "stage": "로컬 모델 준비", "sequence": -1,
                      "receivedSeconds": 0., "processedSeconds": 0., "captions": [], "speakers": [],
                      "request": request, "createdAt": now(), "updatedAt": now(),
                      "overlay": {"muted": False}, "overlayAfter": 0., "error": None}
            self.records[identity] = record
            self.tokens[identity] = secrets.token_urlsafe(32)
            self.cancelled[identity] = threading.Event()
            self.retries[identity] = {}
            self._save(record)
            self.thread = threading.Thread(target=self._run, args=(identity,), name="live-recognition", daemon=True)
            self.thread.start()
            return self.get(identity)

    def get(self, identity):
        with self.lock:
            record = copy.deepcopy(self.records[identity])
            record.pop("request", None)
            record.pop("overlayAfter", None)
            record["lagSeconds"] = max(0., record["receivedSeconds"] - record["processedSeconds"])
            record["overloaded"] = record["lagSeconds"] > 20
            record["sourceUrl"] = f"/api/live/sessions/{identity}/source.wav"
            record["overlayUrl"] = f"/live-overlay/{identity}/{self.tokens[identity]}"
            return record

    def history(self):
        with self.lock:
            return [self.get(key) for key in sorted(self.records, key=lambda k: self.records[k]["createdAt"], reverse=True)]

    def remove(self, identity):
        with self.lock:
            record = self.records[identity]
            if record["status"] in ACTIVE:
                raise PermissionError("라이브 세션이 종료된 뒤 기록을 정리하세요.")
            candidate = self.root / identity
            if candidate.is_symlink() or (hasattr(candidate, "is_junction") and candidate.is_junction()):
                raise ValueError("Invalid live recording folder.")
            folder = self.folder(identity)
            if folder.parent != self.root.resolve() or folder.is_symlink():
                raise ValueError("Invalid live recording folder.")
            shutil.rmtree(folder)
            del self.records[identity]
            self.tokens.pop(identity, None)
            self.retries.pop(identity, None)
            self.cancelled.pop(identity, None)

    def audio(self, identity, sequence, payload):
        if not payload or len(payload) % 2 or len(payload) > MAX_PACKET_BYTES:
            raise ValueError("PCM16 mono 16 kHz 오디오를 2초 이하의 짝수 바이트 패킷으로 보내세요.")
        digest = hashlib.sha256(payload).hexdigest()
        with self.changed:
            record = self.records[identity]
            if record["status"] not in {"loading", "running"}:
                raise PermissionError("종료되거나 중단된 세션에는 오디오를 추가할 수 없습니다.")
            retries = self.retries[identity]
            if sequence <= record["sequence"]:
                if retries.get(sequence) == digest:
                    return self.get(identity)
                raise ValueError("오디오 패킷 순서 또는 재전송 내용이 일치하지 않습니다.")
            if sequence != record["sequence"] + 1:
                raise ValueError("오디오 패킷이 누락됐습니다. 원본 녹음을 보존하고 세션을 중단하세요.")
            source = self.folder(identity) / "source.pcm"
            before = source.stat().st_size
            if before + len(payload) > MAX_SAMPLES * 2:
                raise OverflowError("라이브 세션은 최대 2시간입니다. 종료 후 새 세션을 시작하세요.")
            try:
                with source.open("ab") as output:
                    output.write(payload)
                    output.flush()
                    os.fsync(output.fileno())
                record.update(sequence=sequence, receivedSeconds=(before + len(payload)) / 2 / RATE, updatedAt=now())
                self._save(record)
            except OSError:
                # Source bytes already written remain recoverable; never continue
                # after an ambiguous disk write and risk a shifted source clock.
                record.update(status="stopping", error="원본 음성 저장 실패. 디스크 공간을 확인하세요.")
                self.cancelled[identity].set()
                self.changed.notify_all()
                raise
            retries[sequence] = digest
            for old in list(retries):
                if old < sequence - 8:
                    del retries[old]
            self.changed.notify_all()
            return self.get(identity)

    def finish(self, identity, abort=False):
        with self.changed:
            record = self.records[identity]
            if record["status"] in ACTIVE:
                record.update(status="stopping", stage="중단 중" if abort else "남은 음성 인식 중", updatedAt=now())
                if abort:
                    self.cancelled[identity].set()
                self._save(record)
                self.changed.notify_all()
            return self.get(identity)

    def overlay_control(self, identity, *, muted=None, clear=False):
        with self.lock:
            record = self.records[identity]
            if muted is not None:
                record["overlay"]["muted"] = muted
            if clear:
                # Clear also excludes audio already captured but still queued.
                record["overlayAfter"] = record["receivedSeconds"]
            self._save(record)
            return self.get(identity)

    def overlay_state(self, identity, token):
        with self.lock:
            if not secrets.compare_digest(self.tokens.get(identity, ""), token):
                raise KeyError(identity)
            r = self.records[identity]
            stale = (datetime.now(timezone.utc) - datetime.fromisoformat(r["updatedAt"])).total_seconds() > 10
            captions = [] if stale or r["overlay"]["muted"] or r["status"] not in ACTIVE else [
                c for c in r["captions"] if c["start"] >= r["overlayAfter"] and c["end"] >= r["processedSeconds"] - 8]
            return {"captions": copy.deepcopy(captions[-2:]), "speakers": copy.deepcopy(r["speakers"]),
                    "status": r["status"], "muted": r["overlay"]["muted"]}

    def source(self, identity):
        with self.lock:
            if identity not in self.records:
                raise KeyError(identity)
            path = self.folder(identity) / "source.pcm"
            length = path.stat().st_size // 2 * 2
        # Snapshot size, bounded generator and no whole-recording allocation.
        header = io.BytesIO()
        with wave.open(header, "wb") as wav:
            wav.setparams((1, 2, RATE, length // 2, "NONE", "not compressed"))
            wav.writeframesraw(b"")
        import struct
        data = bytearray(header.getvalue())
        struct.pack_into("<I", data, 4, length + 36)
        struct.pack_into("<I", data, 40, length)
        def chunks():
            yield bytes(data)
            with path.open("rb") as pcm:
                remaining = length
                while remaining:
                    chunk = pcm.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise OSError("Recorded source was truncated.")
                    remaining -= len(chunk)
                    yield chunk
        return chunks(), length + 44

    def _run(self, identity):
        engine = None
        status, error = "completed", None
        def stage(text):
            with self.lock:
                self.records[identity]["stage"] = text
        event = self.cancelled[identity]
        try:
            engine = self.factory(self.records[identity]["request"], event.is_set, stage)
            last_samples = -1
            while True:
                with self.changed:
                    record = self.records[identity]
                    if event.is_set():
                        raise AnalysisCancelled()
                    final = record["status"] == "stopping"
                    if not final:
                        record.update(status="running", stage="음성 수신·점진 인식 중")
                    samples = round(record["receivedSeconds"] * RATE)
                    if samples == last_samples and not final:
                        self.changed.wait(.25)
                        continue
                if samples:
                    update = engine.advance(self.folder(identity) / "source.pcm", samples, final)
                    if update is not None:
                        result, processed = update
                        if (len(result["captions"]) > 20000 or
                                len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 7 * 1024**2):
                            raise RuntimeError("편집 가능한 라이브 자막 크기 한도에 도달했습니다. 원본 녹음을 보존하고 나눠 분석하세요.")
                        with self.lock:
                            record.update(captions=result["captions"][-50:], speakers=result["speakers"],
                                          processedSeconds=min(samples / RATE, processed), updatedAt=now())
                            if final:
                                record["result"] = result
                            self._save(record)
                elif final:
                    raise RuntimeError("수신된 음성이 없습니다. 입력 장치를 확인하세요.")
                last_samples = samples
                if final:
                    break
        except AnalysisCancelled:
            status = "cancelled"
        except Exception as exc:
            status, error = "failed", str(exc)[:1500]
        finally:
            try:
                if engine is not None:
                    engine.close()
            except Exception:
                status, error = "failed", "라이브 모델 종료 중 오류가 발생했습니다. 앱을 다시 시작하세요."
            with self.lock:
                record = self.records[identity]
                if event.is_set():
                    status = "failed" if record.get("error") else "cancelled"
                if status != "completed":
                    record.pop("result", None)
                record.update(status=status, stage=status, error=error or record.get("error"), updatedAt=now())
                try:
                    self._save(record)
                except OSError:
                    record.update(status="failed", error="라이브 결과 저장 실패. PCM 원본 복구를 확인하세요.")

    def stop(self):
        with self.changed:
            self.closing = True
            for identity, record in self.records.items():
                if record["status"] in ACTIVE:
                    self.cancelled[identity].set()
            self.changed.notify_all()
        # Native forwards are cancelled at safe model boundaries; do not release
        # the data/GPU ownership lock while a forward can still write results.
        if self.thread is not None:
            self.thread.join()
