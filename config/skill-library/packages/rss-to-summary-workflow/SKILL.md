---
name: rss-to-summary-workflow
description: Run RSS synchronization and article collection followed by a daily summary under one content-root snapshot. Use when the user requests the complete collection-to-summary workflow.
---

# RSS to daily summary

The workflow manifest invokes `rss-article-saver` in pipeline mode, followed by `daily-article-summarizer`, for the same date and content root. OpenMind's Workflow Engine validates both installed dependencies and freezes the daily brief preferences before admitting the workflow.

Topic selection is an independent Process Skill and schedule. Running RSS synchronization alone must not generate summaries or topics.

For system cron, use the packaged OpenMind CLI. Run `openmind rss pipeline --root ... --user-data ...`, then `openmind brief generate --root ... --user-data ...` after a successful collection. These commands share state, locks, provider bindings and run history with the app. Stop legacy cron jobs that invoke sibling repositories before switching.

The optional `scripts/run_workflow.py` compatibility launcher requires an explicit absolute `--cli`, `--root` and `--user-data`. It invokes those same commands, with no sibling-package paths or private log directory in the installed package.
