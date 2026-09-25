import os
from pathlib import Path
import subprocess
import sys
import threading
from types import SimpleNamespace

from voicesubsep import vst_worker as worker, vst_window


def test_worker_entry_import_does_not_initialize_web_server():
    result = subprocess.run([sys.executable, '-c',
        "import sys; import voicesubsep.desktop_server; assert 'fastapi' not in sys.modules; assert 'uvicorn' not in sys.modules"],
        capture_output=True, text=True, timeout=10,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    assert result.returncode == 0, result.stderr


def test_editor_empty_settings_skip_metadata_until_close(monkeypatch):
    monkeypatch.setattr(worker, '_parameter_metadata', lambda _: (_ for _ in ()).throw(AssertionError('premature scan')))
    plugin = SimpleNamespace(raw_state=b'original')
    assert worker._apply_effect(plugin, {'parameters':{}}, capture_values=False) == {}
    assert plugin.raw_state == b'original'


def test_named_editor_skips_rescan_reports_visible_and_handles_explicit_focus(tmp_path, monkeypatch):
    path=tmp_path/'Mock.vst3'
    path.touch()
    close, focus = tmp_path/'close-editor', tmp_path/'focus-editor'
    visible, ready, focused = threading.Event(), threading.Event(), threading.Event()
    calls, stages = [], []
    def place(name):
        if not visible.is_set(): return False
        calls.append(name)
        if len(calls)>1: focused.set()
        return True
    def progress(stage, fraction):
        stages.append(stage)
        if stage=='open': ready.set()
    def show_editor(*,close_event):
        assert not ready.is_set(), 'Open must mean an actually visible editor'
        visible.set()
        assert ready.wait(2)
        focus.touch()
        assert focused.wait(2)
        close.touch()
        assert close_event.wait(1)
    plugin=SimpleNamespace(name='Mock',parameters={},raw_state=b'captured',show_editor=show_editor)
    monkeypatch.setattr(worker,'_load_effect',lambda path,name: plugin)
    monkeypatch.setattr(worker,'_pedalboard',lambda: (_ for _ in ()).throw(AssertionError('named plugin re-scanned')))
    monkeypatch.setattr(vst_window,'position_editor',place)
    result=worker.edit({'path':str(path),'pluginName':'Mock','parameters':{}},close,focus,progress)
    assert result['state'] and stages[:3]==['loading','opening','open']
    assert calls==['Mock','Mock'], 'Polling must not repeatedly raise a window'
