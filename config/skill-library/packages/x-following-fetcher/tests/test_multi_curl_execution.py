from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import call, patch

from src.app import _fetch_all_tweets
from src.config import AppConfig, CompatConfig, FetchConfig, load_config


class MultiCurlExecutionTests(unittest.TestCase):
    def test_load_config_discovers_numbered_curls_in_numeric_order(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            base = Path(tempdir)
            root = base / "openmind"
            data_dir = root / ".agent" / "skill-data" / "x-following-fetcher"
            root.mkdir(parents=True)
            data_dir.mkdir(parents=True)
            (data_dir / "curl_10.txt").write_text("curl 'https://x.com/10'", encoding="utf-8")
            (data_dir / "curl_2.txt").write_text("curl 'https://x.com/2'", encoding="utf-8")

            config = load_config(
                Path(__file__).resolve().parents[1] / "config.yaml",
                root,
                data_dir,
            )

            self.assertEqual(config.compat.curl_files, [
                data_dir / "curl.txt",
                data_dir / "curl_foryou.txt",
                data_dir / "curl_2.txt",
                data_dir / "curl_10.txt",
            ])

    @patch("src.app.time.sleep")
    @patch("src.app.random.uniform", side_effect=[5.25, 9.75])
    @patch("src.app.parse_timeline_payload", side_effect=[["tweet-1"], ["tweet-2"], ["tweet-3"]])
    @patch("src.app.fetch_timelines")
    def test_fetches_curls_serially_with_random_delay_between_them(
        self,
        mock_fetch_timelines,
        _mock_parse,
        mock_uniform,
        mock_sleep,
    ) -> None:
        credential_files = [Path("curl.txt"), Path("curl_2.txt"), Path("curl_3.txt")]
        mock_fetch_timelines.side_effect = [
            [SimpleNamespace(payload={"index": 1}, label="one")],
            [SimpleNamespace(payload={"index": 2}, label="two")],
            [SimpleNamespace(payload={"index": 3}, label="three")],
        ]
        config = AppConfig(
            fetch=FetchConfig(),
            compat=CompatConfig(curl_file=credential_files[0], curl_files=credential_files),
        )

        tweets = _fetch_all_tweets(config, credential_files)

        self.assertEqual(tweets, ["tweet-1", "tweet-2", "tweet-3"])
        self.assertEqual(mock_fetch_timelines.call_args_list, [
            call(config, credential_files[0]),
            call(config, credential_files[1]),
            call(config, credential_files[2]),
        ])
        self.assertEqual(mock_uniform.call_args_list, [call(5, 10), call(5, 10)])
        self.assertEqual(mock_sleep.call_args_list, [call(5.25), call(9.75)])


if __name__ == "__main__":
    unittest.main()
