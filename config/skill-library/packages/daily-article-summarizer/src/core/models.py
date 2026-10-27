"""Data models for article summaries"""

from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime


@dataclass
class ArticleSummary:
    """Represents a summarized article"""

    title: str
    cache_key: str
    file_path: str
    source_url: str
    author: str
    summary: str
    key_points: List[str]
    category: str
    score: int
    processed_at: str
    date: str  # YYYYMMDD format

    def to_dict(self) -> dict:
        """Convert to dictionary for caching"""
        return {
            "title": self.title,
            "cache_key": self.cache_key,
            "file_path": self.file_path,
            "source_url": self.source_url,
            "author": self.author,
            "summary": self.summary,
            "key_points": self.key_points,
            "category": self.category,
            "score": self.score,
            "processed_at": self.processed_at,
            "date": self.date,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ArticleSummary":
        """Create from dictionary"""
        cache_key = data.get("cache_key")
        if not cache_key:
            source_url = str(data.get("source_url", "") or "").strip()
            file_path = str(data.get("file_path", "") or "").strip()
            if source_url:
                cache_key = f"url:{source_url}"
            else:
                cache_key = file_path or "unknown"

        normalized = dict(data)
        normalized["cache_key"] = cache_key

        # Filter out extra/legacy fields not part of the dataclass
        valid_fields = {
            k: v for k, v in normalized.items()
            if k in cls.__dataclass_fields__
        }
        return cls(**valid_fields)


@dataclass
class ArticleMetadata:
    """Metadata extracted from article markdown file"""

    title: str
    cache_key: str
    file_path: str
    filename: str
    link: str
    author: str
    published_date: Optional[str] = None
    saved_time: Optional[str] = None
    content: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary"""
        return {
            "title": self.title,
            "file_path": self.file_path,
            "filename": self.filename,
            "link": self.link,
            "author": self.author,
            "published_date": self.published_date,
            "saved_time": self.saved_time,
            "content": self.content,
        }
