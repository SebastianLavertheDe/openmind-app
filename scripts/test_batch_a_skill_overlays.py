#!/usr/bin/env python3
"""Cross-entry smoke tests for Batch A's explicit runtime path contract."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "config" / "skill-library" / "packages"
OUTSIDE_CWD = Path(tempfile.gettempdir())


class BatchARuntimeOverlayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="openmind-batch-a-")
        self.root = Path(self.temp.name) / "openmind"
        self.data = Path(self.temp.name) / "skill-data"
        self.run_dir = Path(self.temp.name) / "run"
        self.root.mkdir()
        self.data.mkdir()
        self.run_dir.mkdir()
        self.env = {
            **os.environ,
            "OPENMIND_ROOT": str(self.root),
            "OPENMIND_SKILL_DATA_DIR": str(self.data),
            "OPENMIND_RUN_DIR": str(self.run_dir),
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_script(self, relative_script: str, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SKILLS_ROOT / relative_script), *args],
            cwd=OUTSIDE_CWD,
            env=self.env,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_reporter_reads_openmind_and_run_store_without_skill_ancestors(self) -> None:
        article_dir = self.root / "article/20260805"
        article_dir.mkdir(parents=True)
        (article_dir / "one.md").write_text("article", encoding="utf-8")
        run_dir = self.run_dir / "run-1"
        run_dir.mkdir()
        (run_dir / "run.json").write_text(
            json.dumps({
                "createdAt": "2026-08-05T10:00:00.000Z",
                "state": "succeeded",
                "request": {"skillId": "rss-article-saver"},
            }),
            encoding="utf-8",
        )

        result = self.run_script("skill-run-reporter/scripts/report.py", "20260805")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("rss-article-saver", result.stdout)
        self.assertIn("runs: 1", result.stdout)

    def test_reddit_config_separates_openmind_output_and_skill_cache(self) -> None:
        config = Path(self.temp.name) / "config.yaml"
        config.write_text("fetch:\n  sources: []\nstorage:\n  output_dir: reddit-custom\n", encoding="utf-8")

        sys.path.insert(0, str(SKILLS_ROOT / "reddit-fetcher"))
        try:
            from src.config import load_config

            loaded = load_config(str(config), str(self.root), str(self.data))
        finally:
            sys.path.pop(0)

        self.assertEqual(loaded.storage.output_dir, self.root / "reddit-custom")
        self.assertEqual(loaded.storage.cache_file, self.data / ".reddit_fetch_cache.json")
        self.assertFalse((SKILLS_ROOT / "reddit-fetcher" / ".reddit_fetch_cache.json").exists())

    def test_reddit_config_rejects_output_or_cache_escape(self) -> None:
        config = Path(self.temp.name) / "config.yaml"
        config.write_text(
            "fetch:\n  sources: []\nstorage:\n  output_dir: ../outside\n  cache_file: ../outside-cache.json\n",
            encoding="utf-8",
        )

        sys.path.insert(0, str(SKILLS_ROOT / "reddit-fetcher"))
        try:
            from src.config import load_config
            with self.assertRaises(ValueError):
                load_config(str(config), str(self.root), str(self.data))
        finally:
            sys.path.pop(0)


if __name__ == "__main__":
    unittest.main()
