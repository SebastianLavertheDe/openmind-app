"""Google Gemini AI client."""

from .shared_analysis import SharedAnalysisClient
from .shared_translation import SharedTranslator


class GeminiTranslator(SharedTranslator):
    """Google Gemini 翻译客户端"""

    provider_name = "gemini"
    display_name = "Gemini"


class GeminiClient(SharedAnalysisClient):
    """Google Gemini AI 客户端"""

    provider_name = "gemini"
    display_name = "Gemini"
