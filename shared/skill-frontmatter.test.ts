import { describe, expect, it } from "vitest";
import { parseSkillFrontmatter } from "./skill-frontmatter";

describe("parseSkillFrontmatter", () => {
  it("解析最小 frontmatter(只有 name + description)", () => {
    const md = `---
name: agent-browser
description: Automates browser interactions for web testing.
---
# 正文`;
    const fm = parseSkillFrontmatter(md);
    expect(fm.name).toBe("agent-browser");
    expect(fm.description).toBe("Automates browser interactions for web testing.");
  });

  it("description 含冒号和反引号时不被截断", () => {
    const md = `---
name: daily-article-summarizer
description: Summarize daily articles and append to \`openmind/daily-summary/YYYYMMDD_daily_summary.md\`.
allowed-tools: Bash,Write,Read
---`;
    const fm = parseSkillFrontmatter(md);
    expect(fm.description).toBe("Summarize daily articles and append to `openmind/daily-summary/YYYYMMDD_daily_summary.md`.");
    expect(fm.allowedTools).toBe("Bash,Write,Read");
  });

  it("解析完整执行配置(args 多行列表 + timeoutMs 数字 + envFile)", () => {
    const md = `---
name: rss-article-saver
description: 拉取订阅、提取正文并保存到文章库。
allowed-tools: Bash,Write,Read
title: RSS 文章抓取
group: 采集
cwd: .claude/skills/rss-article-saver
runner: uv
args:
  - run
  - --env-file
  - .env
  - python
  - main.py
envFile: .env
permission: edit
outputArtifacts:
  - openmind/article/\${date}/
timeoutMs: 7200000
---`;
    const fm = parseSkillFrontmatter(md);
    expect(fm.title).toBe("RSS 文章抓取");
    expect(fm.group).toBe("采集");
    expect(fm.runner).toBe("uv");
    expect(fm.args).toEqual(["run", "--env-file", ".env", "python", "main.py"]);
    expect(fm.envFile).toBe(".env");
    expect(fm.permission).toBe("edit");
    expect(fm.outputArtifacts).toEqual(["openmind/article/${date}/"]);
    expect(fm.timeoutMs).toBe(7200000);
  });

  it("解析 surfacesAsSource 多行块", () => {
    const md = `---
name: x-following-fetcher
description: fetch X posts
surfacesAsSource:
  sourceId: x-following
  sourceName: X 关注动态
  kind: x
  artifactRoot: openmind/post
---`;
    const fm = parseSkillFrontmatter(md);
    expect(fm.surfacesAsSource).toEqual({
      sourceId: "x-following",
      sourceName: "X 关注动态",
      kind: "x",
      artifactRoot: "openmind/post"
    });
  });

  it("surfacesAsSource 缺字段时返回 null", () => {
    const md = `---
name: broken
surfacesAsSource:
  sourceId: only-this
---`;
    const fm = parseSkillFrontmatter(md);
    expect(fm.surfacesAsSource).toBeUndefined();
  });

  it("双引号包裹的 description 含特殊字符", () => {
    const md = `---
name: daily-writing-orchestrator
description: "Daily orchestrator. Creates package under openmind/creative/01-内容生产/."
---`;
    const fm = parseSkillFrontmatter(md);
    expect(fm.description).toBe("Daily orchestrator. Creates package under openmind/creative/01-内容生产/.");
  });

  it("没有 frontmatter 时返回空对象", () => {
    expect(parseSkillFrontmatter("# Just a title\n\nbody")).toEqual({});
  });

  it("frontmatter 不闭合时返回空对象", () => {
    expect(parseSkillFrontmatter("---\nname: test\nno closing fence")).toEqual({});
  });

  it("忽略注释行和未识别字段", () => {
    const md = `---
name: test
# 这是一行注释
unknown-field: value
description: real desc
---`;
    const fm = parseSkillFrontmatter(md);
    expect(fm.name).toBe("test");
    expect(fm.description).toBe("real desc");
    expect((fm as Record<string, unknown>).unknown).toBeUndefined();
  });

  it("args 为空数组", () => {
    const md = `---
name: test
args: []
---`;
    const fm = parseSkillFrontmatter(md);
    expect(fm.args).toEqual([]);
  });
});
