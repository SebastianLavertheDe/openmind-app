"""Immutable per-run preference snapshot, shared by summaries and topic selection."""
import hashlib
import json
import os
from pathlib import Path

PROMPT_VERSION = 'openmind-brief-v5'
DEFAULTS = json.loads(Path(__file__).with_name('brief_defaults.json').read_text(encoding='utf-8'))
SUMMARY_FIELDS = ('translated_title', 'summary', 'key_points', 'category', 'score')
SUMMARY_CONTRACT = 'Fixed output contract (overrides any conflicting editable instructions): Return exactly one JSON object with exactly these five fields: {"translated_title":string,"summary":string,"key_points":[string],"category":string,"score":integer 0..100}. Never rename, omit or add fields. Do not wrap JSON in Markdown or add other text.'


def resolve_preferences(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != 1 or type(value.get('revision')) is not int or value['revision'] < 0 or not isinstance(value.get('text'), str) or len(value['text']) > 12000:
        raise ValueError('Invalid daily brief preferences.')
    prompt = value.get('summaryPrompt', DEFAULTS['summaryPrompt'])
    if not isinstance(prompt, dict) or set(prompt) != {'instructions', 'fields'} or not isinstance(prompt['instructions'], str) or len(prompt['instructions']) > 12000:
        raise ValueError('Invalid summary prompt.')
    fields = prompt['fields']
    if not isinstance(fields, dict) or set(fields) != set(SUMMARY_FIELDS) or any(not isinstance(fields[key], str) or len(fields[key]) > 4000 for key in SUMMARY_FIELDS):
        raise ValueError('Summary field names are fixed.')
    legacy = value.get('topicRules', '')
    if not isinstance(legacy, str) or len(legacy) > 20000:
        raise ValueError('Invalid topic rules.')
    legacy = legacy.strip() if legacy.strip() != DEFAULTS['legacyTopicRules'].strip() else ''
    topics = value.get('topicPrompt', legacy or DEFAULTS['topicPrompt'])
    if not isinstance(topics, str) or len(topics) > 20000:
        raise ValueError('Invalid topic prompt.')
    platforms = value.get('topicPlatforms', DEFAULTS['topicPlatforms'])
    if not isinstance(platforms, list) or len(platforms) > 12:
        raise ValueError('Invalid topic platforms.')
    names, ids, normalized = set(), set(), []
    import unicodedata
    for platform in platforms:
        if not isinstance(platform, dict) or set(platform) != {'id', 'name', 'prompt'} or any(not isinstance(platform[key], str) for key in ('id', 'name', 'prompt')):
            raise ValueError('Invalid topic platform.')
        identity, name = platform['id'].strip(), platform['name'].strip()
        key = unicodedata.normalize('NFKC', name).lower()
        if not identity or len(identity) > 80 or not name or len(name) > 80 or len(platform['prompt']) > 12000 or identity in ids or key in names:
            raise ValueError('Platform names and IDs must be nonempty and unique.')
        ids.add(identity); names.add(key)
        normalized.append({'id': identity, 'name': name, 'prompt': platform['prompt']})
    return {**{key: entry for key, entry in value.items() if key != 'topicRules'}, 'summaryPrompt': {
        'instructions': prompt['instructions'].strip() or DEFAULTS['summaryPrompt']['instructions'],
        'fields': {key: fields[key].strip() or DEFAULTS['summaryPrompt']['fields'][key] for key in SUMMARY_FIELDS}
    }, 'topicPrompt': topics.strip(), 'topicPlatforms': normalized}


def read_preferences(root):
    supplied = os.environ.get('OPENMIND_DAILY_BRIEF_PREFERENCES')
    file = Path(root) / '.agent' / 'preferences' / 'daily-brief.json'
    if not file.resolve().is_relative_to(Path(root).resolve()):
        raise ValueError('Preferences must stay inside the content root.')
    value = json.loads(supplied) if supplied else json.loads(file.read_text(encoding='utf-8')) if file.exists() else {'schemaVersion': 1, 'revision': 0, 'text': '', 'updatedAt': None}
    return resolve_preferences(value)


def preference_digest(snapshot):
    return hashlib.sha256(json.dumps(resolve_preferences(snapshot), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def preference_prompt(snapshot):
    return 'Additional user preferences (selection, exclusions, language, length and item limits; explicit requests override conflicting editable content rules above, never the fixed output contract):\n' + (snapshot['text'].strip() or 'No additional preferences. Use the configured summary prompt and topic rules.')


def summary_instructions(snapshot):
    prompt = resolve_preferences(snapshot)['summaryPrompt']
    return '\n'.join(['Summary instructions:', prompt['instructions'], 'Summary field requirements:', *[key + ': ' + prompt['fields'][key] for key in SUMMARY_FIELDS]])


def topic_prompt_context(snapshot):
    snapshot = resolve_preferences(snapshot)
    lines = ['## 通用选题提示词', snapshot['topicPrompt']]
    for platform in snapshot['topicPlatforms']:
        lines += ['## 平台：' + platform['name'], platform['prompt']]
    if snapshot['text'].strip(): lines += ['## 补充偏好', snapshot['text'].strip()]
    return '\n\n'.join(lines)
