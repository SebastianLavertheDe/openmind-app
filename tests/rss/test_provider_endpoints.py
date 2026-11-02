import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import yaml


PACKAGES = Path(__file__).resolve().parents[2] / 'config/skill-library/packages'
ADAPTERS = (
    '_shared/ai_client.py',
    'daily-article-summarizer/src/ai_client.py',
    'daily-topic-selector/scripts/ai_client.py',
    'rss-article-saver/src/ai_client.py',
)


class ProviderEndpointTests(unittest.TestCase):
    def test_anthropic_yaml_endpoints_match_the_app_for_every_adapter(self):
        cases = (
            ('https://api.anthropic.com', 'https://api.anthropic.com/v1/messages'),
            ('https://open.bigmodel.cn/api/anthropic', 'https://open.bigmodel.cn/api/anthropic/v1/messages'),
            ('https://open.bigmodel.cn/api/anthropic/', 'https://open.bigmodel.cn/api/anthropic/v1/messages'),
            ('https://api.deepseek.com/anthropic/v1', 'https://api.deepseek.com/anthropic/v1/messages'),
            ('https://gateway.example.com/v1/', 'https://gateway.example.com/v1/messages'),
            ('https://gateway.example.com/custom/messages/', 'https://gateway.example.com/custom/messages'),
        )
        with tempfile.TemporaryDirectory(prefix='openmind-provider-endpoints-') as directory:
            config = Path(directory) / 'providers.yaml'
            for index, adapter in enumerate(ADAPTERS):
                name = f'endpoint_adapter_{index}'
                spec = importlib.util.spec_from_file_location(name, PACKAGES / adapter)
                module = importlib.util.module_from_spec(spec)
                with patch.dict(sys.modules, {name: module}):
                    spec.loader.exec_module(module)
                    for base, expected in cases:
                        # A complete endpoint must also survive another resolution unchanged.
                        for configured_url in (base, expected):
                            with self.subTest(adapter=adapter, base_url=configured_url):
                                config.write_text(yaml.safe_dump({
                                    'default': 'fixture',
                                    'providers': [{
                                        'id': 'fixture',
                                        'apiKey': 'fixture-key',
                                        'baseUrl': configured_url,
                                        'model': 'fixture-model',
                                        'protocol': 'anthropic-messages',
                                    }],
                                }), encoding='utf-8')
                                with patch.dict(os.environ, {'OPENMIND_PROVIDERS_FILE': str(config)}, clear=True):
                                    provider = module.resolve_provider()
                                self.assertEqual(provider.kind, 'anthropic')
                                self.assertEqual(provider.base_url, expected)


if __name__ == '__main__':
    unittest.main()
