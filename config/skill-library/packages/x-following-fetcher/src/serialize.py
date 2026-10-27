from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .models import Author, EmbeddedTweet, Media, Tweet, TweetMetrics, UrlEntity


def tweet_to_dict(tweet: Tweet) -> dict[str, Any]:
    return asdict(tweet)


def tweet_from_dict(data: dict[str, Any]) -> Tweet:
    author_data = data.get("author", {})
    media_data = data.get("media", [])
    url_entity_data = data.get("url_entities", [])
    metrics_data = data.get("metrics", {})

    quoted_data = data.get("quoted_tweet")
    retweeted_data = data.get("retweeted_tweet")

    def build_embedded(payload: dict[str, Any] | None) -> EmbeddedTweet | None:
        if not isinstance(payload, dict):
            return None
        return EmbeddedTweet(
            tweet_id=str(payload.get("tweet_id", "")),
            author_name=str(payload.get("author_name", "")),
            author_screen_name=str(payload.get("author_screen_name", "")),
            content=str(payload.get("content", "")),
            link=str(payload.get("link", "")),
            url_entities=[
                UrlEntity(
                    url=str(entity.get("url", "")),
                    expanded_url=str(entity.get("expanded_url", "")),
                    display_url=str(entity.get("display_url", "")),
                    is_media=bool(entity.get("is_media", False)),
                )
                for entity in payload.get("url_entities", [])
                if isinstance(entity, dict)
            ],
        )

    return Tweet(
        tweet_id=str(data.get("tweet_id", "")),
        author=Author(
            name=str(author_data.get("name", "")),
            screen_name=str(author_data.get("screen_name", "")),
            verified=bool(author_data.get("verified", False)),
            profile_image_url=str(author_data.get("profile_image_url", "")),
        ),
        content=str(data.get("content", "")),
        created_at=str(data.get("created_at", "")),
        link=str(data.get("link", "")),
        source=str(data.get("source", "x.com")),
        lang=str(data.get("lang", "")),
        title=str(data.get("title", "")),
        fetched_at=str(data.get("fetched_at", "")),
        media=[
            Media(
                media_type=str(item.get("media_type", "")),
                url=str(item.get("url", "")),
                expanded_url=str(item.get("expanded_url", "")),
                display_url=str(item.get("display_url", "")),
                stream_url=str(item.get("stream_url", "")),
                stream_content_type=str(item.get("stream_content_type", "")),
                duration_millis=int(item.get("duration_millis", 0) or 0),
                width=int(item.get("width", 0) or 0),
                height=int(item.get("height", 0) or 0),
                local_path=str(item.get("local_path", "")),
            )
            for item in media_data
            if isinstance(item, dict)
        ],
        url_entities=[
            UrlEntity(
                url=str(item.get("url", "")),
                expanded_url=str(item.get("expanded_url", "")),
                display_url=str(item.get("display_url", "")),
                is_media=bool(item.get("is_media", False)),
            )
            for item in url_entity_data
            if isinstance(item, dict)
        ],
        metrics=TweetMetrics(
            likes=int(metrics_data.get("likes", 0) or 0),
            reposts=int(metrics_data.get("reposts", 0) or 0),
            replies=int(metrics_data.get("replies", 0) or 0),
            quotes=int(metrics_data.get("quotes", 0) or 0),
            bookmarks=int(metrics_data.get("bookmarks", 0) or 0),
        ),
        is_retweet=bool(data.get("is_retweet", False)),
        quoted_tweet_id=str(data.get("quoted_tweet_id", "")),
        quoted_tweet=build_embedded(quoted_data),
        retweeted_tweet=build_embedded(retweeted_data),
    )
