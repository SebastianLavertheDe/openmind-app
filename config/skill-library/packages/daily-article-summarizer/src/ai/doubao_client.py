"""Doubao AI Summarization Client."""

from .shared_summarizer import SharedArticleSummarizer


class DoubaoSummarizer(SharedArticleSummarizer):
    """Doubao 总结客户端"""

    provider_name = "doubao"
    display_name = "Doubao"
