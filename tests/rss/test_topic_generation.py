import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

PACKAGES = Path(__file__).resolve().parents[2] / 'config/skill-library/packages'
sys.path.insert(0, str(PACKAGES))
from _shared import brief_generation as brief
from _shared import topic_generation as topic
from _shared.brief_preferences import DEFAULTS, resolve_preferences, topic_prompt_context
from brief_fixtures import editorial_reply, TOPIC_LABELS

PROVIDER = SimpleNamespace(name='fixture', base_url='http://localhost', model='fixture')
PREFERENCES = {'schemaVersion': 1, 'revision': 3, 'updatedAt': None, 'text': '', 'topicPrompt': 'Select original research; Chinese output.', 'topicPlatforms': [
    {'id': 'a', 'name': 'nameA', 'prompt': 'Select design experiments, including WeChat articles.'},
    {'id': 'b', 'name': 'nameB', 'prompt': 'Select science observations.'}
]}


def source_reply(prompt):
    source = json.loads(prompt.split('SOURCE:\n', 1)[1])
    return {'translated_title': source['title'], 'summary': source['content'], 'key_points': ['Source evidence'], 'category': 'Other', 'score': 10}


class TopicGenerationTests(unittest.TestCase):
    def test_custom_platforms_keep_report_fields_and_writing_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); folder = root / 'article/20261030'; folder.mkdir(parents=True)
            (folder / 'a.md').write_text('# Design\nOriginal interface experiment.\n原文: https://mp.weixin.qq.com/s/research', encoding='utf-8')
            (folder / 'b.md').write_text('# Science\nOriginal observations.\n原文: https://example.org/science', encoding='utf-8')
            calls = []
            def model(provider, prompt, **kwargs):
                calls.append(prompt)
                reply = editorial_reply(prompt, 'zh')
                if 'Configured platform IDs and names:' in prompt:
                    self.assertIn('nameA', prompt); self.assertIn('nameB', prompt)
                    self.assertIn(PREFERENCES['topicPrompt'], prompt)
                    self.assertNotIn('fit_score', prompt); self.assertNotIn('@dotey', prompt)
                    self.assertNotIn('System Design', prompt)
                    reply['platforms'] = [{'id': 'a', 'items': [{'index': 1, 'reason': 'Design match'}]}, {'id': 'b', 'items': [{'index': 2, 'reason': 'Science match'}]}]
                if reply is not None: return json.dumps(reply)
                self.assertIn('Extract sufficient factual detail', prompt)
                return json.dumps(source_reply(prompt))
            with patch.object(brief, 'call_provider_text', model):
                result = brief.generate(root, '20261030', 'topics', PREFERENCES, provider=PROVIDER)
            output = (root / result['path']).read_text(encoding='utf-8')
            self.assertEqual(result['selected'], 2)
            a, b = output.split('## 2. nameA选题 Agent 输出', 1)[1].split('## 3. nameB选题 Agent 输出', 1)
            self.assertIn('Design', a); self.assertNotIn('Science', a)
            self.assertIn('Science', b)
            for label in ['标题', '核心观点', '为什么可能火', '适合人群', '内容结构', '开头钩子', '配图建议', '互动引导', '风险点', '推荐指数']:
                self.assertIn(f'**{label}**:', a)
            self.assertIn('  3. Design 3', output)
            for section in ['## 1. 今日最终推荐', '## 4. 今日候选热点池', '## 5. 明日可追踪话题', '## 6. 可沉淀成长期内容的主题']:
                self.assertIn(section, output)
            metadata = json.loads(output.split('<!-- openmind-topics ', 1)[1].split(' -->', 1)[0])
            self.assertEqual(metadata['items'][0]['links'][0]['url'], 'https://mp.weixin.qq.com/s/research')
            self.assertEqual(metadata['items'][1]['sourceFile'], 'article/20261030/b.md')
            # Low source-quality scores do not introduce a hidden selection gate.
            self.assertNotIn('score >=', '\n'.join(calls))
            writing = subprocess.run([sys.executable, str(PACKAGES / 'daily-writing-orchestrator/scripts/create_writing_package.py'), '--date', '20261030', '--content-root', str(root), '--platform', 'wechat'], text=True, capture_output=True)
            self.assertEqual(writing.returncode, 0, writing.stderr)

    def test_blank_prompt_and_no_platforms_are_preserved_and_stock_rules_only_migrate(self):
        snapshot = resolve_preferences({**PREFERENCES, 'topicPrompt': '', 'topicPlatforms': []})
        self.assertEqual(snapshot['topicPrompt'], ''); self.assertEqual(snapshot['topicPlatforms'], [])
        assembled = topic_prompt_context(snapshot)
        self.assertNotIn('AI', assembled); self.assertNotIn('fit_score', assembled)
        legacy = {key: value for key, value in PREFERENCES.items() if key not in ('topicPrompt', 'topicPlatforms')}
        self.assertEqual(resolve_preferences({**legacy, 'topicRules': 'My old custom rules'})['topicPrompt'], 'My old custom rules')
        self.assertEqual(resolve_preferences({**legacy, 'topicRules': DEFAULTS['legacyTopicRules']})['topicPrompt'], DEFAULTS['topicPrompt'])
        for platforms in [[{'id': 'a', 'name': '', 'prompt': ''}], [{'id': 'a', 'name': 'X', 'prompt': ''}, {'id': 'b', 'name': ' x ', 'prompt': ''}]]:
            with self.assertRaises(ValueError): resolve_preferences({**PREFERENCES, 'topicPlatforms': platforms})

    def test_bad_editorial_result_preserves_document_and_is_not_cached(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); folder = root / 'article/20261030'; folder.mkdir(parents=True)
            (folder / 'a.md').write_text('# Research\nOriginal evidence.', encoding='utf-8')
            output = root / 'daily-topic/20261030_daily_topic.md'; output.parent.mkdir(); output.write_text('Previous edited report', encoding='utf-8')
            broken = True; detail_calls = []
            def model(provider, prompt, **kwargs):
                reply = editorial_reply(prompt, 'zh')
                if 'TOPIC_SOURCE:\n' in prompt:
                    detail_calls.append(prompt)
                    if broken: reply.pop('outline')
                return json.dumps(reply if reply is not None else source_reply(prompt))
            with patch.object(brief, 'call_provider_text', model):
                with self.assertRaisesRegex(ValueError, 'editorial topic fields'):
                    brief.generate(root, '20261030', 'topics', PREFERENCES, provider=PROVIDER)
                self.assertEqual(output.read_text(encoding='utf-8'), 'Previous edited report')
                broken = False
                brief.generate(root, '20261030', 'topics', PREFERENCES, provider=PROVIDER)
                before = len(detail_calls)
                brief.generate(root, '20261030', 'topics', PREFERENCES, provider=PROVIDER)
                self.assertEqual(len(detail_calls), before)
                changed = copy.deepcopy(PREFERENCES); changed['topicPlatforms'][0]['prompt'] = 'Select a different angle.'
                brief.generate(root, '20261030', 'topics', changed, provider=PROVIDER)
                self.assertGreater(len(detail_calls), before)
            self.assertTrue(any(file.read_text(encoding='utf-8') == 'Previous edited report' for file in (root / 'daily-topic/.versions').rglob('*.md')))

    def test_selection_and_editor_cannot_invent_or_repeat_candidates(self):
        valid = {'platforms': [{'id': 'a', 'items': [{'index': 1, 'reason': 'A'}]}, {'id': 'b', 'items': []}], 'document': TOPIC_LABELS['zh']}
        topic.validate_selection(valid, 2, PREFERENCES['topicPlatforms'])
        for groups in [valid['platforms'][:1], [valid['platforms'][0], valid['platforms'][0]], [{'id': 'c', 'items': []}, valid['platforms'][1]], [{'id': 'a', 'items': [{'index': 3, 'reason': 'Invalid'}]}, valid['platforms'][1]]]:
            with self.assertRaises(ValueError): topic.validate_selection({**valid, 'platforms': groups}, 2, PREFERENCES['topicPlatforms'])
        with self.assertRaises(ValueError): topic.validate_items([{'index': 1, 'reason': 'A'}, {'index': 1, 'reason': 'B'}], 2)
        with self.assertRaisesRegex(ValueError, 'unselected'):
            topic.validate_editor({'pick': {'platformId': 'b', 'index': 2}, 'judgment': 'J', 'alternatives': 'A', 'angle': 'A', 'risk': 'R', 'follow_up': [], 'evergreen': []}, {('a', 1)})


if __name__ == '__main__': unittest.main()
