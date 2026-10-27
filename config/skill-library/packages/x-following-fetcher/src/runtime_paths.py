"""Runtime path bindings supplied by the desktop app Broker."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


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


def write_artifact_report(run_dir: Path | None, artifacts: list[dict[str, str]]) -> None:
    """Atomically report exact outputs to the desktop Broker.

    Direct cron/local runs do not receive OPENMIND_ARTIFACT_REPORT_PATH and
    intentionally skip this app-private protocol.
    """
    raw = os.environ.get("OPENMIND_ARTIFACT_REPORT_PATH", "").strip()
    if not raw:
        return
    if run_dir is None:
        raise RuntimePathError("Artifact report path requires a bound Run directory")

    canonical_run_dir = run_dir.expanduser().resolve()
    report_path = Path(raw).expanduser().resolve()
    try:
        report_path.relative_to(canonical_run_dir)
    except ValueError as exc:
        raise RuntimePathError("Artifact report path must stay inside the bound Run directory") from exc

    payload: dict[str, Any] = {"schemaVersion": 1, "artifacts": artifacts}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = report_path.with_name(f".{report_path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(report_path)
    finally:
        temporary.unlink(missing_ok=True)


def resolve_bound_path(value: str, base: Path, label: str) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = base / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(base.resolve())
    except ValueError as exc:
        raise RuntimePathError(f"{label} must stay inside its bound directory: {value}") from exc
    return resolved
