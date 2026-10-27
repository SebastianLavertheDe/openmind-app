from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class RedditFetchCache:
    cache_file: Path
    data: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.data = self._load()

    def _load(self) -> dict:
        if not self.cache_file.exists():
            return {"subreddits": {}}
        try:
            with open(self.cache_file, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if isinstance(payload, dict):
                payload.setdefault("subreddits", {})
                return payload
        except Exception:
            pass
        return {"subreddits": {}}

    def save(self) -> None:
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as handle:
            json.dump(self.data, handle, ensure_ascii=False, indent=2)

    def has_post(self, subreddit: str, post_id: str) -> bool:
        seen = self._subreddit_bucket(subreddit).get("seen_post_ids", [])
        return post_id in seen

    def mark_posts(self, subreddit: str, post_ids: list[str]) -> None:
        bucket = self._subreddit_bucket(subreddit)
        seen = set(bucket.get("seen_post_ids", []))
        for post_id in post_ids:
            if post_id:
                seen.add(post_id)
        bucket["seen_post_ids"] = sorted(seen)

    def _subreddit_bucket(self, subreddit: str) -> dict:
        subreddits = self.data.setdefault("subreddits", {})
        return subreddits.setdefault(subreddit, {"seen_post_ids": []})
