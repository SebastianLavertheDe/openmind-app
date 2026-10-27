"""Cache manager for tracking summarized articles"""

import json
import os
import threading
from datetime import datetime, timedelta
from typing import Dict, Optional
from ..core.models import ArticleSummary


class CacheManager:
    """Manages cache of summarized articles"""

    POST_SUMMARY_BUCKET = "__post_summaries__"
    REDDIT_SUMMARY_BUCKET = "__reddit_summaries__"
    # per-post Reddit 摘要，键为 reddit_{subreddit}_{post_id}，值含首次总结日期
    REDDIT_POST_SUMMARY_BUCKET = "__reddit_post_summaries__"
    # per-post X 摘要，键为 x_{tweet_id}，值含 keep/summary/date
    X_POST_SUMMARY_BUCKET = "__x_post_summaries__"

    def __init__(self, cache_file: str = "summary_cache.json"):
        self.cache_file = cache_file
        self.cache: Dict = self._load_cache()
        self._lock = threading.Lock()
        self._dirty = False

    def _load_cache(self) -> Dict:
        """Load cache from file"""
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"  Warning: Failed to load cache: {e}")
                return {}
        return {}

    def _prune_in_memory(self) -> int:
        """Remove date-keyed entries older than 30 days from the in-memory cache.

        Only top-level keys matching YYYYMMDD are removed; the post/reddit
        buckets are always preserved. Equivalent to ``prune_date_keyed_cache``
        but operates on ``self.cache`` directly, avoiding an extra read+write
        of the cache file on every save.
        """
        cutoff = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
        preserved = {
            self.POST_SUMMARY_BUCKET,
            self.REDDIT_SUMMARY_BUCKET,
            self.REDDIT_POST_SUMMARY_BUCKET,
            self.X_POST_SUMMARY_BUCKET,
        }
        to_remove = [
            key
            for key in self.cache
            if key not in preserved and len(key) == 8 and key.isdigit() and key < cutoff
        ]
        for key in to_remove:
            del self.cache[key]
        # 同步清理 30 天前的 per-post Reddit / X 摘要（按其首次总结日期）
        for bucket_name in (self.REDDIT_POST_SUMMARY_BUCKET, self.X_POST_SUMMARY_BUCKET):
            per_post_bucket = self.cache.get(bucket_name, {})
            if not isinstance(per_post_bucket, dict):
                continue
            stale_keys = [
                key
                for key, value in per_post_bucket.items()
                if isinstance(value, dict)
                and len(str(value.get("date", ""))) == 8
                and str(value.get("date", "")) < cutoff
            ]
            for key in stale_keys:
                del per_post_bucket[key]
        return len(to_remove)

    def flush(self) -> None:
        """Persist the cache to disk once when dirty.

        Pruning happens in memory and the file is written exactly once, so a
        run that marks N summaries triggers one write instead of N. Thread-safe.
        """
        with self._lock:
            if not self._dirty:
                return
            try:
                self._prune_in_memory()
                with open(self.cache_file, "w", encoding="utf-8") as f:
                    json.dump(self.cache, f, ensure_ascii=False, indent=2)
                self._dirty = False
            except Exception as e:
                print(f"  Warning: Failed to save cache: {e}")

    def _save_cache(self) -> None:
        """Backward-compatible immediate flush for low-frequency callers."""
        with self._lock:
            self._dirty = True
        self.flush()

    def is_summarized(self, date: str, cache_key: str) -> bool:
        """Check if an article has been summarized"""
        return date in self.cache and cache_key in self.cache[date]

    def get_summary(self, date: str, cache_key: str) -> Optional[ArticleSummary]:
        """Get cached summary for an article"""
        if self.is_summarized(date, cache_key):
            data = self.cache[date][cache_key]
            return ArticleSummary.from_dict(data)
        return None

    def mark_as_summarized(
        self, date: str, cache_key: str, summary: ArticleSummary
    ) -> None:
        """Mark an article as summarized"""
        if date not in self.cache:
            self.cache[date] = {}

        self.cache[date][cache_key] = summary.to_dict()
        with self._lock:
            self._dirty = True

    def get_all_summaries_for_date(self, date: str) -> Dict[str, ArticleSummary]:
        """Get all summaries for a specific date"""
        if date not in self.cache:
            return {}

        return {
            filename: ArticleSummary.from_dict(data)
            for filename, data in self.cache[date].items()
        }

    def clear_date(self, date: str) -> None:
        """Clear all summaries for a specific date"""
        if date in self.cache:
            del self.cache[date]
            self._save_cache()

    def get_post_summary(self, date: str) -> Optional[dict]:
        """Get cached post summary for a specific date."""
        bucket = self.cache.get(self.POST_SUMMARY_BUCKET, {})
        data = bucket.get(date)
        if isinstance(data, dict):
            return dict(data)
        return None

    def mark_post_summary(
        self,
        date: str,
        post_summary: dict,
        source_path: str = "",
        provider_name: str = "",
        model: str = "",
    ) -> None:
        """Cache summarized same-day post data."""
        self.cache.setdefault(self.POST_SUMMARY_BUCKET, {})
        self.cache[self.POST_SUMMARY_BUCKET][date] = {
            "summary": dict(post_summary),
            "source_path": source_path,
            "provider_name": provider_name,
            "model": model,
            "processed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        self._save_cache()

    def get_post_summary_record(self, date: str) -> Optional[dict]:
        """Get full cached post summary record for a specific date."""
        bucket = self.cache.get(self.POST_SUMMARY_BUCKET, {})
        data = bucket.get(date)
        if isinstance(data, dict):
            return dict(data)
        return None

    def get_reddit_summary(self, date: str) -> Optional[dict]:
        """Get cached short Reddit summary for a specific date."""
        bucket = self.cache.get(self.REDDIT_SUMMARY_BUCKET, {})
        data = bucket.get(date)
        if isinstance(data, dict):
            return dict(data)
        return None

    def mark_reddit_summary(
        self,
        date: str,
        reddit_summary: dict,
        source_path: str = "",
        provider_name: str = "",
        model: str = "",
    ) -> None:
        """Cache short Reddit summary data."""
        self.cache.setdefault(self.REDDIT_SUMMARY_BUCKET, {})
        self.cache[self.REDDIT_SUMMARY_BUCKET][date] = {
            "summary": dict(reddit_summary),
            "source_path": source_path,
            "provider_name": provider_name,
            "model": model,
            "processed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        self._save_cache()

    def get_reddit_post_summary(self, cache_key: str) -> Optional[str]:
        """Get cached short summary for a single Reddit post (per-post granularity)."""
        bucket = self.cache.get(self.REDDIT_POST_SUMMARY_BUCKET, {})
        if not isinstance(bucket, dict):
            return None
        data = bucket.get(cache_key)
        if isinstance(data, dict):
            summary = data.get("summary")
            return str(summary) if summary else None
        if isinstance(data, str):  # backward compat
            return data
        return None

    def mark_reddit_post_summary(self, cache_key: str, summary: str, date: str = "") -> None:
        """Cache a single Reddit post summary (per-post granularity).

        Keyed by the scanner's stable ``reddit_{subreddit}_{post_id}`` so that
        re-runs only summarize newly fetched posts and reuse older ones.
        """
        bucket = self.cache.setdefault(self.REDDIT_POST_SUMMARY_BUCKET, {})
        bucket[cache_key] = {"summary": summary, "date": date}
        with self._lock:
            self._dirty = True

    def get_x_post_summary(self, cache_key: str) -> Optional[dict]:
        """Get cached classification/summary for a single X post."""
        bucket = self.cache.get(self.X_POST_SUMMARY_BUCKET, {})
        if not isinstance(bucket, dict):
            return None
        data = bucket.get(cache_key)
        if isinstance(data, dict):
            return dict(data)
        return None

    def mark_x_post_summary(
        self,
        cache_key: str,
        *,
        keep: bool,
        summary: str = "",
        date: str = "",
    ) -> None:
        """Cache a single X post classification + summary (per-post granularity)."""
        bucket = self.cache.setdefault(self.X_POST_SUMMARY_BUCKET, {})
        bucket[cache_key] = {
            "keep": bool(keep),
            "summary": summary,
            "date": date,
        }
        with self._lock:
            self._dirty = True
