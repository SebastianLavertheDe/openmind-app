from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

from ..config import AppConfig
from ..media_download import cache_tweet_videos
from ..media_enrichment import enrich_tweets_media
from ..models import Tweet
from ..render.html import render_timeline_html
from ..render.markdown import (
    render_external_link_tweet_article_markdown,
    render_tweet_markdown,
)
from ..render.content import build_title
from ..serialize import tweet_from_dict, tweet_to_dict
from .cache import PostCache


ArtifactCallback = Callable[[str, Path], None]


def _tweet_sort_key(tweet: Tweet) -> tuple[str, str]:
    return (tweet.created_at, tweet.tweet_id)


def _bundle_paths(date_dir: Path, config: AppConfig) -> tuple[Path, Path, Path]:
    if config.storage is None:
        raise RuntimeError("missing storage config")
    return (
        date_dir / config.storage.daily_json_filename,
        date_dir / config.storage.daily_html_filename,
        date_dir / config.storage.daily_markdown_filename,
    )


def _load_tweets_from_bundle(json_path: Path) -> list[Tweet]:
    if not json_path.exists():
        return []

    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    tweets: list[Tweet] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        try:
            tweets.append(tweet_from_dict(item))
        except Exception:
            continue
    return tweets


def _load_tweets_from_legacy_json_files(date_dir: Path) -> list[Tweet]:
    tweets: list[Tweet] = []
    for json_file in sorted(date_dir.glob("*.json")):
        if json_file.name == "posts.json":
            continue
        try:
            payload = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        try:
            tweets.append(tweet_from_dict(payload))
        except Exception:
            continue
    return tweets


def _load_existing_day_tweets(date_dir: Path, config: AppConfig) -> list[Tweet]:
    json_path, _, _ = _bundle_paths(date_dir, config)
    bundled = _load_tweets_from_bundle(json_path)
    if bundled:
        return bundled
    return _load_tweets_from_legacy_json_files(date_dir)


def _merge_tweets(existing: list[Tweet], incoming: list[Tweet]) -> list[Tweet]:
    merged: dict[str, Tweet] = {}

    for tweet in existing:
        merged[tweet.tweet_id] = tweet

    for tweet in incoming:
        previous = merged.get(tweet.tweet_id)
        if previous and not tweet.fetched_at:
            tweet.fetched_at = previous.fetched_at
        merged[tweet.tweet_id] = tweet

    return sorted(merged.values(), key=_tweet_sort_key)


def _write_daily_json(json_path: Path, tweets: list[Tweet]) -> None:
    payload = [tweet_to_dict(tweet) for tweet in tweets]
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _write_daily_html(html_path: Path, date_dir: Path, tweets: list[Tweet], config: AppConfig) -> None:
    html_path.write_text(
        render_timeline_html(
            tweets,
            config.render,
            date_label=date_dir.name,
            output_dir=date_dir,
        ),
        encoding="utf-8",
    )


def _write_daily_markdown(markdown_path: Path, tweets: list[Tweet], config: AppConfig) -> None:
    if config.storage is None or not config.storage.write_daily_markdown:
        return

    blocks: list[str] = [f"# {markdown_path.parent.name} Timeline\n"]
    for tweet in sorted(tweets, key=_tweet_sort_key, reverse=True):
        blocks.append(render_tweet_markdown(tweet, config.render).strip())
        blocks.append("\n\n---\n")

    markdown_path.write_text("".join(blocks).rstrip() + "\n", encoding="utf-8")


def _write_daily_bundle(date_dir: Path, tweets: list[Tweet], config: AppConfig) -> None:
    json_path, html_path, markdown_path = _bundle_paths(date_dir, config)
    _write_daily_json(json_path, tweets)
    _write_daily_html(html_path, date_dir, tweets, config)
    _write_daily_markdown(markdown_path, tweets, config)


def _is_internal_x_url(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    if hostname.startswith("www."):
        hostname = hostname[4:]
    return hostname in {
        "x.com",
        "twitter.com",
        "mobile.twitter.com",
        "t.co",
        "pic.x.com",
        "fxtwitter.com",
        "vxtwitter.com",
    }


def _external_links(tweet: Tweet) -> list[str]:
    links: list[str] = []
    seen: set[str] = set()
    for entity in tweet.url_entities:
        if entity.is_media:
            continue
        link = (entity.expanded_url or entity.url).strip()
        if not link or _is_internal_x_url(link) or link in seen:
            continue
        seen.add(link)
        links.append(link)
    return links


def _safe_article_filename(tweet: Tweet, title: str, link_index: int, total_links: int) -> str:
    title = build_title(title, title, 120)
    title = re.sub(r"\s+", " ", title).strip()
    title = re.sub(r'[\\/:*?"<>|\r\n]+', "_", title).strip(" ._")
    if not title:
        title = "tweet"
    suffix = f"_{link_index:02d}" if total_links > 1 else ""
    return f"x_{tweet.tweet_id}{suffix}_{title[:80]}.md"


_EXISTING_ARTICLE_TWEET_ID_RE = re.compile(r"^x_(\d+)")


def _collect_existing_article_tweet_ids(article_root: Path) -> set[str]:
    """扫描 article_output_dir 下所有日期目录,收集已存在的 x_{tweet_id}*.md 的 tweet_id。

    用于跨日期目录去重:同一 X 帖子只要历史任意日期目录里已写过 article,
    本次运行就不再重复抓取/写入当天目录。
    """
    ids: set[str] = set()
    if not article_root.exists():
        return ids
    for date_dir in article_root.iterdir():
        if not date_dir.is_dir():
            continue
        for md_path in date_dir.glob("x_*.md"):
            match = _EXISTING_ARTICLE_TWEET_ID_RE.match(md_path.name)
            if match:
                ids.add(match.group(1))
    return ids


def _skill_dir() -> Path:
    configured = os.environ.get("OPENMIND_SKILL_HOME", "").strip()
    return Path(configured).expanduser().resolve() if configured else Path(__file__).resolve().parents[2]


def _external_article_log_path() -> Path:
    data_dir = (os.environ.get("OPENMIND_SKILL_DATA_DIR") or "").strip()
    if data_dir:
        return Path(data_dir).expanduser().resolve() / "external_article_fetch.log"
    return Path(tempfile.gettempdir()) / "openmind-x-following-fetcher" / "external_article_fetch.log"


def _log_external_article_event(message: str) -> None:
    log_path = _external_article_log_path()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    # Rotate if over 1MB
    try:
        if log_path.exists() and log_path.stat().st_size > 1_000_000:
            keep = log_path.read_bytes()[-1_000_000:]
            nl = keep.find(b"\n")
            if nl >= 0:
                keep = keep[nl + 1:]
            log_path.write_bytes(keep)
    except Exception:
        pass
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(f"[{timestamp}] {message.rstrip()}\n")


def _helper_python(skill_dir: Path) -> str:
    """Prefer the skill venv so cron via a system interpreter still has deps."""
    for candidate in (
        skill_dir / ".venv" / "bin" / "python",          # POSIX venv layout
        skill_dir / ".venv" / "Scripts" / "python.exe",  # Windows venv layout
    ):
        if candidate.exists():
            return str(candidate)
    return sys.executable


def _extract_external_articles(links: list[str]) -> dict[str, dict[str, object]]:
    if not links:
        return {}

    skill_dir = _skill_dir()
    script_path = skill_dir / "scripts" / "extract_external_articles_json.py"
    cmd = [
        _helper_python(skill_dir),
        str(script_path),
        *links,
    ]
    try:
        result = subprocess.run(
            cmd,
            cwd=skill_dir,
            capture_output=True,
            text=True,
            timeout=1800,
            check=False,
            env={
                **os.environ,
                # Keep Broker/local bindings visible to the helper process.
                "OPENMIND_ROOT": os.environ.get("OPENMIND_ROOT", ""),
                "OPENMIND_SKILL_DATA_DIR": os.environ.get(
                    "OPENMIND_SKILL_DATA_DIR", str(skill_dir)
                ),
            },
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        _log_external_article_event(f"站外文章抓取启动失败: {exc}")
        print(f"抓取站外文章失败: {exc}")
        return {}

    stderr = result.stderr.strip()
    if stderr:
        _log_external_article_event(stderr)

    if result.returncode != 0:
        if stderr:
            print(stderr)
        _log_external_article_event("站外文章抓取失败: helper exited non-zero")
        print("抓取站外文章失败: helper exited non-zero")
        return {}

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        _log_external_article_event("站外文章抓取失败: helper returned invalid JSON")
        print("抓取站外文章失败: helper returned invalid JSON")
        return {}

    extracted: dict[str, dict[str, object]] = {}
    if not isinstance(payload, list):
        _log_external_article_event("站外文章抓取失败: helper returned non-list payload")
        return extracted

    success_count = 0
    failure_count = 0
    for item in payload:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        content = str(item.get("content") or "").strip()
        if not url:
            continue
        if not content:
            failure_count += 1
            reason = str(item.get("error") or "").strip()
            if not reason and item.get("validation_blocked"):
                reason = "validation_blocked"
            if not reason:
                reason = "empty_content"
            _log_external_article_event(f"抓取失败: {url} | reason={reason}")
            continue
        extracted[url] = item
        success_count += 1

    _log_external_article_event(
        f"站外文章抓取完成: total={len(links)} success={success_count} failed={failure_count}"
    )
    return extracted


def _write_external_link_tweet_articles(
    article_date_dir: Path,
    tweets: list[Tweet],
    config: AppConfig,
    on_artifact: ArtifactCallback | None = None,
) -> int:
    if config.storage is None or not config.storage.save_external_link_posts_to_article:
        return 0

    # 跨日期目录去重: 同一 X 帖子历史任意日期目录已写过 article 就跳过,避免跨天重复抓取
    existing_tweet_ids = _collect_existing_article_tweet_ids(config.storage.article_output_dir)

    all_links: list[str] = []
    seen_links: set[str] = set()
    for tweet in tweets:
        for link in _external_links(tweet):
            if link in seen_links:
                continue
            seen_links.add(link)
            all_links.append(link)

    extracted_articles = _extract_external_articles(all_links)
    saved_count = 0

    for tweet in tweets:
        external_links = _external_links(tweet)
        stale_paths = list(article_date_dir.glob(f"x_{tweet.tweet_id}*.md")) if article_date_dir.exists() else []

        # 跨日期目录去重: 该帖子已在历史或当天目录存在,跳过避免重复写入,保留已有 article
        if tweet.tweet_id in existing_tweet_ids:
            continue

        matched_articles = [
            (link, extracted_articles[link])
            for link in external_links
            if link in extracted_articles
        ]

        if not matched_articles:
            for stale_path in stale_paths:
                stale_path.unlink(missing_ok=True)
            continue

        article_date_dir.mkdir(parents=True, exist_ok=True)
        written_paths: set[Path] = set()
        total_links = len(matched_articles)
        for index, (link, article) in enumerate(matched_articles, start=1):
            article_title = str(article.get("title") or "").strip() or link
            article_path = article_date_dir / _safe_article_filename(
                tweet,
                article_title,
                index,
                total_links,
            )
            article_path.write_text(
                render_external_link_tweet_article_markdown(
                    tweet,
                    article,
                    article_url=link,
                ),
                encoding="utf-8",
            )
            written_paths.add(article_path)
            saved_count += 1
            if on_artifact is not None:
                on_artifact("x-articles", article_path)

        for stale_path in stale_paths:
            if stale_path not in written_paths:
                stale_path.unlink(missing_ok=True)

    return saved_count


def save_new_tweets(
    tweets: list[Tweet],
    config: AppConfig,
    cache: PostCache,
    on_artifact: ArtifactCallback | None = None,
) -> tuple[int, int]:
    if config.storage is None:
        raise RuntimeError("missing storage config")

    date_str = datetime.now().strftime("%Y%m%d")
    date_dir = config.storage.output_dir / date_str
    date_dir.mkdir(parents=True, exist_ok=True)

    existing_day_tweets = _load_existing_day_tweets(date_dir, config)
    incoming = [
        tweet
        for tweet in tweets
        if config.render.include_retweets or not tweet.is_retweet
    ]

    new_tweets = [tweet for tweet in incoming if not cache.has(tweet.tweet_id)]
    now_iso = datetime.now().isoformat()
    for tweet in new_tweets:
        tweet.fetched_at = now_iso

    merged_tweets = _merge_tweets(existing_day_tweets, incoming)
    enrich_tweets_media(merged_tweets)
    cache_tweet_videos(date_dir, merged_tweets, config)
    _write_daily_bundle(date_dir, merged_tweets, config)
    if on_artifact is not None:
        # The daily directory is one coherent output bundle (JSON, HTML and
        # optional media), so report the directory once rather than every file.
        on_artifact("x-posts", date_dir)
    saved_articles = _write_external_link_tweet_articles(
        config.storage.article_output_dir / date_str,
        merged_tweets,
        config,
        on_artifact,
    )

    for tweet in merged_tweets:
        cache.add(tweet, date_dir / config.storage.daily_html_filename)
    cache.save()

    if new_tweets:
        print(f"发现 {len(new_tweets)} 条新帖子")
        print(f"已写入日聚合文件: {date_dir}")
    else:
        print("没有新增帖子")

    if saved_articles:
        print(f"已同步 {saved_articles} 条带站外链接的帖子到 article 目录")
    print(f"日聚合总计: {len(merged_tweets)} 条")
    return len(new_tweets), len(merged_tweets)
