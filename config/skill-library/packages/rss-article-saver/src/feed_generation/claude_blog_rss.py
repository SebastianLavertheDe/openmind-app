import asyncio
from datetime import datetime, timezone
from feedgen.feed import FeedGenerator
import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
import re
import os

class ClaudeBlogRSSGenerator:
    def __init__(self):
        self.base_url = "https://claude.com/blog"
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0"
        })
        self.date_patterns = [
            re.compile(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b"),
            re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b"),
        ]

    def parse_date(self, date_text):
        """Parse date text and return a datetime object with timezone"""
        try:
            date_text = date_text.strip()
            parsed_date = date_parser.parse(date_text, tzinfos={"UT": timezone.utc, "UTC": timezone.utc})
            if parsed_date.tzinfo is None:
                parsed_date = parsed_date.replace(tzinfo=timezone.utc)
            return parsed_date
        except Exception as e:
            print(f"Error parsing date '{date_text}': {e}")
            return None

    async def fetch_posts(self):
        response = self.session.get(self.base_url, timeout=30)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')
        articles_data = []
        seen_urls = set()

        for item in soup.select("div.blog_cms_item.w-dyn-item"):
            article = self._extract_article_from_card(item, seen_urls)
            if article:
                articles_data.append(article)
                print(f"Found: {article['title']} ({article['date_text']})")

        articles_data.sort(key=lambda x: x['date'] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return articles_data

    def _extract_article_from_card(self, item, seen_urls):
        link = self._find_article_link(item)
        if not link:
            return None

        url = link.get("href", "").strip()
        if url.startswith("/"):
            url = f"https://claude.com{url}"

        if (
            not url
            or url in seen_urls
            or "/blog/" not in url
            or "/blog/category/" in url
            or url.rstrip("/") == self.base_url
        ):
            return None

        title = self._extract_title(item, link)
        if not title:
            return None

        card_text = " ".join(item.get_text(" ", strip=True).split())
        date_text = self._find_date_text(card_text)
        if not date_text:
            date_text = self._fetch_article_date(url)
        if not date_text:
            return None

        seen_urls.add(url)
        parsed_date = self.parse_date(date_text)
        return {
            "title": title,
            "url": url,
            "date": parsed_date,
            "date_text": date_text,
        }

    def _find_article_link(self, item):
        candidates = []
        for link in item.select("a[href]"):
            href = link.get("href", "").strip()
            if href.startswith("/blog/") and "/blog/category/" not in href:
                candidates.append(link)

        if not candidates:
            return None

        candidates.sort(
            key=lambda link: len(" ".join(link.get_text(" ", strip=True).split())),
            reverse=True,
        )
        return candidates[0]

    def _extract_title(self, item, link):
        link_text = " ".join(link.get_text(" ", strip=True).split())
        if len(link_text) >= 10:
            return link_text

        heading = item.find(["h1", "h2", "h3", "h4", "h5", "h6"])
        if heading:
            heading_text = " ".join(heading.get_text(" ", strip=True).split())
            if heading_text:
                return heading_text

        return None

    def _find_date_text(self, text):
        for pattern in self.date_patterns:
            match = pattern.search(text)
            if match:
                return match.group(0)
        return None

    def _fetch_article_date(self, url):
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
        except requests.RequestException:
            return None

        soup = BeautifulSoup(response.text, "html.parser")

        for meta_name in ("article:published_time", "og:published_time"):
            meta = soup.find("meta", attrs={"property": meta_name})
            if meta and meta.get("content"):
                return meta["content"].strip()

        for meta_name in ("publish-date", "datePublished"):
            meta = soup.find("meta", attrs={"name": meta_name})
            if meta and meta.get("content"):
                return meta["content"].strip()

        time_tag = soup.find("time")
        if time_tag:
            datetime_value = time_tag.get("datetime")
            if datetime_value:
                return datetime_value.strip()
            time_text = " ".join(time_tag.get_text(" ", strip=True).split())
            if time_text:
                return time_text

        article_text = " ".join(soup.get_text(" ", strip=True).split())
        return self._find_date_text(article_text)

    def create_feed(self):
        """Create a fresh feed instance"""
        feed = FeedGenerator()
        feed.title('Claude Blog')
        feed.link(href=self.base_url, rel='alternate')
        feed.description('Latest posts from Claude blog')
        feed.language('en')
        return feed

    def generate_rss(self, articles_data):
        feed = self.create_feed()

        for article_data in articles_data:
            entry = feed.add_entry(order='append')
            entry.title(article_data['title'])
            entry.link(href=article_data['url'])
            entry.pubDate(article_data['date'])
            entry.description(article_data['title'])
            entry.guid(article_data['url'], permalink=True)

        rss_content = feed.rss_str(pretty=True)
        return rss_content

async def main():
    generator = ClaudeBlogRSSGenerator()
    articles_data = await generator.fetch_posts()
    rss_content = generator.generate_rss(articles_data)

    # Create rss directory if it doesn't exist
    os.makedirs('rss', exist_ok=True)

    # Write to file in rss directory
    with open('rss/claude_blog_rss.xml', 'wb') as f:
        f.write(rss_content)

    print(f"RSS feed generated successfully with {len(articles_data)} articles!")

if __name__ == "__main__":
    asyncio.run(main())
