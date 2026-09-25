"""Pin the online bootstrap to a locally verified split release; never use the network.

Usage: .venv/Scripts/python.exe scripts/pin-online-release.py release/github-v0.3.0/installer-manifest.json
Add --check to validate and preview without changing installer sources.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parent.parent
BASE_URL = "https://github.com/LiveTrack-X/VOICESUBSEP/releases/"
BLOCK = 1024 * 1024
LIMIT = 2 * 1024**3


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fields(value, expected, label):
    require(isinstance(value, dict) and set(value) == set(expected), "Unexpected " + label + " fields.")


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, "Duplicate manifest field.")
        value[key] = item
    return value


def asset(value, expected_name, *, payload=False):
    fields(value, ("name", "size", "sha256", "parts") if payload else ("name", "size", "sha256"), "asset")
    require(value["name"] == expected_name, "Asset filename does not match the version and expected Windows x64 layout.")
    require(type(value["size"]) is int and 0 < value["size"] < 2**63, "Invalid asset byte count.")
    require(isinstance(value["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", value["sha256"]), "Invalid lowercase SHA-256.")
    if not payload:
        require(value["size"] < LIMIT, "Each downloaded asset must be smaller than 2 GiB.")


def manifest(path):
    require(path.is_file() and not path.is_symlink(), "Manifest must be a regular local file.")
    require(path.stat().st_size <= 1024 * 1024, "Manifest exceeds 1 MiB.")
    value = json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_object)
    fields(value, ("schemaVersion", "version", "installer", "payload"), "manifest")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1, "Only manifest schema 1 is supported.")
    version = value["version"]
    require(isinstance(version, str) and re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version),
            "Use a stable three-component semantic version without leading zeroes.")
    require(all(int(component) <= 65534 for component in version.split(".")), "Version is outside .NET assembly version bounds.")
    asset(value["installer"], f"VOICESUBSEP-{version}-Offline-Setup-x64.exe")
    payload = value["payload"]
    asset(payload, f"voicesubsep-{version}-x64.nsis.7z", payload=True)
    parts = payload["parts"]
    require(isinstance(parts, list) and 1 <= len(parts) <= 990, "Invalid payload part count.")
    for index, part in enumerate(parts, 1):
        asset(part, f"{payload['name']}.part{index:03d}")
    require(sum(part["size"] for part in parts) == payload["size"], "Part byte counts do not equal payload size.")
    require(all(part["size"] == parts[0]["size"] for part in parts[:-1]) and parts[-1]["size"] <= parts[0]["size"],
            "Unexpected split part sizes.")
    return value


def verify_asset(folder, value, combined=None):
    path = folder / value["name"]
    require(path.is_file() and not path.is_symlink() and path.parent.resolve() == folder.resolve(), "Asset must be a regular local sibling file.")
    before = path.stat()
    require(before.st_size == value["size"], "Asset byte count differs from the manifest: " + value["name"])
    digest, size = hashlib.sha256(), 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(BLOCK), b""):
            digest.update(block)
            if combined is not None:
                combined.update(block)
            size += len(block)
    after = path.stat()
    require(size == value["size"] and before.st_mtime_ns == after.st_mtime_ns and before.st_size == after.st_size,
            "Asset changed while reading: " + value["name"])
    require(digest.hexdigest() == value["sha256"], "Asset SHA-256 differs from the manifest: " + value["name"])


def replace_once(text, pattern, replacement):
    updated, count = re.subn(pattern, lambda match: replacement, text, flags=re.MULTILINE)
    require(count == 1, "Installer source does not match the expected pinning structure: " + pattern)
    return updated


def file_call(value):
    return 'File("%s", %dL, "%s")' % (value["name"], value["size"], value["sha256"])


def updates(value):
    version = value["version"]
    paths = [REPO / "installer" / name for name in ("ReleaseConfig.cs", "AssemblyInfo.cs", "app.manifest")]
    require(all(path.is_file() and not path.is_symlink() for path in paths), "Installer sources must be regular local files.")
    originals = {path: path.read_bytes() for path in paths}
    texts = {path: content.decode("utf-8-sig").replace("\r\n", "\n") for path, content in originals.items()}
    config = texts[paths[0]]
    require("namespace VoiceSubSepInstaller" in config and "ApiUrl = BaseUrl + name" in config, "Unexpected release configuration helper.")
    config = replace_once(config, r'        internal const string Version = "[^"\r\n]+";', f'        internal const string Version = "{version}";')
    config = replace_once(config, r'        internal const string ReleaseUrl = "https://github\.com/LiveTrack-X/VOICESUBSEP/releases/tag/v[^"\r\n]+";', f'        internal const string ReleaseUrl = "{BASE_URL}tag/v{version}";')
    config = replace_once(config, r'        private const string BaseUrl = "https://github\.com/LiveTrack-X/VOICESUBSEP/releases/download/v[^"\r\n]+/";', f'        private const string BaseUrl = "{BASE_URL}download/v{version}/";')
    for label, item in (("Installer", value["installer"]), ("Payload", value["payload"])):
        config = replace_once(config, rf'        internal static readonly Asset {label} = File\("[A-Za-z0-9._-]+", [0-9]+L, "[a-f0-9]{{64}}"\);',
                              f'        internal static readonly Asset {label} = {file_call(item)};')
    part_lines = ",\n".join("            " + file_call(part) for part in value["payload"]["parts"])
    config = replace_once(config, r'        internal static readonly IList<Asset> Parts = new List<Asset> \{\n(?:            File\("[A-Za-z0-9._-]+", [0-9]+L, "[a-f0-9]{64}"\),?\n)+        \};',
                          "        internal static readonly IList<Asset> Parts = new List<Asset> {\n" + part_lines + "\n        };")
    config = re.sub(r'// Pinned to the original v[0-9]+\.[0-9]+\.[0-9]+ assets;', f'// Pinned to the original v{version} assets;', config)
    assembly = texts[paths[1]]
    for field in ("AssemblyVersion", "AssemblyFileVersion"):
        assembly = replace_once(assembly, rf'\[assembly: {field}\("[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"\)\]', f'[assembly: {field}("{version}.0")]')
    app = texts[paths[2]]
    tree = ET.fromstring(app)
    identities = tree.findall("{urn:schemas-microsoft-com:asm.v1}assemblyIdentity")
    require(len(identities) == 1 and identities[0].get("name") == "VOICESUBSEP.OnlineInstaller", "Unexpected application manifest identity.")
    app = replace_once(app, r'  <assemblyIdentity version="[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" name="VOICESUBSEP\.OnlineInstaller"/>',
                       f'  <assemblyIdentity version="{version}.0" name="VOICESUBSEP.OnlineInstaller"/>')
    changed = {}
    for path, text in zip(paths, (config, assembly, app)):
        newline = "\r\n" if b"\r\n" in originals[path] else "\n"
        bom = b"\xef\xbb\xbf" if originals[path].startswith(b"\xef\xbb\xbf") else b""
        changed[path] = bom + text.replace("\n", newline).encode("utf-8")
    return originals, changed


def write_updates(originals, changed):
    staged, replaced = {}, []
    try:
        for path, content in changed.items():
            handle, name = tempfile.mkstemp(prefix=".pin-release-", dir=path.parent)
            staged[path] = Path(name)
            with os.fdopen(handle, "wb") as output:
                output.write(content)
        require(all(path.read_bytes() == content for path, content in originals.items()), "Installer sources changed during validation; retry after other writes finish.")
        for path, stage in staged.items():
            os.replace(stage, path)
            replaced.append(path)
    except BaseException:
        for path in reversed(replaced):
            path.write_bytes(originals[path])
        raise
    finally:
        for stage in staged.values():
            stage.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--check", action="store_true", help="Verify all local assets and preview without writing source files.")
    args = parser.parse_args()
    try:
        value = manifest(args.manifest)
        originals, changed = updates(value)
        verify_asset(args.manifest.parent, value["installer"])
        combined = hashlib.sha256()
        for part in value["payload"]["parts"]:
            verify_asset(args.manifest.parent, part, combined)
        require(combined.hexdigest() == value["payload"]["sha256"], "Reassembled payload SHA-256 differs from the manifest.")
        if not args.check:
            write_updates(originals, changed)
        print(json.dumps({"mode": "verified-only" if args.check else "pinned", "version": value["version"],
                          "installer": value["installer"], "payload": value["payload"],
                          "releaseUrl": BASE_URL + "tag/v" + value["version"],
                          "files": [str(path.relative_to(REPO)) for path in changed]}, indent=2))
    except (OSError, ValueError, ET.ParseError) as error:
        parser.exit(1, "Release pinning failed: " + str(error) + "\n")


if __name__ == "__main__":
    main()
