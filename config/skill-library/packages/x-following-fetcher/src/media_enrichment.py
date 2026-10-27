from __future__ import annotations

import json
from typing import Any
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen

from .models import Tweet

_PREFERRED_VIDEO_MAX_BITRATE = 1_200_000


def _parse_tweet_link(tweet_link: str) -> tuple[str, str] | None:
    if not tweet_link:
        return None

    parsed = urlparse(tweet_link)
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 3 or parts[1] != "status":
        return None
    return parts[0], parts[2]


def _fetch_fxtwitter_payload(tweet_link: str) -> dict[str, Any] | None:
    parsed = _parse_tweet_link(tweet_link)
    if parsed is None:
        return None

    screen_name, tweet_id = parsed
    api_url = f"https://api.fxtwitter.com/{screen_name}/status/{tweet_id}"
    try:
        with urlopen(api_url, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, TimeoutError, URLError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None
    return payload


def _pick_best_variant(media_item: dict[str, Any]) -> tuple[str, str]:
    variants = media_item.get("variants", [])
    if not isinstance(variants, list):
        variants = []

    mp4_variants = [
        variant
        for variant in variants
        if isinstance(variant, dict)
        and variant.get("content_type") == "video/mp4"
        and variant.get("url")
    ]
    if mp4_variants:
        capped_variants = [
            variant
            for variant in mp4_variants
            if int(variant.get("bitrate", 0) or 0) <= _PREFERRED_VIDEO_MAX_BITRATE
        ]
        if capped_variants:
            best = max(capped_variants, key=lambda variant: int(variant.get("bitrate", 0) or 0))
        else:
            best = min(mp4_variants, key=lambda variant: int(variant.get("bitrate", 0) or 0))
        return str(best.get("url", "")), str(best.get("content_type", ""))

    for variant in variants:
        if not isinstance(variant, dict):
            continue
        if variant.get("url"):
            return str(variant.get("url", "")), str(variant.get("content_type", ""))

    return str(media_item.get("url", "")), str(media_item.get("format", ""))


def _remote_media_by_type(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    tweet = payload.get("tweet", {})
    if not isinstance(tweet, dict):
        return {}

    media = tweet.get("media", {})
    if not isinstance(media, dict):
        return {}

    all_items = media.get("all", [])
    if not isinstance(all_items, list):
        return {}

    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in all_items:
        if not isinstance(item, dict):
            continue
        grouped.setdefault(str(item.get("type", "")), []).append(item)
    return grouped


def enrich_tweet_media(tweet: Tweet) -> None:
    missing_stream_media = [
        media
        for media in tweet.media
        if media.media_type in {"video", "animated_gif"} and not media.stream_url
    ]
    if not missing_stream_media:
        return

    payload = _fetch_fxtwitter_payload(tweet.link)
    if payload is None:
        return

    remote_by_type = _remote_media_by_type(payload)
    cursors: dict[str, int] = {}

    for media in missing_stream_media:
        remote_candidates = remote_by_type.get(media.media_type, [])
        cursor = cursors.get(media.media_type, 0)
        if cursor >= len(remote_candidates):
            continue

        remote_media = remote_candidates[cursor]
        cursors[media.media_type] = cursor + 1

        stream_url, stream_content_type = _pick_best_variant(remote_media)
        if stream_url:
            media.stream_url = stream_url
        if stream_content_type:
            media.stream_content_type = stream_content_type

        thumbnail_url = str(remote_media.get("thumbnail_url", "") or "")
        if thumbnail_url:
            media.url = thumbnail_url

        media.duration_millis = int(float(remote_media.get("duration", 0) or 0) * 1000)
        media.width = int(remote_media.get("width", 0) or 0)
        media.height = int(remote_media.get("height", 0) or 0)


def enrich_tweets_media(tweets: list[Tweet]) -> None:
    for tweet in tweets:
        enrich_tweet_media(tweet)
