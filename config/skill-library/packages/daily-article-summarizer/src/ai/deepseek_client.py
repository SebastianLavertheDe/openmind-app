"""DeepSeek AI Summarization Client."""

from .shared_summarizer import SharedArticleSummarizer


class DeepSeekSummarizer(SharedArticleSummarizer):
    """DeepSeek 总结客户端"""

    provider_name = "deepseek"
    display_name = "DeepSeek"
