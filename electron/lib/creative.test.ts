import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceProjectStage, archiveCreativeProject, copyCreativeProject, createCreativeProject, createCreativeVersion, getAllCreativeTopics, getCreativeProject, getCreativeReleaseLog, listCreativeProjects, listCreativeVersions, restoreCreativeVersion, saveCreativeFile, updateCreativeManifest } from "./creative";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-creative-userdata-"));

describe("creative topics", () => {
  let repo = "";
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-creative-repo-"));
    fs.mkdirSync(path.join(repo, "openmind", "creative", "01-内容生产", "选题管理"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".openmind"), { recursive: true });
    process.env.OPENMIND_ROOT = path.join(repo, "openmind");
    // 每个用例独立的 workspace，让 app-private 状态按 root 隔离。
    process.env.OPENMIND_WORKSPACE_ROOT = repo;
    process.env.OPENMIND_USER_DATA = userDataDir;
  });

  afterEach(() => {
    delete process.env.OPENMIND_ROOT;
    delete process.env.OPENMIND_WORKSPACE_ROOT;
    delete process.env.OPENMIND_USER_DATA;
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("reuses parsed historical topic markdown until the file changes", () => {
    const topicFile = path.join(repo, "openmind", "creative", "01-内容生产", "选题管理", "ai_topic_2026-06-16.md");
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
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-creative-repo-"));
    fs.mkdirSync(path.join(repo, "openmind", "creative", "01-内容生产", "选题管理"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".openmind"), { recursive: true });
    process.env.OPENMIND_ROOT = path.join(repo, "openmind");
    process.env.OPENMIND_WORKSPACE_ROOT = repo;
    process.env.OPENMIND_USER_DATA = userDataDir;
  });
  afterEach(() => {
    delete process.env.OPENMIND_ROOT;
    delete process.env.OPENMIND_WORKSPACE_ROOT;
    delete process.env.OPENMIND_USER_DATA;
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

    const relaxed = { autoVersionOnStageChange: false, reviewRequiredForReady: false, publishChecklistEnabled: false };
    project = advanceProjectStage(project.dir, "ready", relaxed);
    expect(() => advanceProjectStage(project.dir, "published", relaxed)).toThrow("请先配置");

    updateCreativeManifest(project.dir, { publish: { platform: "wechat", summary: "发布摘要", tags: ["AI"], coverPath: "assets/cover.png", status: "exported", exportedPath: "exports/draft.md" } });
    project = advanceProjectStage(project.dir, "published", relaxed);
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

  it("records export and stage changes in the release log (CRE-T06)", () => {
    const relaxed = { autoVersionOnStageChange: false, reviewRequiredForReady: false, publishChecklistEnabled: false };
    let project = createCreativeProject({ date: "20260616", topic: { title: "发布记录" } });
    project = advanceProjectStage(project.dir, "review", relaxed);
    project = advanceProjectStage(project.dir, "ready", relaxed);
    updateCreativeManifest(project.dir, { publish: { platform: "wechat", summary: "发布摘要", tags: ["AI"], coverPath: "assets/cover.png", status: "exported", exportedPath: "exports/publish.md" } });
    project = advanceProjectStage(project.dir, "published", relaxed);
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

  it("copies and archives creative projects (CRE-T07)", () => {
    const project = createCreativeProject({ date: "20260616", topic: { title: "复制归档" } });
    const copy = copyCreativeProject(project.dir);
    expect(String(copy.manifest?.topic)).toContain("副本");
    expect(listCreativeProjects().some((item: { dir: string }) => item.dir === copy.dir)).toBe(true);
    const archived = archiveCreativeProject(project.dir);
    expect(archived.stage).toBe("archived");
    expect(fs.existsSync(path.join(repo, project.dir))).toBe(false);
    expect(fs.existsSync(path.join(repo, archived.dir))).toBe(true);
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
