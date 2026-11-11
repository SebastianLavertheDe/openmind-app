"""Large daily summaries publish cached articles without an aggregate model call."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'config/skill-library/packages'))
from _shared import brief_generation as brief
from test_brief_content_safety import ANSWER, PREFERENCES, PROVIDER


class LocalAssemblyTests(unittest.TestCase):
    def test_large_summary_keeps_every_score_and_distinct_source_then_regenerates_offline(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            root = Path(temporary)
            folder = root / 'article/20261109'
            folder.mkdir(parents=True)
            for i in range(205):
                (folder / f'{i:03}.md').write_text(f'# Same event\nSource {i}\n原文: https://example.org/{i}', encoding='utf-8')
            # Exact URL duplicates are still removed locally, but distinct
            # reports of the same event must not be discarded by a model.
            (folder / 'duplicate.md').write_text('# Duplicate\n原文: https://example.org/0', encoding='utf-8')

            def model(provider, prompt, **kwargs):
                self.assertIn('SOURCE:\n', prompt)
                source = json.loads(prompt.split('SOURCE:\n')[1])
                i = int(source['url'].rsplit('/', 1)[1])
                return json.dumps({**ANSWER, 'translated_title': f'Article {i}', 'score': i % 101,
                                   'category': 'AI' if i % 2 else 'Science'})

            with patch.object(brief, 'call_provider_text', model) as _:
                result = brief.generate(root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
            self.assertEqual(result['selected'], 205)
            output = root / result['path']
            before = output.read_bytes()
            text = before.decode()
            self.assertNotIn('openmind-brief-sources', text)
            expected = [f'Article {i}' for parity in (0, 1)
                        for i in sorted(range(parity, 205, 2), key=lambda i: -(i % 101))]
            self.assertEqual(re.findall(r'^### (.+)$', text, re.M), expected)
            self.assertEqual(re.findall(r'^## (.+)$', text, re.M), ['📚 Science', '📚 AI'])
            self.assertNotIn('**推荐理由**', text)
            self.assertIn('**评分**: 0/100', text)
            for i in range(205): self.assertIn(f'https://example.org/{i}', text)
            self.assertEqual(len(list((root / '.agent/skill-data/brief-generation/cache').glob('*.json'))), 205)

            with patch.object(brief, 'call_provider_text', side_effect=AssertionError('Unexpected model call')) as model:
                rerun = brief.generate(root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
            model.assert_not_called()
            self.assertEqual(rerun['selected'], 205)
            self.assertEqual(next((root / 'daily-summary/.versions/20261109').glob('*.md')).read_bytes(), before)

    def test_private_sources_follow_restored_versions_and_failed_writes_preserve_output(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            root = Path(temporary)
            folder = root / 'article/20261109'; folder.mkdir(parents=True)
            source = folder / 'article.md'
            source.write_text('# Original\nFirst source', encoding='utf-8')
            with patch.object(brief, 'call_provider_text', return_value=json.dumps({**ANSWER, 'translated_title': 'Original'})):
                result = brief.generate(root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
            output = root / result['path']
            original = output.read_text()
            source.write_text('# Revised\nSecond source', encoding='utf-8')
            with patch.object(brief, 'call_provider_text', return_value=json.dumps({**ANSWER, 'translated_title': 'Revised'})):
                brief.generate(root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
            revised = output.read_text()
            self.assertEqual(brief.legacy_summary_candidates(root, '20261109')[0]['title'], 'Revised')
            output.write_text(original, encoding='utf-8')
            self.assertEqual(brief.legacy_summary_candidates(root, '20261109')[0]['title'], 'Original')
            output.write_text(revised, encoding='utf-8')
            with patch.object(brief, 'write_json', side_effect=OSError('Disk full')):
                with self.assertRaises(OSError): brief.generate(root, '20261109', 'summary', PREFERENCES, provider=PROVIDER)
            self.assertEqual(output.read_text(), revised)
            self.assertEqual(brief.legacy_summary_candidates(root, '20261109')[0]['title'], 'Revised')

    def test_localization_never_receives_articles_and_is_cached_before_source_processing(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {}, clear=True):
            root = Path(temporary)
            folder = root / 'article/20261109'; folder.mkdir(parents=True)
            (folder / 'source.md').write_text('# Private source marker\nPrivate evidence marker', encoding='utf-8')
            labels = json.loads((Path(__file__).parent / 'fixtures/brief-labels.json').read_text())['fr']
            calls = []
            def model(provider, prompt, **kwargs):
                calls.append(prompt)
                if 'SOURCE:\n' in prompt:
                    return json.dumps({**ANSWER, 'translated_title': 'Recherche'})
                self.assertNotIn('Private source marker', prompt)
                self.assertNotIn('Private evidence marker', prompt)
                self.assertNotIn('CANDIDATES:', prompt)
                self.assertLess(len(prompt), 15000)
                return json.dumps({'document': labels})
            snapshot = {**PREFERENCES, 'text': 'Répondre uniquement en français'}
            with patch.object(brief, 'call_provider_text', model):
                result = brief.generate(root, '20261109', 'summary', snapshot, provider=PROVIDER)
                brief.generate(root, '20261109', 'summary', snapshot, provider=PROVIDER)
            self.assertEqual(len(calls), 2)
            self.assertIn('Localize daily summary document labels only', calls[0])
            self.assertIn('SOURCE:\n', calls[1])
            self.assertIn(labels['summary_title'], (root / result['path']).read_text())


if __name__ == '__main__': unittest.main()
