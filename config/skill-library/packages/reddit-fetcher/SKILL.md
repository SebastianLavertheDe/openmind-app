---
name: reddit-fetcher
description: Fetches Reddit hot listings for configured subreddits and saves one markdown file per subreddit per day under reddit, with posts embedded in that file.
allowed-tools: Bash,Write,Read
# openmind-app 执行配置
title: Reddit 内容抓取
group: 采集
cwd: reddit-fetcher
runner: uv
args:
  - run
  - python
  - main.py
permission: edit
outputArtifacts:
  - reddit/${date}/
timeoutMs: 3600000
surfacesAsSource:
  sourceId: reddit
  sourceName: Reddit 订阅
  kind: reddit
  artifactRoot: reddit
---

# Reddit Fetcher

Fetches configured Reddit `hot` JSON feeds and stores them as one markdown file per subreddit per day under `reddit/`.

Comments are disabled by default for daily subreddit fetches. Use the bundled comment script when you need comments for a specific Reddit post URL.

The fetcher keeps a hidden cache of seen Reddit post IDs, so reruns only append newly discovered posts instead of rewriting already fetched ones.

## Output

For each day:

- `YYYYMMDD/<subreddit>.md`: one readable markdown file per subreddit

## Usage

```bash
cd "$OPENMIND_ROOT/.agent/skills/reddit-fetcher"
uv sync
uv run python main.py
```

Fetch comments for one Reddit post URL on demand:

```bash
cd "$OPENMIND_ROOT/.agent/skills/reddit-fetcher"
uv run python scripts/fetch_comments.py 'https://www.reddit.com/r/artificial/comments/1sxka9a/if_ai_is_about_to_get_10x_smarter_how_do_we/'
```

## Configuration

Official fetch behavior remains in the package `config.yaml` and is updated with
the Skill. On first managed run, its `fetch.sources` list is seeded into
`$OPENMIND_SKILL_DATA_DIR/user-sources.yaml`. The desktop configuration page
reads and writes that persistent file, where you can:

- add or edit subreddit JSON URLs
- enable or disable individual communities

Continue to change package `config.yaml` only when developing the Skill itself:

- change timeout / user-agent defaults
- change output directory defaults
- toggle the default `fetch.fetch_comments` behavior

Default behavior:

- subreddit daily fetch: posts only
- single-post comment fetch: use `scripts/fetch_comments.py`

The default output root is `$OPENMIND_ROOT/reddit`. The installed entrypoint
receives `OPENMIND_ROOT`, `OPENMIND_SKILL_DATA_DIR` and `OPENMIND_RUN_DIR`
from the desktop app; it never discovers a project by walking parent folders.
Package updates replace code and official defaults but preserve
`user-sources.yaml` verbatim.

For direct execution, bind an explicit `--content-root` and `--skill-data-dir`
(or set the corresponding `OPENMIND_*` environment values).
