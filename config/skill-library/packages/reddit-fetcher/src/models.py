from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class RedditComment:
    comment_id: str
    author: str
    score: int
    created_at: str
    body: str
    depth: int
    parent_id: str
    permalink: str
    replies: list["RedditComment"] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RedditPost:
    rank: int
    post_id: str
    title: str
    author: str
    subreddit: str
    permalink: str
    external_url: str
    domain: str
    created_at: str
    score: int
    upvote_ratio: float | None
    num_comments: int
    is_self: bool
    is_video: bool
    post_hint: str | None
    flair: str | None
    over_18: bool
    excerpt: str
    selftext: str
    thumbnail: str | None
    video_url: str | None
    preview_images: list[str] = field(default_factory=list)
    comments: list[RedditComment] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RedditListing:
    subreddit: str
    listing_type: str
    source_url: str
    fetched_at: str
    post_count: int
    posts: list[RedditPost]

    def to_dict(self) -> dict:
        data = asdict(self)
        data["posts"] = [post.to_dict() for post in self.posts]
        return data
