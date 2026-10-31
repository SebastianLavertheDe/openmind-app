"""Deterministic provider replies for editorial-flow contract tests."""
import json
from pathlib import Path

TOPIC_LABELS = json.loads((Path(__file__).parent / 'fixtures/topic-labels.json').read_text(encoding='utf-8'))


def editorial_reply(prompt, language='en', choose=None):
    if 'Configured platform IDs and names: ' in prompt:
        platforms = json.loads(prompt.split('Configured platform IDs and names: ', 1)[1].split('\n', 1)[0])
        candidates = json.loads(prompt.split('CANDIDATES:\n', 1)[1])
        indexes = choose(candidates) if choose else [1] if candidates else []
        return {'platforms': [{'id': platform['id'], 'items': [{'index': index, 'reason': 'Evidence'} for index in indexes]} for platform in platforms], 'document': TOPIC_LABELS[language]}
    if 'TOPIC_SOURCE:\n' in prompt:
        source = json.loads(prompt.split('TOPIC_SOURCE:\n', 1)[1])
        title = source.get('extracted_title') or source['title']
        return {'titles': [title, title + ' 2', title + ' 3'], 'core_view': source['extracted_summary'], 'why': 'Evidence', 'audience': 'Readers', 'outline': 'Evidence then implications', 'hook': 'Observed change', 'visuals': 'Source comparison', 'interaction': 'Discuss the evidence', 'risk': 'Verify the source', 'recommendation': '8/10: Evidence'}
    if 'EDITORIAL_TREATMENTS:\n' in prompt:
        groups = json.loads(prompt.split('EDITORIAL_TREATMENTS:\n', 1)[1])
        group = next(group for group in groups if group['items'])
        return {'pick': {'platformId': group['platformId'], 'index': group['items'][0]['index']}, 'judgment': 'Evidence', 'alternatives': 'Other candidates are less relevant', 'angle': 'Original evidence', 'risk': 'Verify the source', 'follow_up': ['Track source updates'], 'evergreen': ['Reusable findings']}
    return None
