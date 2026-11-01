"""Atomic writes and cross-process ownership, also used by the RSS runner."""
import contextlib
import json
import os
import sys
from pathlib import Path
import time
import uuid

class BusyError(RuntimeError):
    pass


def process_alive(pid):
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        raise ValueError('Invalid lock owner PID.')
    if sys.platform == 'win32':
        # Windows os.kill(pid, 0) calls TerminateProcess, and missing PIDs
        # raise WinError 87 rather than ProcessLookupError. Only query a handle.
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return ctypes.get_last_error() != 87  # Access denied stays locked.
        try:
            return kernel.WaitForSingleObject(handle, 0) != 0
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    return True


def retry_file_operation(work):
    # Windows readers can temporarily deny delete/replace sharing. Retain
    # ownership while retrying instead of abandoning a live owner's lock.
    for attempt in range(20):
        try:
            return work()
        except PermissionError:
            if sys.platform != 'win32' or attempt == 19:
                raise
            time.sleep(0.015)


def release_lock(file, token):
    def release():
        try:
            owner = json.loads(file.read_text(encoding='utf-8'))
        except FileNotFoundError:
            return
        if owner.get('token') == token:
            file.unlink(missing_ok=True)
    retry_file_operation(release)


def inside(root, *parts):
    root = Path(root).resolve()
    target = root.joinpath(*parts)
    if not target.resolve().is_relative_to(root):
        raise ValueError('Path escapes the selected content root.')
    return target


def atomic_write(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('xb') as stream:
            stream.write(value.encode() if isinstance(value, str) else value)
            stream.flush(); os.fsync(stream.fileno())
        retry_file_operation(lambda: temp.replace(file))
    finally:
        temp.unlink(missing_ok=True)


def write_json(file, value):
    atomic_write(file, json.dumps(value, ensure_ascii=False, indent=2) + '\n')


@contextlib.contextmanager
def task_lock(directory, name):
    directory.mkdir(parents=True, exist_ok=True)
    file = directory / (name + '.lock')
    token = uuid.uuid4().hex
    for attempt in range(3):
        try:
            with file.open('x') as stream:
                json.dump({'pid': os.getpid(), 'token': token}, stream)
            break
        except FileExistsError:
            try:
                owner = json.loads(file.read_text())
                if not process_alive(owner['pid']):
                    file.unlink(missing_ok=True); continue
            except (ValueError, KeyError):
                if time.time() - file.stat().st_mtime > 60:
                    file.unlink(missing_ok=True); continue
            except FileNotFoundError:
                continue
            except PermissionError:
                pass
            raise BusyError('A task for this date is already running.')
    else:
        raise BusyError('The task lock is busy.')
    try:
        yield
    finally:
        release_lock(file, token)
