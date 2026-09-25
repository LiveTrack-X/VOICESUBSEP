"""Own exactly one inference process tree, including FFmpeg/VST descendants."""
from __future__ import annotations

import os
import signal
import time


class ProcessTree:
    def __init__(self, process):
        self.process = process
        self.handle = None
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes as w

            class BasicLimit(ctypes.Structure):
                _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                            ("LimitFlags", w.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                            ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", w.DWORD),
                            ("Affinity", ctypes.c_size_t), ("PriorityClass", w.DWORD), ("SchedulingClass", w.DWORD)]

            class IoCounters(ctypes.Structure):
                _fields_ = [(name, ctypes.c_uint64) for name in
                            ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

            class ExtendedLimit(ctypes.Structure):
                _fields_ = [("BasicLimitInformation", BasicLimit), ("IoInfo", IoCounters),
                            ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

            class Accounting(ctypes.Structure):
                _fields_ = [("TotalUserTime", ctypes.c_int64), ("TotalKernelTime", ctypes.c_int64),
                            ("ThisPeriodTotalUserTime", ctypes.c_int64), ("ThisPeriodTotalKernelTime", ctypes.c_int64),
                            ("TotalPageFaultCount", w.DWORD), ("TotalProcesses", w.DWORD),
                            ("ActiveProcesses", w.DWORD), ("TotalTerminatedProcesses", w.DWORD)]

            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.CreateJobObjectW.argtypes, kernel.CreateJobObjectW.restype = [ctypes.c_void_p, w.LPCWSTR], w.HANDLE
            kernel.SetInformationJobObject.argtypes, kernel.SetInformationJobObject.restype = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL
            kernel.AssignProcessToJobObject.argtypes, kernel.AssignProcessToJobObject.restype = [w.HANDLE, w.HANDLE], w.BOOL
            kernel.TerminateJobObject.argtypes, kernel.TerminateJobObject.restype = [w.HANDLE, w.UINT], w.BOOL
            kernel.CloseHandle.argtypes, kernel.CloseHandle.restype = [w.HANDLE], w.BOOL
            kernel.QueryInformationJobObject.argtypes, kernel.QueryInformationJobObject.restype = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p], w.BOOL
            self.kernel = kernel
            self.accounting = Accounting
            handle = kernel.CreateJobObjectW(None, None)
            if not handle:
                raise OSError("Could not create the analysis process group.")
            info = ExtendedLimit()
            info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not kernel.SetInformationJobObject(handle, 9, ctypes.byref(info), ctypes.sizeof(info)) or not kernel.AssignProcessToJobObject(handle, int(process._handle)):
                kernel.CloseHandle(handle)
                raise OSError("Could not isolate the analysis process tree.")
            self.handle = handle

    def terminate(self):
        if self.handle is not None:
            if not self.kernel.TerminateJobObject(self.handle, 1):
                raise OSError("Could not terminate the owned analysis process tree.")
        else:
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def close(self):
        if self.handle is not None:
            import ctypes
            handle = self.handle
            try:
                self.terminate()
                deadline = time.monotonic() + 5
                while True:
                    accounting = self.accounting()
                    if not self.kernel.QueryInformationJobObject(handle, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None):
                        raise OSError("Could not confirm that the analysis process tree exited.")
                    if accounting.ActiveProcesses == 0:
                        break
                    if time.monotonic() >= deadline:
                        raise OSError("The analysis process tree did not exit in time.")
                    time.sleep(.02)
            finally:
                self.handle = None
                self.kernel.CloseHandle(handle)
        else:
            self.terminate()
