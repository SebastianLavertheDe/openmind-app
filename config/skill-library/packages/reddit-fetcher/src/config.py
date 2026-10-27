from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

import yaml

from .runtime_paths import require_skill_data_dir, require_content_root, resolve_bound_path


@dataclass(frozen=True)
class FetchConfig:
    timeout_seconds: int
    user_agent: str
    fetch_comments: bool
    comment_timeout_seconds: int
    top_level_comment_limit: int
    reply_limit: int
    max_comment_depth: int
    listing_retry_count: int
    comment_retry_count: int
    request_delay_seconds: float
    rss_only: bool
    sources: list[str]


@dataclass(frozen=True)
class StorageConfig:
    output_dir: Path
    cache_file: Path


@dataclass(frozen=True)
class AppConfig:
    fetch: FetchConfig
    storage: StorageConfig


def load_config(
    config_path: str = "config.yaml",
    content_root: str | None = None,
    skill_data_dir: str | None = None,
) -> AppConfig:
    skill_root = Path(__file__).resolve().parents[1]
    config_candidate = Path(config_path).expanduser()
    config_abs = (config_candidate if config_candidate.is_absolute() else skill_root / config_candidate).resolve()
    with open(config_abs, "r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle) or {}

    fetch_raw = raw.get("fetch", {})
    storage_raw = raw.get("storage", {})

    root = require_content_root(content_root)
    data_dir = require_skill_data_dir(skill_data_dir)
    sources = _load_user_sources(data_dir, skill_root, fetch_raw.get("sources", []))

    # Default output_dir: <content_root>/reddit
    output_dir_raw = storage_raw.get("output_dir", "")
    if output_dir_raw:
        output_dir = resolve_bound_path(str(output_dir_raw), root, "storage.output_dir")
    else:
        output_dir = root / "reddit"

    cache_file_raw = storage_raw.get("cache_file", "")
    if cache_file_raw:
        cache_file = resolve_bound_path(str(cache_file_raw), data_dir, "storage.cache_file")
    else:
        cache_file = data_dir / ".reddit_fetch_cache.json"

    return AppConfig(
        fetch=FetchConfig(
            timeout_seconds=int(fetch_raw.get("timeout_seconds", 30)),
            user_agent=str(
                fetch_raw.get(
                    "user_agent",
                    "Mozilla/5.0 (compatible; reddit-fetcher/0.1)",
                )
            ),
            fetch_comments=bool(fetch_raw.get("fetch_comments", False)),
            comment_timeout_seconds=int(fetch_raw.get("comment_timeout_seconds", 20)),
            top_level_comment_limit=int(fetch_raw.get("top_level_comment_limit", 20)),
            reply_limit=int(fetch_raw.get("reply_limit", 3)),
            max_comment_depth=int(fetch_raw.get("max_comment_depth", 2)),
            listing_retry_count=int(fetch_raw.get("listing_retry_count", 3)),
            comment_retry_count=int(fetch_raw.get("comment_retry_count", 2)),
            request_delay_seconds=float(fetch_raw.get("request_delay_seconds", 0.2)),
            rss_only=bool(fetch_raw.get("rss_only", True)),
            sources=sources,
        ),
        storage=StorageConfig(
            output_dir=output_dir,
            cache_file=cache_file,
        ),
    )


def _load_user_sources(data_dir: Path, skill_root: Path, packaged_sources: object) -> list[str]:
    defaults = _validate_sources(packaged_sources, "package config fetch.sources")
    # Bare source-tree execution historically uses the package directory as its
    # data directory. Keep that developer flow read-only and use package defaults
    # directly; installed runs always receive a separate managed data directory.
    if data_dir.resolve() == skill_root.resolve():
        return defaults

    source_file = data_dir / "user-sources.yaml"
    if not source_file.exists():
        _write_sources_if_missing(source_file, defaults)
    try:
        with open(source_file, "r", encoding="utf-8") as handle:
            document = yaml.safe_load(handle) or {}
    except OSError as exc:
        raise ValueError(f"Unable to read persistent Reddit sources: {source_file}") from exc
    if not isinstance(document, dict):
        raise ValueError(f"Unsupported persistent Reddit source schema: {source_file}")
    schema_version = document.get("schemaVersion", 1)
    if schema_version == 1:
        return _validate_sources(document.get("sources"), f"{source_file} sources")
    if schema_version == 2:
        return _validate_structured_sources(document.get("sources"), f"{source_file} sources")
    raise ValueError(f"Unsupported persistent Reddit source schema: {source_file}")


def _validate_sources(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise ValueError(f"{label} must be a list of non-empty URLs")
    return [item.strip() for item in value]


def _validate_structured_sources(value: object, label: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be a list")
    enabled_urls: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError(f"{label} entries must be objects")
        url = item.get("url")
        if not isinstance(url, str) or not url.strip():
            raise ValueError(f"{label} entries must contain a non-empty URL")
        if item.get("enabled", True) is not False:
            enabled_urls.append(url.strip())
    return enabled_urls


def _write_sources_if_missing(target: Path, sources: list[str]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = yaml.safe_dump(
        {
            "schemaVersion": 2,
            "sources": [_default_source_entry(source) for source in sources],
        },
        allow_unicode=True,
        sort_keys=False,
    ).encode("utf-8")
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(payload)
    except Exception:
        try:
            target.unlink()
        except OSError:
            pass
        raise


def _default_source_entry(url: str) -> dict[str, object]:
    normalized = url.strip()
    parsed = urlparse(normalized)
    parts = [unquote(part) for part in parsed.path.split("/") if part]
    name = f"r/{parts[1]}" if len(parts) >= 2 and parts[0].lower() == "r" else parsed.hostname or "Reddit community"
    return {
        "id": hashlib.sha1(f"reddit:{normalized}".encode("utf-8")).hexdigest(),
        "name": name,
        "url": normalized,
        "enabled": True,
        "frequency": "每日流水线",
        "tags": ["社区"],
    }
