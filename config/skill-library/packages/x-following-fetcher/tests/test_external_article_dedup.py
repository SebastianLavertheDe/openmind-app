import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import AppConfig, StorageConfig
from src.models import Author, Tweet, UrlEntity
from src.storage.files import (
    _collect_existing_article_tweet_ids,
    _write_external_link_tweet_articles,
)


def _make_tweet(tweet_id: str, url: str) -> Tweet:
    return Tweet(
        tweet_id=tweet_id,
        author=Author(),
        content="",
        created_at="",
        link="",
        url_entities=[UrlEntity(url=url, expanded_url=url)],
    )


def _make_config(article_root: Path) -> AppConfig:
    return AppConfig(
        storage=StorageConfig(
            output_dir=article_root,
            cache_file=article_root / "cache.json",
            article_output_dir=article_root,
            save_external_link_posts_to_article=True,
        )
    )


class CollectExistingTweetIdsTests(unittest.TestCase):
    def test_collects_tweet_ids_across_date_dirs_and_dedups_multi_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "20260620").mkdir()
            (root / "20260621").mkdir()
            (root / "20260620" / "x_123_foo.md").write_text("a")
            (root / "20260620" / "x_123_01_bar.md").write_text("b")  # 同 tweet 多链接 -> 同一 tweet_id
            (root / "20260621" / "x_456_baz.md").write_text("c")
            (root / "20260620" / "other.md").write_text("d")  # 非 x_ 前缀,忽略
            ids = _collect_existing_article_tweet_ids(root)
            self.assertEqual(ids, {"123", "456"})

    def test_missing_root_returns_empty(self):
        ids = _collect_existing_article_tweet_ids(Path("/nonexistent/path/xyz"))
        self.assertEqual(ids, set())


class WriteExternalArticleDedupTests(unittest.TestCase):
    def test_skips_tweet_already_present_in_historical_date_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "20260620").mkdir()
            (root / "20260620" / "x_123_old.md").write_text("old")  # 历史目录已有该 tweet
            today_dir = root / "20260625"
            config = _make_config(root)
            tweet = _make_tweet("123", "https://example.com/article")

            with patch(
                "src.storage.files._extract_external_articles",
                return_value={"https://example.com/article": {"title": "Example"}},
            ):
                saved = _write_external_link_tweet_articles(today_dir, [tweet], config)

            self.assertEqual(saved, 0)
            self.assertFalse(today_dir.exists() and any(today_dir.glob("x_123*.md")))

    def test_writes_new_tweet_not_in_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            today_dir = root / "20260625"
            config = _make_config(root)
            tweet = _make_tweet("999", "https://example.com/new")

            with patch(
                "src.storage.files._extract_external_articles",
                return_value={"https://example.com/new": {"title": "New Article"}},
            ):
                reported: list[tuple[str, Path]] = []
                saved = _write_external_link_tweet_articles(
                    today_dir,
                    [tweet],
                    config,
                    on_artifact=lambda declaration_id, artifact_path: reported.append(
                        (declaration_id, artifact_path)
                    ),
                )

            self.assertEqual(saved, 1)
            written = list(today_dir.glob("x_999*.md"))
            self.assertEqual(len(written), 1)
            self.assertEqual(reported, [("x-articles", written[0])])

    def test_preserves_existing_article_in_today_dir(self):
        # 当天目录已有该 tweet 的 article, 再次运行不应删除(避免反复增删的回归 bug)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            today_dir = root / "20260625"
            today_dir.mkdir()
            existing = today_dir / "x_123_already.md"
            existing.write_text("already")
            config = _make_config(root)
            tweet = _make_tweet("123", "https://example.com/article")
            with patch(
                "src.storage.files._extract_external_articles",
                return_value={"https://example.com/article": {"title": "Example"}},
            ):
                saved = _write_external_link_tweet_articles(today_dir, [tweet], config)
            self.assertEqual(saved, 0)
            self.assertTrue(existing.exists())  # 当天已有的不被删


if __name__ == "__main__":
    unittest.main()
