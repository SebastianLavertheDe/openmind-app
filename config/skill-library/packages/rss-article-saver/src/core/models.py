"""
Core data models for ByteByteGo RSS
"""

from dataclasses import dataclass, field
from typing import Optional, List


@dataclass
class Article:
    """Blog article data model"""

    title: str
    link: str
    author: str
    published: str
    summary: str
    full_content: Optional[str] = None
    image_urls: List[str] = field(default_factory=list)
    feed_type: str = "rss"
    feed_category: str = "article"
    feed_name: str = ""  # RSS feed name (e.g., "Anthropic Engineering Blog")
    feed_url: str = ""  # RSS feed URL
    comments: Optional[str] = None

    translated_title: Optional[str] = None
    ai_summary: Optional[str] = None
    ai_score: Optional[int] = None
    ai_category: Optional[str] = None
    ai_tags: List[str] = field(default_factory=list)
