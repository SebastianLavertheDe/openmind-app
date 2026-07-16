import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addManualTopic, advanceProjectStage, archiveCreativeProject, bindCreativeSession, copyCreativeProject, createCreativeProject, createCreativeVersion, deleteCreativeProject, getAllCreativeTopics, getCreativeProject, getCreativeReleaseLog, getCreativeTopics, listCreativeProjects, listCreativeVersions, restoreCreativeProject, restoreCreativeVersion, reviewCreativeProject, saveCreativeFile, setCreativeReviewStatus, updateCreativeManifest } from "./creative";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-creative-userdata-"));

describe("creative topics", () => {
  let repo = "";
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-creative-repo-"));
    fs.mkdirSync(path.join(repo, ".claude", "skills"), { recursive: true });
    fs.mkdirSync(path.join(repo, "mymind", "creative", "01-内容生产", "选题管理"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".cctools"), { recursive: true });
    process.env.CCTOOLS_REPO_ROOT = repo;
    process.env.CCTOOLS_USER_DATA = userDataDir;
  });

  afterEach(() => {
    delete process.env.CCTOOLS_REPO_ROOT;
    delete process.env.CCTOOLS_USER_DATA;
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("adds a manual topic and surfaces it through getCreativeTopics", () => {
    expect(getCreativeTopics("20260616").topics).toHaveLength(0);
    const after = addManualTopic("20260616", { title: "本地 AI 工作台", body: "整理体验要点", score: 85, platform: "公众号" });
    expect(after.topics).toHaveLength(1);
    expect(after.topics[0]).toMatchObject({ title: "本地 AI 工作台", section: "manual", platform: "公众号", ignored: false });
    expect(after.topics[0].id).toBeTruthy();
    expect(after.topics[0].score).toBe(85);
    expect(() => addManualTopic("20260616", { title: "本地 AI 工作台" })).toThrow("已存在");
  });

  it("persists manual topics and rejects empty titles or dates", () => {
    expect(() => addManualTopic("20260616", { title: "   " })).toThrow("不能为空");
    expect(() => addManualTopic("not-a-date", { title: "选题" })).toThrow("日期");
    addManualTopic("20260616", { title: "选题 A", score: 0 });
    const store = JSON.parse(fs.readFileSync(path.join(repo, ".cctools", "creative-manual-topics.json"), "utf8"));
    expect(store["20260616"]).toHaveLength(1);
    expect(getCreativeTopics("20260616").topics.map((topic) => topic.title)).toContain("选题 A");
    expect(getCreativeTopics("20260617").topics).toHaveLength(0);
  });

  it("reuses parsed historical topic markdown until the file changes", () => {
    const topicFile = path.join(repo, "mymind", "creative", "01-内容生产", "选题管理", "ai_topic_2026-06-16.md");
    fs.writeFileSync(topicFile, "## 1. 今日最推荐\n\n**缓存选题**\n\n初始内容\n\n## 2. 小红书\n", "utf8");
    const readFile = vi.spyOn(fs, "readFileSync");

    expect(getAllCreativeTopics()[0].topics[0].title).toBe("缓存选题");
    const topicReads = readFile.mock.calls.filter(([file]) => file === topicFile).length;
    getAllCreativeTopics();
    expect(readFile.mock.calls.filter(([file]) => file === topicFile)).toHaveLength(topicReads);

    fs.writeFileSync(topicFile, "## 1. 今日最推荐\n\n**更新选题**\n\n更新内容\n\n## 2. 小红书\n", "utf8");
    const future = new Date(Date.now() + 2_000);
    fs.utimesSync(topicFile, future, future);
    expect(getAllCreativeTopics()[0].topics[0].title).toBe("更新选题");
    readFile.mockRestore();
  });
});

describe("creative projects lifecycle", () => {
  let repo = "";
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-creative-repo-"));
    fs.mkdirSync(path.join(repo, ".claude", "skills"), { recursive: true });
    fs.mkdirSync(path.join(repo, "mymind", "creative", "01-内容生产", "选题管理"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".cctools"), { recursive: true });
    process.env.CCTOOLS_REPO_ROOT = repo;
    process.env.CCTOOLS_USER_DATA = userDataDir;
  });
  afterEach(() => {
    delete process.env.CCTOOLS_REPO_ROOT;
    delete process.env.CCTOOLS_USER_DATA;
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("dedupes creative projects by source topic id (CRE-T01)", () => {
    const first = createCreativeProject({ date: "20260616", topic: { title: "本地 AI 工作台", body: "体验要点" }, sourceTopicId: "topic-1" });
    const second = createCreativeProject({ date: "20260616", topic: { title: "重复选题", body: "不应再建" }, sourceTopicId: "topic-1" });
    expect(second.dir).toBe(first.dir);
  });

  it("enforces stage transition guards (CRE-T02)", () => {
    let project = createCreativeProject({ date: "20260616", topic: { title: "阶段守卫" } });
    expect(() => advanceProjectStage(project.dir, "ready")).toThrow("不允许");

    project = advanceProjectStage(project.dir, "review");
    expect(() => advanceProjectStage(project.dir, "ready")).toThrow("审核尚未批准");

    reviewCreativeProject(project.dir);
    setCreativeReviewStatus(project.dir, "approved");
    project = advanceProjectStage(project.dir, "ready");
    expect(() => advanceProjectStage(project.dir, "published")).toThrow("请先配置");

    updateCreativeManifest(project.dir, { publish: { platform: "wechat", summary: "发布摘要", tags: ["AI"], coverPath: "assets/cover.png", status: "exported", exportedPath: "exports/draft.md" } });
    project = advanceProjectStage(project.dir, "published");
    expect(project.stage).toBe("published");
  });

  it("restores a historic version without losing the original (CRE-T03)", () => {
    const project = createCreativeProject({ date: "20260616", topic: { title: "版本恢复" } });
    createCreativeVersion(project.dir, "draft.md", "VERSION A", "v-a");
    const versionA = listCreativeVersions(project.dir, "draft.md").find((item) => item.note === "v-a")!;
    expect(versionA).toBeTruthy();
    saveCreativeFile({ projectDir: project.dir, file: "draft.md", content: "CURRENT EDIT", createVersion: false });
    expect(getCreativeProject(project.dir).files?.["draft.md"]).toBe("CURRENT EDIT");
    const restored = restoreCreativeVersion(project.dir, "draft.md", versionA.path);
    expect(restored.files?.["draft.md"]).toBe("VERSION A");
    expect(listCreativeVersions(project.dir, "draft.md").some((item) => item.path === versionA.path)).toBe(true);
  });

  it("builds a review report and lets the editor approve it (CRE-T04)", () => {
    const project = createCreativeProject({ date: "20260616", topic: { title: "审核流程" } });
    const longBody = "本地优先的 AI 工作台把模型运行放在用户自己的目录里，数据不出本机，这对隐私敏感的写作和研究都很有价值。".repeat(20);
    const draft = `# 本地 AI 工作台体验\n\n## 为什么值得关注\n\n${longBody}\n\n参考来源：https://example.com/local-ai。\n`;
    saveCreativeFile({ projectDir: project.dir, file: "draft.md", content: draft, createVersion: false });
    const reviewed = reviewCreativeProject(project.dir);
    const report = reviewed.manifest?.reviewReport as { status: string; score: number; dimensions: Record<string, number>; issues: Array<{ severity: string }> };
    expect(report.status).toBe("pending");
    expect(report.issues.some((issue) => issue.severity === "error")).toBe(false);
    expect(Object.keys(report.dimensions)).toHaveLength(5);
    const approved = setCreativeReviewStatus(project.dir, "approved");
    expect((approved.manifest?.reviewReport as { status: string }).status).toBe("approved");
  });

  it("records export and stage changes in the release log (CRE-T06)", () => {
    let project = createCreativeProject({ date: "20260616", topic: { title: "发布记录" } });
    project = advanceProjectStage(project.dir, "review");
    reviewCreativeProject(project.dir);
    setCreativeReviewStatus(project.dir, "approved");
    project = advanceProjectStage(project.dir, "ready");
    updateCreativeManifest(project.dir, { publish: { platform: "wechat", summary: "发布摘要", tags: ["AI"], coverPath: "assets/cover.png", status: "exported", exportedPath: "exports/publish.md" } });
    project = advanceProjectStage(project.dir, "published");
    const events = getCreativeReleaseLog(project.dir);
    const actions = events.map((event: { action: string }) => event.action);
    expect(actions).toContain("content_exported");
    expect(actions).toContain("stage_changed");
  });

  it("applies configurable workflow gates and stage-version policy", () => {
    let project = createCreativeProject({ date: "20260616", topic: { title: "可配置工作流" } });
    const relaxed = {
      autoVersionOnStageChange: false,
      reviewRequiredForReady: false,
      publishChecklistEnabled: false
    };
    project = advanceProjectStage(project.dir, "review", relaxed);
    project = advanceProjectStage(project.dir, "ready", relaxed);
    expect(listCreativeVersions(project.dir, "draft.md")).toHaveLength(0);
    updateCreativeManifest(project.dir, { publish: { platform: "wechat", status: "exported", exportedPath: "exports/relaxed.md" } });
    project = advanceProjectStage(project.dir, "published", relaxed);
    expect(project.stage).toBe("published");
  });

  it("copies, archives and deletes creative projects (CRE-T07)", () => {
    const project = createCreativeProject({ date: "20260616", topic: { title: "复制归档删除" } });
    const copy = copyCreativeProject(project.dir);
    expect(String(copy.manifest?.topic)).toContain("副本");
    expect(listCreativeProjects().some((item: { dir: string }) => item.dir === copy.dir)).toBe(true);
    expect(deleteCreativeProject(copy.dir)).toBe(true);
    expect(fs.existsSync(path.join(repo, copy.dir))).toBe(false);
    const archived = archiveCreativeProject(project.dir);
    expect(archived.stage).toBe("archived");
    expect(fs.existsSync(path.join(repo, project.dir))).toBe(false);
    expect(fs.existsSync(path.join(repo, archived.dir))).toBe(true);
  });

  it("restores an archived project back into drafting (CRE-T08)", () => {
    const project = createCreativeProject({ date: "20260616", topic: { title: "归档恢复" } });
    const archived = archiveCreativeProject(project.dir);
    expect(archived.stage).toBe("archived");
    expect(fs.existsSync(path.join(repo, archived.dir))).toBe(true);
    const restored = restoreCreativeProject(archived.dir);
    expect(restored.stage).toBe("drafting");
    expect(fs.existsSync(path.join(repo, restored.dir))).toBe(true);
    expect(restored.dir).toContain("02-制作中");
    expect(listCreativeProjects().some((item: { dir: string }) => item.dir === restored.dir)).toBe(true);
  });

  it("binds and deduplicates AI session IDs (CRE-T09)", () => {
    const project = createCreativeProject({ date: "20260616", topic: { title: "会话绑定" } });
    const result1 = bindCreativeSession(project.dir, "session-a");
    expect(result1.manifest.aiSessionIds).toEqual(["session-a"]);
    const result2 = bindCreativeSession(project.dir, "session-b");
    expect(result2.manifest.aiSessionIds).toEqual(["session-a", "session-b"]);
    const result3 = bindCreativeSession(project.dir, "session-a");
    expect(result3.manifest.aiSessionIds).toEqual(["session-a", "session-b"]);
    const detail = getCreativeProject(project.dir);
    expect(detail.manifest.aiSessionIds).toEqual(["session-a", "session-b"]);
  });

  it("caches project scans until a stage directory or manifest changes", () => {
    const project = createCreativeProject({ date: "20260616", topic: { title: "缓存检查" } });
    const readdir = vi.spyOn(fs, "readdirSync");

    expect(listCreativeProjects()).toHaveLength(1);
    const readsAfterFirstScan = readdir.mock.calls.length;
    expect(listCreativeProjects()).toHaveLength(1);
    expect(readdir).toHaveBeenCalledTimes(readsAfterFirstScan);

    updateCreativeManifest(project.dir, { status: "cached-update" });
    expect(listCreativeProjects()[0].status).toBe("cached-update");
    expect(readdir.mock.calls.length).toBeGreaterThan(readsAfterFirstScan);
    readdir.mockRestore();
  });
});
