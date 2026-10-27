#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
import trafilatura
from bs4 import BeautifulSoup

from src.managers.config_manager import RSSConfig
from src.managers.content_manager import ContentExtractor


def _fetch_html(url: str) -> str:
    downloaded = trafilatura.fetch_url(url)
    if downloaded:
        return downloaded

    response = requests.get(
        url,
        timeout=30,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36"
            )
        },
    )
    response.raise_for_status()
    return response.text


def _extract_metadata(url: str) -> dict[str, str]:
    html = _fetch_html(url)
    metadata = trafilatura.metadata.extract_metadata(html)

    title = ""
    author = ""
    published = ""
    if metadata:
        title = str(getattr(metadata, "title", "") or "").strip()
        author = str(getattr(metadata, "author", "") or "").strip()
        published = str(getattr(metadata, "date", "") or "").strip()

    if not title:
        soup = BeautifulSoup(html, "html.parser")
        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            title = og_title["content"].strip()
        elif soup.title and soup.title.string:
            title = soup.title.string.strip()
        else:
            h1 = soup.find("h1")
            if h1:
                title = h1.get_text(" ", strip=True)

    return {
        "title": title,
        "author": author,
        "published_date": published,
    }


def _build_extractor(skill_dir: Path) -> ContentExtractor:
    config_path = skill_dir / "config.yaml"
    config = RSSConfig(str(config_path))
    extractor = ContentExtractor(config.get_content_settings())
    return extractor


def _process_url(url: str, extractor: ContentExtractor) -> dict[str, object]:
    """Extract one URL. Safe to call from multiple worker threads.

    Notes on concurrency:
      - The non-WeChat path (trafilatura + requests + BeautifulSoup) uses only
        local state and is fully thread-safe.
      - The WeChat path opens its own `with sync_playwright()` per call, so each
        worker gets an independent Playwright instance; no instance is shared.
      - `extractor._last_wechat_fetch_at` is read-modified-write and therefore
        racy under threads, but the only consequence is a skipped sleep, which is
        acceptable for a read-only best-effort fetch.
    """
    try:
        extracted = extractor.extract_content(url)
        metadata = _extract_metadata(url)
        content = str(extracted.get("content") or "").strip()
        author = str(extracted.get("author") or metadata.get("author") or "").strip()
        return {
            "url": url,
            "ok": bool(content),
            "title": metadata.get("title", ""),
            "author": author,
            "published_date": metadata.get("published_date", ""),
            "content": content,
            "images": extracted.get("images") or [],
            "validation_blocked": bool(extracted.get("validation_blocked", False)),
        }
    except Exception as exc:
        return {
            "url": url,
            "ok": False,
            "title": "",
            "author": "",
            "published_date": "",
            "content": "",
            "images": [],
            "validation_blocked": False,
            "error": str(exc),
        }


def main() -> int:
    urls = [arg.strip() for arg in sys.argv[1:] if arg.strip()]
    if not urls:
        print("[]")
        return 0

    skill_dir = Path(__file__).resolve().parents[1]
    # 把 extract 期间所有 print（config/trafilatura/extract_content/_extract_metadata）统一导到
    # stderr，保持 stdout 干净给最终 JSON。单次 redirect（主线程）—— worker 线程共享 sys.stdout，
    # 不在 worker 内 redirect_stdout，避免多线程切换全局 sys.stdout 的 race 把日志漏进 stdout。
    with contextlib.redirect_stdout(sys.stderr):
        extractor = _build_extractor(skill_dir)

        # trafilatura fetch/extract is blocking IO, so a thread pool gives near-linear
        # speedup. Workers capped at 6 to keep host load sane; tasks beyond that queue.
        max_workers = min(6, len(urls)) if len(urls) > 1 else 1
        if max_workers <= 1:
            records = [_process_url(url, extractor) for url in urls]
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                records = list(executor.map(lambda u: _process_url(u, extractor), urls))

    json.dump(records, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
