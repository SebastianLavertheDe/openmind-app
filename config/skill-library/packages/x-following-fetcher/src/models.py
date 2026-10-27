from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class Author:
    name: str = ""
    screen_name: str = ""
    verified: bool = False
    profile_image_url: str = ""


@dataclass(slots=True)
class Media:
    media_type: str
    url: str
    expanded_url: str = ""
    display_url: str = ""
    stream_url: str = ""
    stream_content_type: str = ""
    duration_millis: int = 0
    width: int = 0
    height: int = 0
    local_path: str = ""


@dataclass(slots=True)
class UrlEntity:
    url: str
    expanded_url: str = ""
    display_url: str = ""
    is_media: bool = False


@dataclass(slots=True)
class EmbeddedTweet:
    tweet_id: str = ""
    author_name: str = ""
    author_screen_name: str = ""
    content: str = ""
    link: str = ""
    url_entities: list[UrlEntity] = field(default_factory=list)


@dataclass(slots=True)
class TweetMetrics:
    likes: int = 0
    reposts: int = 0
    replies: int = 0
    quotes: int = 0
    bookmarks: int = 0


@dataclass(slots=True)
class Tweet:
    tweet_id: str
    author: Author
    content: str
    created_at: str
    link: str
    source: str = "x.com"
    lang: str = ""
    title: str = ""
    fetched_at: str = ""
    media: list[Media] = field(default_factory=list)
    url_entities: list[UrlEntity] = field(default_factory=list)
    metrics: TweetMetrics = field(default_factory=TweetMetrics)
    is_retweet: bool = False
    quoted_tweet_id: str = ""
    quoted_tweet: EmbeddedTweet | None = None
    retweeted_tweet: EmbeddedTweet | None = None

    def to_cache_record(self, output_path: str) -> dict[str, str | bool]:
        return {
            "tweet_id": self.tweet_id,
            "screen_name": self.author.screen_name,
            "created_at": self.created_at,
            "fetched_at": self.fetched_at,
            "output_path": output_path,
            "is_retweet": self.is_retweet,
        }
