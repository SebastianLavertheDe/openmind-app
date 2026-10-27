#!/usr/bin/env python3
"""Collect [i]/[t] markers from daily-summary files into an interest inbox."""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from runtime_paths import RuntimePathError, require_content_root, resolve_content_path


MARKER_PATTERNS = [
    re.compile(
        r"^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?"
        r"\[(?P<kind>[it])\]\s+(?P<body>.+?)\s*$"
    ),
    re.compile(r"^\s{0,3}#{1,6}\s+\[(?P<kind>[it])\]\s+(?P<body>.+?)\s*$"),
]
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
BARE_URL_RE = re.compile(r"https?://[^\s)>\]]+")
EXISTING_ID_RE = re.compile(r"interest-id:\s*([a-f0-9]{12,40})")

INBOX_RELATIVE = Path("creative/01-内容生产/选题管理/00-兴趣收集箱.md")
SUMMARY_DIR_RELATIVE = Path("daily-summary")


@dataclass(frozen=True)
class InterestItem:
    kind: str
    title: str
    value: str
    source_ref: str
    source_url: str
    next_step: str
    item_id: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect [i]/[t] markers from daily-summary into the interest inbox."
    )
    parser.add_argument("--source", help="Daily summary markdown file to scan.")
    parser.add_argument("--date", help="Date in YYYYMMDD or YYYY-MM-DD format.")
    parser.add_argument("--content-root", default="", help="Explicit content root; defaults to OPENMIND_ROOT.")
    parser.add_argument("--skill-data-dir", default="", help="Reserved app-private Skill data directory.")
    parser.add_argument("--run-dir", default="", help="Reserved app-private Run working directory.")
    parser.add_argument("--inbox", help="Output inbox file. Defaults to the standard content-root path.")
    parser.add_argument("--dry-run", action="store_true", help="Print found items without writing.")
    return parser.parse_args()


def resolve_source(args: argparse.Namespace, content_root: Path) -> Path:
    if args.source:
        return resolve_content_path(args.source, content_root, "--source")

    if args.date:
        compact_date = args.date.replace("-", "")
        return content_root / SUMMARY_DIR_RELATIVE / f"{compact_date}_daily_summary.md"

    candidates = sorted((content_root / SUMMARY_DIR_RELATIVE).glob("*_daily_summary.md"))
    if not candidates:
        raise FileNotFoundError(f"No daily summary files found under {content_root / SUMMARY_DIR_RELATIVE}")
    return candidates[-1]


def format_date(source: Path) -> str:
    match = re.search(r"(\d{8})_daily_summary\.md$", source.name)
    if not match:
        return "未标日期"
    raw = match.group(1)
    return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"


def relative_ref(path: Path, content_root: Path, line_no: int) -> str:
    try:
        rel = path.resolve().relative_to(content_root)
    except ValueError:
        rel = path.resolve()
    return f"{rel}:{line_no}"


def match_marker(line: str) -> re.Match[str] | None:
    for pattern in MARKER_PATTERNS:
        match = pattern.match(line)
        if match:
            return match
    return None


def is_boundary(line: str) -> bool:
    if match_marker(line):
        return True
    if re.match(r"^\s{0,3}#{1,6}\s+", line):
        return True
    return bool(re.match(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)", line))


def collect_context(lines: list[str], index: int) -> str:
    context = [lines[index]]
    for next_line in lines[index + 1 : index + 9]:
        if is_boundary(next_line):
            break
        context.append(next_line)
        if next_line.strip() == "" and len(context) > 2:
            break
    return "\n".join(context)


def collect_block(lines: list[str], index: int) -> str:
    """Collect the entire section block from a marker line until the next section boundary."""
    block = [lines[index]]
    for i in range(index + 1, len(lines)):
        line = lines[i]
        if re.match(r"^\s{0,3}#{1,3}\s+", line) and not match_marker(line):
            break
        if re.match(r"^\s{0,3}---+\s*$", line):
            break
        if match_marker(line):
            break
        block.append(line)
    return "\n".join(block)


def first_url(text: str) -> str:
    md_match = MD_LINK_RE.search(text)
    if md_match:
        return md_match.group(2).rstrip(".,;")

    bare_match = BARE_URL_RE.search(text)
    if bare_match:
        return bare_match.group(0).rstrip(".,;")
    return "待补"


def clean_markdown(text: str) -> str:
    def replace_link(match: re.Match[str]) -> str:
        label = match.group(1).strip()
        if label.lower() in {"source", "link"} or label in {"原帖", "原文", "链接", "详情"}:
            return ""
        return label

    text = MD_LINK_RE.sub(replace_link, text)
    text = BARE_URL_RE.sub("", text)
    text = re.sub(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)", "", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text)
    text = re.sub(r"^\[[it]\]\s+", "", text)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -")


def truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def title_and_value(body: str) -> tuple[str, str]:
    cleaned = clean_markdown(body)
    if not cleaned:
        return "未命名兴趣点", "待补"

    value = cleaned
    title = cleaned
    for sep in ("：", ":"):
        if sep in cleaned:
            left, right = cleaned.split(sep, 1)
            left = left.strip()
            right = right.strip()
            if 2 <= len(left) <= 45 and right:
                title = f"{left}: {truncate(right, 56)}"
                value = right
                break

    return truncate(title, 90), truncate(value, 150)


def item_id(source_ref: str, title: str, value: str) -> str:
    normalized = re.sub(r"\s+", " ", f"{source_ref}|{title}|{value}").strip()
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]


def extract_items(source: Path, content_root: Path) -> list[InterestItem]:
    lines = source.read_text(encoding="utf-8").splitlines()
    items: list[InterestItem] = []

    for index, line in enumerate(lines):
        match = match_marker(line)
        if not match:
            continue

        kind = match.group("kind")
        body = match.group("body").strip()
        context = collect_block(lines, index)
        title, value = title_and_value(body)
        source_ref = relative_ref(source, content_root, index + 1)
        next_step = "判断是否进入选题池" if kind == "i" else "深化选题并补官方来源"
        items.append(
            InterestItem(
                kind=kind,
                title=title,
                value=value,
                source_ref=source_ref,
                source_url=first_url(context),
                next_step=next_step,
                item_id=item_id(source_ref, title, value),
            )
        )
    return items


def base_inbox_text() -> str:
    return (
        "# 兴趣收集箱\n\n"
        "> 从 `daily-summary` 的 `[i]` / `[t]` 标记批量整理而来。\n\n"
        "## 待整理\n\n"
        "## 选题候选\n"
    )


def ensure_section(text: str, section: str) -> str:
    if re.search(rf"(?m)^## {re.escape(section)}\s*$", text):
        return text
    if not text.endswith("\n"):
        text += "\n"
    return f"{text}\n## {section}\n"


def section_bounds(text: str, section: str) -> tuple[int, int, int]:
    match = re.search(rf"(?m)^## {re.escape(section)}\s*$", text)
    if not match:
        raise ValueError(f"Missing section: {section}")
    body_start = match.end()
    next_match = re.search(r"(?m)^##\s+", text[body_start:])
    body_end = body_start + next_match.start() if next_match else len(text)
    return match.start(), body_start, body_end


def insert_into_section(text: str, section: str, date_label: str, entries: list[str]) -> str:
    if not entries:
        return text

    text = ensure_section(text, section)
    _, body_start, body_end = section_bounds(text, section)
    body = text[body_start:body_end]
    date_match = re.search(rf"(?m)^### {re.escape(date_label)}\s*$", body)
    block = "\n".join(entries).rstrip() + "\n"

    if date_match:
        date_body_start = body_start + date_match.end()
        after_date = text[date_body_start:body_end]
        next_date = re.search(r"(?m)^###\s+", after_date)
        insert_at = date_body_start + next_date.start() if next_date else body_end
        insertion = "\n" + block
        return text[:insert_at].rstrip() + insertion + "\n" + text[insert_at:].lstrip("\n")

    insertion = f"\n\n### {date_label}\n\n{block}"
    return text[:body_start].rstrip() + insertion + "\n" + text[body_start:].lstrip("\n")


def render_item(item: InterestItem) -> str:
    return (
        f"<!-- interest-id: {item.item_id} -->\n"
        f"- [ ] {item.title}\n"
        f"  - 一句话价值: {item.value}\n"
        f"  - 来源文件: `{item.source_ref}`\n"
        f"  - 原链: {item.source_url}\n"
        f"  - 下一步: {item.next_step}\n"
    )


def update_inbox(inbox: Path, items: list[InterestItem], date_label: str) -> tuple[int, int]:
    if inbox.exists():
        text = inbox.read_text(encoding="utf-8")
    else:
        text = base_inbox_text()

    existing_ids = set(EXISTING_ID_RE.findall(text))
    new_items = [item for item in items if item.item_id not in existing_ids]
    grouped = {
        "待整理": [render_item(item) for item in new_items if item.kind == "i"],
        "选题候选": [render_item(item) for item in new_items if item.kind == "t"],
    }

    for section, entries in grouped.items():
        text = insert_into_section(text, section, date_label, entries)

    inbox.parent.mkdir(parents=True, exist_ok=True)
    inbox.write_text(text.rstrip() + "\n", encoding="utf-8")
    return len(new_items), len(items) - len(new_items)


def print_items(items: list[InterestItem]) -> None:
    for item in items:
        section = "待整理" if item.kind == "i" else "选题候选"
        print(f"- [{section}] {item.title}")
        print(f"  来源文件: {item.source_ref}")
        print(f"  原链: {item.source_url}")


def main() -> int:
    args = parse_args()
    try:
        content_root = require_content_root(args.content_root)
        source = resolve_source(args, content_root).resolve()
        inbox = resolve_content_path(args.inbox, content_root, "--inbox") if args.inbox else content_root / INBOX_RELATIVE
    except RuntimePathError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if not source.exists():
        print(f"Source file not found: {source}", file=sys.stderr)
        return 1

    items = extract_items(source, content_root)
    i_count = sum(1 for item in items if item.kind == "i")
    t_count = sum(1 for item in items if item.kind == "t")
    print(f"Source: {source}")
    print(f"Found: {len(items)} items ([i]={i_count}, [t]={t_count})")

    if args.dry_run:
        print_items(items)
        return 0

    if not items:
        print("No [i] or [t] markers found. Inbox was not changed.")
        return 0

    new_count, skipped_count = update_inbox(inbox, items, format_date(source))
    print(f"Written: {new_count} new items, skipped: {skipped_count} existing items")
    print(f"Inbox: {inbox}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
