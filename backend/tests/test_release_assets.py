"""Small offline fixtures for GitHub split assets and the Windows reassembly script."""

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("release_assets", ROOT / "scripts/prepare-release-assets.py")
assets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(assets)


@pytest.fixture
def prepared(tmp_path):
    installer = tmp_path / "VOICESUBSEP-0.2.0-Offline-Setup-x64.exe"
    installer.write_bytes(b"fixture-not-an-executable")
    payload = tmp_path / "voicesubsep-0.2.0-x64.nsis.7z"
    original = bytes(range(251)) * 9
    payload.write_bytes(original)
    output = tmp_path / "release"
    manifest = assets.prepare(installer, payload, "0.2.0", output, part_size=700)
    return output, manifest, original


def assemble(output):
    powershell = shutil.which("powershell.exe")
    if not powershell:
        pytest.skip("Actual assembly is exercised with Windows PowerShell 5.1.")
    return subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                           "-File", str(output / "Assemble-Installer.ps1"), "-Directory", str(output)],
                          capture_output=True, text=True, timeout=30)


def write_manifest(output, manifest):
    (output / "installer-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_preparation_preserves_sources_and_hashes_every_asset(prepared):
    output, manifest, original = prepared
    parts = manifest["payload"]["parts"]
    assert [part["size"] for part in parts] == [700, 700, 700, 159]
    assert b"".join((output / part["name"]).read_bytes() for part in parts) == original
    assert (output.parent / manifest["payload"]["name"]).read_bytes() == original
    assert assets.digest_file(output.parent / manifest["payload"]["name"]) == manifest["payload"]["sha256"]
    for line in (output / "SHA256SUMS.txt").read_text().splitlines():
        digest, name = line.split("  ", 1)
        assert assets.digest_file(output / name) == digest
    assert not (output / manifest["payload"]["name"]).exists()
    assert manifest["version"] == "0.2.0"


def test_preparation_never_overwrites_an_existing_output(prepared):
    output, manifest, _ = prepared
    previous = (output / "installer-manifest.json").read_bytes()
    with pytest.raises(FileExistsError):
        assets.prepare(output.parent / manifest["installer"]["name"], output.parent / manifest["payload"]["name"],
                       "0.2.0", output, part_size=700)
    assert (output / "installer-manifest.json").read_bytes() == previous


@pytest.mark.parametrize("name", ["../escape", "..\\escape", "C:escape", "CON.exe", "lpt1.data", "file.", "evil/name", "a\n.exe"])
def test_asset_names_reject_traversal_and_windows_special_paths(name):
    with pytest.raises(ValueError):
        assets.safe_basename(name)


def test_powershell_assembles_and_reuses_matching_payload(prepared):
    output, manifest, original = prepared
    result = assemble(output)
    assert result.returncode == 0, result.stdout + result.stderr
    destination = output / manifest["payload"]["name"]
    assert destination.read_bytes() == original
    previous_mtime = destination.stat().st_mtime_ns
    result = assemble(output)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Verified existing payload" in result.stdout
    assert destination.stat().st_mtime_ns == previous_mtime
    assert not list(output.glob("*.tmp"))


@pytest.mark.parametrize("damage", ["part_hash", "part_size", "payload_hash", "installer_hash", "missing_part"])
def test_powershell_rejects_damage_without_leaving_payload(prepared, damage):
    output, manifest, _ = prepared
    first = output / manifest["payload"]["parts"][0]["name"]
    if damage == "part_hash":
        first.write_bytes(b"x" * first.stat().st_size)
    elif damage == "part_size":
        first.write_bytes(b"x")
    elif damage == "missing_part":
        first.unlink()
    elif damage == "installer_hash":
        manifest["installer"]["sha256"] = "0" * 64
        write_manifest(output, manifest)
    else:
        manifest["payload"]["sha256"] = "0" * 64
        write_manifest(output, manifest)
    result = assemble(output)
    assert result.returncode != 0
    assert not (output / manifest["payload"]["name"]).exists()
    assert not list(output.glob("*.tmp"))


@pytest.mark.parametrize("record,name", [("payload", "../escape.nsis.7z"), ("installer", "..\\escape.exe"),
                                         ("part", "..\\outside.part001"), ("part", "CON.part001")])
def test_powershell_rejects_manifest_path_traversal(prepared, record, name):
    output, manifest, _ = prepared
    target = manifest["payload"]["parts"][0] if record == "part" else manifest[record]
    target["name"] = name
    write_manifest(output, manifest)
    result = assemble(output)
    assert result.returncode != 0
    assert "unsafe filename" in result.stderr
    assert not list(output.glob("*.tmp"))


def test_powershell_never_overwrites_a_different_completed_payload(prepared):
    output, manifest, _ = prepared
    destination = output / manifest["payload"]["name"]
    destination.write_bytes(b"unrelated existing file")
    result = assemble(output)
    assert result.returncode != 0
    assert destination.read_bytes() == b"unrelated existing file"
    assert not list(output.glob("*.tmp"))


@pytest.mark.parametrize("part_size", [2259, 5000])
def test_single_part_payload_is_accepted_by_powershell(tmp_path, part_size):
    installer = tmp_path / "setup.exe"
    installer.write_bytes(b"not-executable")
    payload = tmp_path / "test.nsis.7z"
    payload.write_bytes(b"x" * 2259)
    output = tmp_path / "release"
    manifest = assets.prepare(installer, payload, "0.2.0", output, part_size=part_size)
    assert len(manifest["payload"]["parts"]) == 1
    result = assemble(output)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (output / payload.name).read_bytes() == payload.read_bytes()


@pytest.mark.parametrize("damage", ["duplicate", "reordered", "total_size"])
def test_powershell_rejects_inconsistent_manifest_before_assembly(prepared, damage):
    output, manifest, _ = prepared
    if damage == "duplicate":
        manifest["payload"]["parts"][1] = manifest["payload"]["parts"][0]
    elif damage == "reordered":
        manifest["payload"]["parts"].reverse()
    else:
        manifest["payload"]["size"] += 1
    write_manifest(output, manifest)
    result = assemble(output)
    assert result.returncode != 0
    assert not (output / manifest["payload"]["name"]).exists()
    assert not list(output.glob("*.tmp"))
