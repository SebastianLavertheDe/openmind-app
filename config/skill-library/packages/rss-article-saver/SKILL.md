---
name: rss-article-saver
description: Normalize RSS, Atom or supported websites into local RSS 2.0 and collect articles. Use for subscription synchronization, article collection or diagnosing a source failure.
---

# RSS synchronization and collection

Use OpenMind's RSS Sources page to manage subscriptions. The original website or feed URL is shown; users choose which sources to enable. Do not edit an installed package or silently subscribe to suggested feeds.

The process accepts `--mode sync|collect|pipeline`, `--date YYYYMMDD`, optional `--source-id`, and the absolute `OPENMIND_ROOT` and `OPENMIND_SKILL_DATA_DIR` bindings supplied by the app. `sync` only refreshes local RSS; `collect` only saves articles; `pipeline` runs both. No model provider is needed. Use the packaged `openmind rss ... --root ... --user-data ...` CLI for cron.

Persistent subscriptions, local RSS and deduplication indexes live in `.agent/skill-data/rss-article-saver/`. Articles live in `article/YYYYMMDD/`. Updated originals are kept in `article/.updates/`; existing user edits remain intact. Never store runtime files in this package.

Source edits, disabling and deletion invalidate in-flight results. Locks are shared by the app and CLI. Report the stable error code and message from the result; preserve the previous valid feed on conversion failure. An unsupported website needs a supported feed or adapter; do not invent an RSS URL.

Source selection belongs to the user. Do not filter by AI topics, preferred authors, quality scores or personal interests during collection. Daily brief preferences are applied by the summarizer and topic selector.
