"""Daily summaries retain usable sources when individual model calls fail."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'config/skill-library/packages'))
from _shared import brief_generation as brief
from _shared.ai_client import AIProviderError
from test_brief_content_safety import ANSWER, LABELS, PREFERENCES, PROVIDER, refusal


class BriefSourceFailureTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        environment = patch.dict(os.environ, {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def sources(self, root, titles=('Before', 'Broken marker', 'After')):
        folder = root / 'article/20261109'
        folder.mkdir(parents=True)
        for index, title in enumerate(titles, 1):
            (folder / f'{index}.md').write_text(f'# {title}\nEvidence for {title}.', encoding='utf-8')

    def output(self, root):
        return root / 'daily-summary/20261109_daily_summary.md'

    def test_one_source_failure_continues_and_records_partial_output_without_leaking_errors(self):
        failures = [
            '{"summary": "fixture-secret", invalid JSON',
            json.dumps({**ANSWER, 'score': 'invalid'}),
            '[]',
            AIProviderError('Network error fixture-secret'),
            AIProviderError('HTTP fixture-secret', status_code=400, response_text='fixture-secret'),
            AIProviderError('Rate limit fixture-secret', status_code=429, response_text='fixture-secret'),
            AIProviderError('Upstream fixture-secret', status_code=502, response_text='fixture-secret'),
        ]
        for index, failure in enumerate(failures):
            with self.subTest(failure=index):
                root = self.root / str(index)
                self.sources(root)
                seen, ranking = [], []
                def model(provider, prompt, **kwargs):
                    if 'SOURCE:\n' in prompt:
                        source = json.loads(prompt.split('SOURCE:\n')[1])
                        seen.append(source['title'])
                        if source['title'] == 'Broken marker':
                            if isinstance(failure, Exception): raise failure
                            return failure
                        return json.dumps({**ANSWER, 'translated_title': source['title']})
                    ranking.append(prompt)
                    self.assertNotIn('Broken marker', prompt)
                    candidates = json.loads(prompt.split('CANDIDATES:\n')[1])
                    self.assertEqual([row['title'] for row in candidates], ['Before', 'After'])
                    return json.dumps({'items': [{'index': 1}, {'index': 2}], 'document': LABELS})
                diagnostics = io.StringIO()
                with patch.object(brief, 'call_provider_text', model), contextlib.redirect_stderr(diagnostics):
                    result = brief.generate(root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
                self.assertEqual(seen, ['Before', 'Broken marker', 'After'])
                self.assertEqual(len(ranking), 1)
                self.assertEqual(result['status'], 'partial')
                self.assertEqual(result['selected'], 2)
                failed = result['failedSources']
                self.assertEqual(len(failed), 1)
                self.assertEqual(failed[0]['index'], 2)
                self.assertEqual(failed[0]['path'], 'article/20261109/2.md')
                self.assertEqual(failed[0]['reason'], 'provider-error' if isinstance(failure, Exception) else 'invalid-response')
                if isinstance(failure, AIProviderError) and failure.status_code:
                    self.assertEqual(failed[0]['statusCode'], failure.status_code)
                self.assertEqual(result['skippedSources'], [])
                document = self.output(root).read_text()
                self.assertIn('Before', document)
                self.assertIn('After', document)
                self.assertNotIn('Broken marker', document)
                self.assertIn('"failedSourceCount": 1', document)
                data = root / '.agent/skill-data/brief-generation'
                snapshots = list((data / 'snapshots').glob('*.json'))
                self.assertEqual(len(snapshots), 1)
                self.assertEqual(json.loads(snapshots[0].read_text())['failedSources'], failed)
                self.assertEqual(len(list((data / 'cache').glob('*.json'))), 3)
                self.assertIn('source-failed', diagnostics.getvalue())
                for recorded in [diagnostics.getvalue(), json.dumps(result), snapshots[0].read_text(), document]:
                    self.assertNotIn('fixture-secret', recorded)

    def test_rerun_reuses_successes_and_retries_only_the_failed_source(self):
        self.sources(self.root)
        seen = []
        broken = True
        def model(provider, prompt, **kwargs):
            if 'SOURCE:\n' in prompt:
                source = json.loads(prompt.split('SOURCE:\n')[1])
                seen.append(source['title'])
                if broken and source['title'] == 'Broken marker': return '{invalid'
                return json.dumps({**ANSWER, 'translated_title': source['title']})
            candidates = json.loads(prompt.split('CANDIDATES:\n')[1])
            return json.dumps({'items': [{'index': row['index']} for row in candidates], 'document': LABELS})
        with patch.object(brief, 'call_provider_text', model), contextlib.redirect_stderr(io.StringIO()):
            first = brief.generate(self.root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
            previous = self.output(self.root).read_bytes()
            broken = False
            second = brief.generate(self.root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
        self.assertEqual(first['status'], 'partial')
        self.assertEqual(second['status'], 'succeeded')
        self.assertEqual(second['selected'], 3)
        self.assertNotIn('failedSources', second)
        self.assertEqual(seen, ['Before', 'Broken marker', 'After', 'Broken marker'])
        versions = list((self.root / 'daily-summary/.versions/20261109').glob('*.md'))
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0].read_bytes(), previous)

    def test_partial_process_exits_successfully_and_writes_result_and_artifact(self):
        self.sources(self.root)
        run = self.root / 'run'
        args = ['main.py', '--date', '20261109', '--content-root', str(self.root), '--run-dir', str(run)]
        def model(provider, prompt, **kwargs):
            if 'SOURCE:\n' in prompt:
                source = json.loads(prompt.split('SOURCE:\n')[1])
                if source['title'] == 'Broken marker': return '{invalid'
                return json.dumps(ANSWER)
            return json.dumps({'items': [{'index': 1}, {'index': 2}], 'document': LABELS})
        with patch.object(sys, 'argv', args), patch.object(brief, 'resolve_provider', return_value=PROVIDER), \
                patch.object(brief, 'call_provider_text', model), contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(brief.main('summary'), 0)
        result = json.loads((run / 'result.json').read_text())
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(len(result['failedSources']), 1)
        artifact = json.loads((run / 'artifacts.json').read_text())['artifacts'][0]
        self.assertEqual(artifact['logicalPath'], 'daily-summary/20261109_daily_summary.md')
        self.assertTrue(self.output(self.root).exists())

    def test_all_failed_process_preserves_old_summary_and_reports_nonzero_exit(self):
        self.sources(self.root, ['Invalid', 'Rejected', 'Invalid too'])
        output = self.output(self.root)
        output.parent.mkdir(parents=True)
        output.write_text('Previous summary', encoding='utf-8')
        run = self.root / 'run'
        args = ['main.py', '--date', '20261109', '--content-root', str(self.root), '--run-dir', str(run)]
        seen = []
        def model(provider, prompt, **kwargs):
            source = json.loads(prompt.split('SOURCE:\n')[1])
            seen.append(source['title'])
            if source['title'] == 'Rejected': raise refusal()
            return '{invalid'
        with patch.object(sys, 'argv', args), patch.object(brief, 'resolve_provider', return_value=PROVIDER), \
                patch.object(brief, 'call_provider_text', model), contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(brief.main('summary'), 1)
        result = json.loads((run / 'result.json').read_text())
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(len(result['failedSources']), 2)
        self.assertEqual(len(result['skippedSources']), 1)
        self.assertEqual(seen, ['Invalid', 'Rejected', 'Invalid too'])
        self.assertEqual(output.read_text(), 'Previous summary')
        self.assertFalse((run / 'artifacts.json').exists())
        self.assertFalse((self.root / 'daily-summary/.versions').exists())

    def test_authentication_and_permission_faults_still_stop_without_overwriting(self):
        for status in [401, 403]:
            with self.subTest(status=status):
                root = self.root / str(status)
                self.sources(root)
                output = self.output(root)
                output.parent.mkdir(parents=True)
                output.write_text('Previous summary', encoding='utf-8')
                seen = []
                def model(provider, prompt, **kwargs):
                    source = json.loads(prompt.split('SOURCE:\n')[1])
                    seen.append(source['title'])
                    if source['title'] == 'Broken marker':
                        raise AIProviderError('fixture-secret', status_code=status, response_text='fixture-secret')
                    return json.dumps(ANSWER)
                with patch.object(brief, 'call_provider_text', model), self.assertRaises(AIProviderError):
                    brief.generate(root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
                self.assertEqual(seen, ['Before', 'Broken marker'])
                self.assertEqual(output.read_text(), 'Previous summary')

    def test_ranking_failures_still_preserve_existing_summary(self):
        for index, failure in enumerate(['{invalid', json.dumps({'items': [{'index': 99}], 'document': LABELS}), AIProviderError('fixture-secret')]):
            with self.subTest(failure=index):
                root = self.root / str(index)
                self.sources(root)
                output = self.output(root)
                output.parent.mkdir(parents=True)
                output.write_text('Previous summary', encoding='utf-8')
                def model(provider, prompt, **kwargs):
                    if 'SOURCE:\n' in prompt:
                        source = json.loads(prompt.split('SOURCE:\n')[1])
                        return '{invalid' if source['title'] == 'Broken marker' else json.dumps(ANSWER)
                    if isinstance(failure, Exception): raise failure
                    return failure
                with patch.object(brief, 'call_provider_text', model), contextlib.redirect_stderr(io.StringIO()), \
                        self.assertRaises((AIProviderError, ValueError)):
                    brief.generate(root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
                self.assertEqual(output.read_text(), 'Previous summary')

    def test_failures_in_article_and_reddit_do_not_block_x_content(self):
        self.sources(self.root, ['Invalid article'])
        reddit = self.root / 'reddit/20261109/items.md'
        reddit.parent.mkdir(parents=True)
        reddit.write_text('# Invalid Reddit\nEvidence', encoding='utf-8')
        posts = self.root / 'post/20261109/posts.json'
        posts.parent.mkdir(parents=True)
        posts.write_text(json.dumps([{'text': 'Accepted X post', 'id': '123'}]), encoding='utf-8')
        def model(provider, prompt, **kwargs):
            if 'SOURCE:\n' in prompt:
                source = json.loads(prompt.split('SOURCE:\n')[1])
                return json.dumps(ANSWER) if source['kind'] == 'post' else '{invalid'
            candidates = json.loads(prompt.split('CANDIDATES:\n')[1])
            self.assertEqual([row['kind'] for row in candidates], ['post'])
            return json.dumps({'items': [{'index': 1}], 'document': LABELS})
        with patch.object(brief, 'call_provider_text', model), contextlib.redirect_stderr(io.StringIO()):
            result = brief.generate(self.root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['selected'], 1)
        self.assertEqual([r['path'] for r in result['failedSources']], ['article/20261109/1.md', 'reddit/20261109/items.md'])

    def test_topics_keep_existing_invalid_response_policy(self):
        self.sources(self.root)
        with patch.object(brief, 'call_provider_text', return_value='{invalid') as model, self.assertRaises(ValueError):
            brief.generate(self.root, '20261109', 'topics', PREFERENCES, provider=PROVIDER)
        self.assertEqual(model.call_count, 1)


if __name__ == '__main__': unittest.main()
