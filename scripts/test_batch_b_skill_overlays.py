#!/usr/bin/env python3
"""Contract checks for Batch B's root/data/run bindings from an unrelated cwd."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "config" / "skill-library" / "packages"
OUTSIDE_CWD = Path(tempfile.gettempdir())


class BatchBRuntimeOverlayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="openmind-batch-b-")
        base = Path(self.temp.name)
        self.root = base / "openmind"
        self.data = base / "skill-data"
        self.run_dir = base / "run"
        self.root.mkdir()
        self.data.mkdir()
        self.run_dir.mkdir()
        self.env = {
            **os.environ,
            "OPENMIND_ROOT": str(self.root),
            "OPENMIND_SKILL_DATA_DIR": str(self.data),
            "OPENMIND_RUN_DIR": str(self.run_dir),
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_code(self, code: str, *paths: str) -> subprocess.CompletedProcess[str]:
        env = {**self.env, "PYTHONPATH": os.pathsep.join(str(SKILLS_ROOT / p) for p in paths)}
        return subprocess.run(
            [sys.executable, "-c", code],
            cwd=OUTSIDE_CWD,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_daily_summarizer_resolves_sources_below_bound_root_and_cache_below_data(self) -> None:
        result = self.run_code(
            "from runtime_paths import require_skill_data_dir, resolve_data_path, require_content_root; "
            "root=require_content_root(); data=require_skill_data_dir(); "
            "assert root.is_dir(); assert resolve_data_path('summary_cache.json', data, 'cache').parent == data",
            "daily-article-summarizer",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rss_and_x_configs_never_place_cache_in_package_or_openmind(self) -> None:
        result = self.run_code(
            "from src.managers.config_manager import RSSConfig; import os; from pathlib import Path; "
            "c=RSSConfig('', os.environ['OPENMIND_ROOT'], os.environ['OPENMIND_SKILL_DATA_DIR']); "
            "assert Path(c.get_article_base_dir()) == Path(os.environ['OPENMIND_ROOT'])/'article'; "
            "assert Path(c.get_cache_file()).parent == Path(os.environ['OPENMIND_SKILL_DATA_DIR']); "
            "assert Path(c.get_counter_file()).parent == Path(os.environ['OPENMIND_SKILL_DATA_DIR'])",
            "rss-article-saver",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

        result = self.run_code(
            "from pathlib import Path; from src.config import load_config; import os; "
            "c=load_config(None, os.environ['OPENMIND_ROOT'], os.environ['OPENMIND_SKILL_DATA_DIR']); "
            "assert c.storage.output_dir == Path(os.environ['OPENMIND_ROOT'])/'post'; "
            "assert c.storage.article_output_dir == Path(os.environ['OPENMIND_ROOT'])/'article'; "
            "assert c.storage.cache_file.parent == Path(os.environ['OPENMIND_SKILL_DATA_DIR'])",
            "x-following-fetcher",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_x_managed_credential_is_read_from_broker_json(self) -> None:
        self.env["OPENMIND_SKILL_HOME"] = str(SKILLS_ROOT / "x-following-fetcher")
        result = self.run_code(
            "import os, json; from src.fetcher.client import _read_managed_credential; "
            "os.environ['X_FETCHER_CREDENTIAL_JSON']=json.dumps({'url':'https://x.test','headers':{'Authorization':'Bearer token'}}); "
            "request=_read_managed_credential(None)[0]; assert request.url == 'https://x.test'; "
            "assert request.headers['Authorization'] == 'Bearer token'",
            "x-following-fetcher",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_batch_b_ai_adapters_are_resolved_inside_each_skill_package(self) -> None:
        cases = [
            (
                [SKILLS_ROOT / "daily-article-summarizer"],
                "from src.ai import shared_summarizer; import src.ai_client as c; "
                "assert '_shared' not in c.__file__",
            ),
            (
                [SKILLS_ROOT / "rss-article-saver"],
                "from src.ai import shared_analysis, shared_translation; import src.ai_client as c; "
                "assert '_shared' not in c.__file__",
            ),
            (
                [SKILLS_ROOT / "daily-topic-selector" / "scripts"],
                "import ai_client as c; assert '_shared' not in c.__file__",
            ),
        ]
        for paths, code in cases:
            result = self.run_code(code, *(str(path) for path in paths))
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_managed_runs_prefer_provider_profile_and_reject_legacy_fallback(self) -> None:
        self.env.update({
            "OPENMIND_MANAGED_RUN": "1",
            "OPENMIND_PROVIDER_API_KEY": "bound-profile-secret",
            "OPENMIND_PROVIDER_BASE_URL": "https://provider.test/v1/chat/completions",
            "OPENMIND_PROVIDER_MODEL": "profile-model",
            "OPENMIND_PROVIDER_PROTOCOL": "openai-chat",
            "NVIDIA_API_KEY": "legacy-provider-secret",
            "NVIDIA_MODEL": "legacy-model",
        })
        cases = [
            ("src.ai_client", ["daily-article-summarizer"]),
            ("src.ai_client", ["rss-article-saver"]),
            ("ai_client", ["daily-topic-selector/scripts"]),
        ]
        for module, paths in cases:
            result = self.run_code(
                f"import importlib; c=importlib.import_module('{module}'); "
                "bound=c.resolve_provider(); "
                "assert bound.name == 'bound-profile'; assert bound.model == 'profile-model'; "
                "assert bound.api_key == 'bound-profile-secret'; "
                "import os; os.environ.pop('OPENMIND_PROVIDER_API_KEY'); "
                "exec(\"try:\\n    c.resolve_provider()\\n    raise AssertionError('legacy fallback was used')\\n"
                "except ValueError as error:\\n    assert 'Managed Run' in str(error)\")",
                *paths,
            )
            self.assertEqual(result.returncode, 0, f"{module}: {result.stderr}")


if __name__ == "__main__":
    unittest.main()
