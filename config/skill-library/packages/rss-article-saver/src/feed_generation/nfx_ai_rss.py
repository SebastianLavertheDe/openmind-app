from urllib.parse import urljoin

from institution_feed import InstitutionFeed, next_page_props, parse_date, run


class NFXAIRSSGenerator(InstitutionFeed):
    title = "NFX AI"
    base_url = "https://www.nfx.com/library/generative-ai"
    description = "AI startup essays, business models, and insights from NFX"
    output_file = "nfx_ai_rss.xml"
    api_url = "https://content.nfx.com/wp-json/wp/v2/posts"

    def fetch_posts(self):
        data = next_page_props(self.get(self.base_url).text)
        if data["category"]["slug"] != "generative-ai":
            raise ValueError("The NFX page is not the AI category")
        posts = data["posts"]
        if not posts:
            raise ValueError("NFX AI list is empty")

        # Cards show only month/year; the public CMS supplies exact UTC dates.
        details = {}
        for offset in range(0, len(posts), 100):
            batch = posts[offset:offset + 100]
            rows = self.get(self.api_url, params={
                "include": ",".join(str(post["id"]) for post in batch),
                "per_page": 100,
                "_fields": "id,date_gmt,excerpt",
            }).json()
            details.update({row["id"]: row for row in rows})

        articles = []
        for post in posts:
            detail = details[post["id"]]
            articles.append({
                "title": post["title"],
                "url": urljoin(self.base_url, post["url"]),
                "date": parse_date(detail["date_gmt"] + "Z"),
                "description": post.get("shortDescription") or detail["excerpt"]["rendered"],
                "authors": (post.get("author") or {}).get("name", ""),
            })
        return articles


if __name__ == "__main__":
    raise SystemExit(run(NFXAIRSSGenerator))
