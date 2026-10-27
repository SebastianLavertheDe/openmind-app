#!/usr/bin/env python3
"""Report skill run status for a given date."""

import json
import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

from runtime_paths import RuntimePathError, optional_run_dir, require_content_root

CONTENT_ROOT: Path | None = None
RUN_DIR: Path | None = None


def configure_paths(content_root: Path, run_dir: Path | None) -> None:
    global CONTENT_ROOT, RUN_DIR
    CONTENT_ROOT = content_root
    RUN_DIR = run_dir


def content_path(*parts: str) -> Path:
    if CONTENT_ROOT is None:
        raise RuntimeError("report paths have not been configured")
    return CONTENT_ROOT.joinpath(*parts)


def run_records(date_str: str) -> list[dict]:
    if RUN_DIR is None or not RUN_DIR.exists():
        return []
    records: list[dict] = []
    for entry in RUN_DIR.iterdir():
        if not entry.is_dir():
            continue
        record_path = entry / "run.json"
        if not record_path.exists():
            continue
        record = read_json(record_path)
        if not isinstance(record, dict):
            continue
        created = str(record.get("createdAt", ""))
        if not created.startswith(iso_date(date_str)):
            continue
        request = record.get("request")
        if isinstance(request, dict):
            record["skillId"] = request.get("skillId")
        records.append(record)
    return records


def workflow_records(date_str: str) -> list[dict]:
    if RUN_DIR is None:
        return []
    workflow_dir = RUN_DIR / "workflows"
    if not workflow_dir.exists():
        return []
    results: list[dict] = []
    for path in workflow_dir.glob("*.json"):
        record = read_json(path)
        if isinstance(record, dict) and str(record.get("createdAt", "")).startswith(iso_date(date_str)):
            results.append(record)
    return results


def yesterday_str():
    return (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")


def iso_date(yyyymmdd):
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"


def count_files(d: Path):
    if not d.exists():
        return 0
    return sum(1 for f in d.iterdir() if f.is_file())


def file_size_kb(p: Path):
    if not p.exists():
        return 0
    return round(p.stat().st_size / 1024, 1)


def read_jsonl(path: Path):
    if not path.exists():
        return []
    results = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    results.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return results


def read_json(path: Path):
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def file_mtime_date(path: Path):
    if not path.exists():
        return None
    return datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y%m%d")


def recent_log_errors(path: Path, limit=3):
    if not path.exists():
        return []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()[-300:]
    except OSError:
        return []

    errors = []
    for line in reversed(lines):
        line = line.strip()
        if "Failed to fetch" not in line:
            continue
        if line not in errors:
            errors.append(line)
        if len(errors) >= limit:
            break
    return list(reversed(errors))


# ── Skill checks ──────────────────────────────────────────────

def check_rss_article_saver(date_str):
    info = {"skill": "rss-article-saver", "ran": False, "details": {}}

    # Output directory
    article_dir = content_path("article", date_str)
    if article_dir.exists():
        count = count_files(article_dir)
        info["ran"] = True
        info["details"]["articles_saved"] = count

    entries = [entry for entry in run_records(date_str) if entry.get("skillId") == "rss-article-saver"]
    if entries:
        info["ran"] = True
        info["details"]["runs"] = len(entries)
        info["details"]["status"] = entries[-1].get("state")

    # Counter
    counter = read_json(content_path("article", ".counter.json"))
    if counter and counter.get("current_date") == date_str:
        info["ran"] = True
        info["details"]["counter"] = counter.get("article_counter", "?")

    return info


def check_daily_article_summarizer(date_str):
    info = {"skill": "daily-article-summarizer", "ran": False, "details": {}}

    # Output file
    summary_file = content_path("daily-summary", f"{date_str}_daily_summary.md")
    if summary_file.exists():
        info["ran"] = True
        size = file_size_kb(summary_file)
        info["details"]["summary_size_kb"] = size

    entries = [entry for entry in run_records(date_str) if entry.get("skillId") == "daily-article-summarizer"]
    if entries:
        info["ran"] = True
        info["details"]["runs"] = len(entries)
        info["details"]["status"] = entries[-1].get("state")

    return info


def check_x_following_fetcher(date_str):
    info = {"skill": "x-following-fetcher", "ran": False, "details": {}}

    post_dir = content_path("post", date_str)
    if post_dir.exists():
        info["ran"] = True
        posts_json = post_dir / "posts.json"
        if posts_json.exists():
            data = read_json(posts_json)
            if isinstance(data, list):
                info["details"]["posts_fetched"] = len(data)
            elif isinstance(data, dict) and "posts" in data:
                info["details"]["posts_fetched"] = len(data["posts"])
        html = post_dir / "index.html"
        if html.exists():
            info["details"]["has_html"] = True

    return info


def check_reddit_fetcher(date_str):
    info = {"skill": "reddit-fetcher", "ran": False, "details": {}}

    reddit_dir = content_path("reddit", date_str)
    if reddit_dir.exists():
        info["ran"] = True
        md_files = list(reddit_dir.glob("*.md"))
        info["details"]["subreddit_files"] = len(md_files)
        info["details"]["subreddits"] = [f.stem for f in md_files]
        if not md_files:
            info["details"]["status"] = "no_output"
            entries = [entry for entry in run_records(date_str) if entry.get("skillId") == "reddit-fetcher"]
            if entries:
                info["details"]["status"] = entries[-1].get("state")

    return info


def check_daily_topic_selector(date_str):
    info = {"skill": "daily-topic-selector", "ran": False, "details": {}}

    topic_file = content_path("daily-topic", f"{date_str}_daily_topic.md")
    if topic_file.exists():
        info["ran"] = True
        info["details"]["topic_file_kb"] = file_size_kb(topic_file)

    return info


def check_ai_media_topic_selector(date_str):
    info = {"skill": "ai-media-topic-selector", "ran": False, "details": {}}

    iso = iso_date(date_str)
    topic_dir = content_path("creative", "01-内容生产", "选题管理")
    if topic_dir.exists():
        for f in topic_dir.iterdir():
            if f.is_file() and iso in f.name and f.name.endswith(".md"):
                info["ran"] = True
                info["details"]["topic_file"] = f.name
                break

    return info


def check_collect_interest_markers(date_str):
    info = {"skill": "collect-interest-markers", "ran": False, "details": {}}

    inbox = content_path("creative", "01-内容生产", "选题管理", "00-兴趣收集箱.md")
    if not inbox.exists():
        return info

    iso = iso_date(date_str)
    try:
        text = inbox.read_text(encoding="utf-8")
    except OSError:
        return info

    if f"### {iso}" in text:
        # Count items under this date section
        count = text.count(f"<!-- interest-id:")
        # Find the section for this specific date
        in_section = False
        section_items = 0
        for line in text.splitlines():
            if line.strip() == f"### {iso}":
                in_section = True
                continue
            if in_section:
                if line.startswith("### "):
                    break
                if "<!-- interest-id:" in line:
                    section_items += 1
        info["ran"] = True
        info["details"]["items_collected"] = section_items

    return info


def check_rss_to_summary_workflow(date_str):
    info = {"skill": "rss-to-summary-workflow", "ran": False, "details": {}}

    steps_found = workflow_records(date_str)

    if steps_found:
        info["ran"] = True
        info["details"]["steps"] = len(steps_found)
        statuses = {str(e.get("state", "unknown")) for e in steps_found}
        info["details"]["status"] = next(iter(statuses)) if len(statuses) == 1 else f"mixed: {sorted(statuses)}"

    return info


# ── Main ───────────────────────────────────────────────────────

CHECKS = [
    check_rss_to_summary_workflow,
    check_rss_article_saver,
    check_daily_article_summarizer,
    check_x_following_fetcher,
    check_reddit_fetcher,
    check_daily_topic_selector,
    check_ai_media_topic_selector,
    check_collect_interest_markers,
]


def main():
    parser = argparse.ArgumentParser(description="Report installed Skill run status for a given date.")
    parser.add_argument("date", nargs="?", default=yesterday_str(), help="Date in YYYYMMDD format.")
    parser.add_argument("--content-root", default="", help="Explicit content root; defaults to OPENMIND_ROOT.")
    parser.add_argument("--run-dir", default="", help="App-private Run directory; defaults to OPENMIND_RUN_DIR.")
    parser.add_argument("--skill-data-dir", default="", help="Reserved app-private Skill data directory.")
    args = parser.parse_args()
    try:
        configure_paths(require_content_root(args.content_root), optional_run_dir(args.run_dir))
    except RuntimePathError as exc:
        parser.error(str(exc))
    date_str = args.date

    if len(date_str) != 8 or not date_str.isdigit():
        print(f"Invalid date: {date_str}. Use YYYYMMDD format.")
        sys.exit(1)

    print(f"# Skill Run Report: {iso_date(date_str)}")
    print()

    results = []
    for check_fn in CHECKS:
        results.append(check_fn(date_str))

    ran_count = sum(1 for r in results if r["ran"])
    total = len(results)

    # Summary
    print(f"## Summary: {ran_count}/{total} skills ran")
    print()

    # Table
    print("| Skill | Ran | Key Metrics |")
    print("|-------|-----|-------------|")
    for r in results:
        ran_str = "Yes" if r["ran"] else "No"
        metrics = ", ".join(f"{k}: {v}" for k, v in r["details"].items()) if r["details"] else "-"
        print(f"| {r['skill']} | {ran_str} | {metrics} |")
    print()

    # Details
    for r in results:
        if r["ran"] and r["details"]:
            print(f"### {r['skill']}")
            for k, v in r["details"].items():
                print(f"- **{k}**: {v}")
            print()

    # Not tracked
    not_ran = [r["skill"] for r in results if not r["ran"]]
    if not_ran:
        print(f"**Did not run:** {', '.join(not_ran)}")


if __name__ == "__main__":
    main()
