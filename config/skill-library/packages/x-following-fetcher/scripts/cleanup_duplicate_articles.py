#!/usr/bin/env python3
"""一次性清理内容根 article/ 下同 tweet_id 跨日期目录重复的 x_ article.

保留规则: 每个 tweet_id 保留最早日期目录里的全部文件(含多链接 _01.._NN).
安全: 默认 dry-run 仅预览; 仅删除确属同 tweet_id 跨目录的副本; 不动单目录内多链接文件.

用法:
  python scripts/cleanup_duplicate_articles.py --dry-run
  python scripts/cleanup_duplicate_articles.py --apply
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

_TID_RE = re.compile(r"^x_(\d+)")


def _resolve_article_root(cli_value) -> Path:
    # 绑定内容根（OPENMIND_ROOT）；
    # 扁平布局下文章位于 <root>/article。
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from runtime_paths import require_content_root

    return require_content_root(str(cli_value) if cli_value else None) / "article"


def collect_groups(article_root: Path) -> dict[str, dict[str, list[Path]]]:
    """按 tweet_id 聚合: {tweet_id: {date_dir_name: [file_paths]}}."""
    groups: dict[str, dict[str, list[Path]]] = defaultdict(lambda: defaultdict(list))
    if not article_root.exists():
        return groups
    for date_dir in article_root.iterdir():
        if not date_dir.is_dir():
            continue
        for md in date_dir.glob("x_*.md"):
            m = _TID_RE.match(md.name)
            if not m:
                continue
            groups[m.group(1)][date_dir.name].append(md)
    return groups


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--article-root", type=Path, default=None,
                    help="article 目录；默认 <内容根>/article（OPENMIND_ROOT）")
    ap.add_argument("--apply", dest="dry_run", action="store_false",
                    help="真正执行删除 (默认 dry-run 仅预览)")
    ap.set_defaults(dry_run=True)
    args = ap.parse_args()

    root: Path = _resolve_article_root(args.article_root)
    if not root.is_dir():
        print(f"article-root 不存在: {root}", file=sys.stderr)
        return 2

    groups = collect_groups(root)

    to_delete: list[Path] = []
    dup_count = 0
    for tid, by_date in groups.items():
        if len(by_date) < 2:  # 仅单个日期目录 -> 非跨目录重复,跳过
            continue
        dup_count += 1
        keep_date = min(by_date.keys())  # 最早日期 = 保留
        for dname, paths in by_date.items():
            if dname == keep_date:
                continue
            to_delete.extend(paths)

    print(f"article-root: {root}")
    print(f"模式: {'DRY-RUN(预览, 加 --apply 真删)' if args.dry_run else 'APPLY(真删)'}")
    print(f"跨目录重复 tweet_id 组数: {dup_count}")
    print(f"待删除文件数: {len(to_delete)}")
    if not to_delete:
        print("无可清理项.")
        return 0

    # 安全校验: 每个待删 tweet_id 必须有保留副本(最早日期目录里的文件)
    for p in to_delete:
        m = _TID_RE.match(p.name)
        assert m, f"异常文件名(无 tweet_id): {p}"
        tid = m.group(1)
        keep_date = min(groups[tid].keys())
        assert groups[tid][keep_date], f"tweet_id {tid} 保留副本缺失"

    for p in sorted(to_delete):
        rel = p.relative_to(root)
        if args.dry_run:
            print(f"  [dry] would delete {rel}")
        else:
            p.unlink()
            print(f"  [ok]  deleted {rel}")

    if args.dry_run:
        print(f"\n预览完成, 未实际删除 {len(to_delete)} 个文件. 加 --apply 执行.")
    else:
        print(f"\n已删除 {len(to_delete)} 个文件.")
    print("已有知识库内容会保留；如其中引用了已清理的重复文章，请按需手动整理链接。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
