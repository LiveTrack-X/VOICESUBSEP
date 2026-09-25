import os
from pathlib import Path
import subprocess
import sys

import pytest

from voicesubsep.vst_process_lock import vst_lock_path, vst_process_lock


@pytest.fixture
def lock_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
    environment["TEMP"] = str(tmp_path / "different-child-temporary")
    return environment


def test_parent_and_child_share_lock_despite_different_temp(lock_environment):
    code = "from voicesubsep.vst_process_lock import vst_process_lock\nwith vst_process_lock():\n print('acquired', flush=True)"
    with vst_process_lock():
        response = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=lock_environment, timeout=5)
        assert response.returncode != 0
        assert "Another VST operation is running" in response.stderr
        assert "acquired" not in response.stdout
    response = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=lock_environment, timeout=5)
    assert response.returncode == 0 and response.stdout.strip() == "acquired"
    assert "different-child-temporary" not in str(vst_lock_path())


def test_killed_owner_releases_lock_without_deleting_shared_lock_file(lock_environment):
    code = "import sys\nfrom voicesubsep.vst_process_lock import vst_process_lock\nwith vst_process_lock():\n print('locked', flush=True)\n sys.stdin.readline()"
    process = subprocess.Popen([sys.executable, "-c", code], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env=lock_environment, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        assert process.stdout.readline().strip() == "locked"
        with pytest.raises(RuntimeError, match="Another VST operation"):
            with vst_process_lock():
                pytest.fail("A second process must not acquire the VST slot.")
        process.kill(); process.wait(timeout=5)
        with vst_process_lock():
            assert vst_lock_path().is_file()
            assert vst_lock_path().stat().st_size <= 2
    finally:
        if process.poll() is None:
            process.kill(); process.wait(timeout=5)
        for pipe in (process.stdin, process.stdout, process.stderr):
            pipe.close()


def test_exception_in_effect_processing_releases_lock(lock_environment):
    with pytest.raises(ValueError, match="fixture"):
        with vst_process_lock():
            raise ValueError("fixture")
    with vst_process_lock():
        assert vst_lock_path().exists()
