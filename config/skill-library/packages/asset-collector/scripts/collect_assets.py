#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from runtime_paths import RuntimePathError, require_content_root, resolve_content_path

DEFAULT_DRAFT_FILES = ["topic-brief.md", "xiaohongshu-draft.md", "wechat-draft.md", "twitter-thread.md"]
URL_RE = re.compile(r"https?://[^\s<>)\\]\"']+")
MD_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\((https?://[^)]+)\)")
MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
IMAGE_SLOT_RE = re.compile(r"\[(图\d+|图片\d+|封面|配图\d*)[：:]\s*([^\]]+)\]")
# Local source references must match the bound content root (absolute paths
# in either separator style); the pattern is built at runtime — see
# enable_root_aware_local_sources(). The default never matches.
LOCAL_SOURCE_RE = re.compile(r"(?!x)x")

def enable_root_aware_local_sources(root: Path) -> None:
    global LOCAL_SOURCE_RE
    escaped_root = re.escape(str(root))
    escaped_root_fwd = re.escape(str(root).replace("\\", "/"))
    LOCAL_SOURCE_RE = re.compile(
        r"(?:(?:`|\"|')?)((?:" + escaped_root + "|" + escaped_root_fwd + r")[\\/][^\s`\"'。；、)）\]]+)"
    )


SOURCE_SUFFIXES = {".md", ".json", ".html", ".txt"}


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def strip_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---", 4)
    if end == -1:
        return text
    after = text.find("\n", end + 4)
    if after == -1:
        return ""
    return text[after + 1 :]


def clean_text(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[*_`#>|]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def line_context(text: str, start: int, max_len: int = 220) -> str:
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", start)
    if line_end == -1:
        line_end = len(text)
    return clean_text(text[line_start:line_end])[:max_len]


def classify_text(label: str, url: str = "") -> str:
    haystack = f"{label} {url}".lower()
    if any(token in haystack for token in ["twitter.com", "x.com", "reddit.com", "原帖", "帖子", "tweet"]):
        return "post_screenshot"
    if any(token in haystack for token in ["数据", "图表", "benchmark", "score", "%", "百分比", "对比", "table"]):
        return "data_screenshot"
    if any(token in haystack for token in ["封面", "卡片", "流程图", "配图", "生成图", "cover"]):
        return "generated_card"
    if url:
        return "source_screenshot"
    return "unknown_asset"


def copyright_risk(asset_type: str, source_url: str, source_file: str) -> str:
    if asset_type in {"generated_card", "local_extract"}:
        return "low"
    if source_url:
        if any(domain in source_url for domain in ["openai.com", "anthropic.com", "github.com", "arxiv.org"]):
            return "low"
        return "medium"
    if source_file:
        return "low"
    return "unknown"


def asset_status(asset_type: str, source_url: str, source_file: str, file_path: str) -> str:
    if file_path:
        return "existing_file"
    if asset_type == "generated_card":
        return "manual_required"
    if source_url or source_file:
        return "reference_found"
    return "manual_required"


def manual_action(asset_type: str, source_url: str, source_file: str, usage: str) -> str:
    if asset_type == "generated_card":
        return f"Create a designed visual/card for: {usage}"
    if source_url:
        return f"Capture screenshot from source URL: {source_url}"
    if source_file:
        return f"Use local source excerpt or render local file: {source_file}"
    return f"Find source or create asset for: {usage}"


def make_asset(
    asset_id: str,
    source_doc: str,
    asset_type: str,
    usage: str,
    caption: str = "",
    source_url: str = "",
    source_file: str = "",
    file_path: str = "",
) -> Dict[str, object]:
    status = asset_status(asset_type, source_url, source_file, file_path)
    return {
        "id": asset_id,
        "source_doc": source_doc,
        "file": file_path,
        "type": asset_type,
        "source_url": source_url,
        "source_file": source_file,
        "caption": caption or usage,
        "usage": usage,
        "copyright_risk": copyright_risk(asset_type, source_url, source_file),
        "fact_supported": bool(source_url or source_file or file_path),
        "status": status,
        "manual_action": "" if status == "existing_file" else manual_action(asset_type, source_url, source_file, usage),
    }


def next_id(prefix: str, number: int) -> str:
    return f"{prefix}_{number:03d}"


def extract_assets_from_text(source_doc: str, text: str, start_idx: int) -> Tuple[List[Dict[str, object]], int]:
    assets: List[Dict[str, object]] = []
    seen = set()
    idx = start_idx
    text = strip_frontmatter(text)

    for match in IMAGE_SLOT_RE.finditer(text):
        label = clean_text(match.group(1))
        detail = clean_text(match.group(2))
        asset_type = classify_text(detail)
        key = ("slot", source_doc, label, detail)
        if key in seen:
            continue
        seen.add(key)
        assets.append(make_asset(next_id("asset", idx), source_doc, asset_type, detail, label))
        idx += 1

    for alt, target in MD_IMAGE_RE.findall(text):
        target = target.strip()
        asset_type = "image_url" if target.startswith("http") else "local_extract"
        key = ("image", target)
        if key in seen:
            continue
        seen.add(key)
        assets.append(
            make_asset(
                next_id("asset", idx),
                source_doc,
                asset_type,
                clean_text(alt) or "Markdown image",
                clean_text(alt),
                source_url=target if target.startswith("http") else "",
                source_file="" if target.startswith("http") else target,
            )
        )
        idx += 1

    for label, url in MD_LINK_RE.findall(text):
        label = clean_text(label)
        url = url.strip()
        key = ("md-link", url, label)
        if key in seen:
            continue
        seen.add(key)
        asset_type = classify_text(label, url)
        assets.append(make_asset(next_id("asset", idx), source_doc, asset_type, label or url, label, source_url=url))
        idx += 1

    for match in URL_RE.finditer(text):
        url = match.group(0).strip().rstrip(".,;，。；")
        key = ("url", url)
        if key in seen:
            continue
        seen.add(key)
        usage = line_context(text, match.start()) or url
        asset_type = classify_text(usage, url)
        assets.append(make_asset(next_id("asset", idx), source_doc, asset_type, usage, source_url=url))
        idx += 1

    for match in LOCAL_SOURCE_RE.finditer(text):
        source_file = match.group(1).strip().rstrip(".,;，。；")
        if not should_collect_local_source(source_file):
            continue
        key = ("local", source_file)
        if key in seen:
            continue
        seen.add(key)
        usage = line_context(text, match.start()) or source_file
        assets.append(make_asset(next_id("asset", idx), source_doc, "local_extract", usage, source_file=source_file))
        idx += 1

    return assets, idx


def should_collect_local_source(source_file: str) -> bool:
    if "/文稿库/02-制作中/" in source_file:
        return False
    if source_file.endswith("/"):
        return False
    suffix = Path(source_file).suffix.lower()
    if suffix and suffix not in SOURCE_SUFFIXES:
        return False
    return bool(suffix)


def existing_asset_files(assets_dir: Path, start_idx: int) -> Tuple[List[Dict[str, object]], int]:
    assets: List[Dict[str, object]] = []
    idx = start_idx
    if not assets_dir.exists():
        return assets, idx
    for path in sorted(assets_dir.rglob("*")):
        if not path.is_file() or path.name in {"manifest.json", "missing_assets.json"}:
            continue
        rel = path.relative_to(assets_dir.parent).as_posix()
        assets.append(
            make_asset(
                next_id("asset", idx),
                "assets/",
                "unknown_asset",
                f"Existing asset file: {rel}",
                path.stem,
                file_path=rel,
            )
        )
        idx += 1
    return assets, idx


def missing_entries(assets: List[Dict[str, object]]) -> List[Dict[str, str]]:
    missing: List[Dict[str, str]] = []
    for idx, asset in enumerate(assets, start=1):
        status = str(asset.get("status", ""))
        asset_type = str(asset.get("type", "unknown_asset"))
        if status == "existing_file":
            continue
        if asset_type == "generated_card":
            reason = "needs_generated_visual"
        elif status == "reference_found":
            reason = "needs_screenshot"
        else:
            reason = "missing_source"
        missing.append(
            {
                "id": next_id("missing", idx),
                "source_asset_id": str(asset.get("id", "")),
                "reason": reason,
                "manual_action": str(asset.get("manual_action", "")),
            }
        )
    return missing


def load_package_manifest(package_dir: Path) -> Dict[str, object]:
    path = package_dir / "manifest.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_package_manifest(
    package_dir: Path,
    assets: List[Dict[str, object]],
    missing: List[Dict[str, str]],
    content_root: Path,
) -> None:
    path = package_dir / "manifest.json"
    manifest = load_package_manifest(package_dir)
    manifest["asset_collection"] = "manifest_created"
    manifest["assets"] = assets
    manifest["missing_assets"] = missing
    manifest["asset_manifest"] = (package_dir / "assets/manifest.json").relative_to(content_root).as_posix()
    manifest["asset_collected_at"] = dt.datetime.now().isoformat(timespec="seconds")
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def collect(args: argparse.Namespace) -> Dict[str, object]:
    content_root = require_content_root(args.content_root)
    enable_root_aware_local_sources(content_root)
    package_dir = resolve_content_path(args.draft_dir, content_root, "--draft-dir")
    if not package_dir.exists():
        raise FileNotFoundError(f"Draft dir not found: {package_dir}")

    assets_dir = resolve_content_path(args.output_dir, content_root, "--output-dir") if args.output_dir else package_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    input_names = [args.draft_file] if args.draft_file else DEFAULT_DRAFT_FILES
    input_files = [package_dir / name for name in input_names if (package_dir / name).exists()]
    if not input_files:
        raise FileNotFoundError(f"No input draft files found in: {package_dir}")

    assets: List[Dict[str, object]] = []
    idx = 1
    for path in input_files:
        extracted, idx = extract_assets_from_text(path.name, read_text(path), idx)
        assets.extend(extracted)

    existing, idx = existing_asset_files(assets_dir, idx)
    assets.extend(existing)

    missing = missing_entries(assets)
    payload = {
        "package_dir": package_dir.relative_to(content_root).as_posix(),
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "input_files": [path.name for path in input_files],
        "assets": assets,
        "missing_assets": missing,
    }

    (assets_dir / "manifest.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (assets_dir / "missing_assets.json").write_text(json.dumps(missing, ensure_ascii=False, indent=2), encoding="utf-8")
    if not args.no_update_package_manifest:
        write_package_manifest(package_dir, assets, missing, content_root)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect evidence and asset requirements from a writing package.")
    parser.add_argument("--draft-dir", required=True, help="Writing package directory.")
    parser.add_argument("--draft-file", default="", help="Optional single draft file name inside draft-dir.")
    parser.add_argument("--output-dir", default="", help="Optional output dir. Default: draft-dir/assets.")
    parser.add_argument("--content-root", default="", help="Explicit content root; defaults to OPENMIND_ROOT.")
    parser.add_argument("--skill-data-dir", default="", help="Reserved app-private Skill data directory.")
    parser.add_argument("--run-dir", default="", help="Reserved app-private Run working directory.")
    parser.add_argument("--date", default="", help="Reserved for future package discovery.")
    parser.add_argument("--topic-file", default="", help="Reserved for future source discovery.")
    parser.add_argument("--no-update-package-manifest", action="store_true", help="Do not update root manifest.json.")
    args = parser.parse_args()

    try:
        payload = collect(args)
    except RuntimePathError as exc:
        parser.error(str(exc))
    print(f"Asset manifest: {Path(payload['package_dir']) / 'assets/manifest.json'}")
    print(f"Assets: {len(payload['assets'])}")
    print(f"Missing assets: {len(payload['missing_assets'])}")


if __name__ == "__main__":
    main()
