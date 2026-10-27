---
name: x-following-fetcher
description: Fetches latest posts from X (Twitter) users you follow and summarizes them as a markdown table
allowed-tools: Bash,Write,Read
# openmind-app 执行配置
title: X 动态抓取
group: 采集
cwd: x-following-fetcher
runner: uv
args:
  - run
  - python
  - main.py
permission: edit
outputArtifacts:
  - article/${date}/x_*.md
  - post/${date}/
timeoutMs: 7200000
surfacesAsSource:
  sourceId: x-following
  sourceName: X 关注动态
  kind: x
artifactRoot: post
---

Desktop App contract: use `cctools.skill.yaml` as the runnable contract.
`curl.txt` and optional numbered files (`curl_2.txt`, `curl_3.txt`, ...) are
private credentials under
`OPENMIND_SKILL_DATA_DIR`; they are excluded from installed packages, parsed
as data by the Python HTTP client, and never executed as shell commands. The
requests run serially in filename order with a random 5-10 second pause
between adjacent cURLs. `X_FETCHER_CREDENTIAL_JSON` remains available only for
explicit direct/test invocations. Caches and external-fetch logs also belong
to `OPENMIND_SKILL_DATA_DIR`.
