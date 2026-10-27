from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import yaml

from src.config import load_config


class PersistentRedditSourcesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="reddit-persistent-config-")
        base = Path(self.temp.name)
        self.content_root = base / "openmind"
        self.data_root = base / "skill-data"
        self.content_root.mkdir()
        self.data_root.mkdir()
        self.config_path = base / "config.yaml"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_package_config(self, timeout: int, source: str) -> None:
        self.config_path.write_text(
            yaml.safe_dump({
                "fetch": {"timeout_seconds": timeout, "sources": [source]},
                "storage": {"output_dir": "", "cache_file": ""},
            }, sort_keys=False),
            encoding="utf-8",
        )

    def test_package_rules_update_while_user_sources_persist(self) -> None:
        self.write_package_config(30, "https://reddit.com/r/default-v1/hot.json")
        first = load_config(str(self.config_path), str(self.content_root), str(self.data_root))
        self.assertEqual(first.fetch.sources, ["https://reddit.com/r/default-v1/hot.json"])

        persistent = self.data_root / "user-sources.yaml"
        persistent.write_text(
            yaml.safe_dump({
                "schemaVersion": 1,
                "sources": ["https://reddit.com/r/user-community/hot.json"],
            }, sort_keys=False),
            encoding="utf-8",
        )
        self.write_package_config(60, "https://reddit.com/r/default-v2/hot.json")

        updated = load_config(str(self.config_path), str(self.content_root), str(self.data_root))

        self.assertEqual(updated.fetch.timeout_seconds, 60)
        self.assertEqual(updated.fetch.sources, ["https://reddit.com/r/user-community/hot.json"])

    def test_structured_sources_only_return_enabled_communities(self) -> None:
        self.write_package_config(30, "https://reddit.com/r/default/hot.json")
        persistent = self.data_root / "user-sources.yaml"
        persistent.write_text(
            yaml.safe_dump({
                "schemaVersion": 2,
                "sources": [
                    {
                        "id": "enabled",
                        "name": "r/enabled",
                        "url": "https://reddit.com/r/enabled/hot.json",
                        "enabled": True,
                        "tags": ["社区"],
                    },
                    {
                        "id": "disabled",
                        "name": "r/disabled",
                        "url": "https://reddit.com/r/disabled/hot.json",
                        "enabled": False,
                        "tags": ["社区"],
                    },
                ],
            }, sort_keys=False),
            encoding="utf-8",
        )

        config = load_config(str(self.config_path), str(self.content_root), str(self.data_root))

        self.assertEqual(config.fetch.sources, ["https://reddit.com/r/enabled/hot.json"])


if __name__ == "__main__":
    unittest.main()
