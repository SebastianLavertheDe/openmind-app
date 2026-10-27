---
name: ai-media-topic-selector
description: "Select daily topics and develop editorial angles from local articles, summaries and social posts, using the user's saved interests and output preferences. Use for manual topic selection, 选题筛选 or editorial planning."
---

# Daily editorial topics

All paths are relative to `$OPENMIND_ROOT`, the selected private content root.

Read `.agent/preferences/daily-brief.json` once at the beginning, or use the current preference snapshot provided by OpenMind. Record its revision in the output. The current user request takes precedence over saved preferences. Apply interests, exclusions, output language, item count and requested platform throughout candidate selection, ranking and writing.

When preferences are empty, rank by information quality and recency, summarize faithfully, and retain the source language. Do not impose an AI topic restriction, author whitelist, WeChat exclusion or viral-content threshold.

Use user-provided material and the selected date's `article/`, `post/`, `reddit/`, `daily-summary/` and `daily-topic/` files. Read [source rules](references/sources.md) for provenance and missing material. Use public web sources only when the current request authorizes browsing. Never manufacture missing evidence.

Deduplicate candidates, choose the requested total number across all sources, explain each recommendation and retain original links and source file paths. When a publishing platform was requested, consult [editorial roles](references/agents.md) for appropriate presentation; these are perspectives within the current session, not additional runtime agents.

Write the memo to `creative/01-内容生产/选题管理/ai_topic_YYYY-MM-DD.md`, using [the output guide](references/output-template.md). Preserve an existing memo as a version before explicitly regenerating it. Report the saved path and any missing source material. This Skill does not generate or require a knowledge wiki.
