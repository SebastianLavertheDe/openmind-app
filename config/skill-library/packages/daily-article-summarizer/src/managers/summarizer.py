"""Summarizer for processing articles with AI"""

import importlib
from datetime import datetime
from typing import List, Optional
from ..core.models import ArticleMetadata, ArticleSummary


class ArticleSummarizer:
    """Manages article summarization using AI with fallback"""

    def __init__(self):
        self.primary_client = None
        self.fallback_clients = []
        self.enabled = False

        # Provider chain follows the package AI client's auto order (claude→deepseek→doubao);
        # the first client that initializes becomes primary, the rest are fallbacks.
        # config.yaml no longer drives provider selection (old provider/model fields were never read).
        _chain = [
            ("Claude", "claude_client", "ClaudeSummarizer"),
            ("DeepSeek", "deepseek_client", "DeepSeekSummarizer"),
            ("Doubao", "doubao_client", "DoubaoSummarizer"),
        ]

        for idx, (label, module_name, class_name) in enumerate(_chain):
            try:
                mod = importlib.import_module(f".{module_name}", package=__package__.rsplit(".", 1)[0] + ".ai")
                client_cls = getattr(mod, class_name)
                client = client_cls()
            except Exception as e:
                print(f"  Warning: {label} client initialization failed: {e}")
                continue

            if idx == 0:
                self.primary_client = client
                self.enabled = True
                print(f"  ✓ Primary AI client: {label}")
            else:
                self.fallback_clients.append((label, client))
                if not self.enabled:
                    self.enabled = True
                print(f"  ✓ Fallback AI client: {label}")

        if not self.enabled:
            print(f"  Error: No AI client available")

    def summarize_article(
        self, article: ArticleMetadata, date: str
    ) -> Optional[ArticleSummary]:
        """
        Summarize a single article with fallback

        Args:
            article: Article metadata with content
            date: Date string (YYYYMMDD)

        Returns:
            ArticleSummary or None if failed
        """
        if not self.enabled:
            print("  AI summarization disabled")
            return None

        if not article.content:
            print(f"  Warning: No content to summarize for {article.filename}")
            return None

        print(f"  Summarizing: {article.title[:50]}...")

        # Try primary client first
        if self.primary_client:
            result = self.primary_client.summarize_article(article.title, article.content)
            if result:
                return self._create_summary(article, result, date)
            print(f"  Primary client failed, trying fallback...")

        # Try fallback clients in order
        for client_name, client in self.fallback_clients:
            result = client.summarize_article(article.title, article.content)
            if result:
                print(f"  ✓ Used fallback: {client_name}")
                return self._create_summary(article, result, date)

        print(f"  Warning: Failed to summarize {article.filename}")
        return None

    def _create_summary(
        self, article: ArticleMetadata, result: dict, date: str
    ) -> ArticleSummary:
        """Create ArticleSummary from AI result"""
        return ArticleSummary(
            title=result.get("translated_title", article.title),
            cache_key=article.cache_key,
            file_path=article.file_path,
            source_url=article.link,
            author=article.author,
            summary=result["summary"],
            key_points=result["key_points"],
            category=result["category"],
            score=result["score"],
            processed_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            date=date,
        )

    def batch_summarize(
        self, articles: List[ArticleMetadata], date: str, batch_size: int = 5
    ) -> List[ArticleSummary]:
        """
        Summarize multiple articles in batches

        Args:
            articles: List of article metadata
            date: Date string (YYYYMMDD)
            batch_size: Number of articles to process in each batch

        Returns:
            List of ArticleSummary objects
        """
        summaries = []

        for i in range(0, len(articles), batch_size):
            batch = articles[i : i + batch_size]
            print(f"\n  Processing batch {i // batch_size + 1}/{(len(articles) + batch_size - 1) // batch_size}")

            for article in batch:
                summary = self.summarize_article(article, date)
                if summary:
                    summaries.append(summary)

        return summaries
