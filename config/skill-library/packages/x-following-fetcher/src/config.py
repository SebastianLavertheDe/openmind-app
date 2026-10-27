from __future__ import annotations

import ast
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .runtime_paths import require_skill_data_dir, require_content_root, resolve_bound_path


def _parse_scalar(raw_value: str) -> Any:
    value = raw_value.strip()
    if not value:
        return ""

    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered in {"null", "none"}:
        return None

    try:
        if value.startswith(("'", '"')) and value.endswith(("'", '"')):
            return ast.literal_eval(value)
    except Exception:
        return value

    if value.isdigit():
        return int(value)

    try:
        return float(value)
    except ValueError:
        return value


def _load_simple_yaml(path: Path) -> dict[str, Any]:
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue

        indent = len(raw_line) - len(raw_line.lstrip(" "))
        line = raw_line.strip()
        if line.startswith("#"):
            continue

        while len(stack) > 1 and indent <= stack[-1][0]:
            stack.pop()

        parent = stack[-1][1]
        if ":" not in line:
            continue

        key, raw_value = line.split(":", 1)
        key = key.strip()
        raw_value = raw_value.split(" #", 1)[0].rstrip()

        if raw_value.strip():
            parent[key] = _parse_scalar(raw_value)
            continue

        # Peek ahead: if next indented lines start with "-", parse as list
        lines = path.read_text(encoding="utf-8").splitlines()
        line_idx = lines.index(raw_line) if raw_line in lines else -1
        items: list[Any] | None = None
        if line_idx >= 0:
            for peek in lines[line_idx + 1:]:
                peek_stripped = peek.strip()
                if not peek_stripped or peek_stripped.startswith("#"):
                    continue
                peek_indent = len(peek) - len(peek.lstrip(" "))
                if peek_indent <= indent:
                    break
                if peek_stripped.startswith("- "):
                    if items is None:
                        items = []
                    items.append(_parse_scalar(peek_stripped[2:].strip().strip("'\"")))
                else:
                    break
        if items is not None:
            parent[key] = items
            continue

        child: dict[str, Any] = {}
        parent[key] = child
        stack.append((indent, child))

    return root


@dataclass(slots=True)
class FetchConfig:
    count: int = 20
    timeout_seconds: int = 120
    max_retries: int = 2
    include_promoted: bool = False


@dataclass(slots=True)
class RenderConfig:
    include_metrics: bool = True
    include_images: bool = True
    expand_urls: bool = True
    include_retweets: bool = True
    include_quotes: bool = True
    title_max_length: int = 120


@dataclass(slots=True)
class StorageConfig:
    output_dir: Path
    cache_file: Path
    article_output_dir: Path
    daily_json_filename: str = "posts.json"
    daily_html_filename: str = "index.html"
    daily_markdown_filename: str = "timeline.md"
    write_daily_markdown: bool = False
    video_subdir: str = "videos"
    save_external_link_posts_to_article: bool = False


@dataclass(slots=True)
class CompatConfig:
    curl_file: Path
    # Credentials live in the private per-Skill data directory. They are
    # parsed as data by the Python HTTP client and are never shell-executed.
    curl_files: list[Path] = field(default_factory=list)


@dataclass(slots=True)
class AppConfig:
    fetch: FetchConfig = field(default_factory=FetchConfig)
    render: RenderConfig = field(default_factory=RenderConfig)
    storage: StorageConfig | None = None
    compat: CompatConfig | None = None


def _resolve_path(base_dir: Path, raw_path: str, default_path: Path) -> Path:
    if not raw_path:
        return default_path

    path = Path(os.path.expanduser(raw_path))
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()


def load_config(
    config_path: Path | None = None,
    content_root: str | Path | None = None,
    skill_data_dir: str | Path | None = None,
) -> AppConfig:
    skill_dir = Path(__file__).resolve().parents[1]
    root = require_content_root(str(content_root) if content_root is not None else None)
    data_dir = require_skill_data_dir(str(skill_data_dir) if skill_data_dir is not None else None)
    config_path = config_path or Path(
        os.environ.get("X_FETCHER_CONFIG", skill_dir / "config.yaml")
    )
    config_path = Path(config_path).expanduser()
    if not config_path.is_absolute():
        config_path = skill_dir / config_path
    raw = _load_simple_yaml(Path(config_path))

    fetch_raw = raw.get("fetch", {})
    render_raw = raw.get("render", {})
    storage_raw = raw.get("storage", {})
    compat_raw = raw.get("compat", {})

    default_output_dir = root / "post"
    default_article_output_dir = root / "article"
    default_cache_file = data_dir / ".x-following-cache.json"
    default_curl_file = data_dir / "curl.txt"

    def resolve_content(raw_path: str, default_path: Path, label: str) -> Path:
        if not raw_path:
            return default_path
        candidate = Path(os.path.expanduser(raw_path))
        if not candidate.is_absolute():
            candidate = root / candidate
        resolved = candidate.resolve()
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"{label} must stay inside the content root: {raw_path}") from exc
        return resolved

    storage = StorageConfig(
        output_dir=resolve_content(str(storage_raw.get("output_dir", "")), default_output_dir, "storage.output_dir"),
        cache_file=resolve_bound_path(str(storage_raw.get("cache_file", "")) or ".x-following-cache.json", data_dir, "storage.cache_file"),
        article_output_dir=resolve_content(str(storage_raw.get("article_output_dir", "")), default_article_output_dir, "storage.article_output_dir"),
        daily_json_filename=str(storage_raw.get("daily_json_filename", "posts.json")),
        daily_html_filename=str(storage_raw.get("daily_html_filename", "index.html")),
        daily_markdown_filename=str(storage_raw.get("daily_markdown_filename", "timeline.md")),
        write_daily_markdown=bool(storage_raw.get("write_daily_markdown", False)),
        video_subdir=str(storage_raw.get("video_subdir", "videos")),
        save_external_link_posts_to_article=bool(
            storage_raw.get("save_external_link_posts_to_article", False)
        ),
    )
    primary_curl = _resolve_path(data_dir, str(compat_raw.get("curl_file", "")), default_curl_file)
    extra_curls = [
        _resolve_path(data_dir, str(p), data_dir / p)
        for p in (compat_raw.get("extra_curl_files") or [])
        if isinstance(p, str)
    ]
    numbered_curls = sorted(
        (
            candidate
            for candidate in data_dir.glob("curl_*.txt")
            if re.fullmatch(r"curl_(\d+)\.txt", candidate.name, re.IGNORECASE)
        ),
        key=lambda candidate: int(re.fullmatch(r"curl_(\d+)\.txt", candidate.name, re.IGNORECASE).group(1)),
    )
    curl_files: list[Path] = []
    for candidate in [primary_curl, *extra_curls, *numbered_curls]:
        if candidate not in curl_files:
            curl_files.append(candidate)
    compat = CompatConfig(
        curl_file=primary_curl,
        curl_files=curl_files,
    )

    return AppConfig(
        fetch=FetchConfig(
            count=int(fetch_raw.get("count", 20)),
            timeout_seconds=int(fetch_raw.get("timeout_seconds", 120)),
            max_retries=int(fetch_raw.get("max_retries", 2)),
            include_promoted=bool(fetch_raw.get("include_promoted", False)),
        ),
        render=RenderConfig(
            include_metrics=bool(render_raw.get("include_metrics", True)),
            include_images=bool(render_raw.get("include_images", True)),
            expand_urls=bool(render_raw.get("expand_urls", True)),
            include_retweets=bool(render_raw.get("include_retweets", True)),
            include_quotes=bool(render_raw.get("include_quotes", True)),
            title_max_length=int(render_raw.get("title_max_length", 120)),
        ),
        storage=storage,
        compat=compat,
    )
