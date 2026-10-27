"""Claude-compatible AI Summarization Client."""

from .shared_summarizer import SharedArticleSummarizer


class ClaudeSummarizer(SharedArticleSummarizer):
    """Claude 总结客户端"""

    provider_name = "claude"
    display_name = "Claude"
