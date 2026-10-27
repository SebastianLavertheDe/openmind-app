#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import urlparse

from src.fetcher import fetch_comments


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch comments for a Reddit post URL")
    parser.add_argument("url", help="Full Reddit post URL")
    parser.add_argument("--user-agent", default="Mozilla/5.0 (compatible; reddit-fetcher-comments/0.1)")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--top-level-limit", type=int, default=20)
    parser.add_argument("--reply-limit", type=int, default=3)
    parser.add_argument("--max-depth", type=int, default=2)
    parser.add_argument("--retry-count", type=int, default=1)
    parser.add_argument("--request-delay", type=float, default=0.2)
    parser.add_argument("--output", help="Optional markdown output path")
    args = parser.parse_args()

    permalink = _normalize_permalink(args.url)
    comments = fetch_comments(
        permalink=permalink,
        user_agent=args.user_agent,
        timeout_seconds=args.timeout,
        top_level_limit=args.top_level_limit,
        reply_limit=args.reply_limit,
        max_depth=args.max_depth,
        retry_count=args.retry_count,
        request_delay_seconds=args.request_delay,
    )

    content = _render_markdown(args.url, comments)
    if args.output:
        output_path = Path(args.output).expanduser()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(content, encoding="utf-8")
        print(output_path)
    else:
        print(content, end="")
    return 0


def _normalize_permalink(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.netloc.endswith("reddit.com"):
        raise ValueError("Expected a reddit.com post URL")
    return f"https://www.reddit.com{parsed.path}"


def _render_markdown(url: str, comments) -> str:
    lines = [
        f"# Reddit Comments",
        "",
        f"- **帖子**: {url}",
        f"- **评论数**: {len(comments)}",
        "",
        "## 评论",
        "",
    ]
    lines.extend(_render_comments(comments))
    return "\n".join(lines).strip() + "\n"


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


if __name__ == "__main__":
    raise SystemExit(main())
