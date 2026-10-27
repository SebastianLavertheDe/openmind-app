from __future__ import annotations

import argparse
import os
from datetime import datetime
from pathlib import Path

from .cache import RedditFetchCache
from .config import load_config
from .fetcher import fetch_listing
from .runtime_paths import RuntimePathError, optional_run_dir, require_skill_data_dir, require_content_root
from .storage import write_subreddit_markdown


def _ensure_local_cron_bindings() -> None:
    """Fill Broker-style bindings for bare local/cron invocations."""
    skill_dir = Path(__file__).resolve().parents[1]
    if not os.environ.get("OPENMIND_SKILL_DATA_DIR"):
        os.environ["OPENMIND_SKILL_DATA_DIR"] = str(skill_dir)
    # Installed copies live at <content-root>/.agent/skills/cctools/<skill>/;
    # the ancestor carrying the app-managed .agent/skills store is the
    # user-selected content root itself (flat layout, no mymind/ layer).
    for parent in [skill_dir, *skill_dir.parents]:
        if (parent / ".agent" / "skills").is_dir():
            if not os.environ.get("OPENMIND_ROOT"):
                os.environ["OPENMIND_ROOT"] = str(parent)
            break


def run() -> int:
    parser = argparse.ArgumentParser(description="Fetch Reddit hot listings")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    parser.add_argument("--content-root", default="", help="Explicit content root; defaults to OPENMIND_ROOT.")
    parser.add_argument("--skill-data-dir", default="", help="App-private Skill data directory.")
    parser.add_argument("--run-dir", default="", help="App-private Run working directory.")
    parser.add_argument("--date", default="", help="Output date in YYYYMMDD or YYYY-MM-DD format.")
    args = parser.parse_args()

    try:
        _ensure_local_cron_bindings()
        content_root = require_content_root(args.content_root)
        require_skill_data_dir(args.skill_data_dir)
        optional_run_dir(args.run_dir)
        config = load_config(args.config, str(content_root), args.skill_data_dir)
    except RuntimePathError as exc:
        parser.error(str(exc))

    if not config.fetch.sources:
        print("No Reddit sources configured.")
        return 1

    print("=" * 60)
    print("Reddit Fetcher")
    print("=" * 60)

    day_dir = config.storage.output_dir / normalize_date(args.date)
    cache = RedditFetchCache(config.storage.cache_file)
    fetched_count = 0
    written_count = 0
    failed_count = 0

    for source_url in config.fetch.sources:
        print(f"\nFetching: {source_url}")
        try:
            listing = fetch_listing(
                source_url,
                user_agent=config.fetch.user_agent,
                timeout_seconds=config.fetch.timeout_seconds,
                fetch_comments_enabled=config.fetch.fetch_comments,
                comment_timeout_seconds=config.fetch.comment_timeout_seconds,
                top_level_comment_limit=config.fetch.top_level_comment_limit,
                reply_limit=config.fetch.reply_limit,
                max_comment_depth=config.fetch.max_comment_depth,
                listing_retry_count=config.fetch.listing_retry_count,
                comment_retry_count=config.fetch.comment_retry_count,
                request_delay_seconds=config.fetch.request_delay_seconds,
                rss_only=config.fetch.rss_only,
            )
            fetched_count += 1
            new_posts = [
                post
                for post in listing.posts
                if not cache.has_post(listing.subreddit, post.post_id)
            ]
            if not new_posts:
                print(f"No new posts for r/{listing.subreddit}")
                continue

            filtered_listing = listing.__class__(
                subreddit=listing.subreddit,
                listing_type=listing.listing_type,
                source_url=listing.source_url,
                fetched_at=listing.fetched_at,
                post_count=len(new_posts),
                posts=new_posts,
            )
            md_path = write_subreddit_markdown(
                filtered_listing,
                config.storage,
                normalize_date(args.date),
                append=(day_dir / f"{listing.subreddit}.md").exists(),
            )
            cache.mark_posts(listing.subreddit, [post.post_id for post in new_posts])
            cache.save()
            written_count += 1
            print(f"Saved {len(new_posts)} new posts for r/{listing.subreddit} -> {md_path}")
        except Exception as exc:
            failed_count += 1
            print(f"Failed to fetch {source_url}: {exc}")

    print(f"\nSummary: fetched={fetched_count}, written={written_count}, failed={failed_count}")
    print("Done.")
    if fetched_count == 0 and failed_count > 0:
        return 1
    return 0


def normalize_date(value: str) -> str:
    if not value:
        return datetime.now().strftime("%Y%m%d")
    compact = value.replace("-", "")
    if len(compact) != 8 or not compact.isdigit():
        raise ValueError("--date must be YYYYMMDD or YYYY-MM-DD")
    datetime.strptime(compact, "%Y%m%d")
    return compact
