"""Regression coverage for the 2026 Anthropic/Claude site migrations."""
import asyncio
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

REPO = Path(__file__).resolve().parents[2]
PACKAGE = REPO / "config/skill-library/packages/rss-article-saver"
sys.path.insert(0, str(PACKAGE))
sys.path.insert(0, str(PACKAGE / "src/feed_generation"))
from anthropic_engineering_rss import AnthropicEngineeringRSSGenerator
from claude_blog_rss import ClaudeBlogRSSGenerator
from src import rss_pipeline as rss


def response(html):
    return Mock(text=html, content=html.encode())


class AnthropicSiteMigrationTests(unittest.TestCase):
    def test_engineering_accepts_research_links_and_deduplicates_cards(self):
        html = """
        <article><time>Oct 13, 2026</time>
          <a href="/research/redesigning-source-control"><img></a>
          <h3><a href="/research/redesigning-source-control">Source control</a></h3>
        </article>
        <article><h3><a href="/research/redesigning-source-control">Duplicate</a></h3></article>
        <article><time>Sep 1, 2026</time><h3>
          <a href="https://www.anthropic.com/engineering/legacy">Legacy article</a>
        </h3></article>
        <article><h3><a href="https://example.org/research/unrelated">External</a></h3></article>
        """
        generator = AnthropicEngineeringRSSGenerator()
        with patch.object(generator.session, "get", return_value=response(html)):
            rows = asyncio.run(generator.fetch_posts())
        self.assertEqual([row["title"] for row in rows], ["Source control", "Legacy article"])
        self.assertEqual(rows[0]["url"], "https://www.anthropic.com/research/redesigning-source-control")
        self.assertEqual(rows[0]["date"].date().isoformat(), "2026-10-13")

    def test_claude_resource_cards_preserve_title_and_card_date(self):
        html = """
        <nav><a href="/resources/articles">Articles</a>
          <a href="/blog/category/agents">Agents</a></nav>
        <a href="/resources/articles/new-post">
          <div><span>Article</span><span>Oct 28, 2026</span></div>
          <h3>New resource article</h3><p>A summary, not part of the title.</p>
          <span>Claude Code</span>
        </a>
        <a href="/resources/articles/new-post"><h3>Duplicate</h3></a>
        <a href="https://claude.com/resources/articles/older-post">
          <span>Oct 22, 2026</span><h3>Older resource article</h3>
        </a>
        <a href="https://example.org/resources/articles/foreign"><h3>Foreign</h3></a>
        <div class="blog_cms_item w-dyn-item">
          <a href="/blog/legacy">Legacy Claude article</a><span>October 1, 2026</span>
        </div>
        """
        generator = ClaudeBlogRSSGenerator()
        with patch.object(generator.session, "get", return_value=response(html)) as get:
            rows = asyncio.run(generator.fetch_posts())
        get.assert_called_once_with("https://claude.com/resources/articles", timeout=30)
        self.assertEqual(
            [row["title"] for row in rows],
            ["New resource article", "Older resource article", "Legacy Claude article"],
        )
        self.assertEqual(rows[0]["date"].date().isoformat(), "2026-10-28")
        self.assertEqual(len({row["url"] for row in rows}), 3)
        raw, _ = rss.normalize_feed("Claude", generator.base_url, rows)
        _, parsed = rss.parse_feed(raw, generator.base_url)
        self.assertEqual(parsed[0]["guid"], rows[0]["url"])
        self.assertIsNotNone(parsed[0]["date"].tzinfo)

    def test_claude_missing_date_uses_article_metadata_not_adjacent_card(self):
        html = """
        <a href="/resources/articles/dated"><span>Oct 28, 2026</span><h3>Dated</h3></a>
        <a href="/resources/articles/undated"><h3>Undated</h3></a>
        """
        generator = ClaudeBlogRSSGenerator()
        with patch.object(generator.session, "get", return_value=response(html)), patch.object(
            generator, "_fetch_article_date", return_value=None
        ) as metadata:
            rows = asyncio.run(generator.fetch_posts())
        self.assertEqual(len(rows), 1)
        metadata.assert_called_once_with("https://claude.com/resources/articles/undated")

    def test_claude_detection_accepts_old_redirect_and_new_listing(self):
        catalog = json.loads((REPO / "config/rss-sources/catalog.json").read_text(encoding="utf-8"))
        canonical = "https://claude.com/resources/articles"
        html = '<a href="/resources/articles/new"><span>Oct 28, 2026</span><h3>New article</h3></a>'
        for original in ["https://claude.com/blog", canonical]:
            with self.subTest(original=original), patch.object(
                rss, "fetch", return_value=(html.encode(), canonical)
            ), patch("requests.Session.get", return_value=response(html)):
                self.assertEqual(rss.detect(original, catalog)["adapterId"], "claude_blog_rss")


if __name__ == "__main__":
    unittest.main()
