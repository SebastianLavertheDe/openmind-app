"""Platform digests cover saved posts without competing with article ranking."""
import contextlib
import copy
import io
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
from _shared import social_brief as social
from _shared.ai_client import AIProviderError
from test_brief_content_safety import ANSWER, LABELS, PREFERENCES, PROVIDER, refusal

DATE = '20261110'


def social_response(prompt):
    sources = json.loads(prompt.split('SOCIAL_SOURCES:\n', 1)[1])
    return {'items': [{'index': row['index'], 'keep': row['content'] != 'Empty greeting',
                       'summary': 'Summary ' + row['title'][:40] if row['content'] != 'Empty greeting' else '',
                       'category': 'x_tools' if row['kind'] == 'post' else '', 'score': 80}
                      for row in sources]}


class SocialBriefTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        environment = patch.dict(os.environ, {}, clear=True)
        environment.start(); self.addCleanup(environment.stop)
        self.calls = []

    def posts(self, titles):
        file = self.root / f'post/{DATE}/posts.json'
        file.parent.mkdir(parents=True, exist_ok=True)
        rows = [{'id': str(i), 'text': title, 'url': f'https://x.com/fixture/status/{i}',
                 'author_name': 'Example Author', 'author_screen_name': 'fixture'} for i, title in enumerate(titles, 1)]
        file.write_text(json.dumps(rows), encoding='utf-8')
        return file

    def reddit(self, community, titles):
        file = self.root / f'reddit/{DATE}/{community}.md'
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(f'# r/{community} Hot Posts\n\n' + '\n\n'.join(
            f'## {i}. {title}\n\n- **Reddit 链接**: https://www.reddit.com/r/{community}/comments/id{i}/post/\n\n### 正文\nEvidence for {title}.'
            for i, title in enumerate(titles, 1)), encoding='utf-8')
        return file

    def article(self, title):
        file = self.root / f'article/{DATE}/{title}.md'
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(f'# {title}\nComplete article evidence.', encoding='utf-8')

    def model(self, provider, prompt, **kwargs):
        self.calls.append(prompt)
        if 'SOCIAL_SOURCES:\n' in prompt:
            sources = json.loads(prompt.split('SOCIAL_SOURCES:\n')[1])
            self.assertLessEqual(len(sources), social.BATCH_SIZE)
            self.assertEqual(len({row['kind'] for row in sources}), 1)
            return json.dumps(social_response(prompt))
        if 'SOURCE:\n' in prompt:
            source = json.loads(prompt.split('SOURCE:\n')[1])
            self.assertEqual(source['kind'], 'article')
            return json.dumps({**ANSWER, 'translated_title': source['title']})
        if 'CANDIDATES:\n' in prompt:
            candidates = json.loads(prompt.split('CANDIDATES:\n')[1])
            self.assertTrue(candidates)
            self.assertEqual({row['kind'] for row in candidates}, {'article'})
            return json.dumps({'items': [{'index': 1, 'reason': 'Article selection'}], 'document': LABELS})
        self.assertIn('Localize daily summary document labels only', prompt)
        return json.dumps({'items': [], 'document': LABELS})

    def generate(self, **kwargs):
        return brief.generate(self.root, DATE, 'summary', kwargs.pop('snapshot', PREFERENCES),
                              provider=kwargs.pop('provider', PROVIDER), **kwargs)

    def output(self):
        return (self.root / f'daily-summary/{DATE}_daily_summary.md').read_text(encoding='utf-8')

    def social_calls(self):
        return [json.loads(prompt.split('SOCIAL_SOURCES:\n')[1]) for prompt in self.calls if 'SOCIAL_SOURCES:\n' in prompt]

    def test_large_social_digests_are_independent_of_article_limit_and_keep_community_links(self):
        self.article('Article A'); self.article('Article B')
        self.posts([f'Product update {i}' for i in range(205)])
        self.reddit('Tools', [f'Tool post {i}' for i in range(21)])
        self.reddit('Science', [f'Science post {i}' for i in range(13)])
        snapshot = {**PREFERENCES, 'text': 'Keep at most 1 article; summarize every substantive X and Reddit post.'}
        with patch.object(brief, 'call_provider_text', self.model): result = self.generate(snapshot=snapshot)
        self.assertEqual(result['selected'], 240)
        self.assertEqual(result['status'], 'succeeded')
        batches = self.social_calls()
        self.assertEqual(len(batches), 13)
        self.assertEqual(sum(len(batch) for batch in batches), 239)
        self.assertEqual(sum('CANDIDATES:\n' in prompt for prompt in self.calls), 1)
        text = self.output()
        headings = re.findall(r'^## (.+)$', text, re.M)
        self.assertEqual(headings, ['🧵 当天 Post 总结', '💬 Reddit 热帖', '📚 Science'])
        self.assertIn('**原始帖子**: 205 · **参与总结**: 205', text)
        self.assertIn('**社区数**: 2 · **原始帖子**: 34 · **参与总结**: 34', text)
        self.assertIn('**概览**:', text); self.assertIn('**今日主线**:', text)
        self.assertIn('**Example Author (@fixture)**:', text)
        self.assertIn('### r/Science', text); self.assertIn('### r/Tools', text)
        self.assertIn('https://x.com/fixture/status/205', text)
        self.assertIn('https://www.reddit.com/r/Tools/comments/id21/post/', text)
        self.assertEqual(text.count('**评分**:'), 1)
        self.assertEqual(text.count('[原帖]'), 239)
        snapshots = list((self.root / '.agent/skill-data/brief-generation/snapshots').glob('*.json'))
        self.assertEqual(len(json.loads(snapshots[0].read_text())['sources']), 240)

    def test_incremental_cache_reuses_existing_and_excluded_posts_and_invalidates_edits(self):
        self.posts(['Update A', 'Empty greeting']); self.reddit('Tools', ['Tool A'])
        with patch.object(brief, 'call_provider_text', self.model):
            self.assertEqual(self.generate()['selected'], 2)
            self.calls.clear()
            self.generate(); self.assertEqual(self.calls, [])
            self.posts(['Update A', 'Empty greeting', 'Update B']); self.reddit('Tools', ['Tool A', 'Tool B'])
            self.assertEqual(self.generate()['selected'], 4)
            self.assertEqual([[row['title'] for row in batch] for batch in self.social_calls()], [['Update B'], ['Tool B']])
            self.calls.clear()
            self.posts(['Edited update A', 'Empty greeting', 'Update B'])
            self.generate()
            self.assertEqual([[row['title'] for row in batch] for batch in self.social_calls()], [['Edited update A']])
            self.calls.clear()
            self.generate(snapshot={**PREFERENCES, 'revision': 1, 'text': 'Summarize in English.'})
            self.assertEqual(sum(map(len, self.social_calls())), 5)
            self.calls.clear()
            changed_provider = copy.copy(PROVIDER); changed_provider.model = 'fixture-v2'
            self.generate(provider=changed_provider)
            self.assertEqual(sum(map(len, self.social_calls())), 5)
        self.assertTrue(list((self.root / f'daily-summary/.versions/{DATE}').glob('*.md')))

    def test_safety_refusal_and_malformed_batch_isolate_the_one_bad_post(self):
        for error in [refusal(), ValueError('malformed fixture-secret')]:
            with self.subTest(error=type(error).__name__):
                # Separate roots avoid reusing the successful cache across cases.
                self.root = self.root / type(error).__name__; self.root.mkdir()
                self.posts(['Before', 'Rejected', 'After'])
                self.reddit('Tools', ['Healthy Reddit'])
                def model(provider, prompt, **kwargs):
                    if 'SOCIAL_SOURCES:\n' in prompt:
                        rows = json.loads(prompt.split('SOCIAL_SOURCES:\n')[1])
                        if any(row['title'] == 'Rejected' for row in rows):
                            if isinstance(error, AIProviderError): raise error
                            return '{invalid'
                    return self.model(provider, prompt, **kwargs)
                log = io.StringIO()
                with patch.object(brief, 'call_provider_text', model), contextlib.redirect_stderr(log):
                    result = self.generate()
                self.assertEqual(result['selected'], 3)
                field = 'skippedSources' if isinstance(error, AIProviderError) else 'failedSources'
                self.assertEqual(len(result[field]), 1)
                self.assertNotIn('Summary Rejected', self.output())
                self.assertIn('Summary Before', self.output()); self.assertIn('Summary After', self.output())
                self.assertIn('Healthy Reddit', self.output())
                self.assertNotIn('fixture-secret', log.getvalue() + json.dumps(result) + self.output())

    def test_failed_sources_are_retried_without_resummarizing_successful_platform(self):
        self.posts(['Broken X']); self.reddit('Tools', ['Healthy Reddit'])
        broken = True
        def model(provider, prompt, **kwargs):
            if broken and 'SOCIAL_SOURCES:\n' in prompt and json.loads(prompt.split('SOCIAL_SOURCES:\n')[1])[0]['kind'] == 'post':
                raise AIProviderError('fixture-secret', status_code=502)
            return self.model(provider, prompt, **kwargs)
        with patch.object(brief, 'call_provider_text', model), contextlib.redirect_stderr(io.StringIO()):
            first = self.generate()
            self.assertEqual(first['status'], 'partial')
            self.assertEqual(first['selected'], 1)
            self.calls.clear(); broken = False
            second = self.generate()
        self.assertEqual(second['status'], 'succeeded')
        self.assertEqual(second['selected'], 2)
        self.assertEqual([[row['title'] for row in batch] for batch in self.social_calls()], [['Broken X']])

    def test_auth_fault_stops_immediately_and_preserves_previous_document(self):
        self.posts(['Before', 'After']); self.reddit('Tools', ['Reddit'])
        output = self.root / f'daily-summary/{DATE}_daily_summary.md'
        output.parent.mkdir(); output.write_text('Previous summary')
        for status in (401, 403):
            with self.subTest(status=status), patch.object(brief, 'call_provider_text', side_effect=AIProviderError('private', status_code=status)) as model:
                with self.assertRaises(AIProviderError): self.generate()
                self.assertEqual(model.call_count, 1)
                self.assertEqual(output.read_text(), 'Previous summary')

    def test_all_social_failures_preserve_document_and_create_no_artifact(self):
        self.posts(['X A', 'X B']); self.reddit('Tools', ['Reddit'])
        output = self.root / f'daily-summary/{DATE}_daily_summary.md'
        output.parent.mkdir(); output.write_text('Previous summary')
        run = self.root / 'run'
        with patch.dict(os.environ, {'OPENMIND_RUN_DIR': str(run)}), patch.object(brief, 'call_provider_text', side_effect=AIProviderError('private', status_code=502)) as model, contextlib.redirect_stderr(io.StringIO()):
            result = self.generate()
        self.assertEqual(model.call_count, 2)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(len(result['failedSources']), 3)
        self.assertEqual(output.read_text(), 'Previous summary')
        self.assertFalse((run / 'artifacts.json').exists())

    def test_reddit_only_omits_other_sources_and_keeps_each_community(self):
        self.posts(['X']); self.article('Article'); self.reddit('Tools', ['Tool']); self.reddit('Science', ['Study'])
        with patch.object(brief, 'call_provider_text', self.model): result = self.generate(reddit_only=True)
        self.assertEqual(result['selected'], 2)
        self.assertEqual({row['kind'] for batch in self.social_calls() for row in batch}, {'reddit'})
        self.assertNotIn('## 🧵', self.output()); self.assertNotIn('## 📚', self.output())
        self.assertIn('### r/Science', self.output()); self.assertIn('### r/Tools', self.output())

    def test_zero_kept_posts_publish_an_empty_digest_without_inventing_sections(self):
        self.posts(['Empty greeting'])
        with patch.object(brief, 'call_provider_text', self.model): result = self.generate()
        self.assertEqual(result['status'], 'succeeded'); self.assertEqual(result['selected'], 0)
        self.assertNotIn('## 🧵', self.output()); self.assertNotIn('## 💬', self.output())

    def test_labels_failure_preserves_previous_document_and_reuses_item_cache_on_retry(self):
        self.posts(['X update'])
        output = self.root / f'daily-summary/{DATE}_daily_summary.md'
        output.parent.mkdir(); output.write_text('Previous summary')
        def model(provider, prompt, **kwargs):
            if 'SOCIAL_SOURCES:\n' not in prompt: return '{invalid'
            return self.model(provider, prompt, **kwargs)
        with patch.object(brief, 'call_provider_text', model), self.assertRaises(ValueError): self.generate()
        self.assertEqual(output.read_text(), 'Previous summary')
        self.calls.clear()
        with patch.object(brief, 'call_provider_text', self.model): self.generate()
        self.assertEqual(self.social_calls(), [])

    def test_duplicate_url_does_not_remove_another_platforms_content(self):
        file = self.posts(['An X update'])
        rows = json.loads(file.read_text()); rows.append(rows[0]); file.write_text(json.dumps(rows))
        self.article('Article')
        article = self.root / f'article/{DATE}/Article.md'
        article.write_text(article.read_text() + '\n原文: https://x.com/fixture/status/1')
        counts = {}
        sources = brief.read_candidates(self.root, DATE, counts=counts)
        self.assertEqual([row['kind'] for row in sources], ['article', 'post'])
        self.assertEqual(counts['post'], 2)
        with patch.object(brief, 'call_provider_text', self.model): result = self.generate()
        self.assertEqual(result['selected'], 2)
        self.assertIn('**原始帖子**: 2 · **参与总结**: 1', self.output())

    def test_invalid_model_indexes_and_invented_metadata_are_rejected(self):
        valid = {'index': 1, 'keep': True, 'summary': 'Supported update.', 'category': 'x_models', 'score': 80}
        social.validate_batch({'items': [valid]}, 'post', 1)
        for items in [[], [valid, valid], [{**valid, 'index': 2}], [{**valid, 'index': True}],
                      [{**valid, 'keep': 'true'}], [{**valid, 'score': True}], [{**valid, 'summary': ''}],
                      [{**valid, 'category': 'Invented'}], [{**valid, 'url': 'https://invented.example'}]]:
            with self.subTest(items=items), self.assertRaises(ValueError): social.validate_batch({'items': items}, 'post', 1)

    def test_topic_fallback_retains_each_social_source_when_original_files_are_missing(self):
        posts = self.posts(['X update A', 'X update B'])
        reddit = self.reddit('Tools', ['Reddit update'])
        self.article('Article')
        with patch.object(brief, 'call_provider_text', self.model): self.generate()
        posts.unlink(); reddit.unlink(); (self.root / f'article/{DATE}/Article.md').unlink()
        self.assertEqual(brief.read_candidates(self.root, DATE), [])
        candidates = brief.legacy_summary_candidates(self.root, DATE)
        self.assertEqual(len(candidates), 4)
        self.assertEqual([row['title'] for row in candidates], ['X update A', 'X update B', 'Reddit update', 'Article'])
        self.assertEqual(candidates[0]['url'], 'https://x.com/fixture/status/1')
        self.assertEqual(candidates[2]['url'], 'https://www.reddit.com/r/Tools/comments/id1/post/')
        self.assertEqual(candidates[0]['author_screen_name'], 'fixture')
        self.assertEqual({row['path'] for row in candidates}, {f'daily-summary/{DATE}_daily_summary.md'})


if __name__ == '__main__': unittest.main()
