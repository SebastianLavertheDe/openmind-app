"""Log rotation and cache pruning utilities for cron-based skills."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path


def rotate_log(path: str | Path, max_bytes: int = 5_000_000) -> None:
    """Truncate a log file to its last *max_bytes* if it exceeds the limit.

    Keeps the most recent content (tail of the file).  On failure, silently
    does nothing so it never blocks the caller.
    """
    p = Path(path)
    if not p.exists():
        return
    try:
        size = p.stat().st_size
        if size <= max_bytes:
            return
        keep = p.read_bytes()[-max_bytes:]
        # Find the first newline so we don't start mid-line
        nl = keep.find(b"\n")
        if nl >= 0:
            keep = keep[nl + 1:]
        p.write_bytes(keep)
    except Exception:
        pass


def prune_date_keyed_cache(
    path: str | Path,
    keep_days: int = 30,
    special_keys: set[str] | None = None,
) -> int:
    """Remove date-keyed entries older than *keep_days* from a JSON cache.

    Only keys matching ``YYYYMMDD`` format are removed.  *special_keys* are
    always preserved (e.g. ``"__post_summaries__"``).

    Returns the number of removed keys.
    """
    p = Path(path)
    if not p.exists():
        return 0
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return 0
    if not isinstance(data, dict):
        return 0

    cutoff = (datetime.now() - timedelta(days=keep_days)).strftime("%Y%m%d")
    preserved = special_keys or set()
    to_remove = [
        k for k in data
        if k not in preserved and len(k) == 8 and k.isdigit() and k < cutoff
    ]
    if not to_remove:
        return 0
    for k in to_remove:
        del data[k]
    try:
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        return 0
    return len(to_remove)
