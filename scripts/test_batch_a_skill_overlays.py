#!/usr/bin/env python3
"""Cross-entry smoke tests for Batch A's explicit runtime path contract."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "config" / "skill-library" / "packages"


class BatchARuntimeOverlayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="openmind-batch-a-")
        self.root = Path(self.temp.name) / "openmind"
        self.data = Path(self.temp.name) / "skill-data"
        self.root.mkdir()
        self.data.mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

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
