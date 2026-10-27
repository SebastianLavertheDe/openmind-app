from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import yaml

from src.managers.config_manager import RSSConfig


class PersistentSubscriptionsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="rss-persistent-config-")
        base = Path(self.temp.name)
        self.content_root = base / "openmind"
        self.data_root = base / "skill-data"
        self.content_root.mkdir()
        self.data_root.mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_seeds_package_defaults_into_skill_data(self) -> None:
        config = RSSConfig("", str(self.content_root), str(self.data_root))

        opml_path = Path(config.get_opml_file())

        self.assertEqual(opml_path, self.data_root / "subscriptions.opml")
        self.assertTrue(opml_path.exists())
        self.assertTrue((self.data_root / "subscriptions.wechat.opml").exists())

    def test_keeps_existing_user_subscriptions(self) -> None:
        persistent = self.data_root / "subscriptions.opml"
        persistent.write_text(
            '<opml><body><outline xmlUrl="https://user.example/rss"/></body></opml>\n',
            encoding="utf-8",
        )

        config = RSSConfig("", str(self.content_root), str(self.data_root))

        self.assertEqual(Path(config.get_opml_file()), persistent)
        self.assertIn("https://user.example/rss", persistent.read_text(encoding="utf-8"))

    def test_package_rules_update_while_user_subscriptions_persist(self) -> None:
        persistent = self.data_root / "subscriptions.opml"
        persistent.write_text(
            '<opml><body><outline xmlUrl="https://user.example/rss"/></body></opml>\n',
            encoding="utf-8",
        )
        package_config = Path(self.temp.name) / "updated-config.yaml"
        package_config.write_text(
            yaml.safe_dump({
                "article_base_dir": "",
                "opml_file": "subscriptions.opml",
                "max_articles_per_feed": 7,
            }, sort_keys=False),
            encoding="utf-8",
        )

        updated = RSSConfig(str(package_config), str(self.content_root), str(self.data_root))

        self.assertEqual(updated.get_max_articles_per_feed(), 7)
        self.assertEqual(Path(updated.get_opml_file()), persistent)
        self.assertIn("https://user.example/rss", persistent.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
