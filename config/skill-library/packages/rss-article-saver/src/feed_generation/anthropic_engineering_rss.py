import asyncio
import os
import re
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from feedgen.feed import FeedGenerator


class AnthropicEngineeringRSSGenerator:
    def __init__(self):
        self.base_url = "https://www.anthropic.com/engineering"
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0"
        })
        self.date_patterns = [
            re.compile(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b"),
            re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b"),
        ]

    def parse_date(self, date_text):
        """Parse date text and return a datetime object with timezone."""
        if not date_text:
            return None
        try:
            parsed_date = date_parser.parse(
                date_text.strip(),
                tzinfos={"UT": timezone.utc, "UTC": timezone.utc},
            )
            if parsed_date.tzinfo is None:
                parsed_date = parsed_date.replace(tzinfo=timezone.utc)
            return parsed_date
        except Exception as e:
            print(f"Error parsing date '{date_text}': {e}")
            return None

    async def fetch_posts(self):
        response = self.session.get(self.base_url, timeout=30)
        response.raise_for_status()

        page_html = response.text
        soup = BeautifulSoup(page_html, "html.parser")

        articles_data = []
        seen_urls = set()

        for card in soup.find_all("article"):
            article = self._extract_article_from_card(
                card,
                seen_urls,
                page_html,
            )
            if article:
                articles_data.append(article)
                print(f"Found: {article['title']} ({article['date_text']})")

        articles_data.sort(key=lambda x: x["date"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return articles_data

    def _extract_article_from_card(self, card, seen_urls, page_html):
        article_links = self._find_article_links(card)
        if len(article_links) != 1:
            return None

        link = article_links[0]
        if not link:
            return None

        url = link.get("href", "").strip()
        if url.startswith("/"):
            url = f"https://www.anthropic.com{url}"

        if (
            not url
            or url in seen_urls
            or "/engineering/" not in url
            or url.rstrip("/") == self.base_url
        ):
            return None

        title = self._extract_title(card)
        if not title:
            return None

        description = self._extract_summary(card) or title
        date_text = self._extract_date_text(card)
        if not date_text:
            date_text = self._extract_published_on_from_page_html(url, page_html)
        # Another card's date is not this article's publication date.

        seen_urls.add(url)
        return {
            "title": title,
            "url": url,
            "description": description,
            "date": self.parse_date(date_text),
            "date_text": date_text,
        }

    def _find_article_links(self, card):
        article_links = []
        for link in card.find_all("a", href=True):
            href = link.get("href", "").strip()
            if href.startswith("/engineering/"):
                article_links.append(link)
        return article_links

    def _extract_title(self, card):
        heading = card.find(["h1", "h2", "h3"])
        if heading:
            return " ".join(heading.get_text(" ", strip=True).split())

        article_links = self._find_article_links(card)
        link = article_links[0] if article_links else None
        if link:
            text = " ".join(link.get_text(" ", strip=True).split())
            if text:
                return text
        return None

    def _extract_summary(self, card):
        summary = card.find("p")
        if not summary:
            return None
        text = " ".join(summary.get_text(" ", strip=True).split())
        return text or None

    def _extract_date_text(self, card):
        time_tag = card.find("time")
        if time_tag:
            datetime_value = time_tag.get("datetime")
            if datetime_value:
                return datetime_value.strip()
            time_text = " ".join(time_tag.get_text(" ", strip=True).split())
            if time_text:
                return time_text

        for tag in card.find_all(["div", "span", "p"]):
            classes = " ".join(tag.get("class", [])).lower()
            text = " ".join(tag.get_text(" ", strip=True).split())
            if "date" in classes and text:
                return text

        card_text = " ".join(card.get_text(" ", strip=True).split())
        return self._find_date_text(card_text)

    def _extract_published_on_from_page_html(self, url, page_html):
        slug = url.rstrip("/").split("/")[-1]
        pattern = re.compile(
            rf'{re.escape(slug)}.{{0,1500}}?"publishedOn":"([^"]+)"',
            re.DOTALL,
        )
        match = pattern.search(page_html)
        if match:
            return match.group(1)
        return None

    def _find_date_text(self, text):
        for pattern in self.date_patterns:
            match = pattern.search(text)
            if match:
                return match.group(0)
        return None

    def create_feed(self):
        """Create a fresh feed instance."""
        feed = FeedGenerator()
        feed.title("Anthropic Engineering Blog")
        feed.link(href=self.base_url, rel="alternate")
        feed.description("Latest posts from Anthropic Engineering blog")
        feed.language("en")
        return feed

    def generate_rss(self, articles_data):
        feed = self.create_feed()

        for article_data in articles_data:
            entry = feed.add_entry(order="append")
            entry.title(article_data["title"])
            entry.link(href=article_data["url"])
            entry.pubDate(article_data["date"])
            entry.description(article_data["description"])
            entry.guid(article_data["url"], permalink=True)

        return feed.rss_str(pretty=True)


async def main():
    generator = AnthropicEngineeringRSSGenerator()
    articles_data = await generator.fetch_posts()
    rss_content = generator.generate_rss(articles_data)

    os.makedirs("rss", exist_ok=True)
    with open("rss/anthropic_engineering_rss.xml", "wb") as f:
        f.write(rss_content)

    print(f"RSS feed generated successfully with {len(articles_data)} articles!")


if __name__ == "__main__":
    asyncio.run(main())
