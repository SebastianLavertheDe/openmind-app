"""Exercise every migrated website parser against fixed, offline responses.

Use the RSS project's Python dependencies (OPENMIND_TEST_PYTHON for npm test:rss).
No login, real subscription, API key, or public site is involved.
"""
import importlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

REPO = Path(__file__).resolve().parents[2]
PACKAGE = REPO / 'config/skill-library/packages/rss-article-saver'
sys.path.insert(0, str(PACKAGE))
sys.path.insert(0, str(PACKAGE / 'src/feed_generation'))
from src import rss_pipeline as rss

CATALOG = json.loads((REPO / 'config/rss-sources/catalog.json').read_text())
DATE = '2026-10-27T08:00:00Z'
TITLE = 'Product design research'
META = f'<meta property="article:published_time" content="{DATE}"><meta name="description" content="Detailed research findings">'
FEED = f'<rss version="2.0"><channel><title>Research</title><link>https://example.org/</link><description>Studies</description><item><title>{TITLE}</title><link>https://example.org/study</link><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate><category>ai</category><description>Evidence from design experiments</description></item></channel></rss>'

def response(text='', data=None):
    value = Mock(text=text, content=text.encode()); value.json.return_value = data
    return value

class AdapterTests(unittest.TestCase):
    def test_every_website_adapter_produces_stable_standard_rss(self):
        fixtures = {
            'cursor_rss': f'<article><a href="/blog/design"><p>{TITLE}</p></a><p>Research findings</p><time datetime="{DATE}"></time></article>',
            'anthropic_engineering_rss': f'<article><a href="/engineering/design"><h2>{TITLE}</h2></a><time datetime="{DATE}"></time></article>',
            'claude_blog_rss': f'<div class="blog_cms_item w-dyn-item"><a href="/blog/design">{TITLE}</a><span>October 27, 2026</span></div>',
            'gwern_rss': f'<li><a href="/blog/2026/design">{TITLE}</a></li>',
            'a16z_ai_rss': f'<div data-feed-component="categories" data-categories="ai" data-feed-count="1"><div class="feed-component--list"><article data-feed-item><h4><a href="/design/">{TITLE}</a></h4></article></div></div>',
            'stanford_hai_rss': f'<a class="ContentCard_titleLink" href="/news/design">{TITLE}</a>',
            'sequoia_ai_rss': f'<a href="/article/design"><h2 data-framer-name="Title">{TITLE}</h2></a>',
            'bessemer_ai_rss': '<script>self.__next_f.push(' + json.dumps([1, json.dumps({'posts': [{'title': TITLE, 'path': '/atlas/design', 'publishedAt': DATE, 'sectors': ['Design']} ]})]) + ')</script>',
            'nfx_ai_rss': '<script id="__NEXT_DATA__">' + json.dumps({'props': {'pageProps': {'category': {'slug': 'generative-ai'}, 'posts': [{'id': 1, 'title': TITLE, 'url': '/library/design'}]}}}) + '</script>',
        }
        for adapter in CATALOG['adapters']:
            with self.subTest(adapter=adapter['id']):
                cls = getattr(importlib.import_module(adapter['module']), adapter['className'])
                def get(_session, url, **kwargs):
                    if 'article-list' in url: return response(data={'code': 100200, 'totalPage': 1, 'data': [{'id': 1, 'title': TITLE, 'publishTime': '2026-10-27'}]})
                    if url == 'https://content.nfx.com/wp-json/wp/v2/posts': return response(data=[{'id': 1, 'date_gmt': '2026-10-27T08:00:00', 'excerpt': {'rendered': 'Evidence'}}])
                    if 'greylock' in url or 'menlovc' in url: return response(FEED)
                    if url.rstrip('/') == adapter['url'].rstrip('/') or url.endswith('?filterBy=news') or url == 'https://gwern.net/blog/newest': return response(fixtures[adapter['id']])
                    return response(META + '<meta name="dc.date.issued" content="2026-10-27"><div class="DetailMeta_row"><span>Date</span><span>October 27, 2026</span></div><main><h1>Research</h1><time datetime="'+DATE+'"></time><div data-framer-name="Content">Product design research</div></main>')
                source = {'name': 'Fixture', 'inputUrl': adapter['url'], 'adapterId': adapter['id']}
                with patch('requests.Session.get', get):
                    if adapter['id'] == 'sequoia_ai_rss':
                        # Browser transport is a separate runtime prerequisite;
                        # feed the actual listing parser a rendered page fixture.
                        rows = cls().parse_listing(fixtures[adapter['id']])
                        with patch.object(cls, 'fetch_listing', return_value=rows): raw, entries = rss.convert(source, CATALOG)
                    else: raw, entries = rss.convert(source, CATALOG)
                self.assertEqual(len(entries), 1)
                self.assertEqual(entries[0]['title'], TITLE)
                _, normalized = rss.parse_feed(raw, adapter['url'])
                self.assertEqual(normalized[0]['guid'], entries[0]['url'])
                self.assertEqual(normalized[0]['date'].date().isoformat(), '2026-10-27')
                self.assertIsNotNone(normalized[0]['date'].tzinfo)

    def test_missing_dates_are_not_replaced_with_fetch_time_or_another_articles_date(self):
        from gwern_rss import GwernRSSGenerator
        from anthropic_engineering_rss import AnthropicEngineeringRSSGenerator
        from bs4 import BeautifulSoup
        generator = AnthropicEngineeringRSSGenerator()
        card = BeautifulSoup(f'<article><a href="/engineering/design"><h2>{TITLE}</h2></a></article>', 'html.parser').article
        entry = generator._extract_article_from_card(card, set(), '')
        self.assertIsNone(entry['date'])
        raw, _ = rss.normalize_feed('Fixture', generator.base_url, [entry])
        self.assertNotIn(b'<pubDate>', raw)
        generator = GwernRSSGenerator()
        with patch.object(generator.session, 'get', return_value=response(f'<li><a href="/blog/2026/design">{TITLE}</a></li>')), patch.object(generator, '_fetch_post_metadata', return_value=(None, 'Research')):
            import asyncio
            rows = asyncio.run(generator.fetch_posts())
        self.assertIsNone(rows[0]['date'])

if __name__ == '__main__': unittest.main()
