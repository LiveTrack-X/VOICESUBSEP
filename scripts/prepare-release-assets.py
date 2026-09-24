"""Prepare offline Windows installer assets below GitHub's per-file size limit.

This only copies/splits local files. It never downloads, publishes, or installs.
Run Assemble-Installer.ps1 beside all generated assets to restore the payload.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

GIB = 1024**3
GITHUB_ASSET_LIMIT = 2 * GIB
BUFFER_SIZE = 1024 * 1024
SCRIPT = Path(__file__).with_name("Assemble-Installer.ps1")
_BASENAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}\Z")
_VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?\Z")
_RESERVED = re.compile(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\Z", re.IGNORECASE)


def safe_basename(value: str) -> str:
    if (not isinstance(value, str) or not _BASENAME.fullmatch(value)
            or value.endswith(".") or _RESERVED.fullmatch(value.split(".")[0])):
        raise ValueError("Release filenames must be safe Windows basenames.")
    return value


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(BUFFER_SIZE), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare(installer: Path, payload: Path, version: str, output: Path, *, part_size: int = GIB) -> dict:
    if not _VERSION.fullmatch(version):
        raise ValueError("Use a version such as 0.2.0.")
    if isinstance(part_size, bool) or not isinstance(part_size, int) or not 1 <= part_size < GITHUB_ASSET_LIMIT:
        raise ValueError("Part size must be a positive byte count below 2 GiB.")
    installer, payload, output = installer.absolute(), payload.absolute(), output.absolute()
    for source in (installer, payload):
        safe_basename(source.name)
        if source.is_symlink() or not source.is_file() or source.stat().st_size <= 0:
            raise ValueError("Installer and payload must be existing nonempty regular files.")
    if installer.suffix.lower() != ".exe" or not payload.name.lower().endswith(".nsis.7z"):
        raise ValueError("Expected an installer EXE and its original .nsis.7z payload.")
    if installer.stat().st_size >= GITHUB_ASSET_LIMIT:
        raise ValueError("The installer EXE itself must be below GitHub's 2 GiB asset limit.")
    if (payload.stat().st_size + part_size - 1) // part_size > 990:
        raise ValueError("Too many parts for one GitHub release; increase the part size.")
    if output.exists() or output.is_symlink():
        raise FileExistsError("Output directory already exists; choose a new directory to preserve its assets.")
    if not SCRIPT.is_file():
        raise FileNotFoundError("Assemble-Installer.ps1 must be present beside this script.")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".release-assets-", dir=output.parent))
    try:
        shutil.copyfile(installer, staging / installer.name)
        installer_info = {"name": installer.name, "size": (staging / installer.name).stat().st_size,
                          "sha256": digest_file(staging / installer.name)}
        payload_digest = hashlib.sha256()
        parts = []
        total = 0
        with payload.open("rb") as source:
            while block := source.read(min(BUFFER_SIZE, part_size)):
                part_name = safe_basename(f"{payload.name}.part{len(parts) + 1:03d}")
                part_digest = hashlib.sha256()
                size = 0
                with (staging / part_name).open("xb") as target:
                    while block:
                        target.write(block)
                        part_digest.update(block)
                        payload_digest.update(block)
                        size += len(block)
                        if size == part_size:
                            break
                        block = source.read(min(BUFFER_SIZE, part_size - size))
                total += size
                parts.append({"name": part_name, "size": size, "sha256": part_digest.hexdigest()})
        if not parts or total != payload.stat().st_size:
            raise ValueError("Payload changed while preparing the release. Retry after the build finishes.")
        manifest = {"schemaVersion": 1, "version": version, "installer": installer_info,
                    "payload": {"name": payload.name, "size": total, "sha256": payload_digest.hexdigest(),
                                "parts": parts}}
        (staging / "installer-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        shutil.copyfile(SCRIPT, staging / SCRIPT.name)
        checksums = [f"{digest_file(file)}  {file.name}" for file in sorted(staging.iterdir())]
        (staging / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="ascii")
        if output.exists() or output.is_symlink():
            raise FileExistsError("Output directory appeared while preparing assets; it was not overwritten.")
        os.rename(staging, output)
        return manifest
    finally:
        # Only our newly created staging files are eligible for cleanup; no recursive removal.
        if staging.exists():
            for file in staging.iterdir():
                file.unlink()
            staging.rmdir()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installer", required=True, type=Path)
    parser.add_argument("--payload", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--part-size", type=int, default=GIB, help="Bytes per part; default: 1073741824 (1 GiB)")
    args = parser.parse_args()
    try:
        manifest = prepare(args.installer, args.payload, args.version, args.output, part_size=args.part_size)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Release asset preparation failed: {error}\n")
    print(json.dumps({"output": str(args.output.resolve()), "version": manifest["version"],
                      "installer": manifest["installer"], "payload": manifest["payload"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
