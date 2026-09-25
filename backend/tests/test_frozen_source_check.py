from __future__ import annotations

import importlib.util
from pathlib import Path
import types

import pytest

script = Path(__file__).resolve().parents[2] / "scripts/check-frozen-source.py"
spec = importlib.util.spec_from_file_location("frozen_source_check", script)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def test_filename_normalization_keeps_nested_code_equivalent():
    raw = b"def outer():\n    def inner():\n        return 'live'\n    return inner()\n"
    frozen = compile(raw, "old/build/machine/module.py", "exec", dont_inherit=True)
    assert gate.matches_source(raw, frozen)


@pytest.mark.parametrize("old,current", [
    ("value = 1", "value = 2"),
    ("def run():\n return 'old'", "def run():\n return 'new'"),
    ("def run():\n return 1", "def run():\n raise RuntimeError('new')"),
    ("def run():\n def nested():\n  return True\n return nested", "def run():\n def nested():\n  return False\n return nested"),
])
def test_actual_code_and_nested_constant_changes_fail(old, current):
    assert not gate.matches_source(current.encode(), compile(old, "old.py", "exec", dont_inherit=True))


def test_same_bytes_and_stale_timestamp_cannot_hide_changed_code(tmp_path):
    source = tmp_path / "module.py"
    source.write_bytes(b"choice = 'old'\n")
    archived = compile(source.read_bytes(), "module.py", "exec", dont_inherit=True)
    stat = source.stat()
    source.write_bytes(b"choice = 'new'\n")
    import os
    os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    assert source.stat().st_size == stat.st_size
    assert source.stat().st_mtime_ns == stat.st_mtime_ns
    records = gate.compare_modules({"voicesubsep.module": source}, {"voicesubsep.module"}, lambda _: archived)
    assert records[0]["matched"] is False
    assert records[0]["error"] == "bundled bytecode differs from current source"


def test_missing_and_deleted_modules_fail_while_development_exclusions_are_optional(tmp_path):
    source = tmp_path / "module.py"
    source.write_bytes(b"value = 1")
    mapping = {"voicesubsep.current": source, "voicesubsep.qwen_asr": source, "voicesubsep.qwen_model_cache": source}
    rows = gate.compare_modules(mapping, {"voicesubsep.deleted", "unrelated.package"}, lambda _: pytest.fail("no code to load"))
    assert [(row["module"], row["matched"]) for row in rows] == [
        ("voicesubsep.current", False), ("voicesubsep.deleted", False)]


def test_bundling_excluded_development_runtime_fails(tmp_path):
    path = tmp_path / "module.py"
    path.write_bytes(b"value = 1")
    rows = gate.compare_modules({"voicesubsep.qwen_asr": path}, {"voicesubsep.qwen_asr"}, lambda _: pytest.fail("excluded"))
    assert rows[0]["error"] == "development-only module was bundled"


def test_full_source_inventory_includes_packages_and_entry_script(tmp_path):
    (tmp_path / "__init__.py").write_bytes(b"")
    (tmp_path / "desktop_server.py").write_bytes(b"value = 2")
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "__init__.py").write_bytes(b"")
    (nested / "module.py").write_bytes(b"value = 3")
    sources = gate.application_sources(tmp_path)
    assert set(sources) == {"voicesubsep", "voicesubsep.desktop_server", "voicesubsep.nested", "voicesubsep.nested.module"}
    code = {name: compile(path.read_bytes(), "frozen.py", "exec", dont_inherit=True) for name, path in sources.items()}
    assert all(row["matched"] for row in gate.compare_modules(sources, set(code), code.__getitem__))
    del code["voicesubsep.desktop_server"]
    assert any(not row["matched"] for row in gate.compare_modules(sources, set(code), code.__getitem__))


def test_malformed_archive_code_is_a_failed_module_not_silently_skipped(tmp_path):
    path = tmp_path / "module.py"
    path.write_bytes(b"value = 1")
    rows = gate.compare_modules({"voicesubsep.module": path}, {"voicesubsep.module"}, lambda _: b"not a code object")
    assert rows[0]["matched"] is False
    assert "could not be compared" in rows[0]["error"]


def test_import_and_comparison_need_no_pyinstaller_or_models(monkeypatch):
    import builtins
    original = builtins.__import__
    def blocked(name, *args, **kwargs):
        if name.split(".")[0] in {"PyInstaller", "torch", "transformers", "numpy"}:
            pytest.fail("Optional runtime imported by a unit boundary")
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", blocked)
    isolated = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(isolated)
    assert isolated.matches_source(b"value = 1", compile("value = 1", "frozen.py", "exec", dont_inherit=True))


def test_entry_script_is_checked_outside_pyz(tmp_path, monkeypatch):
    import marshal
    import sys
    package = tmp_path / "voicesubsep"
    package.mkdir()
    (package / "__init__.py").write_bytes(b"")
    (package / "desktop_server.py").write_bytes(b"value = 'current'")
    executable = tmp_path / "server.exe"
    executable.write_bytes(b"synthetic archive boundary; never executed")
    reader = types.ModuleType("PyInstaller.archive.readers")
    class FakePyz:
        toc = {"voicesubsep": ()}
        def extract(self, name):
            return compile(b"", "frozen-package.py", "exec", dont_inherit=True)
    class FakeArchive:
        toc = {"desktop_server": ()}
        def __init__(self, _):
            pass
        def open_embedded_archive(self, name):
            assert name == "PYZ.pyz"
            return FakePyz()
        def extract(self, name):
            assert name == "desktop_server"
            return marshal.dumps(compile("value = 'stale'", "frozen-entry.py", "exec", dont_inherit=True))
    reader.CArchiveReader = FakeArchive
    monkeypatch.setitem(sys.modules, "PyInstaller", types.ModuleType("PyInstaller"))
    monkeypatch.setitem(sys.modules, "PyInstaller.archive", types.ModuleType("PyInstaller.archive"))
    monkeypatch.setitem(sys.modules, "PyInstaller.archive.readers", reader)
    result = gate.inspect_bundle(executable, package)
    assert result["passed"] is False and result["checkedModules"] == 2
    assert [row["module"] for row in result["modules"] if not row["matched"]] == ["voicesubsep.desktop_server"]
