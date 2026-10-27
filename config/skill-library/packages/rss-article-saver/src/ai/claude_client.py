"""Claude (Zhipu GLM) AI client."""

from .shared_analysis import SharedAnalysisClient


class ClaudeClient(SharedAnalysisClient):
    """Claude (Zhipu GLM) AI client"""

    provider_name = "claude"
    display_name = "Claude(智谱)"
