import asyncio
import os
import re
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
from feedgen.feed import FeedGenerator


class GwernRSSGenerator:
    def __init__(self):
        self.base_url = "https://gwern.net"
        self.blog_newest_url = f"{self.base_url}/blog/newest"
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0"
        })

    async def fetch_posts(self):
        response = self.session.get(self.blog_newest_url, timeout=30)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        articles_data = []
        seen_urls = set()

        for li in soup.find_all("li"):
            link = li.find("a", href=True)
            if not link:
                continue

            href = link.get("href", "").strip()
            if not re.match(r"/blog/\d{4}/", href):
                continue

            url = f"{self.base_url}{href}"
            if url in seen_urls:
                continue

            title = " ".join(link.get_text(" ", strip=True).split())
            if not title:
                continue

            date, description = self._fetch_post_metadata(url)

            seen_urls.add(url)
            articles_data.append({
                "title": title,
                "url": url,
                "description": description or title,
                "date": date,
            })
            print(f"Found: {title} ({date})")

        articles_data.sort(key=lambda x: x["date"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return articles_data

    def _fetch_post_metadata(self, url):
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            return None, None

        soup = BeautifulSoup(response.text, "html.parser")

        date = self._extract_date(soup)
        description = self._extract_abstract(soup)

        return date, description

    def _extract_date(self, soup):
        meta = soup.find("meta", attrs={"name": "dc.date.issued"})
        if meta and meta.get("content"):
            try:
                return datetime.strptime(
                    meta["content"].strip(), "%Y-%m-%d"
                ).replace(tzinfo=timezone.utc)
            except ValueError:
                pass
        return None

    def _extract_abstract(self, soup):
        abstract = soup.find(class_="abstract")
        if abstract:
            text = " ".join(abstract.get_text(" ", strip=True).split())
            if text:
                return text
        return None

    def create_feed(self):
        feed = FeedGenerator()
        feed.title("gwern.net")
        feed.link(href=self.base_url, rel="alternate")
        feed.description("Gwern's writings on statistics, decision-making, AI, and technology")
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
    generator = GwernRSSGenerator()
    articles_data = await generator.fetch_posts()
    rss_content = generator.generate_rss(articles_data)

    os.makedirs("rss", exist_ok=True)
    with open("rss/hn_gwernnet_rss.xml", "wb") as f:
        f.write(rss_content)

    print(f"RSS feed generated successfully with {len(articles_data)} articles!")


if __name__ == "__main__":
    asyncio.run(main())
