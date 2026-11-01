import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'config/skill-library/packages'))
from _shared.runtime_io import BusyError, process_alive, task_lock, atomic_write


class LockOwnerTests(unittest.TestCase):
    def test_concurrent_registry_writers_finish_without_abandoned_locks(self):
        package = Path(__file__).resolve().parents[2] / 'config/skill-library/packages/rss-article-saver'
        code = '''import json,sys
from pathlib import Path
from src.rss_pipeline import lock,json_write
root=Path(sys.argv[1]); counter=root/'counter.json'
for _ in range(30):
    with lock(root,'registry',wait=5):
        value=json.loads(counter.read_text(encoding='utf-8'))
        json_write(counter,value+1)
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'counter.json').write_text('0', encoding='utf-8')
            children = [subprocess.Popen([sys.executable, '-B', '-c', code, directory],
                                        cwd=package, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        for _ in range(2)]
            try:
                for child in children:
                    _, errors = child.communicate(timeout=30)
                    self.assertEqual(child.returncode, 0, errors)
                self.assertEqual(json.loads((root / 'counter.json').read_text()), 60)
                self.assertFalse((root / 'registry.lock').exists())
            finally:
                for child in children:
                    if child.poll() is None:
                        child.kill(); child.communicate()

    def test_windows_reader_cannot_leave_a_live_owner_lock_after_release(self):
        from test_pipeline import rss
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original_unlink = Path.unlink
            for name, acquire in [('task', task_lock), ('rss', rss.lock)]:
                file = root / (name + '.lock')
                denied = []
                def unlink(target, *args, **kwargs):
                    if target == file and not denied:
                        denied.append(True)
                        raise PermissionError('Windows sharing violation')
                    return original_unlink(target, *args, **kwargs)
                with patch('sys.platform', 'win32'), patch.object(Path, 'unlink', unlink):
                    with acquire(root, name): pass
                self.assertTrue(denied)
                self.assertFalse(file.exists())
                with acquire(root, name): pass

    def test_windows_replace_retries_preserve_previous_bytes_until_published(self):
        from test_pipeline import rss
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'index.json'
            for write in [atomic_write, rss.write_atomic]:
                file.write_bytes(b'previous')
                original_replace = os.replace
                denied = []
                def replace(source, target):
                    if not denied:
                        denied.append(True)
                        self.assertEqual(file.read_bytes(), b'previous')
                        raise PermissionError('Windows sharing violation')
                    return original_replace(source, target)
                with patch('sys.platform', 'win32'), patch.object(os, 'replace', replace):
                    write(file, b'complete')
                self.assertTrue(denied)
                self.assertEqual(file.read_bytes(), b'complete')

    def test_live_owner_survives_checks_and_keeps_both_locks(self):
        from test_pipeline import rss
        child = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stdin.read()'], stdin=subprocess.PIPE)
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name, acquire, busy in [('task', task_lock, BusyError), ('rss', rss.lock, rss.FeedError)]:
                    file = root / (name + '.lock')
                    file.write_text(json.dumps({'pid': child.pid, 'token': 'live'}))
                    self.assertTrue(process_alive(child.pid))
                    with self.assertRaises(busy):
                        with acquire(root, name): self.fail('Admitted overlapping task')
                    self.assertIsNone(child.poll())
                    self.assertEqual(json.loads(file.read_text())['token'], 'live')
        finally:
            child.communicate(timeout=10)

    def test_exited_owner_is_recovered_by_both_locks(self):
        from test_pipeline import rss
        child = subprocess.Popen([sys.executable, '-c', 'pass'])
        child.wait(timeout=10)
        self.assertFalse(process_alive(child.pid))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, acquire in [('task', task_lock), ('rss', rss.lock)]:
                file = root / (name + '.lock')
                file.write_text(json.dumps({'pid': child.pid, 'token': 'dead'}))
                with acquire(root, name):
                    self.assertEqual(json.loads(file.read_text())['pid'], os.getpid())
                self.assertFalse(file.exists())
