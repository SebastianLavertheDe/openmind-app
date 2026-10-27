import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import Error as PlaywrightError, sync_playwright

from institution_feed import InstitutionFeed, is_ai, parse_date, run


class SequoiaAIRSSGenerator(InstitutionFeed):
    title = "Sequoia Capital AI"
    base_url = "https://sequoiacap.com/stories"
    description = "AI articles and investment perspectives from Sequoia Capital"
    output_file = "sequoia_ai_rss.xml"

    def parse_listing(self, html):
        soup = BeautifulSoup(html, "html.parser")
        articles = {}
        for link in soup.select('a[href*="/article/"]'):
            url = urljoin(self.base_url, link["href"])
            parsed = urlparse(url)
            title = link.select_one('[data-framer-name^="Title"]')
            if (parsed.netloc != "sequoiacap.com" or "/tag/" in parsed.path
                    or title is None):
                continue
            authors = next((p.get_text(" ", strip=True) for p in link.select("p")
                            if re.match(r"^by\s", p.get_text(strip=True), re.I)), "")
            articles.setdefault(url, {
                "title": title.get_text(" ", strip=True),
                "url": url,
                "authors": re.sub(r"^by\s+", "", authors, flags=re.I),
            })
        if not articles:
            raise ValueError("Sequoia story cards were not found")
        return list(articles.values())[:self.limit]

    def fetch_listing(self):
        # The old RSS and AI archive omit new articles after the site migration.
        # Stories renders each tab on the client, so collect all three tabs.
        articles = {}
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    page.goto(self.base_url, wait_until="networkidle", timeout=60000)
                    for tab in ("Spotlight", "Perspective", "News"):
                        if tab != "Spotlight":
                            page.get_by_text(tab, exact=True).first.click()
                            page.wait_for_function("""tab => {
                                const card = document.querySelector('a[href*="/article/"]');
                                return card && card.querySelector(`[data-framer-name="${tab}"]`);
                            }""", arg=tab, timeout=15000)
                        for article in self.parse_listing(page.content()):
                            articles.setdefault(article["url"], article)
                finally:
                    browser.close()
        except PlaywrightError as exc:
            raise RuntimeError(f"Could not load Sequoia story tabs: {exc}") from exc
        return list(articles.values())

    def parse_metadata(self, html):
        soup = BeautifulSoup(html, "html.parser")
        # Some pages emit invalid JSON-LD (image: undefined), but their visible
        # publication date has a valid datetime attribute.
        published = soup.select_one("main time[datetime]")
        description = soup.select_one('meta[name="description"]')
        description = description.get("content", "") if description else ""
        headline = soup.select_one("h1")
        content = soup.select_one('main [data-framer-name="Content"]')
        if content is None:
            raise ValueError("Sequoia article body was not found")
        return {
            "date": parse_date(published.get("datetime") if published else None),
            "description": description,
            "is_ai": is_ai(headline.get_text(" ", strip=True) if headline else "",
                           description, content.get_text(" ", strip=True)),
        }

    def fetch_article(self, article):
        # Each worker owns its HTTP session.
        fetcher = InstitutionFeed()
        try:
            metadata = self.parse_metadata(fetcher.get(article["url"]).text)
            if metadata.pop("is_ai"):
                article.update(metadata)
                return article
        except (ValueError, RuntimeError) as exc:
            raise RuntimeError(f"Could not read {article['url']}: {exc}") from exc
        finally:
            fetcher.session.close()

    def fetch_posts(self):
        candidates = self.fetch_listing()
        with ThreadPoolExecutor(max_workers=4) as pool:
            return [article for article in pool.map(self.fetch_article, candidates) if article]


if __name__ == "__main__":
    raise SystemExit(run(SequoiaAIRSSGenerator))
