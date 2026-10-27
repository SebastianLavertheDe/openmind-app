---
name: collect-interest-markers
description: Collect `[i]` and `[t]` reading markers from `daily-summary/*_daily_summary.md` into `creative/01-内容生产/选题管理/00-兴趣收集箱.md` below the bound content root. Use when the user asks to 整理/收集/提取 daily-summary 兴趣标记, 将标记转为兴趣收集箱, or batch process marked daily-summary items into 待整理 and 选题候选.
---

# Collect Interest Markers

## Overview

Use this skill to batch collect lightweight reading markers from daily summaries into the interest inbox. Keep reading-stage decisions simple: only `[i]` and `[t]` are supported.

## Marker Rules

- `[i]`: 感兴趣，待整理
- `[t]`: 选题候选
- Do not introduce `[m]`, `[w]`, or other marker types unless the user's workflow changes.

Supported line forms:

```md
- [i] OpenAI Developers: Codex 推出 Build iOS Apps 插件... [原帖](https://x.com/...)
- [t] Cursor: What we've learned building cloud agents... [原文](https://cursor.com/...)
### [t] Lessons from building Claude Code
```

The script also accepts `- [ ] [i] ...` and `- [ ] [t] ...` if the user marks checklist items.

## Quick Start

Run with an explicit content root:

```bash
python3 scripts/collect_interest_markers.py --content-root /path/to/content-root --date 20260605
```

Useful variants:

```bash
python3 scripts/collect_interest_markers.py --content-root /path/to/content-root --source daily-summary/20260605_daily_summary.md
python3 scripts/collect_interest_markers.py --content-root /path/to/content-root --source daily-summary/20260605_daily_summary.md --dry-run
```

Default output:

```text
creative/01-内容生产/选题管理/00-兴趣收集箱.md

The desktop app injects `OPENMIND_ROOT`, `OPENMIND_SKILL_DATA_DIR` and
`OPENMIND_RUN_DIR`; the script never searches ancestor directories for a
repository.
```

## Workflow

1. Identify the source daily-summary file. Prefer the user-specified file, then `--date YYYYMMDD`, then the latest `daily-summary/*_daily_summary.md` below the bound root.
2. Run `scripts/collect_interest_markers.py`.
3. Report how many `[i]` and `[t]` items were found, how many were newly written, and where the inbox is.
4. If no markers are found, tell the user the source file has no `[i]` or `[t]` items.

## Output Shape

Keep the inbox concise and scannable:

```md
# 兴趣收集箱

## 待整理

### 2026-06-05

<!-- interest-id: ... -->
- [ ] 标题
  - 一句话价值: ...
  - 来源文件: `daily-summary/20260605_daily_summary.md:42`
  - 原链: https://...
  - 下一步: 判断是否进入选题池

## 选题候选
```

The script writes hidden `interest-id` comments and skips existing items on repeated runs.

## Guardrails

- Do not modify the source `daily-summary` by default.
- Do not expand the inbox into another full summary; preserve only title, one-sentence value, source file, original link, and next step.
- Move items into `01-选题池.md`, wiki, or archive only in a separate整理 step after the user asks.
