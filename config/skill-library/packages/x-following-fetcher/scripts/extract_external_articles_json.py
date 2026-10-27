#!/usr/bin/env python3
"""Small package-local external article extractor for X link enrichment."""

from __future__ import annotations

import contextlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor

import requests
import trafilatura
from bs4 import BeautifulSoup


def _fetch_html(url: str) -> str:
    downloaded = trafilatura.fetch_url(url)
    if downloaded:
        return downloaded
    response = requests.get(
        url,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0 (compatible; cctools-x-fetcher/1.0)"},
    )
    response.raise_for_status()
    return response.text


def _extract(url: str) -> dict[str, object]:
    try:
        html = _fetch_html(url)
        content = trafilatura.extract(html, include_links=True, include_images=True) or ""
        metadata = trafilatura.metadata.extract_metadata(html)
        title = str(getattr(metadata, "title", "") or "").strip() if metadata else ""
        author = str(getattr(metadata, "author", "") or "").strip() if metadata else ""
        published = str(getattr(metadata, "date", "") or "").strip() if metadata else ""
        if not title:
            soup = BeautifulSoup(html, "html.parser")
            og_title = soup.find("meta", property="og:title")
            title = str(og_title.get("content", "")).strip() if og_title else ""
            if not title and soup.title and soup.title.string:
                title = soup.title.string.strip()
        return {
            "url": url,
            "ok": bool(content.strip()),
            "title": title,
            "author": author,
            "published_date": published,
            "content": content,
            "images": [],
            "validation_blocked": False,
        }
    except Exception as exc:  # noqa: BLE001 - one failed URL must not abort the bundle
        return {"url": url, "ok": False, "content": "", "images": [], "error": str(exc)}


def main() -> int:
    urls = [item.strip() for item in sys.argv[1:] if item.strip()]
    if not urls:
        print("[]")
        return 0
    with contextlib.redirect_stdout(sys.stderr):
        workers = min(6, len(urls))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            records = list(pool.map(_extract, urls))
    json.dump(records, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
