from __future__ import annotations

from pathlib import Path

from .config import StorageConfig
from .models import RedditListing, RedditPost


def write_subreddit_markdown(
    listing: RedditListing,
    storage: StorageConfig,
    date_str: str,
    append: bool = False,
) -> Path:
    day_dir = storage.output_dir / date_str
    day_dir.mkdir(parents=True, exist_ok=True)

    md_path = day_dir / f"{listing.subreddit}.md"
    if append and md_path.exists():
        total_count = _count_existing_posts(md_path) + len(listing.posts)
        _update_header(md_path, listing, total_count)
        with open(md_path, "a", encoding="utf-8") as handle:
            handle.write("\n".join(_render_post_sections(listing.posts)).strip() + "\n")
    else:
        with open(md_path, "w", encoding="utf-8") as handle:
            handle.write(_render_listing_markdown(listing))

    return md_path


def _render_listing_markdown(listing: RedditListing) -> str:
    lines = [
        f"# r/{listing.subreddit} Hot Posts",
        "",
        f"- **抓取时间**: {listing.fetched_at}",
        f"- **来源**: {listing.source_url}",
        f"- **帖子数量**: {listing.post_count}",
        "",
    ]

    lines.extend(_render_post_sections(listing.posts))
    return "\n".join(lines).strip() + "\n"


def _render_post_sections(posts: list[RedditPost]) -> list[str]:
    lines: list[str] = []
    for post in posts:
        lines.extend(
            [
                f"## {post.rank}. {post.title}",
                "",
                "### 元数据",
                "",
                f"- **作者**: u/{post.author}",
                f"- **分数**: {post.score}",
                f"- **评论数**: {post.num_comments}",
                f"- **发布时间**: {post.created_at}",
                f"- **Reddit 链接**: {post.permalink}",
                f"- **外链**: {post.external_url}" if post.external_url else "- **外链**: 无",
                f"- **域名**: {post.domain}",
                f"- **类型**: {_post_type(post)}",
                f"- **NSFW**: {'yes' if post.over_18 else 'no'}",
            ]
        )

        if post.flair:
            lines.append(f"- **Flair**: {post.flair}")
        if post.upvote_ratio is not None:
            lines.append(f"- **Upvote Ratio**: {post.upvote_ratio}")
        if post.thumbnail:
            lines.append(f"- **Thumbnail**: {post.thumbnail}")
        if post.video_url:
            lines.append(f"- **Video**: {post.video_url}")

        lines.extend(["", "### 正文", ""])
        if post.selftext:
            lines.append(post.selftext)
        elif post.excerpt:
            lines.append(post.excerpt)
        else:
            lines.append("_无正文_")

        if post.preview_images:
            lines.extend(["", "### 图片", ""])
            for url in post.preview_images:
                lines.append(f"- {url}")

        if post.comments:
            lines.extend(["", "### 评论", ""])
            lines.extend(_render_comments(post.comments))

        lines.extend(["", "---", ""])

    return lines


def _post_type(post) -> str:
    if post.is_video:
        return "video"
    if post.is_self:
        return "self"
    if post.post_hint:
        return post.post_hint
    return "link"


def _count_existing_posts(md_path: Path) -> int:
    try:
        count = 0
        with open(md_path, "r", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("## "):
                    count += 1
        return count
    except Exception:
        return 0


def _update_header(md_path: Path, listing: RedditListing, total_count: int) -> None:
    with open(md_path, "r", encoding="utf-8") as handle:
        lines = handle.readlines()

    for idx, line in enumerate(lines):
        if line.startswith("- **抓取时间**:"):
            lines[idx] = f"- **抓取时间**: {listing.fetched_at}\n"
        elif line.startswith("- **来源**:"):
            lines[idx] = f"- **来源**: {listing.source_url}\n"
        elif line.startswith("- **帖子数量**:"):
            lines[idx] = f"- **帖子数量**: {total_count}\n"

    with open(md_path, "w", encoding="utf-8") as handle:
        handle.writelines(lines)


def _render_comments(comments, indent: int = 0) -> list[str]:
    lines: list[str] = []
    prefix = "  " * indent
    for comment in comments:
        lines.extend(
            [
                f"{prefix}- u/{comment.author} | +{comment.score} | {comment.created_at}",
                f"{prefix}  {comment.body}",
            ]
        )
        if comment.replies:
            lines.extend(_render_comments(comment.replies, indent=indent + 1))
        lines.append("")
    return lines
