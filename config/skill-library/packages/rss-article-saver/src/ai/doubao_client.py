"""Doubao AI client."""

from .shared_analysis import SharedAnalysisClient


class DoubaoClient(SharedAnalysisClient):
    """Doubao AI client"""

    provider_name = "doubao"
    display_name = "Doubao"
