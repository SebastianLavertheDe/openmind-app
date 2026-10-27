# Topic Selection Rules

Default behavior:

1. Read `## 1. 今日最终推荐`.
2. Inside it, read `### 今日最值得优先写的主题`.
3. Use the first bold title or first non-empty line as the selected topic.

Manual overrides:

- `--topic "keyword"` with `--date`: search in this order:
  1. final recommendation title
  2. candidate hotspot pool rows
  3. Xiaohongshu topic headings
  4. WeChat topic headings
- `--topic-index N`: select the Nth data row from `## 4. 今日候选热点池`.
- `--topic-file`: use an explicit ai_topic file.

Never write all candidate topics by default.
