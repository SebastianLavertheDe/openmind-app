"""Google Gemini AI Summarization Client."""

from .shared_summarizer import SharedArticleSummarizer


class GeminiSummarizer(SharedArticleSummarizer):
    """Google Gemini 总结客户端"""

    provider_name = "gemini"
    display_name = "Gemini"
