"""Article summarizer adapter backed by the package-local AI client."""

from __future__ import annotations

import json
from typing import Dict, Optional

from ..ai_client import call_provider_text, extract_json_text, resolve_provider


class SharedArticleSummarizer:
    provider_name = ""
    display_name = ""

    def __init__(self):
        self.provider = resolve_provider()
        self.model = self.provider.model
        self.base_url = self.provider.base_url

    def summarize_article(
        self, title: str, content: str, max_retries: int = 3
    ) -> Optional[Dict]:
        if len(content) > 8000:
            content = content[:8000] + "..."

        prompt = build_daily_summary_prompt(title, content)

        try:
            content_text = call_provider_text(
                self.provider,
                prompt,
                temperature=0.3,
                max_tokens=4000,
                timeout=120,
                retries=max_retries,
                response_format_json=True,
            )
        except Exception as e:
            print(f"    Error: {self.display_name} summarization failed: {e}")
            return None

        if not content_text:
            print(f"    Warning: Empty response from {self.display_name} API")
            return None

        json_str = extract_json_text(content_text)
        try:
            result = json.loads(json_str)
        except json.JSONDecodeError as e:
            print(f"    Warning: Failed to parse {self.display_name} JSON response: {e}")
            print(f"    Response was: {json_str[:200]}...")
            return None

        from _shared.brief_generation import validate_response
        try:
            validate_response(result, 'summary')
        except ValueError:
            print(f"    Warning: Invalid summary fields in {self.display_name} response")
            return None

        return {
            "translated_title": result.get("translated_title", title),
            "summary": result.get("summary", ""),
            "key_points": result.get("key_points", []),
            "category": result.get("category", "Other"),
            "score": int(result.get("score", 70)),
        }


def build_daily_summary_prompt(title: str, content: str) -> str:
    import os
    from _shared.brief_preferences import read_preferences
    from _shared.brief_generation import summarize_prompt
    snapshot = read_preferences(os.environ["OPENMIND_ROOT"])
    return summarize_prompt({'title': title, 'content': content}, snapshot)
