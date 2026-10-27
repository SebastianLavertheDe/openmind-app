import json
import re
from urllib.parse import urljoin

from institution_feed import InstitutionFeed, next_flight_data, parse_date, run


class BessemerAIRSSGenerator(InstitutionFeed):
    title = "Bessemer Atlas AI"
    base_url = "https://www.bvp.com/atlas"
    description = "AI research, articles, and investment perspectives from Bessemer Atlas"
    output_file = "bessemer_ai_rss.xml"

    def parse_posts(self, html):
        data = next_flight_data(html)
        match = re.search(r'"posts":', data)
        if match is None:
            raise ValueError("Atlas article list was not found")
        posts, _ = json.JSONDecoder().raw_decode(data[match.end():].lstrip())
        articles = []
        for post in posts:
            if not post.get("publishedAt"):
                continue
            articles.append({
                "title": post["title"],
                "url": urljoin(self.base_url, post["path"]),
                "date": parse_date(post["publishedAt"]),
                "description": post.get("subtitle", ""),
                "authors": ", ".join(person["name"] for person in post.get("contributors") or []),
            })
        return articles

    def fetch_posts(self):
        return self.parse_posts(self.get(self.base_url).text)


if __name__ == "__main__":
    raise SystemExit(run(BessemerAIRSSGenerator))
