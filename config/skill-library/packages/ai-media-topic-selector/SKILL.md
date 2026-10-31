---
name: ai-media-topic-selector
description: "Select daily topics and develop editorial angles from local articles, summaries and social posts, using the user's saved interests and output preferences. Use for manual topic selection, 选题筛选 or editorial planning."
---

# Daily editorial topics

All paths are relative to `$OPENMIND_ROOT`, the selected private content root.

Read `.agent/preferences/daily-brief.json` once at the beginning, or use the current preference snapshot provided by OpenMind. Record its revision in the output. The current user request takes precedence over saved preferences. Apply interests, exclusions, output language, item count and requested platform throughout candidate selection, ranking and writing.

Selection is controlled solely by the user's `topicPrompt` plus the `{id,name,prompt}` entries in `topicPlatforms` and optional additional `text` preferences. Apply the common prompt to all platforms, and each platform prompt only to that platform. A more specific platform instruction overrides a conflicting common content preference for its own platform; explicit additional preferences take precedence. Do not add subject restrictions, author preferences, source exclusions, numeric thresholds or virality gates. Blank prompts add no restrictions. An explicitly empty platform list means one general topic section. Missing settings use the short, user-visible examples in `_shared/brief_defaults.json`; legacy custom `topicRules` text migrates to the common prompt. Do not activate the archived legacy default rules. Summary settings control source summarization only; they do not override topic selection.

Use user-provided material and the selected date's `article/`, `post/`, `reddit/`, `daily-summary/` and `daily-topic/` files. Read [source rules](references/sources.md) for provenance and missing material. Use public web sources only when the current request authorizes browsing. Never manufacture missing evidence.

Deduplicate repeated events within each platform, honor counts in the scope specified by the user, and retain original links and source file paths. One topic can appear on several platforms. Global total limits count unique topics across platforms; per-platform limits apply to the named platform only. Use [editorial roles](references/agents.md) only as perspectives within this session, not additional runtime agents. Preserve the full report format in [the output guide](references/output-template.md), including the title variants and all ten editorial fields. User prompts customize editorial content, not report field names or section structure.

Write the memo to `creative/01-内容生产/选题管理/ai_topic_YYYY-MM-DD.md`, using [the output guide](references/output-template.md). Preserve an existing memo as a version before explicitly regenerating it. Report the saved path and any missing source material. This Skill does not generate or require a knowledge wiki.
