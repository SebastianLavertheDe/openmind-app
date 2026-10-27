---
name: asset-collector
description: "Collect source evidence and asset requirements for social-media writing packages. Use after creative-writing has produced or updated xiaohongshu-draft.md, wechat-draft.md, twitter-thread.md, or topic-brief.md and the user asks to collect screenshots, source evidence, image assets, asset manifest, missing assets, or 素材/截图/证据图 for a draft package."
---

# Asset Collector

Collect evidence and asset requirements after drafts exist.

This skill does not write articles, choose topics, or decide the article's argument. It reads a writing package and produces structured asset metadata for screenshots, source evidence, generated cards, and missing manual actions.

## Quick Start

Run:

```bash
python3 asset-collector/scripts/collect_assets.py \
  --content-root /path/to/content-root \
  --draft-dir "creative/01-内容生产/文稿库/02-制作中/YYYYMMDD-选题名"
```

Optional single-file mode:

```bash
python3 asset-collector/scripts/collect_assets.py \
  --content-root /path/to/content-root \
  --draft-dir "creative/01-内容生产/文稿库/02-制作中/YYYYMMDD-选题名" \
  --draft-file wechat-draft.md
```

Outputs:

- `assets/manifest.json`
- `assets/missing_assets.json`
- Updates root `manifest.json` with `asset_collection`, `assets`, and `missing_assets`

The installed form may omit `--content-root` because the desktop app injects
`OPENMIND_ROOT`, `OPENMIND_SKILL_DATA_DIR` and `OPENMIND_RUN_DIR`. Relative
paths are resolved below the explicit content root; no ancestor is
discovered and no app-private state is written into the Skill package.

## Workflow

1. Read package files:
   - `topic-brief.md`
   - selected draft file(s): `xiaohongshu-draft.md`, `wechat-draft.md`, `twitter-thread.md`
   - root `manifest.json` when present
2. Extract asset needs:
   - explicit image slots like `[图1：来源截图，证明 xxx]`
   - Markdown links
   - raw URLs
   - local paths below the bound content root
   - Markdown image links
3. Classify each item:
   - `source_screenshot`
   - `post_screenshot`
   - `data_screenshot`
   - `generated_card`
   - `local_extract`
   - `image_url`
   - `unknown_asset`
4. Generate manifest entries with:
   - `id`
   - `file`
   - `type`
   - `source_url`
   - `source_file`
   - `caption`
   - `usage`
   - `copyright_risk`
   - `fact_supported`
   - `status`
   - `manual_action`
5. Write missing items for anything that still needs a screenshot, source file, or generated visual.

## Rules

- Screenshot collection happens after writing, because screenshots depend on what the draft actually cites.
- If a specific person's view is cited, collect the person's original post or original page.
- If a post is cited, collect the post itself instead of a second-hand summary.
- If a core claim depends on a source, collect the exact source that supports the claim.
- If a core data point is used, collect the paragraph, chart, or page containing that data.
- Weak background references may remain as links/excerpts; they do not always need screenshots.
- Do not block the package when a screenshot is unavailable. Add an entry to `missing_assets` with a manual action.
- Do not fabricate URLs, screenshots, or source files.

## Scope

The bundled script is a deterministic extraction and manifest builder. It does not currently drive a browser or capture pixels. Browser-based screenshot capture can be added later using the manifest as the queue.

For detailed schema and extraction rules, read:

- `references/asset-schema.md`
