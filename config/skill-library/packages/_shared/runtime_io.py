"""Atomic writes and cross-process ownership, also used by the RSS runner."""
import contextlib
import json
import os
from pathlib import Path
import time
import uuid

class BusyError(RuntimeError):
    pass


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
        temp.replace(file)
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
                os.kill(owner['pid'], 0)
            except ProcessLookupError:
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
        if file.exists() and json.loads(file.read_text()).get('token') == token:
            file.unlink()
