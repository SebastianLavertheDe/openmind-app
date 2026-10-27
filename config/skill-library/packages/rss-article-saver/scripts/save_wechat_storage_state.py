#!/usr/bin/env python3
"""
Open a visible Chromium session, let the user complete WeChat validation/login,
then persist storage state for later headless reuse.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


DEFAULT_URL = "https://mp.weixin.qq.com/"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Save WeChat browser storage state for rss-article-saver."
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help="WeChat article URL to open before saving state.",
    )
    parser.add_argument(
        "--state-path",
        default="wechat_storage_state.json",
        help="Output path for Playwright storage state JSON.",
    )
    parser.add_argument(
        "--user-data-dir",
        default="",
        help="Optional Chromium user data dir to reuse.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    state_path = Path(args.state_path).expanduser().resolve()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    user_data_dir = args.user_data_dir.strip()

    with sync_playwright() as playwright:
        context = None
        browser = None
        try:
            launch_kwargs = {
                "headless": False,
                "user_agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/146.0.0.0 Safari/537.36"
                ),
                "locale": "zh-CN",
                "viewport": {"width": 1440, "height": 2200},
            }

            if user_data_dir:
                profile_dir = Path(os.path.expanduser(user_data_dir)).resolve()
                profile_dir.mkdir(parents=True, exist_ok=True)
                context = playwright.chromium.launch_persistent_context(
                    str(profile_dir),
                    **launch_kwargs,
                )
            else:
                browser = playwright.chromium.launch(headless=False)
                context = browser.new_context(**launch_kwargs)

            page = context.new_page()
            print(f"Opening: {args.url}")
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            print("")
            print("Complete WeChat validation/login in the opened browser window.")
            print("When the target article is visible, press Enter here to save state.")
            input()

            context.storage_state(path=str(state_path))
            print(f"Saved storage state to: {state_path}")
        finally:
            if context:
                context.close()
            if browser:
                browser.close()


if __name__ == "__main__":
    main()
