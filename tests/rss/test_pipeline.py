import contextlib
import importlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

PACKAGES = Path(__file__).resolve().parents[2] / 'config' / 'skill-library' / 'packages'
sys.path.insert(0, str(PACKAGES / 'rss-article-saver'))
sys.path.insert(0, str(PACKAGES))
from src import rss_pipeline as rss
from _shared import brief_generation as brief
from _shared.brief_preferences import preference_digest

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        port = self.server.server_port
        if self.path == '/denied': self.send_response(403); self.end_headers(); return
        self.send_response(200); self.end_headers()
        if self.path == '/rss': data = f'<rss version="2.0"><channel><title>Design</title><item><title>Design study</title><link>/article</link><guid>stable-id</guid><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate><description>Research</description></item></channel></rss>'
        elif self.path == '/atom': data = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Science</title><entry><title>Science study</title><id>tag:science:one</id><link href="/article"/><updated>2026-10-27T10:00:00+02:00</updated></entry></feed>'
        elif self.path == '/page': data = '<html><link rel="alternate" type="application/rss+xml" href="rss" title="Design"></html>'
        elif self.path == '/multi': data = '<html><link rel="alternate" type="application/rss+xml" href="/rss" title="Design"><link rel="alternate" type="application/atom+xml" href="/atom" title="Science"></html>'
        elif self.path == '/bad': data = '<rss><channel>'
        elif self.path == '/article': data = '<article><h1>Design study</h1><p>This study presents concrete research results for accessible product interfaces and a detailed comparison of interaction methods.</p></article>'
        else: data = '<html><h1>Unrelated page</h1></html>'
        self.wfile.write(data.encode())

class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'
    @classmethod
    def tearDownClass(cls): cls.server.shutdown(); cls.server.server_close()
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.data = self.root / '.agent/skill-data/rss-article-saver'; self.data.mkdir(parents=True)
        self.catalog = {'adapters': [], 'sources': []}
        self.source = {'id': 'test-source', 'name': 'Research', 'inputUrl': self.url + '/rss', 'resolvedFeedUrl': None, 'adapterId': 'feed', 'kind': 'feed', 'revision': 1, 'enabled': True, 'feedRevision': 0}
        self.doc = {'schemaVersion': 1, 'initialized': True, 'revision': 1, 'sources': [self.source]}
        self.write(self.doc)
        self.pipeline = rss.Pipeline(self.root, self.data, self.catalog)
    def write(self, doc): rss.json_write(self.data / 'sources.json', doc)
    def test_direct_atom_discovery_and_candidates(self):
        for route in ['/rss', '/atom']:
            result = rss.detect(self.url + route, self.catalog); self.assertEqual(result['kind'], 'feed')
        result = rss.detect(self.url + '/page', self.catalog)
        self.assertEqual(result['inputUrl'], self.url + '/page'); self.assertEqual(result['resolvedFeedUrl'], self.url + '/rss')
        result = rss.detect(self.url + '/multi', self.catalog); self.assertEqual(len(result['candidates']), 2); self.assertIsNone(result['resolvedFeedUrl'])
        selected = rss.detect(self.url + '/multi', self.catalog, self.url + '/atom'); self.assertTrue(selected['resolvedFeedUrl'].endswith('/atom'))
    def test_adapter_and_error_categories(self):
        result = rss.detect(self.url + '/unknown', {'adapters': [{'id': 'fixture', 'url': self.url + '/unknown'}]}); self.assertEqual(result['adapterId'], 'fixture')
        for route, code in [('/unknown', 'unsupported-page'), ('/bad', 'invalid-feed'), ('/denied', 'access-denied')]:
            with self.assertRaises(rss.FeedError) as caught: rss.detect(self.url + route, self.catalog)
            self.assertEqual(caught.exception.code, code)
        with patch.object(rss, 'build_opener') as opener:
            opener.return_value.open.side_effect = socket.timeout()
            with self.assertRaises(rss.FeedError) as caught: rss.fetch(self.url)
            self.assertEqual(caught.exception.code, 'timeout')
    def test_sync_collect_xml_guid_timezone_and_dedup(self):
        self.assertEqual(self.pipeline.run('sync', '20261027')['status'], 'succeeded')
        self.assertFalse((self.root / 'article').exists())
        data = (self.data / 'feeds/test-source.xml').read_bytes()
        _, entries = rss.parse_feed(data, self.url)
        self.assertEqual(entries[0]['guid'], 'stable-id'); self.assertEqual(entries[0]['url'], self.url + '/article')
        self.assertIsNotNone(entries[0]['date'].tzinfo)
        result = self.pipeline.run('collect', '20261027'); self.assertEqual(result['results'][0]['collected'], 1)
        result = self.pipeline.run('pipeline', '20261027'); self.assertEqual(result['results'][0]['collected'], 0)
        self.assertEqual(len(list((self.root / 'article').rglob('*.md'))), 1)
    def test_failure_preserves_valid_feed_and_other_sources_continue(self):
        self.pipeline.run('sync', '20261027'); old = (self.data / 'feeds/test-source.xml').read_bytes()
        doc = self.pipeline.registry(); doc['sources'][0]['inputUrl'] = self.url + '/bad'; doc['sources'].append({**self.source, 'id': 'healthy'}); self.write(doc)
        result = self.pipeline.run('pipeline', '20261027'); self.assertEqual(result['status'], 'partial'); self.assertEqual((self.data / 'feeds/test-source.xml').read_bytes(), old)
    def test_inflight_disable_delete_and_url_change_discard_results(self):
        for mutation in ['disable', 'delete', 'change']:
            self.write(self.doc)
            def convert(*args):
                doc = json.loads(json.dumps(self.doc))
                if mutation == 'delete': doc['sources'] = []
                elif mutation == 'disable': doc['sources'][0]['enabled'] = False
                else: doc['sources'][0]['revision'] += 1
                self.write(doc)
                return rss.normalize_feed('Name', self.url, [])
            with patch.object(rss, 'convert', convert): result = self.pipeline.run('pipeline', '20261027')
            self.assertEqual(result['results'][0]['status'], 'skipped'); self.assertFalse((self.data / 'feeds/test-source.xml').exists())
    def test_overlapping_runs_skip_and_dead_locks_recover(self):
        with rss.lock(self.data / 'locks', 'test-source'):
            result = self.pipeline.run('sync', '20261027'); self.assertEqual(result['results'][0]['error']['code'], 'busy')
        rss.json_write(self.data / 'locks/test-source.lock', {'pid': 2147483647, 'token': 'dead'})
        self.assertEqual(self.pipeline.run('sync', '20261027')['status'], 'succeeded')
    def test_old_articles_are_not_duplicated_and_symlinks_cannot_escape(self):
        folder = self.root / 'article/20261001'; folder.mkdir(parents=True)
        (folder / 'old.md').write_text(f'# Saved\n\n**链接**: [original]({self.url}/article)\nUser edited body')
        result = self.pipeline.run('pipeline', '20261027'); self.assertEqual(result['results'][0]['collected'], 0)
        with tempfile.TemporaryDirectory() as outside:
            (self.data / 'feeds/test-source.xml').unlink(); (self.data / 'feeds').rmdir(); (self.data / 'feeds').symlink_to(outside, target_is_directory=True)
            result = self.pipeline.run('sync', '20261027'); self.assertEqual(result['results'][0]['error']['code'], 'unsafe-path'); self.assertEqual(list(Path(outside).iterdir()), [])
    def test_invalid_xml_output_and_write_failure_preserve_old(self):
        self.pipeline.run('sync', '20261027'); old = (self.data / 'feeds/test-source.xml').read_bytes()
        with patch.object(rss, 'convert', return_value=(b'<rss>bad', [])):
            self.assertEqual(self.pipeline.run('sync', '20261027')['status'], 'failed')
        self.assertEqual((self.data / 'feeds/test-source.xml').read_bytes(), old)
        with patch.object(rss, 'write_atomic', side_effect=PermissionError('denied')):
            self.assertEqual(self.pipeline.run('sync', '20261027')['status'], 'failed')

class PreferencesTests(unittest.TestCase):
    def test_non_ai_preferences_cache_content_and_model_revision(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); folder = root / 'article/20261027'; folder.mkdir(parents=True)
            (folder / 'design.md').write_text('# Design\nProduct design research with original examples and interviews.')
            (folder / 'science.md').write_text('# Science\nA science study with original measurements and analysis.')
            calls = []
            def model(provider, prompt, **kwargs):
                calls.append(prompt)
                if 'SOURCE:\n' in prompt:
                    source = json.loads(prompt.split('SOURCE:\n')[1]); chosen = ('design' in source['title'].lower()) == ('Design only' in prompt)
                    return json.dumps({'keep': chosen, 'translated_title': source['title'], 'summary': 'English research summary', 'key_points': ['Evidence'], 'category': source['title'], 'score': 90, 'reason': 'Matches preference'})
                return json.dumps({'items': [{'index': 1, 'reason': 'Relevant evidence'}]})
            provider = brief.resolve_provider if False else type('Provider', (), {'name': 'fixture', 'base_url': 'http://localhost', 'model': 'fixture-v1'})()
            first = {'schemaVersion': 1, 'revision': 1, 'text': 'Design only, exclude science, English, at most 1 item', 'updatedAt': None}
            second = {**first, 'revision': 2, 'text': 'Science only, exclude design, English, at most 1 item'}
            with patch.object(brief, 'call_provider_text', model):
                brief.generate(root, '20261027', 'summary', first, provider=provider); before = len(calls)
                brief.generate(root, '20261027', 'summary', first, provider=provider); self.assertEqual(len(calls), before)
                brief.generate(root, '20261027', 'topics', second, provider=provider)
                result = (root / 'daily-topic/20261027_daily_topic.md').read_text(); self.assertIn('### Science', result); self.assertNotIn('### Design', result)
                self.assertIn('偏好版本**: 2', result); self.assertGreater(len(calls), before)
                writing = subprocess.run([sys.executable, str(PACKAGES / 'daily-writing-orchestrator/scripts/create_writing_package.py'), '--date', '20261027', '--content-root', str(root), '--platform', 'wechat'], capture_output=True, text=True)
                self.assertEqual(writing.returncode, 0, writing.stderr)
                manifests = list((root / 'creative').rglob('manifest.json'))
                self.assertEqual(len(manifests), 1)
                self.assertIn('Science', manifests[0].read_text())
                before = len(calls); (folder / 'science.md').write_text('# Science\nUpdated research with new measurements.')
                brief.generate(root, '20261027', 'summary', second, provider=provider); self.assertGreater(len(calls), before)
                before = len(calls); provider.model = 'fixture-v2'; brief.generate(root, '20261027', 'summary', second, provider=provider); self.assertGreater(len(calls), before)
            self.assertTrue(list((root / 'daily-summary/.versions/20261027').glob('*.md')))
            self.assertNotEqual(preference_digest(first), preference_digest(second))
    def test_no_personal_gate_and_failures_preserve_existing_document(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); folder = root / 'article/20261027'; folder.mkdir(parents=True)
            (folder / 'a.md').write_text('# Gardening\nDetailed observations from a local garden.')
            output = root / 'daily-summary/20261027_daily_summary.md'; output.parent.mkdir(); output.write_text('My edited summary')
            snapshot = {'schemaVersion': 1, 'revision': 0, 'text': '', 'updatedAt': None}
            provider = type('Provider', (), {'name': 'fixture', 'base_url': 'http://localhost', 'model': 'v1'})()
            with patch.object(brief, 'call_provider_text', side_effect=RuntimeError('failed')):
                with self.assertRaises(RuntimeError): brief.generate(root, '20261027', 'summary', snapshot, provider=provider)
            self.assertEqual(output.read_text(), 'My edited summary')
            self.assertIn('any subject', brief.summarize_prompt({'content': 'Gardening'}, snapshot))

if __name__ == '__main__': unittest.main()
