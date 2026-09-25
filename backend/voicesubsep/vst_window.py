"""Keep this worker's native editor title bar reachable without scaling its canvas."""
from __future__ import annotations

import os


def editor_origin(rect: tuple[int, int, int, int], work: tuple[int, int, int, int]) -> tuple[int, int]:
    """A too-large fixed GUI keeps its top-right close button inside the work area."""
    left, top, right, bottom = rect
    x0, y0, x1, y1 = work
    width, height = right - left, bottom - top
    if width <= 0 or height <= 0 or x1 <= x0 or y1 <= y0:
        return left, top
    x = min(max(left, x0), x1 - width)
    y = y0 if height > y1 - y0 else min(max(top, y0), y1 - height)
    return x, y


def position_editor(plugin_name: str) -> bool:
    """Only the current native worker's Pedalboard top-level window is eligible.

    Pedalboard provides a native title bar, but initially anchors its content at
    (0, 0), which can put the title bar above the work area on Windows. Never
    control other processes, change window size, or synthesize input. Called only
    on initial open or an explicit focus request, never on an ordinary poll.
    """
    if os.name != "nt":
        return True
    import ctypes
    from ctypes import wintypes

    class MonitorInfo(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                    ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.SendMessageTimeoutW.argtypes = [wintypes.HWND, wintypes.UINT, ctypes.c_size_t,
                                         ctypes.c_void_p, wintypes.UINT, wintypes.UINT,
                                         ctypes.POINTER(ctypes.c_size_t)]
    user32.SendMessageTimeoutW.restype = ctypes.c_size_t
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    user32.MonitorFromWindow.restype = wintypes.HANDLE
    user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MonitorInfo)]
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    found = False

    @callback_type
    def visit(hwnd, _):
        nonlocal found
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value != os.getpid() or not user32.IsWindowVisible(hwnd):
            return True
        title = ctypes.create_unicode_buffer(512)
        result = ctypes.c_size_t()
        # Synchronous same-process text messages can block against a plugin's UI
        # thread. Bound every message and never run this on the close watcher.
        if not user32.SendMessageTimeoutW(hwnd, 0x000D, len(title), ctypes.cast(title, ctypes.c_void_p),
                                         0x0001 | 0x0002, 100, ctypes.byref(result)):
            return True
        label_text = f"VOICESUBSEP · {plugin_name[:120]}"
        if title.value not in ("Pedalboard", label_text):
            return True
        if user32.IsIconic(hwnd):
            user32.ShowWindowAsync(hwnd, 9)  # SW_RESTORE: explicit user request.
        rect = wintypes.RECT()
        monitor = MonitorInfo(cbSize=ctypes.sizeof(MonitorInfo))
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)) or not user32.GetMonitorInfoW(user32.MonitorFromWindow(hwnd, 2), ctypes.byref(monitor)):
            return True
        work = monitor.rcWork
        x, y = editor_origin((rect.left, rect.top, rect.right, rect.bottom), (work.left, work.top, work.right, work.bottom))
        # Raise only this worker's editor. HWND_TOP is temporary; never TOPMOST.
        if not user32.SetWindowPos(hwnd, None, x, y, 0, 0, 0x0001 | 0x4000):
            return True
        user32.SetForegroundWindow(hwnd)
        label = ctypes.create_unicode_buffer(label_text)
        user32.SendMessageTimeoutW(hwnd, 0x000C, 0, ctypes.cast(label, ctypes.c_void_p),
                                  0x0001 | 0x0002, 100, ctypes.byref(result))
        found = True
        return False

    user32.EnumWindows(visit, 0)
    return found
