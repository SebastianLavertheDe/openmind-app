"""Content-safety refusals skip only the rejected source, using temporary data."""
import contextlib
import io
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
from _shared.ai_client import AIProviderError

LABELS = json.loads((Path(__file__).parent / 'fixtures/brief-labels.json').read_text(encoding='utf-8'))['zh']
PREFERENCES = {'schemaVersion': 1, 'revision': 0, 'text': '', 'updatedAt': None}
PROVIDER = SimpleNamespace(name='fixture', base_url='http://localhost', model='fixture')
ANSWER = {'translated_title': 'Evidence', 'summary': 'Supported facts.', 'key_points': [], 'category': 'Science', 'score': 80}


def refusal(code='1301', message='Sensitive content', status=400):
    return AIProviderError('Raw response must stay private: fixture-secret', status_code=status,
                           response_text=json.dumps({'error': {'code': code, 'message': message}}))


class BriefContentSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.folder = self.root / 'article/20261102'
        self.folder.mkdir(parents=True)
        self.output = self.root / 'daily-summary/20261102_daily_summary.md'
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def sources(self, titles):
        for index, title in enumerate(titles, 1):
            (self.folder / f'{index}.md').write_text(f'# {title}\nSupported facts for {title}.', encoding='utf-8')

    def test_refusal_skips_one_source_and_never_reintroduces_its_title(self):
        self.sources(['Before', 'Rejected marker', 'After'])
        for error in [refusal(), refusal(1301), refusal(None, '输入或生成内容可能包含敏感内容'),
                      refusal(None, '系统检测到输入或生成内容可能包含不安全或敏感内容')]:
            with self.subTest(response=error.response_text):
                seen = []
                def model(provider, prompt, **kwargs):
                    if 'SOURCE:\n' in prompt:
                        source = json.loads(prompt.split('SOURCE:\n')[1])
                        seen.append(source['title'])
                        if source['title'] == 'Rejected marker': raise error
                        return json.dumps({**ANSWER, 'translated_title': source['title']})
                    self.fail('Daily summaries must not make a selection request.')
                diagnostics = io.StringIO()
                with patch.object(brief, 'call_provider_text', model), contextlib.redirect_stderr(diagnostics):
                    result = brief.generate(self.root, '20261102', 'summary', PREFERENCES, provider=PROVIDER)
                self.assertEqual(result['status'], 'succeeded')
                self.assertEqual(result['selected'], 2)
                self.assertEqual(result['skippedSources'], [{'index': 2, 'path': 'article/20261102/2.md', 'reason': 'content-safety'}])
                document = self.output.read_text(encoding='utf-8')
                self.assertIn('Before', document)
                self.assertIn('After', document)
                self.assertNotIn('Rejected marker', document)
                self.assertIn('"skippedSourceCount": 1', document)
                self.assertIn('source-skipped', diagnostics.getvalue())
                self.assertNotIn('fixture-secret', diagnostics.getvalue())
                self.assertNotIn(error.response_text, diagnostics.getvalue())
                snapshots = list((self.root / '.agent/skill-data/brief-generation/snapshots').glob('*.json'))
                self.assertTrue(any(json.loads(file.read_text())['skippedSources'] == result['skippedSources'] for file in snapshots))
                # Only successful source results are cached; a refusal remains a skip on rerun.
                self.assertIn('Rejected marker', seen)

    def test_all_rejected_sources_skip_without_overwriting_existing_summary(self):
        self.sources(['Rejected A', 'Rejected B'])
        self.output.parent.mkdir(parents=True)
        self.output.write_text('Previous summary', encoding='utf-8')
        with patch.object(brief, 'call_provider_text', side_effect=refusal()) as model, contextlib.redirect_stderr(io.StringIO()):
            result = brief.generate(self.root, '20261102', 'summary', PREFERENCES, provider=PROVIDER)
        self.assertEqual(result['status'], 'skipped')
        self.assertEqual(result['reason'], 'content-safety')
        self.assertEqual(len(result['skippedSources']), 2)
        self.assertEqual(model.call_count, 2)
        self.assertEqual(self.output.read_text(), 'Previous summary')

    def test_process_reports_all_skipped_as_successful_exit_with_a_durable_result(self):
        self.sources(['Rejected'])
        run = self.root / 'private-run'
        args = ['main.py', '--date', '20261102', '--content-root', str(self.root), '--run-dir', str(run)]
        with patch.object(sys, 'argv', args), patch.object(brief, 'resolve_provider', return_value=PROVIDER), \
                patch.object(brief, 'call_provider_text', side_effect=refusal()), \
                contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(brief.main('summary'), 0)
        result = json.loads((run / 'result.json').read_text())
        self.assertEqual(result['status'], 'skipped')
        self.assertEqual(len(result['skippedSources']), 1)
        self.assertFalse(self.output.exists())

    def test_other_provider_failures_still_fail_and_preserve_existing_summary(self):
        self.sources(['Evidence'])
        self.output.parent.mkdir(parents=True)
        self.output.write_text('Previous summary', encoding='utf-8')
        errors = [refusal('invalid_request', 'Invalid parameter'), refusal(status=401), refusal(status=429),
                  AIProviderError('Network failure'), AIProviderError('Unknown response', status_code=400, response_text='not JSON')]
        for error in errors:
            with self.subTest(error=error.response_text), patch.object(brief, 'call_provider_text', side_effect=error):
                if error.status_code == 401:
                    with self.assertRaises(AIProviderError):
                        brief.generate(self.root, '20261102', 'summary', PREFERENCES, provider=PROVIDER)
                else:
                    with contextlib.redirect_stderr(io.StringIO()):
                        result = brief.generate(self.root, '20261102', 'summary', PREFERENCES, provider=PROVIDER)
                    self.assertEqual(result['status'], 'failed')
                    self.assertEqual(result['failedSources'][0]['reason'], 'provider-error')
                    self.assertEqual(result['skippedSources'], [])
                self.assertEqual(self.output.read_text(), 'Previous summary')

    def test_invalid_json_is_not_misclassified_as_a_safety_skip(self):
        self.sources(['Evidence'])
        with patch.object(brief, 'call_provider_text', return_value='{invalid JSON'), contextlib.redirect_stderr(io.StringIO()):
            result = brief.generate(self.root, '20261102', 'summary', PREFERENCES, provider=PROVIDER)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['skippedSources'], [])
        self.assertEqual(result['failedSources'][0]['reason'], 'invalid-response')
        self.assertFalse(self.output.exists())

    def test_topic_generation_receives_only_accepted_sources(self):
        self.sources(['Rejected marker', 'Accepted'])
        def model(provider, prompt, **kwargs):
            source = json.loads(prompt.split('SOURCE:\n')[1])
            if source['title'] == 'Rejected marker': raise refusal()
            return json.dumps(ANSWER)
        def topic_report(date, summaries, snapshot, provider, cache):
            self.assertEqual([row['source']['title'] for row in summaries], ['Accepted'])
            return '# Topics\n<!-- openmind-brief-metadata -->\nAccepted', summaries
        with patch.object(brief, 'call_provider_text', model), patch('_shared.topic_generation.topic_report', topic_report), contextlib.redirect_stderr(io.StringIO()):
            result = brief.generate(self.root, '20261102', 'topics', PREFERENCES, provider=PROVIDER)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['selected'], 1)
        self.assertEqual(len(result['skippedSources']), 1)


if __name__ == '__main__': unittest.main()
