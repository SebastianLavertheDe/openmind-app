from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from institution_feed import InstitutionFeed, parse_date, run


class StanfordHAIRSSGenerator(InstitutionFeed):
    title = "Stanford HAI News"
    base_url = "https://hai.stanford.edu/news"
    description = "AI research, policy, and societal impact news from Stanford HAI"
    output_file = "stanford_hai_rss.xml"
    listing_url = "https://hai.stanford.edu/news?filterBy=news"

    def parse_listing(self, html):
        soup = BeautifulSoup(html, "html.parser")
        articles = {}
        for link in soup.select('a[class*="ContentCard_titleLink"][href]'):
            url = urljoin(self.base_url, link["href"])
            parsed = urlparse(url)
            if parsed.netloc != "hai.stanford.edu" or not parsed.path.startswith("/news/"):
                continue
            articles.setdefault(url, {"title": link.get_text(" ", strip=True), "url": url})
        if not articles:
            raise ValueError("Stanford HAI news list was not found")
        return list(articles.values())

    def parse_metadata(self, html):
        soup = BeautifulSoup(html, "html.parser")
        date_text = None
        for row in soup.select('[class*="DetailMeta_row"]'):
            fields = row.find_all(recursive=False)
            if len(fields) >= 2 and fields[0].get_text(strip=True) == "Date":
                date_text = fields[1].get_text(" ", strip=True)
                break
        if not date_text:
            featured_date = soup.select_one('[class*="FeatureArticleMeta_date"]')
            if featured_date:
                date_text = featured_date.get_text(" ", strip=True)
        description = soup.select_one('meta[name="description"]')
        return {
            "date": parse_date(date_text),
            "description": description.get("content", "") if description else "",
        }

    def fetch_posts(self):
        articles = self.parse_listing(self.get(self.listing_url).text)
        for article in articles:
            try:
                article.update(self.parse_metadata(self.get(article["url"]).text))
            except ValueError as exc:
                raise RuntimeError(f"Could not read {article['url']}: {exc}") from exc
        return articles


if __name__ == "__main__":
    raise SystemExit(run(StanfordHAIRSSGenerator))
