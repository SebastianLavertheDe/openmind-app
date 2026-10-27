# Output guide

Save `creative/01-内容生产/选题管理/ai_topic_YYYY-MM-DD.md` unless the user chooses another permitted content location.

Use the user's requested language and format. Include the selected date and preference revision, followed by ranked recommendations. For each recommendation include the title, factual summary, recommendation reason, an editorial angle if requested, original links, local source files and any uncertainty. A single total item limit applies across all sections and sources.

When no candidate fits, explain that result and the missing material. Do not fill the memo with unrelated items. Platform-specific outlines and title variants are optional and follow the user's request.

To let the writing-package Skill consume this memo independently of its language and headings, include one machine-readable HTML comment. Fill it with the same ranked recommendations, date and saved preference revision; use an empty `items` array when none fit. Each link must come from the source material. Escape any `-->` inside JSON strings as `--\u003e`.

```text
<!-- openmind-topics {"schemaVersion":1,"date":"YYYYMMDD","preferencesRevision":0,"items":[{"title":"Selected title","summary":"Factual summary","reason":"Why it matches","sourceFile":"article/YYYYMMDD/example.md","links":[{"label":"Original source","url":"https://example.org/article"}]}]} -->
```
