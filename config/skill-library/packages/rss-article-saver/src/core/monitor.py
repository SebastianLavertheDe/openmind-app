"""
RSS Monitor - Main orchestrator for multi-feed RSS article sync
"""

import json
import os
import sys
from pathlib import Path
from ..managers.config_manager import RSSConfig
from ..managers.opml_parser import OPMLParser
from ..managers.rss_manager import RSSManager
from ..managers.config_manager import RSSConfig


class RSSMonitor:
    """Multi-feed RSS monitor"""

    def __init__(
        self,
        config_file: str = "",
        content_root: str | None = None,
        skill_data_dir: str | None = None,
        run_date: str = "",
    ):
        """Initialize the RSS monitor"""
        self.config = RSSConfig(config_file, content_root, skill_data_dir)
        self.rss_manager = RSSManager(self.config, run_date)
        self.opml_parser = OPMLParser(self.config.get_opml_file())
        self.processed_feed_sources = set()

    def monitor(self) -> None:
        """Main monitoring workflow"""
        print("=" * 50)
        print("RSS Article Monitor")
        print("=" * 50)

        # Load RSS feeds from OPML
        feeds = self.opml_parser.parse()
        feeds = self._filter_enabled_feeds(feeds)

        if not feeds:
            print("No RSS feeds found. Please check your subscriptions.opml file.")
            sys.exit(1)

        # Process each feed
        for feed in feeds:
            self._process_feed(feed)

        print("\n" + "=" * 50)
        print("Done!")
        print("=" * 50)

    def _filter_enabled_feeds(self, feeds):
        requested_url = os.environ.get("OPENMIND_SOURCE_URL", "").strip()
        if requested_url:
            selected = [feed for feed in feeds if feed.url == requested_url]
            print(f"Single source mode: {requested_url} ({len(selected)} matched)")
            return selected

        project_root = os.environ.get("OPENMIND_PROJECT_ROOT", "").strip()
        if not project_root:
            return feeds
        settings_path = Path(project_root) / ".cctools" / "source-settings.json"
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            disabled_urls = set(settings.get("disabledUrls") or [])
        except (OSError, ValueError, TypeError):
            return feeds
        enabled = [feed for feed in feeds if feed.url not in disabled_urls]
        if len(enabled) != len(feeds):
            print(f"Skipped {len(feeds) - len(enabled)} disabled RSS source(s)")
        return enabled

    def _process_feed(
        self, feed, parent_title: str = None, parent_category: str = None
    ) -> None:
        """Process a feed or a nested OPML feed recursively."""
        try:
            feed_identity = self.rss_manager.get_feed_identity(feed)
        except Exception:
            feed_identity = feed.url

        if feed_identity in self.processed_feed_sources:
            print(f"Skipping duplicate feed source: {feed.title}")
            print(f"URL: {feed.url}")
            return

        self.processed_feed_sources.add(feed_identity)

        print(f"\n{'=' * 50}")
        print(f"Feed: {feed.title}")
        print(f"URL: {feed.url}")
        if parent_title:
            print(f"Parent: {parent_title}")
        print("=" * 50)

        parsed_feed = self.rss_manager.fetch_feed(feed)
        if not parsed_feed:
            print(f"Failed to fetch feed: {feed.title}")
            return

        if isinstance(parsed_feed, dict) and parsed_feed.get("type") == "opml":
            print("Processing nested OPML feeds...")
            nested_feeds = parsed_feed.get("feeds", [])
            nested_parent_title = parsed_feed.get("parent_title", feed.title)
            nested_parent_category = parsed_feed.get("parent_category", feed.category)

            for nested_feed in nested_feeds:
                self._process_feed(
                    nested_feed,
                    parent_title=nested_parent_title,
                    parent_category=nested_parent_category,
                )
            return

        print(f"Entries: {len(parsed_feed.entries)}")
        self.rss_manager.process_feed(parsed_feed, feed, parent_category)
