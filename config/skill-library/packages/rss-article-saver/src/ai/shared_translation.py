"""Translation adapter backed by the package-local AI client."""

from __future__ import annotations

import html
import json
import re
from typing import Optional

from bs4 import BeautifulSoup

from ..ai_client import call_provider_text, extract_json_text, resolve_provider


class SharedTranslator:
    provider_name = ""
    display_name = ""

    def __init__(self):
        self.provider = resolve_provider()
        self.model = self.provider.model
        self.base_url = self.provider.base_url

    def translate_title(self, title: str) -> Optional[str]:
        if not title or len(title.strip()) < 1:
            return title
        prompt = f"""Translate the following title to Chinese.

Original title: {title}

Output format (JSON only):
{{"translation": "translated_title_here"}}

Rules:
- Return ONLY the JSON object
- Do NOT include any explanations or thinking process
- Keep it concise and accurate"""
        return self._translate_with_prompt(prompt, max_retries=3, max_tokens=200)

    def translate_to_chinese(self, text: str, max_retries: int = 3) -> Optional[str]:
        if not text or len(text.strip()) < 1:
            return text
        prompt = f"""Translate the following text to Chinese.

Text:
{text}

Output format (JSON only):
{{"translation": "translated_text_here"}}

Rules:
- Return ONLY the JSON object
- Do NOT include any explanations or thinking process
- Keep Markdown format
- Do not translate code blocks or URLs
- Keep technical terms accurate"""
        return self._translate_with_prompt(prompt, max_retries=max_retries, max_tokens=32768)

    def _translate_chunk(self, text: str, max_retries: int) -> Optional[str]:
        return self.translate_to_chinese(text, max_retries=max_retries)

    def _translate_with_prompt(
        self,
        prompt: str,
        *,
        max_retries: int,
        max_tokens: int,
    ) -> Optional[str]:
        try:
            raw = call_provider_text(
                self.provider,
                prompt,
                temperature=0.3,
                max_tokens=max_tokens,
                timeout=120,
                retries=max_retries,
                response_format_json=True,
            )
        except Exception as e:
            print(f"    Error: {self.display_name} translation failed: {e}")
            return None

        translation = extract_json_translation(raw)
        if translation:
            return self._clean_html_tags(translation)
        return self._clean_html_tags(raw)

    def _clean_html_tags(self, text: str) -> str:
        text = html.unescape(str(text or ""))
        try:
            soup = BeautifulSoup(text, "html.parser")
            clean_text = soup.get_text(separator="\n", strip=True)
        except Exception:
            clean_text = re.sub(r"<[^>]+>", "\n", text)
        clean_text = re.sub(r"\n{3,}", "\n\n", clean_text)
        return clean_text.strip()


def extract_json_translation(content: str) -> Optional[str]:
    if not content:
        return None
    try:
        result = json.loads(extract_json_text(content))
        translation = result.get("translation")
        if translation:
            return str(translation).strip()
    except (json.JSONDecodeError, AttributeError, TypeError, ValueError):
        pass

    match = re.search(r'\{[^{}]*"translation"\s*:\s*"([^"]+)"[^{}]*\}', content)
    if match:
        return match.group(1).strip()
    return None
