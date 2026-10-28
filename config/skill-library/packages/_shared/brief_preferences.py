"""Immutable per-run preference snapshot, shared by summaries and topic selection."""
import hashlib
import json
import os
from pathlib import Path

PROMPT_VERSION = 'openmind-brief-v3'
NEUTRAL = 'Faithfully summarize the selected content. Organize by information quality and recency. Do not favor a subject, author, platform or viral potential. Use the source language unless the user requests another language.'


def read_preferences(root):
    supplied = os.environ.get('OPENMIND_DAILY_BRIEF_PREFERENCES')
    file = Path(root) / '.agent' / 'preferences' / 'daily-brief.json'
    if not file.resolve().is_relative_to(Path(root).resolve()):
        raise ValueError('Preferences must stay inside the content root.')
    value = json.loads(supplied) if supplied else json.loads(file.read_text(encoding='utf-8')) if file.exists() else {'schemaVersion': 1, 'revision': 0, 'text': '', 'updatedAt': None}
    if value.get('schemaVersion') != 1 or not isinstance(value.get('revision'), int) or value['revision'] < 0 or not isinstance(value.get('text'), str) or len(value['text']) > 12000:
        raise ValueError('Invalid daily brief preferences.')
    return value


def preference_digest(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def preference_prompt(snapshot):
    return 'User preferences (selection, exclusions, language, length and item limits):\n' + (snapshot['text'].strip() or NEUTRAL)
