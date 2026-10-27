"""DeepSeek AI client."""

from .shared_analysis import SharedAnalysisClient


class DeepSeekClient(SharedAnalysisClient):
    """DeepSeek AI 客户端"""

    provider_name = "deepseek"
    display_name = "DeepSeek"
