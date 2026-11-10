"""Daily summary source sections preserve selected content and article categories."""
import json
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'config/skill-library/packages'))
from _shared import brief_generation as brief

LABELS = json.loads((Path(__file__).parent / 'fixtures/brief-labels.json').read_text(encoding='utf-8'))
METADATA = {'generatedAt': '2026-11-10T00:00:00Z', 'preferencesRevision': 0}


def item(title, kind, category):
    return {'source': {'title': title, 'kind': kind, 'path': f'{kind}/20261110/{title}.md', 'url': f'https://example.org/{title}', 'subreddit': 'research'},
            'result': {'translated_title': title, 'summary': f'Facts about {title}', 'key_points': ['Evidence'], 'score': 90, 'category': category}}


class BriefSectionTests(unittest.TestCase):
    def test_social_sections_use_short_lines_and_articles_keep_detailed_categories(self):
        selected = [item('Article-A', 'article', 'AI'), item('Reddit-A', 'reddit', 'Science'),
                    item('Post-A', 'post', 'x_industry'), item('Article-B', 'article', 'Science'),
                    item('Article-C', 'article', 'AI'), item('Post-B', 'post', 'x_other')]
        before = json.dumps(selected)
        text = brief.render('20261110', 'summary', selected, METADATA, LABELS['zh'])
        self.assertEqual(re.findall(r'^## (.+)$', text, re.M),
                         ['🧵 当天 Post 总结', '💬 Reddit 热帖', '📚 AI', '📚 Science'])
        self.assertEqual(re.findall(r'^### (.+)$', text, re.M),
                         ['r/research', 'Article-A', 'Article-C', 'Article-B'])
        self.assertIn('**今日主线**:', text)
        self.assertIn('**公司 / 融资 / 行业动态** (1):', text)
        self.assertIn('- Facts about Post-A [原帖]', text)
        self.assertIn('- Facts about Reddit-A [原帖]', text)
        self.assertEqual(text.count('**评分**:'), 3)
        for row in selected:
            self.assertIn(row['result']['summary'], text)
            self.assertIn(f'<../{row["source"]["path"]}>', text)
            self.assertIn(row['source']['url'], text)
        self.assertEqual(json.dumps(selected), before)

    def test_empty_source_sections_are_omitted_and_labels_are_localized(self):
        for language, labels in LABELS.items():
            with self.subTest(language=language):
                text = brief.render('20261110', 'summary', [item('Post', 'post', 'x_models')], METADATA, labels)
                self.assertEqual(re.findall(r'^## (.+)$', text, re.M), [f'🧵 {labels["posts_section"]}'])
                text = brief.render('20261110', 'summary', [item('Reddit', 'reddit', 'AI')], METADATA, labels)
                self.assertEqual(re.findall(r'^## (.+)$', text, re.M), [f'💬 {labels["reddit_section"]}'])
        text = brief.render('20261110', 'summary', [], METADATA, LABELS['zh'])
        self.assertNotRegex(text, r'(?m)^## ')

    def test_topic_render_keeps_selection_order(self):
        selected = [item('Article', 'article', 'AI'), item('Post', 'post', 'Startup'), item('Reddit', 'reddit', 'AI')]
        text = brief.render('20261110', 'topics', selected, METADATA, LABELS['zh'])
        self.assertEqual(re.findall(r'^### (.+)$', text, re.M), ['Article', 'Post', 'Reddit'])
        self.assertNotIn('## 🧵', text)
        self.assertNotIn('## 💬', text)


if __name__ == '__main__': unittest.main()
