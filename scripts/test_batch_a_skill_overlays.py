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


REPO_ROOT = Path(__file__).resolve().parents[2]
SKILLS_ROOT = REPO_ROOT / ".claude" / "skills"
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

    def test_asset_collector_uses_bound_root_from_an_unrelated_cwd(self) -> None:
        package = self.root / "creative/01-内容生产/文稿库/02-制作中/20260805-topic"
        package.mkdir(parents=True)
        (package / "topic-brief.md").write_text("[图1：官方截图]\nhttps://example.com/source\n", encoding="utf-8")

        result = self.run_script(
            "asset-collector/scripts/collect_assets.py",
            "--draft-dir",
            "creative/01-内容生产/文稿库/02-制作中/20260805-topic",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((package / "assets/manifest.json").exists())
        self.assertFalse((SKILLS_ROOT / "asset-collector" / "assets").exists())

    def test_interest_collector_writes_only_to_bound_root(self) -> None:
        source = self.root / "daily-summary/20260805_daily_summary.md"
        source.parent.mkdir(parents=True)
        source.write_text("# Summary\n\n[i] 一个值得追踪的主题\n  原文: https://example.com\n", encoding="utf-8")

        result = self.run_script(
            "collect-interest-markers/scripts/collect_interest_markers.py",
            "--date",
            "20260805",
        )

        inbox = self.root / "creative/01-内容生产/选题管理/00-兴趣收集箱.md"
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(inbox.exists())
        self.assertIn("daily-summary/20260805_daily_summary.md", inbox.read_text(encoding="utf-8"))

    def test_writing_orchestrator_keeps_manifest_paths_root_relative(self) -> None:
        topic = self.root / "creative/01-内容生产/选题管理/ai_topic_2026-08-05.md"
        topic.parent.mkdir(parents=True)
        topic.write_text(
            "## 1. 今日最终推荐\n\n"
            "### 今日最值得优先写的主题\n\n"
            "**显式根目录主题**\n\n"
            "## 4. 今日候选热点池\n",
            encoding="utf-8",
        )

        result = self.run_script(
            "daily-writing-orchestrator/scripts/create_writing_package.py",
            "--date",
            "20260805",
            "--platform",
            "wechat",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        package_dirs = list((self.root / "creative/01-内容生产/文稿库/02-制作中").iterdir())
        self.assertEqual(len(package_dirs), 1)
        manifest = json.loads((package_dirs[0] / "manifest.json").read_text(encoding="utf-8"))
        self.assertFalse(str(manifest["package_dir"]).startswith("/"))
        self.assertFalse(str(manifest["source_topic_file"]).startswith("/"))

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
