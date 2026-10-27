from __future__ import annotations

import html

from ..config import RenderConfig
from ..models import EmbeddedTweet, Tweet
from .content import build_title, normalize_embedded_content, normalize_tweet_content


def _render_embedded_tweet(
    section_title: str,
    embedded: EmbeddedTweet,
    *,
    expand_urls: bool,
) -> list[str]:
    lines = [f"{section_title}\n"]
    author_line = embedded.author_name
    if embedded.author_screen_name:
        author_line = f"{author_line} (@{embedded.author_screen_name})".strip()
    if author_line:
        lines.append(f"- **作者**: {author_line}")
    if embedded.link:
        lines.append(f"- **链接**: {embedded.link}")
    lines.append("")
    normalized_content = normalize_embedded_content(embedded, expand_urls)
    if normalized_content:
        lines.append(normalized_content)
        lines.append("")
    return lines


def render_tweet_markdown(tweet: Tweet, config: RenderConfig) -> str:
    content = normalize_tweet_content(tweet, config.expand_urls)
    title = build_title(tweet.title, content, config.title_max_length)
    lines: list[str] = []

    if title:
        lines.append(f"# {title}\n")

    lines.append("## 元数据\n")
    lines.append(f"- **链接**: {tweet.link}")
    lines.append(f"- **作者**: {tweet.author.name} (@{tweet.author.screen_name})")
    lines.append(f"- **发布时间**: {tweet.created_at}")
    lines.append(f"- **保存时间**: {tweet.fetched_at}")
    lines.append(f"- **来源**: {tweet.source}")
    lines.append(f"- **ID**: {tweet.tweet_id}")
    if tweet.is_retweet:
        lines.append("- **类型**: Retweet")
        if tweet.retweeted_tweet and tweet.retweeted_tweet.author_screen_name:
            lines.append(
                f"- **转推自**: {tweet.retweeted_tweet.author_name} (@{tweet.retweeted_tweet.author_screen_name})"
            )
    if tweet.quoted_tweet_id:
        lines.append(f"- **引用推文ID**: {tweet.quoted_tweet_id}")
    lines.append("")

    if config.include_images:
        image_urls = [media.url for media in tweet.media if media.media_type == "photo"]
        if image_urls:
            lines.append("## 图片\n")
            for image_url in image_urls:
                lines.append(f"![]({image_url})")
            lines.append("")

    other_media = [media for media in tweet.media if media.media_type != "photo"]
    if other_media:
        lines.append("## 媒体\n")
        for media in other_media:
            target = media.expanded_url or media.url
            label = media.display_url or target
            lines.append(f"- **{media.media_type}**: {label}")
            if target and target != label:
                lines.append(f"  {target}")
        lines.append("")

    if content:
        lines.append("## 正文\n")
        lines.append(content)
        lines.append("")

    if config.include_quotes and tweet.quoted_tweet:
        quoted_content = html.unescape(tweet.quoted_tweet.content).strip()
        embedded = EmbeddedTweet(
            tweet_id=tweet.quoted_tweet.tweet_id,
            author_name=tweet.quoted_tweet.author_name,
            author_screen_name=tweet.quoted_tweet.author_screen_name,
            content=quoted_content,
            link=tweet.quoted_tweet.link,
            url_entities=tweet.quoted_tweet.url_entities,
        )
        lines.extend(
            _render_embedded_tweet(
                "## 引用内容",
                embedded,
                expand_urls=config.expand_urls,
            )
        )

    if config.include_metrics:
        lines.append("## 互动数据\n")
        lines.append(f"- 👍 点赞: {tweet.metrics.likes}")
        lines.append(f"- 🔄 转发: {tweet.metrics.reposts}")
        lines.append(f"- 💬 回复: {tweet.metrics.replies}")
        lines.append(f"- 📎 引用: {tweet.metrics.quotes}")
        lines.append("")

    lines.append("---")
    lines.append(f"\n[查看原推]({tweet.link})\n")
    return "\n".join(lines)


def render_external_link_tweet_article_markdown(
    tweet: Tweet,
    article: dict[str, object],
    *,
    article_url: str,
) -> str:
    title = str(article.get("title") or "").strip()
    content = str(article.get("content") or "").strip()
    author = str(article.get("author") or "").strip()
    published_date = str(article.get("published_date") or "").strip()
    lines: list[str] = []

    if title:
        lines.append(f"# {title}\n")

    lines.append("## 元数据\n")
    lines.append(f"- **链接**: {article_url}")
    lines.append(f"- **作者**: {author}")
    lines.append(f"- **来源推文**: {tweet.link}")
    lines.append(f"- **推文作者**: {tweet.author.name} (@{tweet.author.screen_name})")
    lines.append(f"- **发布时间**: {published_date}")
    lines.append(f"- **保存时间**: {tweet.fetched_at}")
    lines.append(f"- **来源**: {tweet.source}")
    lines.append(f"- **ID**: {tweet.tweet_id}")
    lines.append("")

    if content:
        lines.append("## 正文\n")
        lines.append(content)
        lines.append("")

    lines.append("---")
    lines.append(f"\n[查看原推]({tweet.link})\n")
    return "\n".join(lines)
