from __future__ import annotations

import html
import json
import re
import time
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from .models import RedditComment, RedditListing, RedditPost

ATOM_NS = "{http://www.w3.org/2005/Atom}"
MEDIA_NS = "{http://search.yahoo.com/mrss/}"
IMG_SRC_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)
HREF_RE = re.compile(r"<a[^>]+href=[\"']([^\"']+)[\"']", re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")


def fetch_listing(
    url: str,
    user_agent: str,
    timeout_seconds: int,
    fetch_comments_enabled: bool,
    comment_timeout_seconds: int,
    top_level_comment_limit: int,
    reply_limit: int,
    max_comment_depth: int,
    listing_retry_count: int,
    comment_retry_count: int,
    request_delay_seconds: float,
    rss_only: bool = False,
) -> RedditListing:
    rss_url = _rss_url_from_listing_url(url)

    if rss_only:
        return _fetch_rss_listing(
            rss_url,
            original_url=url,
            user_agent=user_agent,
            timeout_seconds=timeout_seconds,
            retry_count=listing_retry_count,
            request_delay_seconds=request_delay_seconds,
        )

    try:
        payload = _load_json(
            url,
            user_agent=user_agent,
            timeout_seconds=timeout_seconds,
            retry_count=listing_retry_count,
            request_delay_seconds=request_delay_seconds,
        )
    except HTTPError as exc:
        if exc.code != 403:
            raise
        print(f"  Warning: JSON listing blocked with 403; using RSS fallback: {rss_url}")
        return _fetch_rss_listing(
            rss_url,
            original_url=url,
            user_agent=user_agent,
            timeout_seconds=timeout_seconds,
            retry_count=listing_retry_count,
            request_delay_seconds=request_delay_seconds,
        )

    listing = payload.get("data", {})
    children = listing.get("children", [])
    posts = [_normalize_post(index, child.get("data", {})) for index, child in enumerate(children, start=1)]
    if fetch_comments_enabled:
        for post in posts:
            if post.num_comments <= 0:
                continue
            try:
                post.comments = fetch_comments(
                    post.permalink,
                    user_agent=user_agent,
                    timeout_seconds=comment_timeout_seconds,
                    top_level_limit=top_level_comment_limit,
                    reply_limit=reply_limit,
                    max_depth=max_comment_depth,
                    retry_count=comment_retry_count,
                    request_delay_seconds=request_delay_seconds,
                )
            except Exception as exc:
                print(f"  Warning: comment fetch failed for {post.post_id}: {exc}")
    subreddit = posts[0].subreddit if posts else _subreddit_from_url(url)

    return RedditListing(
        subreddit=subreddit,
        listing_type="hot",
        source_url=url,
        fetched_at=_utc_now(),
        post_count=len(posts),
        posts=posts,
    )


def _fetch_rss_listing(
    rss_url: str,
    original_url: str,
    user_agent: str,
    timeout_seconds: int,
    retry_count: int,
    request_delay_seconds: float,
) -> RedditListing:
    payload = _load_bytes(
        rss_url,
        user_agent=user_agent,
        timeout_seconds=timeout_seconds,
        retry_count=retry_count,
        request_delay_seconds=request_delay_seconds,
        accept="application/atom+xml,application/xml,text/xml,*/*",
    )
    root = ET.fromstring(payload)
    subreddit = _subreddit_from_url(original_url)
    posts = [
        _normalize_rss_post(index, entry, subreddit)
        for index, entry in enumerate(root.findall(f"{ATOM_NS}entry"), start=1)
    ]
    return RedditListing(
        subreddit=subreddit,
        listing_type="hot-rss",
        source_url=rss_url,
        fetched_at=_utc_now(),
        post_count=len(posts),
        posts=posts,
    )


def _normalize_rss_post(rank: int, entry: ET.Element, subreddit: str) -> RedditPost:
    title = _entry_text(entry, "title")
    raw_id = _entry_text(entry, "id")
    permalink = _entry_link(entry)
    post_id = raw_id.removeprefix("t3_") or _post_id_from_permalink(permalink)
    content_html = _entry_text(entry, "content")
    author = _entry_author(entry)
    created_at = _entry_text(entry, "published") or _entry_text(entry, "updated")
    preview_images = [html.unescape(url) for url in IMG_SRC_RE.findall(content_html)]

    thumbnail = None
    thumbnail_element = entry.find(f"{MEDIA_NS}thumbnail")
    if thumbnail_element is not None:
        thumbnail = thumbnail_element.get("url")
        if thumbnail:
            thumbnail = html.unescape(thumbnail)
            preview_images.insert(0, thumbnail)

    preview_images = list(dict.fromkeys(url for url in preview_images if url))
    external_url = _rss_external_url(content_html, permalink)
    domain = urlparse(external_url or permalink).netloc
    excerpt = _html_to_text(content_html)

    return RedditPost(
        rank=rank,
        post_id=post_id,
        title=title.strip(),
        author=author,
        subreddit=subreddit,
        permalink=permalink,
        external_url=external_url,
        domain=domain,
        created_at=created_at,
        score=0,
        upvote_ratio=None,
        num_comments=0,
        is_self=False,
        is_video=False,
        post_hint=None,
        flair=None,
        over_18=False,
        excerpt=excerpt,
        selftext="",
        thumbnail=thumbnail,
        video_url=None,
        preview_images=preview_images,
    )


def _normalize_post(rank: int, data: dict) -> RedditPost:
    preview_images = []
    preview = data.get("preview") or {}
    for image in preview.get("images", []):
        source = image.get("source") or {}
        source_url = source.get("url")
        if source_url:
            preview_images.append(html.unescape(source_url))

    media_metadata = data.get("media_metadata") or {}
    for item in media_metadata.values():
        source = item.get("s") or {}
        source_url = source.get("u")
        if source_url:
            preview_images.append(html.unescape(source_url))

    preview_images = list(dict.fromkeys(preview_images))
    thumbnail = data.get("thumbnail")
    if thumbnail and not str(thumbnail).startswith("http"):
        thumbnail = None

    created_ts = data.get("created_utc")
    created_at = (
        datetime.fromtimestamp(created_ts, tz=UTC).isoformat()
        if created_ts
        else ""
    )

    selftext = (data.get("selftext") or "").strip()
    excerpt = selftext or data.get("url_overridden_by_dest") or data.get("url") or ""
    excerpt = " ".join(excerpt.split())

    reddit_video = ((data.get("media") or {}).get("reddit_video") or {})
    secure_media = ((data.get("secure_media") or {}).get("reddit_video") or {})
    video_url = reddit_video.get("fallback_url") or secure_media.get("fallback_url")

    return RedditPost(
        rank=rank,
        post_id=str(data.get("id", "")),
        title=str(data.get("title", "")).strip(),
        author=str(data.get("author", "")),
        subreddit=str(data.get("subreddit", "")),
        permalink="https://www.reddit.com" + str(data.get("permalink", "")),
        external_url=str(data.get("url_overridden_by_dest") or data.get("url") or ""),
        domain=str(data.get("domain", "")),
        created_at=created_at,
        score=int(data.get("score") or 0),
        upvote_ratio=data.get("upvote_ratio"),
        num_comments=int(data.get("num_comments") or 0),
        is_self=bool(data.get("is_self")),
        is_video=bool(data.get("is_video")),
        post_hint=data.get("post_hint"),
        flair=data.get("link_flair_text"),
        over_18=bool(data.get("over_18")),
        excerpt=excerpt,
        selftext=selftext,
        thumbnail=thumbnail,
        video_url=video_url,
        preview_images=preview_images,
    )


def fetch_comments(
    permalink: str,
    user_agent: str,
    timeout_seconds: int,
    top_level_limit: int,
    reply_limit: int,
    max_depth: int,
    retry_count: int,
    request_delay_seconds: float,
) -> list[RedditComment]:
    comments_url = permalink.rstrip("/") + f"/.json?limit={top_level_limit}"
    payload = _load_json(
        comments_url,
        user_agent=user_agent,
        timeout_seconds=timeout_seconds,
        retry_count=retry_count,
        request_delay_seconds=request_delay_seconds,
    )

    if not isinstance(payload, list) or len(payload) < 2:
        return []

    children = payload[1].get("data", {}).get("children", [])
    comments: list[RedditComment] = []
    for child in children:
        comment = _normalize_comment(child, reply_limit=reply_limit, max_depth=max_depth)
        if comment:
            comments.append(comment)
        if len(comments) >= top_level_limit:
            break
    return comments


def _normalize_comment(
    child: dict,
    reply_limit: int,
    max_depth: int,
) -> RedditComment | None:
    if child.get("kind") != "t1":
        return None

    data = child.get("data", {})
    if data.get("body") in (None, "[deleted]", "[removed]"):
        return None

    created_ts = data.get("created_utc")
    created_at = (
        datetime.fromtimestamp(created_ts, tz=UTC).isoformat()
        if created_ts
        else ""
    )

    replies: list[RedditComment] = []
    depth = int(data.get("depth") or 0)
    if depth + 1 < max_depth:
        reply_data = data.get("replies")
        if isinstance(reply_data, dict):
            reply_children = reply_data.get("data", {}).get("children", [])
            for reply_child in reply_children:
                reply = _normalize_comment(
                    reply_child,
                    reply_limit=reply_limit,
                    max_depth=max_depth,
                )
                if reply:
                    replies.append(reply)
                if len(replies) >= reply_limit:
                    break

    return RedditComment(
        comment_id=str(data.get("id", "")),
        author=str(data.get("author", "")),
        score=int(data.get("score") or 0),
        created_at=created_at,
        body=" ".join(str(data.get("body", "")).split()),
        depth=depth,
        parent_id=str(data.get("parent_id", "")),
        permalink="https://www.reddit.com" + str(data.get("permalink", "")),
        replies=replies,
    )


def _subreddit_from_url(url: str) -> str:
    path_parts = [part for part in urlparse(url).path.split("/") if part]
    if len(path_parts) >= 2 and path_parts[0] == "r":
        return path_parts[1]
    return "unknown"


def _rss_url_from_listing_url(url: str) -> str:
    parsed = urlparse(url)
    subreddit = _subreddit_from_url(url)
    query = parse_qs(parsed.query)
    limit = query.get("limit", ["25"])[0]
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc or "www.reddit.com"
    return f"{scheme}://{netloc}/r/{subreddit}/hot/.rss?limit={limit}"


def _entry_text(entry: ET.Element, name: str) -> str:
    child = entry.find(f"{ATOM_NS}{name}")
    if child is None or child.text is None:
        return ""
    return child.text.strip()


def _entry_author(entry: ET.Element) -> str:
    child = entry.find(f"{ATOM_NS}author/{ATOM_NS}name")
    if child is None or child.text is None:
        return ""
    return child.text.strip().removeprefix("/u/").removeprefix("u/")


def _entry_link(entry: ET.Element) -> str:
    fallback = ""
    for child in entry.findall(f"{ATOM_NS}link"):
        href = child.get("href") or ""
        if not href:
            continue
        if not fallback:
            fallback = href
        if child.get("rel", "alternate") == "alternate":
            return href
    return fallback


def _post_id_from_permalink(permalink: str) -> str:
    parts = [part for part in urlparse(permalink).path.split("/") if part]
    if "comments" in parts:
        idx = parts.index("comments")
        if idx + 1 < len(parts):
            return parts[idx + 1]
    return permalink.rstrip("/").rsplit("/", 1)[-1]


def _rss_external_url(content_html: str, permalink: str) -> str:
    for href in HREF_RE.findall(content_html):
        clean_href = html.unescape(href)
        parsed = urlparse(clean_href)
        if "reddit.com" in parsed.netloc:
            continue
        if parsed.scheme in {"http", "https"}:
            return clean_href
    return ""


def _html_to_text(content_html: str) -> str:
    text = re.sub(r"(?i)<br\s*/?>", "\n", content_html)
    text = TAG_RE.sub(" ", text)
    return SPACE_RE.sub(" ", html.unescape(text)).strip()


def _utc_now() -> str:
    return datetime.now(tz=UTC).isoformat()


def _load_json(
    url: str,
    user_agent: str,
    timeout_seconds: int,
    retry_count: int,
    request_delay_seconds: float,
):
    raw = _load_bytes(
        url,
        user_agent=user_agent,
        timeout_seconds=timeout_seconds,
        retry_count=retry_count,
        request_delay_seconds=request_delay_seconds,
        accept="application/json",
    )
    return json.loads(raw.decode("utf-8"))


def _load_bytes(
    url: str,
    user_agent: str,
    timeout_seconds: int,
    retry_count: int,
    request_delay_seconds: float,
    accept: str,
) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retry_count + 1):
        if request_delay_seconds > 0:
            time.sleep(request_delay_seconds)

        request = Request(
            url,
            headers={
                "User-Agent": user_agent,
                "Accept": accept,
            },
        )
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                return response.read()
        except HTTPError as exc:
            last_error = exc
            if exc.code == 429 and attempt < retry_count:
                wait_seconds = 5 * (attempt + 1)
                print(f"  Warning: 429 for {url}, retrying in {wait_seconds}s...")
                time.sleep(wait_seconds)
                continue
            raise
        except URLError as exc:
            last_error = exc
            if attempt < retry_count:
                wait_seconds = 2 * (attempt + 1)
                print(f"  Warning: request failed for {url}, retrying in {wait_seconds}s...")
                time.sleep(wait_seconds)
                continue
            raise

    if last_error:
        raise last_error
    raise RuntimeError(f"Request failed without an error: {url}")
