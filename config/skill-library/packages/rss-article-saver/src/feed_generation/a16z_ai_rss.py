#!/usr/bin/env python3
"""Generate RSS for the visible All AI News & Content list on a16z."""

import argparse
import json
import sys
from datetime import timezone
from html import escape
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from feedgen.feed import FeedGenerator
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class A16zAIRSSGenerator:
    def __init__(self):
        self.base_url = "https://a16z.com/category/ai/"
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0"})
        self.session.mount("https://", HTTPAdapter(max_retries=Retry(
            total=2,
            backoff_factor=0.5,
            status_forcelist=[429, 500, 502, 503, 504],
        )))

    def fetch_html(self, url):
        response = self.session.get(url, timeout=30)
        response.raise_for_status()
        return response.text

    def parse_listing(self, html):
        soup = BeautifulSoup(html, "html.parser")
        listing = soup.select_one(
            '[data-feed-component="categories"][data-categories="ai"]'
        )
        if listing is None:
            raise ValueError("a16z All AI News & Content list was not found")

        # The server preloads more items than the browser initially displays.
        limit = int(listing.get("data-feed-count", "12"))
        if limit < 1:
            raise ValueError("a16z AI list has an invalid visible item count")

        articles = []
        seen_urls = set()
        for card in listing.select(".feed-component--list > [data-feed-item]"):
            link = card.select_one("h4 a[href]")
            if link is None:
                continue
            title = link.get_text(" ", strip=True)
            url = urljoin(self.base_url, link["href"])
            parsed_url = urlparse(url)
            if (not title or url in seen_urls
                    or parsed_url.scheme not in {"http", "https"}
                    or parsed_url.netloc != "a16z.com"):
                continue

            authors = card.select_one("h4 + div")
            articles.append({
                "title": title,
                "url": url,
                "authors": authors.get_text(" ", strip=True) if authors else "",
            })
            seen_urls.add(url)
            if len(articles) == limit:
                break

        if not articles:
            raise ValueError("a16z AI list contains no articles")
        return articles

    def parse_metadata(self, html):
        soup = BeautifulSoup(html, "html.parser")
        published = soup.select_one('meta[property="article:published_time"]')
        date_text = published.get("content") if published else None

        # Podcast pages expose their publication date only in JSON-LD.
        if not date_text:
            for script in soup.select('script[type="application/ld+json"]'):
                try:
                    data = json.loads(script.get_text())
                except (TypeError, ValueError):
                    continue
                nodes = data if isinstance(data, list) else [data]
                for node in nodes:
                    if isinstance(node, dict):
                        nodes_in_graph = node.get("@graph", [node])
                        for item in nodes_in_graph:
                            if isinstance(item, dict) and item.get("datePublished"):
                                date_text = item["datePublished"]
                                break
                    if date_text:
                        break
                if date_text:
                    break

        if not date_text:
            raise ValueError("Article has no publication date")
        published_at = date_parser.parse(date_text)
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)

        description = soup.select_one('meta[name="description"]')
        if description is None:
            description = soup.select_one('meta[property="og:description"]')
        return {
            "date": published_at,
            "description": description.get("content", "") if description else "",
        }

    def fetch_posts(self):
        articles = self.parse_listing(self.fetch_html(self.base_url))
        for article in articles:
            try:
                article.update(self.parse_metadata(self.fetch_html(article["url"])))
            except (requests.RequestException, ValueError) as exc:
                raise RuntimeError(f"Could not read {article['url']}: {exc}") from exc
            print(f"Found: {article['title']} ({article['date'].date()})")
        articles.sort(key=lambda article: article["date"], reverse=True)
        return articles

    def generate_rss(self, articles):
        if not articles:
            raise ValueError("Refusing to generate an empty a16z AI feed")
        feed = FeedGenerator()
        feed.load_extension("dc")
        feed.title("a16z AI News & Content")
        feed.link(href=self.base_url, rel="alternate")
        feed.description("Latest articles and podcast episodes from a16z's AI category")
        feed.language("en")
        for article in articles:
            entry = feed.add_entry(order="append")
            entry.title(article["title"])
            entry.link(href=article["url"])
            entry.guid(article["url"], permalink=True)
            entry.pubDate(article["date"])
            entry.description(escape(article["description"] or article["title"]))
            if article["authors"]:
                entry.dc.dc_creator(article["authors"])
        return feed.rss_str(pretty=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="a16z_ai_rss.xml", help="Filename in rss/")
    args = parser.parse_args()
    if not args.output or Path(args.output).name != args.output:
        parser.error("--output must be a filename in rss/")

    generator = A16zAIRSSGenerator()
    try:
        articles = generator.fetch_posts()
        content = generator.generate_rss(articles)
        output = Path("rss") / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_bytes(content)
        temporary.replace(output)
    except (requests.RequestException, ValueError, RuntimeError, OSError) as exc:
        print(f"Failed to generate a16z AI RSS: {exc}", file=sys.stderr)
        return 1
    finally:
        generator.session.close()
    print(f"RSS feed generated: {output} ({len(articles)} articles)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
