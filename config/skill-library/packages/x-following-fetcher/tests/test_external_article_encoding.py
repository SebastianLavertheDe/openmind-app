"""Exercise helper/parent Unicode transport with Windows-style GBK defaults."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
TEXT = "Unicode \u00d6 \u203a \U0001f600 \u4e2d\u6587"


def gbk_environment():
    return {
        **os.environ,
        "PYTHONUTF8": "0",
        "PYTHONIOENCODING": "gbk",
        "PYTHONDONTWRITEBYTECODE": "1",
    }


class ExternalArticleEncodingTests(unittest.TestCase):
    def test_real_helper_preserves_unicode_when_stdout_is_gbk(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = (
                    '<html><head><meta charset="utf-8"><title>' + TEXT
                    + '</title></head><body><article><h1>' + TEXT
                    + '</h1><p>' + ("A substantial article with " + TEXT + ". ") * 40
                    + "</p></article></body></html>"
                ).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/article"
            result = subprocess.run(
                [sys.executable, "-X", "utf8=0",
                 str(ROOT / "scripts/extract_external_articles_json.py"), url],
                env=gbk_environment(), capture_output=True, timeout=45,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
            # The JSON wire format is ASCII-safe; its values remain Unicode.
            rows = json.loads(result.stdout.decode("ascii"))
            self.assertEqual(rows[0]["title"], TEXT)
            self.assertIn(TEXT, rows[0]["content"])
            self.assertTrue(rows[0]["ok"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_gbk_parent_decodes_utf8_helper_output_and_diagnostics(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / "scripts").mkdir()
            data = home / "data"
            data.mkdir()
            (home / "scripts/extract_external_articles_json.py").write_text(
                "import json, sys\n"
                "assert sys.stdout.encoding.lower().replace('-', '') == 'utf8'\n"
                "assert sys.stderr.encoding.lower().replace('-', '') == 'utf8'\n"
                "text = " + ascii(TEXT) + "\n"
                "print(text, file=sys.stderr)\n"
                "print(json.dumps([{'url':'https://example.org/article',"
                "'content':text,'title':text}], ensure_ascii=False))\n",
                encoding="utf-8",
            )
            code = (
                "import json, sys\n"
                f"sys.path.insert(0, {str(ROOT)!r})\n"
                "from src.storage.files import _extract_external_articles\n"
                "rows = _extract_external_articles(['https://example.org/article'])\n"
                "print(json.dumps(rows, ensure_ascii=True))\n"
            )
            result = subprocess.run(
                [sys.executable, "-X", "utf8=0", "-c", code],
                env={
                    **gbk_environment(),
                    "OPENMIND_ROOT": str(home),
                    "OPENMIND_SKILL_HOME": str(home),
                    "OPENMIND_SKILL_DATA_DIR": str(data),
                },
                capture_output=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
            rows = json.loads(result.stdout.decode("ascii"))
            self.assertEqual(rows["https://example.org/article"]["content"], TEXT)
            self.assertIn(TEXT, (data / "external_article_fetch.log").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
