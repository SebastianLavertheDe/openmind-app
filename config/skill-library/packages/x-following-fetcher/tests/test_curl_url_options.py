import unittest

from src.fetcher.client import FetchError, _parse_legacy_curl_command


class CurlUrlOptionTests(unittest.TestCase):
    def test_browser_export_url_formats_preserve_headers_and_request_body(self):
        url = "https://x.com/i/api/graphql/fixture/Following"
        for argument in [f"--url '{url}'", f"--url={url}", f"'{url}'"]:
            with self.subTest(argument=argument):
                request, = _parse_legacy_curl_command(
                    f"curl {argument} \\\n --header 'Authorization: Bearer fixture-token' --data-raw '{{\"variables\":{{\"count\":7}}}}'",
                    "fixture",
                )
                self.assertEqual(request.url, url)
                self.assertEqual(request.method, "POST")
                self.assertEqual(request.headers["Authorization"], "Bearer fixture-token")
                self.assertEqual(request.json_body, {"variables": {"count": 7}})

    def test_missing_url_option_values_are_rejected_without_network(self):
        for command in ["curl --url", "curl --url=", "curl --url --header 'Accept: application/json'"]:
            with self.subTest(command=command), self.assertRaises(FetchError):
                _parse_legacy_curl_command(command, "fixture")


if __name__ == "__main__":
    unittest.main()
