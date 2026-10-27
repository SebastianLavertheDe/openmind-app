from __future__ import annotations

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import AppConfig, CompatConfig, FetchConfig
from src.fetcher.client import FetchError, fetch_timelines


class _TimelineHandler(BaseHTTPRequestHandler):
    request_body: dict = {}
    request_headers: dict[str, str] = {}

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler contract
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        self.__class__.request_body = json.loads(raw.decode("utf-8"))
        self.__class__.request_headers = {key.lower(): value for key, value in self.headers.items()}
        body = json.dumps({"data": {"timeline": "ok"}}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args) -> None:
        return


class ManagedCredentialTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _TimelineHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.previous = os.environ.get("X_FETCHER_CREDENTIAL_JSON")

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        if self.previous is None:
            os.environ.pop("X_FETCHER_CREDENTIAL_JSON", None)
        else:
            os.environ["X_FETCHER_CREDENTIAL_JSON"] = self.previous

    def config(self) -> AppConfig:
        return AppConfig(
            fetch=FetchConfig(count=7, timeout_seconds=2, max_retries=1),
            compat=CompatConfig(curl_file=Path("/missing/curl.txt")),
        )

    def test_structured_credential_posts_json_without_shell_execution(self) -> None:
        port = self.server.server_address[1]
        os.environ["X_FETCHER_CREDENTIAL_JSON"] = json.dumps({
            "requests": [{
                "label": "following",
                "method": "POST",
                "url": f"http://127.0.0.1:{port}/graphql",
                "headers": {"Authorization": "Bearer managed-token"},
                "json": {"variables": {"count": 1, "cursor": None}}
            }]
        })

        responses = fetch_timelines(self.config())

        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0].label, "following")
        self.assertEqual(_TimelineHandler.request_body["variables"]["count"], 7)
        self.assertEqual(_TimelineHandler.request_headers["authorization"], "Bearer managed-token")

    def test_shell_command_payload_is_rejected_as_invalid_json(self) -> None:
        os.environ["X_FETCHER_CREDENTIAL_JSON"] = "curl https://x.com --header Authorization: secret"
        with self.assertRaises(FetchError):
            fetch_timelines(self.config())


if __name__ == "__main__":
    unittest.main()
