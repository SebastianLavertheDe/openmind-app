from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..models import Tweet

CACHE_KEEP_DAYS = 30


class PostCache:
    def __init__(self, cache_file: Path):
        self.cache_file = cache_file
        self.ids: set[str] = set()
        self.records: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if not self.cache_file.exists():
            return

        try:
            raw = json.loads(self.cache_file.read_text(encoding="utf-8"))
        except Exception:
            return

        ids = raw.get("ids", [])
        records = raw.get("posts", {})
        if isinstance(ids, list):
            self.ids = {str(item) for item in ids}
        if isinstance(records, dict):
            self.records = {
                str(key): value for key, value in records.items() if isinstance(value, dict)
            }

    def has(self, tweet_id: str) -> bool:
        return tweet_id in self.ids

    def add(self, tweet: Tweet, output_path: Path) -> None:
        self.ids.add(tweet.tweet_id)
        self.records[tweet.tweet_id] = tweet.to_cache_record(str(output_path))

    def save(self) -> None:
        self._prune_old_records()
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 2,
            "ids": sorted(self.ids),
            "posts": self.records,
        }
        self.cache_file.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _prune_old_records(self) -> None:
        cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=CACHE_KEEP_DAYS)).isoformat()
        to_remove = [
            tid for tid, rec in self.records.items()
            if str(rec.get("fetched_at", "")) < cutoff
        ]
        for tid in to_remove:
            self.records.pop(tid, None)
            self.ids.discard(tid)
