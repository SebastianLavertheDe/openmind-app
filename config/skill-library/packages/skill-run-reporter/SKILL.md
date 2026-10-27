---
name: skill-run-reporter
description: Report daily skill run status and results. Use when the user asks about skill execution status, which skills ran today/yesterday, daily run report, skill运行情况, or 技能运行报告. Also when the user says "check skills", "skill status", "运行报告", "每日报告", or wants to know if a specific skill ran.
# openmind-app 执行配置
title: 运行报告
group: 维护
cwd: .
runner: python
args:
  - skill-run-reporter/scripts/report.py
  - ${date}
permission: read-only
outputArtifacts: []
timeoutMs: 600000
---

# Skill Run Reporter

Check and report which skills ran on a given date, their execution status, and key metrics.

## Usage

```bash
python3 scripts/report.py --content-root /path/to/content-root [YYYYMMDD]
```

Default date is yesterday. Pass a date like `20260519` to check a specific day.

The script scans the selected content output directories and, when supplied by
the desktop app, structured RunStore records under `OPENMIND_RUN_DIR`. It does
not read Skill installation directories, caches, logs or a cctools ancestor.

## What it checks

| Skill | Data Sources |
|-------|-------------|
| rss-article-saver | `article/YYYYMMDD/`, `.counter.json`, RunStore records |
| daily-article-summarizer | `daily-summary/YYYYMMDD_*.md`, RunStore records |
| x-following-fetcher | `post/YYYYMMDD/` |
| reddit-fetcher | `reddit/YYYYMMDD/`, RunStore records |
| daily-topic-selector | `daily-topic/YYYYMMDD_*.md` |
| ai-media-topic-selector | `creative/` topic files with date |
| rss-to-summary-workflow | structured Workflow Run records |

## After running the script

Present the report to the user. If any skill shows issues (no output, errors in logs), highlight them. Summarize overall pipeline health in one sentence.
