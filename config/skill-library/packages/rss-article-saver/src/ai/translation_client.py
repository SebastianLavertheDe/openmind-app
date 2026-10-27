"""
Fallback Translation Client
Claude(智谱) -> DeepSeek -> Doubao
"""

import time
from typing import Optional

from .shared_translation import SharedTranslator


class FallbackTranslator:
    """Multi-provider translation client with fallback chain"""

    _CHAIN = [
        ("Claude(智谱)", "claude"),
        ("DeepSeek", "deepseek"),
        ("Doubao", "doubao"),
    ]

    def __init__(self):
        self.clients = []

        for label, provider_name in self._CHAIN:
            try:
                client = _make_translator(provider_name)
                self.clients.append((label, client))
                print(f"Translation client initialized: {label}")
            except Exception as e:
                print(f"Translation client {label} init skipped: {e}")

        if not self.clients:
            print("Error: No translation client available")

    def translate_title(self, title: str) -> Optional[str]:
        for label, client in self.clients:
            try:
                result = client.translate_title(title)
                if result:
                    if label != self.clients[0][0]:
                        print(f"  ✓ Translation used fallback: {label}")
                    return result
            except Exception as e:
                print(f"  Translation {label} error: {e}")
                continue
        return None

    def translate_to_chinese(self, text: str, max_retries: int = 3) -> Optional[str]:
        for idx, (label, client) in enumerate(self.clients):
            try:
                result = client.translate_to_chinese(text, max_retries=max_retries)
                if result:
                    if label != self.clients[0][0]:
                        print(f"  ✓ Translation used fallback: {label}")
                    return result
            except Exception as e:
                print(f"  Translation {label} error: {e}")
                if idx < len(self.clients) - 1:
                    time.sleep(2)
                continue
        return None


class _GenericTranslator(SharedTranslator):
    provider_name = ""
    display_name = ""


def _make_translator(provider_name: str) -> _GenericTranslator:
    from ..ai_client import resolve_provider

    t = _GenericTranslator()
    t.provider_name = provider_name
    t.provider = resolve_provider()
    t.model = t.provider.model
    t.base_url = t.provider.base_url
    t.display_name = provider_name.capitalize()
    return t
