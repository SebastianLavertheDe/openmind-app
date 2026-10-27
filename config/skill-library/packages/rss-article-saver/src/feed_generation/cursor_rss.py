import asyncio
import os
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from feedgen.feed import FeedGenerator


class CursorRSSGenerator:
    def __init__(self):
        self.base_url = "https://cursor.com/blog"
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0"
        })

    def parse_date(self, date_text):
        """Parse date text and return a datetime object with timezone."""
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

        soup = BeautifulSoup(response.text, "html.parser")

        articles_data = []
        seen_urls = set()

        for card in soup.find_all("article"):
            article = self._extract_article_from_card(card, seen_urls)
            if article:
                articles_data.append(article)
                print(f"Found: {article['title']} ({article['date_text']})")

        articles_data.sort(key=lambda x: x["date"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return articles_data

    def _extract_article_from_card(self, card, seen_urls):
        link = self._find_article_link(card)
        if not link:
            return None

        url = link.get("href", "").strip()
        if url.startswith("/"):
            url = f"https://cursor.com{url}"

        if (
            not url
            or url in seen_urls
            or "/blog/" not in url
            or "/blog/topic/" in url
            or url.rstrip("/") == self.base_url
        ):
            return None

        title = self._extract_title(card)
        if not title:
            return None

        description = self._extract_excerpt(card) or title
        date_text = self._extract_date_text(card)
        if not date_text:
            return None

        seen_urls.add(url)
        return {
            "title": title,
            "url": url,
            "description": description,
            "date": self.parse_date(date_text),
            "date_text": date_text,
        }

    def _find_article_link(self, card):
        for link in card.find_all("a", href=True):
            href = link.get("href", "").strip()
            if href.startswith("/blog/") and "/blog/topic/" not in href:
                return link
        return None

    def _extract_title(self, card):
        paragraphs = card.find_all("p")
        if paragraphs:
            title = " ".join(paragraphs[0].get_text(" ", strip=True).split())
            if title:
                return title

        link = self._find_article_link(card)
        if link:
            text = " ".join(link.get_text(" ", strip=True).split())
            if text:
                return text
        return None

    def _extract_excerpt(self, card):
        paragraphs = card.find_all("p")
        if len(paragraphs) < 2:
            return None
        excerpt = " ".join(paragraphs[1].get_text(" ", strip=True).split())
        return excerpt or None

    def _extract_date_text(self, card):
        time_tag = card.find("time")
        if not time_tag:
            return None

        datetime_value = time_tag.get("datetime")
        if datetime_value:
            return datetime_value.strip()

        time_text = " ".join(time_tag.get_text(" ", strip=True).split())
        return time_text or None

    def create_feed(self):
        """Create a fresh feed instance."""
        feed = FeedGenerator()
        feed.title("Cursor Blog")
        feed.link(href=self.base_url, rel="alternate")
        feed.description("Latest posts from Cursor blog")
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
    generator = CursorRSSGenerator()
    articles_data = await generator.fetch_posts()
    rss_content = generator.generate_rss(articles_data)

    os.makedirs("rss", exist_ok=True)
    with open("rss/cursor_blog_rss.xml", "wb") as f:
        f.write(rss_content)

    print(f"RSS feed generated successfully with {len(articles_data)} articles!")


if __name__ == "__main__":
    asyncio.run(main())
