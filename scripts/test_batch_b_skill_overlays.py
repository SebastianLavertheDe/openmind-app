#!/usr/bin/env python3
"""Contract checks for Batch B's root/data/run bindings from an unrelated cwd."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SKILLS_ROOT = REPO_ROOT / ".claude" / "skills"
OUTSIDE_CWD = Path(tempfile.gettempdir())


class BatchBRuntimeOverlayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="cctools-batch-b-")
        base = Path(self.temp.name)
        self.root = base / "mymind"
        self.data = base / "skill-data"
        self.run_dir = base / "run"
        self.root.mkdir()
        self.data.mkdir()
        self.run_dir.mkdir()
        self.env = {
            **os.environ,
            "CCTOOLS_MYMIND_ROOT": str(self.root),
            "MYMIND_ROOT": str(self.root),
            "CCTOOLS_SKILL_DATA_DIR": str(self.data),
            "CCTOOLS_RUN_DIR": str(self.run_dir),
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
            "from main import _resolve_source_directories; from runtime_paths import require_skill_data_dir, resolve_data_path, require_mymind_root; "
            "root=require_mymind_root(); data=require_skill_data_dir(); paths=_resolve_source_directories(['mymind/article'], 'linux', root); "
            "assert paths == [str(root/'article')]; assert resolve_data_path('summary_cache.json', data, 'cache').parent == data",
            "daily-article-summarizer",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_knowledge_wiki_moves_state_out_of_content_and_rejects_legacy_env_reference(self) -> None:
        self.env["CCTOOLS_SKILL_HOME"] = str(SKILLS_ROOT / "knowledge-wiki-compiler")
        result = self.run_code(
            "from pathlib import Path; from knowledge_wiki_compiler.config import load_config; import os; "
            "root=Path(os.environ['CCTOOLS_MYMIND_ROOT']); data=Path(os.environ['CCTOOLS_SKILL_DATA_DIR']); "
            "cfg=load_config(Path(os.environ['CCTOOLS_SKILL_HOME'])/'config.yaml', root, data); "
            "assert cfg.article_dir == root/'article'; assert cfg.wiki_dir == root/'wiki'; assert cfg.state_dir == data/'wiki-state'; "
            "assert cfg.shared_ai_env_file == data/'provider.env'",
            "knowledge-wiki-compiler/src",
            "knowledge-wiki-compiler",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rss_and_x_configs_never_place_cache_in_package_or_mymind(self) -> None:
        result = self.run_code(
            "from src.managers.config_manager import RSSConfig; import os; from pathlib import Path; "
            "c=RSSConfig('', os.environ['CCTOOLS_MYMIND_ROOT'], os.environ['CCTOOLS_SKILL_DATA_DIR']); "
            "assert Path(c.get_article_base_dir()) == Path(os.environ['CCTOOLS_MYMIND_ROOT'])/'article'; "
            "assert Path(c.get_cache_file()).parent == Path(os.environ['CCTOOLS_SKILL_DATA_DIR']); "
            "assert Path(c.get_counter_file()).parent == Path(os.environ['CCTOOLS_SKILL_DATA_DIR'])",
            "rss-article-saver",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

        result = self.run_code(
            "from pathlib import Path; from src.config import load_config; import os; "
            "c=load_config(None, os.environ['CCTOOLS_MYMIND_ROOT'], os.environ['CCTOOLS_SKILL_DATA_DIR']); "
            "assert c.storage.output_dir == Path(os.environ['CCTOOLS_MYMIND_ROOT'])/'post'; "
            "assert c.storage.article_output_dir == Path(os.environ['CCTOOLS_MYMIND_ROOT'])/'article'; "
            "assert c.storage.cache_file.parent == Path(os.environ['CCTOOLS_SKILL_DATA_DIR'])",
            "x-following-fetcher",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_x_managed_credential_is_read_from_broker_json(self) -> None:
        self.env["CCTOOLS_SKILL_HOME"] = str(SKILLS_ROOT / "x-following-fetcher")
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
                [SKILLS_ROOT / "knowledge-wiki-compiler" / "src"],
                "from knowledge_wiki_compiler import content_ai, entity_ai; "
                "import knowledge_wiki_compiler.ai_client as c; assert '_shared' not in c.__file__",
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
            "CCTOOLS_MANAGED_RUN": "1",
            "CCTOOLS_PROVIDER_API_KEY": "bound-profile-secret",
            "CCTOOLS_PROVIDER_BASE_URL": "https://provider.test/v1/chat/completions",
            "CCTOOLS_PROVIDER_MODEL": "profile-model",
            "CCTOOLS_PROVIDER_PROTOCOL": "openai-chat",
            "NVIDIA_API_KEY": "legacy-provider-secret",
            "NVIDIA_MODEL": "legacy-model",
        })
        cases = [
            ("src.ai_client", ["daily-article-summarizer"]),
            ("src.ai_client", ["rss-article-saver"]),
            ("knowledge_wiki_compiler.ai_client", ["knowledge-wiki-compiler/src"]),
            ("ai_client", ["daily-topic-selector/scripts"]),
        ]
        for module, paths in cases:
            result = self.run_code(
                f"import importlib; c=importlib.import_module('{module}'); "
                "bound=c.resolve_provider('nvidia'); "
                "assert bound.name == 'bound-profile'; assert bound.model == 'profile-model'; "
                "assert bound.api_key == 'bound-profile-secret'; "
                "import os; os.environ.pop('CCTOOLS_PROVIDER_API_KEY'); "
                "exec(\"try:\\n    c.resolve_provider('nvidia')\\n    raise AssertionError('legacy fallback was used')\\n"
                "except ValueError as error:\\n    assert 'Managed Run' in str(error)\")",
                *paths,
            )
            self.assertEqual(result.returncode, 0, f"{module}: {result.stderr}")


if __name__ == "__main__":
    unittest.main()
