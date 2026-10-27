import asyncio
import html
import os
from datetime import datetime, timezone

import requests
from feedgen.feed import FeedGenerator


class QuestMobileRSSGenerator:
    def __init__(self):
        self.base_url = "https://www.questmobile.com.cn"
        self.reports_url = f"{self.base_url}/research/reports/"
        self.api_url = f"{self.base_url}/api/v2/report/article-list"
        self.page_size = 20
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0",
        })

    def _parse_date(self, date_text):
        if not date_text:
            return None
        try:
            return datetime.strptime(date_text.strip(), "%Y-%m-%d").replace(
                tzinfo=timezone.utc
            )
        except ValueError as e:
            print(f"Error parsing date '{date_text}': {e}")
            return None

    def _build_description(self, article):
        intro = html.escape(article.get("introduction") or "")
        cover = article.get("coverImgUrl")
        if cover:
            return f'<p>{intro}</p><p><img src="{html.escape(cover)}" alt="" /></p>'
        return intro or article.get("title", "")

    async def fetch_posts(self):
        articles_data = []
        seen_ids = set()
        page = 1

        while True:
            response = self.session.get(
                self.api_url,
                params={
                    "version": 0,
                    "pageSize": self.page_size,
                    "pageNo": page,
                    "industryId": -1,
                    "labelId": -1,
                },
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()

            if payload.get("code") != 100200:
                raise RuntimeError(
                    f"QuestMobile API error: {payload.get('msg', 'unknown error')}"
                )

            items = payload.get("data") or []
            if not items:
                break

            for item in items:
                article_id = item.get("id")
                title = (item.get("title") or "").strip()
                if not article_id or not title or article_id in seen_ids:
                    continue

                seen_ids.add(article_id)
                url = f"{self.base_url}/research/report/{article_id}/"
                parsed_date = self._parse_date(item.get("publishTime"))

                articles_data.append({
                    "title": title,
                    "url": url,
                    "description": self._build_description(item),
                    "date": parsed_date,
                })
                print(f"Found: {title}")

            total_page = payload.get("totalPage") or page
            if page >= total_page:
                break
            page += 1

        articles_data.sort(key=lambda x: x["date"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return articles_data

    def create_feed(self):
        feed = FeedGenerator()
        feed.title("QuestMobile 行业研究报告")
        feed.link(href=self.reports_url, rel="alternate")
        feed.description("QuestMobile 最新行业研究报告")
        feed.language("zh")
        return feed

    def generate_rss(self, articles_data):
        feed = self.create_feed()

        for article in articles_data:
            entry = feed.add_entry(order="append")
            entry.title(article["title"])
            entry.link(href=article["url"])
            entry.pubDate(article["date"])
            entry.description(article["description"])
            entry.guid(article["url"], permalink=True)

        return feed.rss_str(pretty=True)


async def main():
    generator = QuestMobileRSSGenerator()
    articles_data = await generator.fetch_posts()
    rss_content = generator.generate_rss(articles_data)

    os.makedirs("rss", exist_ok=True)
    with open("rss/questmobile_rss.xml", "wb") as f:
        f.write(rss_content)

    print(f"RSS feed generated successfully with {len(articles_data)} articles!")


if __name__ == "__main__":
    asyncio.run(main())
