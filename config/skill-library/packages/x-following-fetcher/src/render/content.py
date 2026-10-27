from __future__ import annotations

import html
import re
from datetime import datetime

from ..models import EmbeddedTweet, Tweet, UrlEntity


_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")


def replace_url_entities(content: str, entities: list[UrlEntity], expand_urls: bool) -> str:
    updated = html.unescape(content).strip()
    for entity in sorted(entities, key=lambda item: len(item.url), reverse=True):
        if not entity.url:
            continue
        replacement = ""
        if not entity.is_media:
            replacement = (
                entity.expanded_url if expand_urls and entity.expanded_url else entity.display_url or entity.url
            )
        updated = updated.replace(entity.url, replacement)
    updated = re.sub(r"[ \t]+\n", "\n", updated)
    updated = _MULTI_NEWLINE_RE.sub("\n\n", updated)
    return updated.strip()


def normalize_embedded_content(embedded: EmbeddedTweet, expand_urls: bool) -> str:
    return replace_url_entities(embedded.content, embedded.url_entities, expand_urls)


def normalize_tweet_content(tweet: Tweet, expand_urls: bool) -> str:
    if tweet.is_retweet and tweet.retweeted_tweet and tweet.content.startswith("RT @"):
        return normalize_embedded_content(tweet.retweeted_tweet, expand_urls)
    return replace_url_entities(tweet.content, tweet.url_entities, expand_urls)


def build_title(title: str, content: str, max_length: int) -> str:
    normalized_title = title.strip()
    if not normalized_title:
        normalized_title = content.splitlines()[0].strip() if content else ""
    normalized_title = re.sub(r"\s+", " ", normalized_title)
    return normalized_title[:max_length].rstrip()


def should_render_title(title: str, content: str) -> bool:
    raw_title = title.strip()
    normalized_title = re.sub(r"\s+", " ", raw_title)
    if not normalized_title:
        return False

    raw_content = content.strip()
    normalized_content = re.sub(r"\s+", " ", raw_content)
    if not normalized_content:
        return True

    first_paragraph = raw_content.split("\n\n", 1)[0].strip()
    first_line = raw_content.splitlines()[0].strip() if raw_content else ""
    first_chunk = re.sub(r"\s+", " ", first_paragraph or first_line)

    if normalized_title == first_chunk:
        return False
    if normalized_content.startswith(normalized_title):
        return False
    return True


def format_compact_count(value: int) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M".rstrip("0").rstrip(".")
    if value >= 1_000:
        return f"{value / 1_000:.1f}K".rstrip("0").rstrip(".")
    return str(value)


def format_display_time(iso_time: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_time)
        return dt.strftime("%-I:%M %p · %b %-d, %Y")
    except Exception:
        return iso_time


def format_short_time(iso_time: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_time)
        return dt.strftime("%b %-d")
    except Exception:
        return iso_time


def author_initials(name: str, screen_name: str) -> str:
    source = (name or screen_name or "?").strip()
    if not source:
        return "?"
    parts = [part for part in re.split(r"\s+", source) if part]
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    return source[:2].upper()
