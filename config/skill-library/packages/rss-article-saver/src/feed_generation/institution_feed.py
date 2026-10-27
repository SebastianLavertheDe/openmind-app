"""Shared fetching, dates, and RSS output for institution news feeds."""

import argparse
import json
import re
import sys
from datetime import timezone
from html import escape, unescape
from pathlib import Path
from urllib.parse import urlparse

import feedparser
import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from feedgen.feed import FeedGenerator
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


AI_PATTERN = re.compile(
    r"\b(?:AI|artificial intelligence|machine learning|deep learning|generative AI|"
    r"LLMs?|large language models?|foundation models?|reinforcement learning|"
    r"neural networks?|agentic|OpenAI|Anthropic|ChatGPT|GPT-?\d|Claude)\b",
    re.IGNORECASE,
)


def plain_text(value):
    return " ".join(BeautifulSoup(value or "", "html.parser").get_text(" ", strip=True).split())


def is_ai(*values):
    return True  # Relevance is selected downstream using the user preference snapshot.


def parse_date(value):
    if not value:
        raise ValueError("Missing publication date")
    date = date_parser.parse(value)
    return date if date.tzinfo else date.replace(tzinfo=timezone.utc)


def next_page_props(html):
    node = BeautifulSoup(html, "html.parser").select_one("#__NEXT_DATA__")
    if node is None:
        raise ValueError("Page data was not found")
    return json.loads(node.get_text())["props"]["pageProps"]


def next_flight_data(html):
    """Decode JSON string chunks without executing the website's JavaScript."""
    chunks = []
    decoder = json.JSONDecoder()
    for script in BeautifulSoup(html, "html.parser").find_all("script"):
        text = script.get_text()
        for match in re.finditer(r"self\.__next_f\.push\(", text):
            value, _ = decoder.raw_decode(text[match.end():])
            if len(value) > 1 and isinstance(value[1], str):
                chunks.append(value[1])
    if not chunks:
        raise ValueError("Page data was not found")
    return "".join(chunks)


class InstitutionFeed:
    limit = 30

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })
        self.session.mount("https://", HTTPAdapter(max_retries=Retry(
            total=2, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504],
        )))

    def get(self, url, **kwargs):
        response = self.session.get(url, timeout=30, **kwargs)
        response.raise_for_status()
        return response

    def generate_rss(self, articles):
        articles = sorted(articles, key=lambda article: article["date"], reverse=True)
        unique = {}
        for article in articles:
            url = article["url"]
            parsed_url = urlparse(url)
            if parsed_url.scheme not in {"https", "http"} or not parsed_url.netloc:
                raise ValueError(f"Invalid article URL: {url}")
            if not article["title"] or article["date"].tzinfo is None:
                raise ValueError(f"Missing title or timezone: {url}")
            unique.setdefault(url, article)
        articles = list(unique.values())[:self.limit]
        if not articles:
            raise ValueError("Refusing to replace the feed with an empty result")

        feed = FeedGenerator()
        feed.load_extension("dc")
        feed.title(self.title)
        feed.link(href=self.base_url, rel="alternate")
        feed.description(self.description)
        feed.language("en")
        for article in articles:
            entry = feed.add_entry(order="append")
            entry.title(unescape(article["title"]))
            entry.link(href=article["url"])
            entry.guid(article["url"], permalink=True)
            entry.pubDate(article["date"])
            entry.description(escape(plain_text(article.get("description") or article["title"])))
            if article.get("authors"):
                entry.dc.dc_creator(unescape(article["authors"]))
        return feed.rss_str(pretty=True), len(articles)


class FilteredRSSFeed(InstitutionFeed):
    required_tag = None

    def fetch_posts(self):
        parsed = feedparser.parse(self.get(self.rss_url).content)
        if not parsed.version or parsed.bozo:
            raise ValueError(f"Invalid upstream RSS: {parsed.get('bozo_exception', 'not a feed')}")
        articles = []
        for entry in parsed.entries:
            title = entry.get("title", "")
            description = entry.get("summary", "")
            tags = [tag.get("term", "").lower() for tag in entry.get("tags", [])]
            if self.required_tag:
                if self.required_tag not in tags:
                    continue
            elif not is_ai(title, description, " ".join(tags)):
                continue
            articles.append({
                "title": title,
                "url": entry["link"],
                "date": parse_date(entry.get("published")),
                "description": description,
                "authors": entry.get("author", ""),
            })
        return articles


def run(generator_class):
    parser = argparse.ArgumentParser(description=generator_class.description)
    parser.add_argument("--output", default=generator_class.output_file, help="Filename in rss/")
    args = parser.parse_args()
    if not args.output or Path(args.output).name != args.output:
        parser.error("--output must be a filename in rss/")
    generator = generator_class()
    try:
        content, count = generator.generate_rss(generator.fetch_posts())
        output = Path("rss") / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_bytes(content)
        temporary.replace(output)
        print(f"RSS generated: {output} ({count} articles)")
        return 0
    except (requests.RequestException, ValueError, KeyError, RuntimeError, OSError) as exc:
        print(f"Failed to generate {generator.title}: {exc}", file=sys.stderr)
        return 1
    finally:
        generator.session.close()
