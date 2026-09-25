"""Fail closed if bundled application bytecode differs from the current source.

PyInstaller's cache can retain an earlier code object when a source file changes
during analysis. Timestamps and a successful build are not sufficient evidence.
Only loading a real archive requires PyInstaller; the comparison helpers and
their tests use the standard library alone.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import marshal
from pathlib import Path
import types
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "voicesubsep"
ENTRY = "voicesubsep.desktop_server"
EXCLUDED = frozenset({"voicesubsep.qwen_asr", "voicesubsep.qwen_model_cache"})


def normalize_code(code: types.CodeType) -> types.CodeType:
    """Ignore build-machine filenames only; retain bytecode, lines and constants."""
    if not isinstance(code, types.CodeType):
        raise ValueError("The archive entry is not a Python code object.")
    return code.replace(co_filename="<source-check>", co_consts=tuple(
        normalize_code(value) if isinstance(value, types.CodeType) else value
        for value in code.co_consts))


def matches_source(source: bytes, archived: types.CodeType) -> bool:
    fresh = compile(source, "<source-check>", "exec", dont_inherit=True, optimize=0)
    return normalize_code(archived) == normalize_code(fresh)


def application_sources(directory: Path) -> dict[str, Path]:
    if not (directory / "__init__.py").is_file():
        raise ValueError("The application source package is missing.")
    found = {}
    for path in sorted(directory.rglob("*.py")):
        relative = path.relative_to(directory).with_suffix("").parts
        if "__pycache__" in relative:
            continue
        if relative[-1] == "__init__":
            relative = relative[:-1]
        found[".".join((PACKAGE, *relative))] = path
    return found


def compare_modules(sources: dict[str, Path], names: set[str],
                    extract: Callable[[str], types.CodeType]) -> list[dict]:
    """Every source module must exist except explicit development-only Qwen.

    Also reject stale/deleted application modules and accidentally bundled Qwen
    code, rather than silently limiting the check to a small expected allowlist.
    """
    records = []
    application_names = {name for name in names if name == PACKAGE or name.startswith(PACKAGE + ".")}
    for name in sorted((set(sources) - EXCLUDED) | application_names):
        item = {"module": name, "matched": False}
        if name in EXCLUDED:
            item["error"] = "development-only module was bundled"
        elif name not in sources:
            item["error"] = "bundled module has no current source"
        elif name not in application_names:
            item["error"] = "current source module is missing from the bundle"
        else:
            try:
                raw = sources[name].read_bytes()
                item["sourceSha256"] = hashlib.sha256(raw).hexdigest()
                item["matched"] = matches_source(raw, extract(name))
                if not item["matched"]:
                    item["error"] = "bundled bytecode differs from current source"
            except (OSError, ValueError, SyntaxError, TypeError, KeyError, EOFError):
                item["error"] = "source or bundled code could not be compared"
        records.append(item)
    return records


def inspect_bundle(executable: Path, source_dir: Path) -> dict:
    # Deliberately lazy: minimal CI can run all comparison unit tests without
    # PyInstaller, Torch, model weights, Windows or a frozen executable.
    from PyInstaller.archive.readers import CArchiveReader

    archive = CArchiveReader(executable)
    pyz = archive.open_embedded_archive("PYZ.pyz")
    names = set(pyz.toc)
    if "desktop_server" in archive.toc:
        names.add(ENTRY)

    def extract(name):
        if name == ENTRY:
            # The entry script is outside PYZ. Verify its exact code as well.
            return marshal.loads(archive.extract("desktop_server"))
        return pyz.extract(name)

    records = compare_modules(application_sources(source_dir), names, extract)
    with executable.open("rb") as binary:
        digest = hashlib.sha256()
        for block in iter(lambda: binary.read(1024 * 1024), b""):
            digest.update(block)
        executable_hash = digest.hexdigest()
    return {"passed": bool(records) and all(item["matched"] for item in records),
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "executableSha256": executable_hash,
            "method": "all application PYZ modules plus entry script versus fresh optimize=0 compile; only co_filename normalized recursively",
            "checkedModules": len(records), "developmentExclusions": sorted(EXCLUDED), "modules": records}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, default=ROOT / "build/backend/voicesubsep-server/voicesubsep-server.exe")
    parser.add_argument("--source-dir", type=Path, default=ROOT / "backend/voicesubsep")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/frozen-source-check.json")
    args = parser.parse_args(argv)
    try:
        result = inspect_bundle(args.executable.resolve(strict=True), args.source_dir.resolve(strict=True))
    except Exception as exc:
        result = {"passed": False, "error": f"Could not inspect frozen application source ({type(exc).__name__})."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "checkedModules": result.get("checkedModules", 0),
                      "mismatches": [item["module"] for item in result.get("modules", []) if not item["matched"]],
                      "error": result.get("error"), "report": str(args.output)}, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
