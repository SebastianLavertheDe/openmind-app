"""Zhipu AI client."""

from .shared_analysis import SharedAnalysisClient


class ZhipuClient(SharedAnalysisClient):
    """智谱 AI (GLM) 客户端"""

    provider_name = "zhipu"
    display_name = "Zhipu"
