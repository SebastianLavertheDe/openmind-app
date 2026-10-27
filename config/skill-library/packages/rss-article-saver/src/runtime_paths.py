"""Runtime path bindings supplied by the desktop app Broker."""

from __future__ import annotations

import os
from pathlib import Path


class RuntimePathError(ValueError):
    pass


def require_content_root(cli_value: str | None = None) -> Path:
    raw = (cli_value or os.environ.get("OPENMIND_ROOT") or "").strip()
    if not raw:
        raise RuntimePathError("content root is required; pass --content-root or set OPENMIND_ROOT")
    root = Path(raw).expanduser().resolve()
    if not root.is_dir():
        raise RuntimePathError(f"content root is not an existing directory: {root}")
    return root


def require_skill_data_dir(cli_value: str | None = None) -> Path:
    raw = (cli_value or os.environ.get("OPENMIND_SKILL_DATA_DIR") or "").strip()
    if not raw:
        raise RuntimePathError("Skill data directory is required; pass --skill-data-dir or set OPENMIND_SKILL_DATA_DIR")
    data_dir = Path(raw).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def optional_run_dir(cli_value: str | None = None) -> Path | None:
    raw = (cli_value or os.environ.get("OPENMIND_RUN_DIR") or "").strip()
    if not raw:
        return None
    run_dir = Path(raw).expanduser().resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def resolve_content_path(value: str, root: Path, label: str) -> Path:
    raw = value.strip()
    if not raw:
        raise RuntimePathError(f"{label} must not be empty")
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise RuntimePathError(f"{label} must stay inside the content root: {raw}") from exc
    return resolved


def resolve_data_path(value: str, data_dir: Path, label: str) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = data_dir / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(data_dir.resolve())
    except ValueError as exc:
        raise RuntimePathError(f"{label} must stay inside Skill data directory: {value}") from exc
    return resolved
