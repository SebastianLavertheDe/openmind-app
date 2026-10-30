from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from src.app import run
from src.source_status import SourceStatus


class SourceStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="reddit-source-status-")
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.urls = ["https://reddit.com/r/A/hot.json", "https://reddit.com/r/B/hot.json"]

    def tearDown(self):
        self.temp.cleanup()

    def read(self, url):
        return json.loads((self.data / "source-status" / (hashlib.sha256(url.encode()).hexdigest() + ".json")).read_text())

    def test_results_are_isolated_and_older_attempts_cannot_replace_newer_ones(self):
        first = SourceStatus(self.data, self.urls[0])
        other = SourceStatus(self.data, self.urls[1])
        first.finish(3)
        other.finish(error="B failed")
        self.assertEqual(self.read(self.urls[0])["status"], "success")
        self.assertEqual(self.read(self.urls[1])["status"], "failed")
        old = SourceStatus(self.data, self.urls[0])
        new = SourceStatus(self.data, self.urls[0])
        old.finish(error="old failure")
        self.assertEqual(self.read(self.urls[0])["attempt"], new.attempt)
        new.finish(0)
        self.assertIsNotNone(self.read(self.urls[0])["lastSuccessAt"])
        self.assertEqual(self.read(self.urls[0])["itemCount"], 0)

    def test_collector_records_partial_failure_and_success_with_no_new_posts(self):
        config = self.root / "config.yaml"
        config.write_text(json.dumps({"fetch": {"sources": self.urls}, "storage": {}}))
        args = ["collector", "--config", str(config), "--content-root", str(self.root), "--skill-data-dir", str(self.data)]
        listing = SimpleNamespace(subreddit="A", posts=[])
        with patch("sys.argv", args), patch("src.app._ensure_local_cron_bindings"), patch("src.app.fetch_listing", side_effect=[listing, RuntimeError("B failed")]):
            self.assertEqual(run(), 0)
        self.assertEqual(self.read(self.urls[0])["status"], "success")
        self.assertEqual(self.read(self.urls[1])["error"], "B failed")
        self.assertIsNotNone(self.read(self.urls[1])["completedAt"])
        self.assertFalse(list(self.data.rglob(".status-*")))

    def test_failure_survives_retries_and_clears_only_on_success(self):
        first = SourceStatus(self.data, self.urls[0])
        first.finish(error="Request timed out")
        retry = SourceStatus(self.data, self.urls[0])
        self.assertEqual(self.read(self.urls[0])["status"], "running")
        self.assertEqual(self.read(self.urls[0])["error"], "Request timed out")
        retry.finish(error="")
        self.assertEqual(self.read(self.urls[0])["status"], "failed")
        self.assertTrue(self.read(self.urls[0])["error"])
        recovered = SourceStatus(self.data, self.urls[0])
        recovered.finish(0)
        self.assertEqual(self.read(self.urls[0])["status"], "success")
        self.assertIsNone(self.read(self.urls[0])["error"])
        SourceStatus(self.data, self.urls[0])
        self.assertIsNone(self.read(self.urls[0])["error"])


if __name__ == "__main__":
    unittest.main()
