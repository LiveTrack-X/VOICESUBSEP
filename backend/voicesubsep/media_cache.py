"""Content-addressed reuse and explicit cleanup of application-owned media."""
from __future__ import annotations

import hashlib
from pathlib import Path
import shutil

from .storage import Storage, valid_id


def signature(path: Path) -> list[int]:
    stat = path.stat()
    return [stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]


class MediaCache:
    def __init__(self, storage: Storage, protected):
        self.storage, self.protected = storage, protected

    def entries(self):
        for folder in self.storage.media.iterdir():
            if not valid_id(folder.name) or folder.is_symlink() or getattr(folder, "is_junction", lambda: False)():
                continue
            try:
                metadata, source = self.storage.get_media(folder.name)
                if metadata.get("id") != folder.name or source.is_symlink() or source.parent != folder.resolve():
                    continue
                yield metadata, source
            except (OSError, ValueError, TypeError):
                continue

    def commit(self, folder: Path, metadata: dict) -> dict:
        """The caller streamed SHA-256 while uploading; never dedupe by filename."""
        source = folder / metadata["storedName"]
        with self.storage.media_lock:
            for saved, existing in self.entries():
                if (saved.get("sha256") not in {None, metadata["sha256"]}
                        or existing.stat().st_size != metadata["bytes"]):
                    continue
                # A changed file cannot inherit the old content identity. Older
                # entries without a signature are verified before reuse.
                if not saved.get("sha256") or saved.get("fileSignature") != signature(existing):
                    before = signature(existing)
                    digest = hashlib.sha256()
                    with existing.open("rb") as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                            digest.update(chunk)
                    if digest.hexdigest() != metadata["sha256"] or before != signature(existing):
                        continue
                    saved["sha256"] = metadata["sha256"]
                    saved["bytes"] = metadata["bytes"]
                    saved["fileSignature"] = signature(existing)
                    self.storage.write_json(existing.parent / "metadata.json", saved)
                shutil.rmtree(self.storage.contained(folder))
                return self.public(saved)
            metadata["fileSignature"] = signature(source)
            self.storage.write_json(folder / "metadata.json", metadata)
            return self.public(metadata)

    @staticmethod
    def public(metadata):
        return {key: value for key, value in metadata.items() if key not in {"storedName", "fileSignature"}}

    def summary(self):
        with self.storage.media_lock:
            protected = self.protected()
            items = [{"id": info["id"], "name": info["name"], "bytes": path.stat().st_size,
                      "duration": info["duration"], "protected": info["id"] in protected}
                     for info, path in self.entries()]
            return {"items": items, "bytes": sum(item["bytes"] for item in items),
                    "reclaimableBytes": sum(item["bytes"] for item in items if not item["protected"]),
                    "freeBytes": shutil.disk_usage(self.storage.root).free}

    def remove(self, media_id: str):
        with self.storage.media_lock:
            if media_id in self.protected():
                raise PermissionError("This source is retained by a job or preview. Remove finished job history first.")
            folder = self.storage.media / media_id
            if not valid_id(media_id) or folder.is_symlink() or getattr(folder, "is_junction", lambda: False)():
                raise ValueError("Invalid cache entry.")
            self.storage.get_media(media_id)
            target = self.storage.contained(folder)
            if target.parent != self.storage.media.resolve():
                raise ValueError("Invalid cache directory.")
            shutil.rmtree(target)
