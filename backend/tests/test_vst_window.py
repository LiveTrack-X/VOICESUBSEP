from voicesubsep.vst_window import editor_origin
import ctypes
import os
from types import SimpleNamespace
import pytest
from voicesubsep import vst_window


def test_restores_title_bar_above_primary_work_area():
    assert editor_origin((-8, -31, 1048, 686), (0, 0, 1920, 1040)) == (0, 0)


def test_preserves_position_inside_secondary_monitor():
    assert editor_origin((-1700, 80, -800, 780), (-1920, 0, 0, 1040)) == (-1700, 80)


def test_keeps_close_corner_reachable_for_fixed_oversized_gui():
    assert editor_origin((0, 0, 2000, 1400), (0, 0, 1280, 720)) == (-720, 0)


def test_does_not_resize_and_clamps_right_bottom_edge():
    assert editor_origin((1700, 900, 1900, 1100), (0, 40, 1800, 1000)) == (1600, 800)


@pytest.mark.skipif(os.name != 'nt', reason='Windows ctypes callback ABI')
@pytest.mark.parametrize('renamed,minimized', [(False,False),(True,True)])
def test_raise_only_owned_editor_and_restore_without_topmost(monkeypatch,renamed,minimized):
    class Fn:
        def __init__(self, impl): self.impl=impl
        def __call__(self,*args): return self.impl(*args)
    raised, restored, moved=[],[],[]
    def enum(callback,_):
        for hwnd in (101,102,103):
            if not callback(hwnd,0): break
        return True
    def pid(hwnd,output):
        output._obj.value = os.getpid() if hwnd!=101 else os.getpid()+1
    def message(hwnd,kind,length,buffer,flags,timeout,result):
        if kind==0x000D:
            title = 'unrelated plugin dialog' if hwnd==102 else ('VOICESUBSEP · Clear' if renamed else 'Pedalboard')
            text=ctypes.create_unicode_buffer(title)
            ctypes.memmove(buffer,text,ctypes.sizeof(text))
        result._obj.value=1
        return 1
    def rect(hwnd,output):
        output._obj.left,output._obj.top,output._obj.right,output._obj.bottom=-8,-31,1048,686
        return True
    def monitor(handle,output):
        output._obj.rcWork.left,output._obj.rcWork.top=0,0
        output._obj.rcWork.right,output._obj.rcWork.bottom=1920,1040
        return True
    api=SimpleNamespace(**{name:Fn(impl) for name,impl in {
        'EnumWindows':enum, 'GetWindowThreadProcessId':pid,'SendMessageTimeoutW':message,
        'IsWindowVisible':lambda _:True,'GetWindowRect':rect,'MonitorFromWindow':lambda *_:1,
        'GetMonitorInfoW':monitor,'IsIconic':lambda _:minimized,
        'SetWindowPos':lambda *args:moved.append(args) or True,
        'ShowWindowAsync':lambda *args:restored.append(args) or True,
        'SetForegroundWindow':lambda hwnd:raised.append(hwnd) or True,
    }.items()})
    monkeypatch.setattr(ctypes,'WinDLL',lambda *args,**kwargs:api)
    assert vst_window.position_editor('Clear')
    assert raised==[103] and len(moved)==1
    assert moved[0]==(103,None,0,0,0,0,0x0001|0x4000)
    assert restored==([(103,9)] if minimized else [])
