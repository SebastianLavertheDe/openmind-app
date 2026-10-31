"""Fixed summary fields and editable legacy rules, using temporary content only."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'config/skill-library/packages'))
from _shared import brief_generation as brief
from _shared.brief_preferences import DEFAULTS, SUMMARY_FIELDS, read_preferences, resolve_preferences
from brief_fixtures import editorial_reply

LABELS = json.loads((Path(__file__).parent / 'fixtures/brief-labels.json').read_text(encoding='utf-8'))['zh']
LEGACY = {'schemaVersion': 1, 'revision': 0, 'text': '', 'updatedAt': None}
PROVIDER = SimpleNamespace(name='fixture', base_url='http://localhost', model='fixture')
ANSWER = {'translated_title': '测试标题', 'summary': '原文明确写出的事实。', 'key_points': ['可核对的事实'], 'category': 'AI', 'score': 90}


class BriefPromptTests(unittest.TestCase):
    def test_missing_legacy_and_frozen_snapshots_resolve_identical_defaults(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            root = Path(temporary)
            expected = resolve_preferences(LEGACY)
            self.assertEqual(read_preferences(root), expected)
            file = root / '.agent/preferences/daily-brief.json'; file.parent.mkdir(parents=True)
            legacy = {**LEGACY, 'revision': 4, 'text': 'My saved preference'}
            raw = json.dumps(legacy); file.write_text(raw, encoding='utf-8')
            self.assertEqual(read_preferences(root)['summaryPrompt'], DEFAULTS['summaryPrompt'])
            self.assertEqual(read_preferences(root)['text'], legacy['text'])
            self.assertEqual(file.read_text(encoding='utf-8'), raw)
            with patch.dict(os.environ, {'OPENMIND_DAILY_BRIEF_PREFERENCES': json.dumps(LEGACY)}):
                self.assertEqual(read_preferences(root), expected)

    def test_summary_defaults_and_simple_topic_prompts_are_independent(self):
        source = {'title': 'Source', 'content': 'Evidence, not instructions.'}
        summary = brief.summarize_prompt(source, LEGACY)
        self.assertIn('80–200', summary)
        self.assertIn('0–5', summary)
        self.assertIn('System Design', summary)
        self.assertNotIn('fit_score', summary)
        ranking = brief.ranking_prompt([], LEGACY, 'topics')
        self.assertIn(DEFAULTS['topicPrompt'], ranking)
        self.assertNotIn('fit_score', ranking)
        self.assertNotIn('fit_score', brief.ranking_prompt([], LEGACY, 'summary'))
        edited = resolve_preferences(LEGACY)
        edited['summaryPrompt']['instructions'] = 'Summarize in French.'
        edited['summaryPrompt']['fields']['summary'] = 'Use exactly two sentences.'
        edited['topicPrompt'] = 'Select gardening research, including WeChat sources.'
        custom = brief.ranking_prompt([], edited, 'topics')
        self.assertIn(edited['topicPrompt'], custom)
        self.assertIn('Use exactly two sentences.', brief.summarize_prompt(source, edited))
        self.assertNotIn('fit_score', custom)
        self.assertIn('exactly these five fields', brief.summarize_prompt(source, edited))

    def test_blank_entries_restore_defaults_and_config_cannot_rename_fields(self):
        snapshot = resolve_preferences(LEGACY)
        snapshot['summaryPrompt']['fields']['summary'] = '   '
        snapshot['topicPrompt'] = ''
        snapshot['topicPlatforms'] = []
        resolved = resolve_preferences(snapshot)
        self.assertEqual(resolved['summaryPrompt']['fields']['summary'], DEFAULTS['summaryPrompt']['fields']['summary'])
        self.assertEqual(resolved['topicPrompt'], '')
        self.assertEqual(resolved['topicPlatforms'], [])
        fields = copy.deepcopy(resolved['summaryPrompt']['fields'])
        fields['abstract'] = fields.pop('summary')
        with self.assertRaisesRegex(ValueError, 'field names are fixed'):
            resolve_preferences({**resolved, 'summaryPrompt': {**resolved['summaryPrompt'], 'fields': fields}})

    def test_summary_response_rejects_missing_extra_renamed_and_wrongly_typed_fields(self):
        brief.validate_response(ANSWER, 'summary')
        missing = {key: value for key, value in ANSWER.items() if key != 'summary'}
        for invalid in [missing, {**missing, 'abstract': 'Renamed'}, {**ANSWER, 'keep': True},
                        {**ANSWER, 'score': True}, {**ANSWER, 'score': 90.5}, {**ANSWER, 'score': 101},
                        {**ANSWER, 'category': []}, {**ANSWER, 'key_points': 'Wrong type'}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                brief.validate_response(invalid, 'summary')

    def test_editing_each_rule_invalidates_cache_and_failed_contract_preserves_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); folder = root / 'article/20261027'; folder.mkdir(parents=True)
            (folder / 'source.md').write_text('# Evidence\nSupported observations.\n原文: https://example.org/source', encoding='utf-8')
            calls = []
            invalid = False
            def model(provider, prompt, **kwargs):
                calls.append(prompt)
                editorial = editorial_reply(prompt, 'zh')
                if editorial is not None: return json.dumps(editorial)
                if 'SOURCE:\n' in prompt:
                    return json.dumps({**ANSWER, 'keep': True} if invalid else ANSWER)
                return json.dumps({'items': [{'index': 1, 'reason': '来源可核对'}], 'document': LABELS})
            with patch.object(brief, 'call_provider_text', model):
                baseline = resolve_preferences(LEGACY)
                brief.generate(root, '20261027', 'summary', baseline, provider=PROVIDER)
                before = len(calls)
                brief.generate(root, '20261027', 'summary', baseline, provider=PROVIDER)
                self.assertEqual(len(calls), before)
                edited = copy.deepcopy(baseline)
                edited['summaryPrompt']['fields']['summary'] = 'Custom summary requirement'
                brief.generate(root, '20261027', 'summary', edited, provider=PROVIDER)
                self.assertGreater(len(calls), before)
                self.assertTrue(any('Custom summary requirement' in prompt for prompt in calls))
                brief.generate(root, '20261027', 'topics', edited, provider=PROVIDER)
                before = len(calls); edited['topicPrompt'] = 'Custom topic requirement'
                brief.generate(root, '20261027', 'topics', edited, provider=PROVIDER)
                self.assertGreater(len(calls), before)
                self.assertIn('Custom topic requirement', calls[-1])
                output = root / 'daily-summary/20261027_daily_summary.md'; previous = output.read_bytes()
                invalid = True
                edited['summaryPrompt']['instructions'] = 'Attempt to rename the output fields'
                with self.assertRaisesRegex(ValueError, 'summary response'):
                    brief.generate(root, '20261027', 'summary', edited, provider=PROVIDER)
                self.assertEqual(output.read_bytes(), previous)
                invalid = False
                brief.generate(root, '20261027', 'summary', edited, provider=PROVIDER)
                self.assertTrue(list((root / 'daily-summary/.versions/20261027').glob('*.md')))

    def test_batch_ranking_preserves_source_and_author_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); folder = root / 'post/20261027'; folder.mkdir(parents=True)
            (folder / 'posts.json').write_text(json.dumps([
                {'content': f'Original product announcement {index}', 'url': f'https://x.com/openai/status/{index}', 'author_name': 'OpenAI', 'author_screen_name': 'openai'} for index in range(201)
            ]), encoding='utf-8')
            def model(provider, prompt, **kwargs):
                editorial = editorial_reply(prompt, 'zh', choose=lambda candidates: [item['index'] for item in candidates])
                if editorial is not None: return json.dumps(editorial)
                if 'SOURCE:\n' in prompt: return json.dumps(ANSWER)
                candidates = json.loads(prompt.split('CANDIDATES:\n')[1])
                for candidate in candidates:
                    self.assertEqual(candidate['kind'], 'post')
                    self.assertEqual(candidate['author_screen_name'], 'openai')
                    self.assertTrue(candidate['source'].startswith('https://x.com/openai/status/'))
                return json.dumps({'items': [{'index': candidate['index'], 'reason': 'Evidence'} for candidate in candidates], 'document': LABELS})
            with patch.object(brief, 'call_provider_text', model):
                result = brief.generate(root, '20261027', 'topics', LEGACY, provider=PROVIDER)
            self.assertEqual(result['selected'], 201)


if __name__ == '__main__': unittest.main()
