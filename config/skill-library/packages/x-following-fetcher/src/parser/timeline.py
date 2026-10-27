from __future__ import annotations

from datetime import datetime
from typing import Any

from ..models import Author, EmbeddedTweet, Media, Tweet, TweetMetrics, UrlEntity

_PREFERRED_VIDEO_MAX_BITRATE = 1_200_000


def _parse_twitter_date(twitter_date: str) -> str:
    try:
        dt = datetime.strptime(twitter_date, "%a %b %d %H:%M:%S %z %Y")
        return dt.isoformat()
    except Exception:
        return twitter_date


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _nested_tweet_result(result: dict[str, Any]) -> dict[str, Any]:
    return _as_dict(result.get("tweet"))


def _extract_note_tweet_result(result: dict[str, Any]) -> dict[str, Any]:
    note_tweet = _as_dict(result.get("note_tweet"))
    note_results = _as_dict(note_tweet.get("note_tweet_results"))
    return _as_dict(note_results.get("result"))


def _extract_user(result: dict[str, Any]) -> Author:
    core = _as_dict(result.get("core"))
    if not core:
        core = _as_dict(_nested_tweet_result(result).get("core"))

    user_results = _as_dict(core.get("user_results")).get("result")
    user_result = _as_dict(user_results)
    user_core = _as_dict(user_result.get("core"))
    user_legacy = _as_dict(user_result.get("legacy"))
    user = user_core or user_legacy
    avatar = _as_dict(user_result.get("avatar"))

    return Author(
        name=str(user.get("name", "")),
        screen_name=str(user.get("screen_name", "")),
        verified=bool(user_result.get("is_blue_verified", False)),
        profile_image_url=str(avatar.get("image_url", "")),
    )


def _pick_preferred_variant(variants: list[Any]) -> dict[str, Any]:
    mp4_variants = [
        _as_dict(variant)
        for variant in variants
        if _as_dict(variant).get("content_type") == "video/mp4"
        and _as_dict(variant).get("url")
    ]
    if mp4_variants:
        capped_variants = [
            variant
            for variant in mp4_variants
            if int(variant.get("bitrate", 0) or 0) <= _PREFERRED_VIDEO_MAX_BITRATE
        ]
        if capped_variants:
            return max(capped_variants, key=lambda variant: int(variant.get("bitrate", 0) or 0))
        return min(mp4_variants, key=lambda variant: int(variant.get("bitrate", 0) or 0))

    for variant in variants:
        variant_dict = _as_dict(variant)
        if variant_dict.get("url"):
            return variant_dict
    return {}


def _extract_media(legacy: dict[str, Any]) -> list[Media]:
    extended_entities = _as_dict(legacy.get("extended_entities"))
    media_items = extended_entities.get("media", [])
    if not isinstance(media_items, list):
        return []

    media: list[Media] = []
    for item in media_items:
        item_dict = _as_dict(item)
        url = str(item_dict.get("media_url_https") or item_dict.get("media_url") or "")
        if not url:
            continue
        video_info = _as_dict(item_dict.get("video_info"))
        variants = video_info.get("variants", [])
        best_variant: dict[str, Any] = {}
        if isinstance(variants, list):
            best_variant = _pick_preferred_variant(variants)

        original_info = _as_dict(item_dict.get("original_info"))
        media.append(
            Media(
                media_type=str(item_dict.get("type", "unknown")),
                url=url,
                expanded_url=str(item_dict.get("expanded_url", "")),
                display_url=str(item_dict.get("display_url", "")),
                stream_url=str(best_variant.get("url", "")),
                stream_content_type=str(best_variant.get("content_type", "")),
                duration_millis=int(video_info.get("duration_millis", 0) or 0),
                width=int(original_info.get("width", 0) or 0),
                height=int(original_info.get("height", 0) or 0),
            )
        )
    return media


def _extract_legacy(result: dict[str, Any]) -> dict[str, Any]:
    legacy = _as_dict(result.get("legacy"))
    if legacy:
        return legacy

    tweet = _nested_tweet_result(result)
    return _as_dict(tweet.get("legacy"))


def _extract_url_entities(legacy: dict[str, Any], note_result: dict[str, Any]) -> list[UrlEntity]:
    entity_sources: list[dict[str, Any]] = []
    entities = _as_dict(legacy.get("entities"))
    entity_sources.extend(entity for entity in entities.get("urls", []) if isinstance(entity, dict))

    note_entity_set = _as_dict(note_result.get("entity_set"))
    entity_sources.extend(entity for entity in note_entity_set.get("urls", []) if isinstance(entity, dict))

    media_entities = entities.get("media", [])
    entity_sources.extend(
        {
            "url": media.get("url", ""),
            "expanded_url": media.get("expanded_url", ""),
            "display_url": media.get("display_url", ""),
            "is_media": True,
        }
        for media in media_entities
        if isinstance(media, dict)
    )

    seen: set[str] = set()
    url_entities: list[UrlEntity] = []
    for entity in entity_sources:
        url = str(entity.get("url", ""))
        if not url or url in seen:
            continue
        seen.add(url)
        url_entities.append(
            UrlEntity(
                url=url,
                expanded_url=str(entity.get("expanded_url", "")),
                display_url=str(entity.get("display_url", "")),
                is_media=bool(entity.get("is_media", False)),
            )
        )
    return url_entities


def _extract_embedded_tweet(result: dict[str, Any]) -> EmbeddedTweet | None:
    embedded_legacy = _extract_legacy(result)
    if not embedded_legacy:
        return None

    author = _extract_user(result)
    tweet_id = str(embedded_legacy.get("id_str", ""))
    if not tweet_id:
        return None

    note_result = _extract_note_tweet_result(result)
    content = str(note_result.get("text") or embedded_legacy.get("full_text", ""))
    link = (
        f"https://x.com/{author.screen_name}/status/{tweet_id}"
        if author.screen_name
        else ""
    )
    return EmbeddedTweet(
        tweet_id=tweet_id,
        author_name=author.name,
        author_screen_name=author.screen_name,
        content=content,
        link=link,
        url_entities=_extract_url_entities(embedded_legacy, note_result),
    )


def _extract_quoted_tweet(result: dict[str, Any]) -> EmbeddedTweet | None:
    quoted_status_result = _as_dict(result.get("quoted_status_result")).get("result")
    return _extract_embedded_tweet(_as_dict(quoted_status_result))


def _extract_retweeted_tweet(legacy: dict[str, Any]) -> EmbeddedTweet | None:
    retweeted_status_result = _as_dict(legacy.get("retweeted_status_result")).get("result")
    return _extract_embedded_tweet(_as_dict(retweeted_status_result))


def _extract_tweet(result: dict[str, Any]) -> Tweet | None:
    typename = result.get("__typename")
    if typename == "TweetTombstone":
        return None

    legacy = _extract_legacy(result)
    if not legacy:
        return None

    author = _extract_user(result)
    tweet_id = str(legacy.get("id_str", ""))
    if not tweet_id:
        return None

    link = (
        f"https://x.com/{author.screen_name}/status/{tweet_id}"
        if author.screen_name
        else ""
    )

    note_result = _extract_note_tweet_result(result)
    quoted_tweet = _extract_quoted_tweet(result)
    retweeted_tweet = _extract_retweeted_tweet(legacy)
    content = str(note_result.get("text") or legacy.get("full_text", ""))
    url_entities = _extract_url_entities(legacy, note_result)

    return Tweet(
        tweet_id=tweet_id,
        author=author,
        content=content,
        created_at=_parse_twitter_date(str(legacy.get("created_at", ""))),
        link=link,
        source="x.com",
        lang=str(legacy.get("lang", "")),
        media=_extract_media(legacy),
        url_entities=url_entities,
        metrics=TweetMetrics(
            likes=int(legacy.get("favorite_count", 0) or 0),
            reposts=int(legacy.get("retweet_count", 0) or 0),
            replies=int(legacy.get("reply_count", 0) or 0),
            quotes=int(legacy.get("quote_count", 0) or 0),
            bookmarks=int(legacy.get("bookmark_count", 0) or 0),
        ),
        is_retweet=retweeted_tweet is not None or bool(
            legacy.get("retweeted", False) or str(legacy.get("full_text", "")).startswith("RT @")
        ),
        quoted_tweet_id=quoted_tweet.tweet_id if quoted_tweet else "",
        quoted_tweet=quoted_tweet,
        retweeted_tweet=retweeted_tweet,
    )


def parse_timeline_payload(payload: dict[str, Any], *, include_promoted: bool = False) -> list[Tweet]:
    instructions = (
        _as_dict(payload.get("data"))
        .get("home", {})
        .get("home_timeline_urt", {})
        .get("instructions", [])
    )
    if not isinstance(instructions, list):
        return []

    tweets: list[Tweet] = []
    seen_ids: set[str] = set()

    for instruction in instructions:
        instruction_dict = _as_dict(instruction)
        if instruction_dict.get("type") != "TimelineAddEntries":
            continue

        entries = instruction_dict.get("entries", [])
        if not isinstance(entries, list):
            continue

        for entry in entries:
            entry_dict = _as_dict(entry)
            content = _as_dict(entry_dict.get("content"))
            if content.get("__typename") != "TimelineTimelineItem":
                continue

            item_content = _as_dict(content.get("itemContent"))
            if not include_promoted and (
                content.get("promotedMetadata") or item_content.get("promotedMetadata")
            ):
                continue
            tweet_results = _as_dict(item_content.get("tweet_results"))
            result = _as_dict(tweet_results.get("result"))
            tweet = _extract_tweet(result)

            if tweet is None or tweet.tweet_id in seen_ids:
                continue

            seen_ids.add(tweet.tweet_id)
            tweets.append(tweet)

    return tweets
