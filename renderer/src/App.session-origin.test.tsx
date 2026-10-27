import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, AiRun, AiSnapshot, AppBootstrap, AppOverview, DesktopApi, OnboardingState, SkillDefinition, UserPreferences } from "@shared/contracts";
import { App } from "./App";
import { setLocale } from "@shared/messages";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{ id: "codex-native", provider: "codex", label: "Codex", runtime: "native", available: true, version: "1", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, installable: false, oneMillion: false }],
  sessions: [], runs: [], pendingApprovals: []
};

const overview: AppOverview = { repoRoot: "/project", metrics: {}, recent: [] };
const skills: SkillDefinition[] = [];
const LAZY_ROUTE_TIMEOUT_MS = 10_000;
const preferences: UserPreferences = {
  schemaVersion: 1, openmindRoot: "/project/openmind", workspaceRoot: "/project", themeMode: "light",
  uiLanguage: "zh-CN", density: "default", fontSize: "default",
  autoSaveIntervalMs: 30000, maxVersions: 50, archiveAfterDays: 90, defaultReadFilter: "all", contentPreviewMode: "sidebar",
  markReadOnOpen: true, defaultProvider: "", youtubeBrowser: [], defaultPermissionProfile: "edit",
  notesDir: "openmind", destructiveOpsRequireApproval: true, riskScanEnabled: true, defaultPlatform: "公众号",
  defaultLanguage: "zh-CN", defaultContentLength: "medium", defaultTemplate: "", userTags: [],
  workflowAutoSaveDraft: true, workflowAutoVersionOnStageChange: true, workflowReviewRequiredForReady: true,
  workflowPublishChecklistEnabled: true, workflowAutoArchiveEnabled: false
};

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.openmind = {
    getBootstrap: async () => ({ repoRoot: "/project", openmindRoot: "/project/openmind", workspaceRoot: "/project", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview, skills, ai: snapshot }),
    getPreferences: async () => preferences,
    getDefaultSkillsEnabled: async () => true,
    aiRefresh: async () => snapshot,
    aiRefreshProviders: async () => undefined,
    aiGetEvents: async () => [],
    aiCancelRun: async () => true,
    aiResolveApproval: async () => true,
    aiListTurns: async () => ({ data: [], nextCursor: null, total: 0, parseErrors: 0 }),
    aiUpdateSession: async () => { throw new Error("no-op"); },
    runSkill: vi.fn(async () => true),
    selectFiles: async () => [],
    selectOpenmindFiles: async () => [],
    searchOpenmindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
    openPath: vi.fn(async (p: string) => p),
    revealPath: async () => true,
    openExternal: async () => true,
    onAiEvent: () => () => {},
    onSkillEvent: () => () => {},
    ...overrides
  } as unknown as DesktopApi;
}

beforeEach(() => {
  installApi();
});

afterEach(() => {
  window.localStorage.clear();
  setLocale("zh-CN");
  document.documentElement.lang = "zh-CN";
});

function sessionFixture(id: string, scope: any = { type: "workspace" }) {
  return { schemaVersion: 1, id, projectId: "5a111111-1111-4111-8111-111111111111", projectRoot: "/project", scope, title: id, provider: "codex" as const, providerId: "codex-native", providerSessionId: null, cwd: ".", permissionProfile: "auto" as const, status: "idle" as const, pinned: false, archived: false, createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z", lastRunId: null };
}
function runFixture(session: ReturnType<typeof sessionFixture>, input: any = {}) {
  return { schemaVersion: 1, id: `run-${session.id}`, sessionId: session.id, projectId: session.projectId, scope: session.scope, provider: session.provider, providerId: session.providerId, permissionProfile: session.permissionProfile, status: "completed" as const, prompt: input.prompt || "review", contexts: input.contexts || [], turnContext: null, workspacePath: null, baseCommit: null, startedAt: session.createdAt, completedAt: session.updatedAt, error: null, changeSet: null, risks: [] };
}
function bootstrap(ai: AiSnapshot): AppBootstrap {
  return { repoRoot: "/project", openmindRoot: "/project/openmind", workspaceRoot: "/project", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop" as const, platform: "linux" }, overview, skills, ai };
}
function recent(id: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-recent-item")).find(item => item.textContent?.includes(id))!;
}
async function submit(prompt: string) {
  fireEvent.change(await screen.findByLabelText("AI 消息", {}, { timeout: LAZY_ROUTE_TIMEOUT_MS }), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
}

describe("session origin restoration", () => {
  it.each([false, true])("restores the originating brief or its list after deletion=%s", async deleted => {
    const path = "openmind/daily-summary/20261025_daily_summary.md";
    let briefFiles = [path, "openmind/daily-summary/20261026_daily_summary.md"];
    let live = { ...snapshot };
    const aiStartRun = vi.fn(async (input: any) => {
      const session = { ...sessionFixture("简报 A 会话"), origin: input.origin };
      const run = runFixture(session, input);
      live = { ...snapshot, sessions: [session], runs: [run] };
      return { session, run };
    });
    installApi({
      getBootstrap: async () => bootstrap(live), aiRefresh: async () => live, aiRefreshSkills: async () => [], aiStartRun,
      listContent: async () => briefFiles.map(file => ({ path: file, name: file.split("/").at(-1)!, size: 100, modifiedAt: "2026-10-25T00:00:00.000Z" })),
      readContent: async file => ({ path: file, name: "brief.md", content: file === path ? "# 简报文件 A" : "# 简报文件 B" })
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "每日简报" }));
    await screen.findByRole("heading", { name: "简报文件 A" }, { timeout: LAZY_ROUTE_TIMEOUT_MS });
    await submit("分析当前简报 A");
    await waitFor(() => expect(recent("简报 A 会话")).toBeTruthy());
    expect(aiStartRun.mock.calls[0][0].origin).toMatchObject({ page: "brief", filePath: path });
    fireEvent.click(screen.getByRole("button", { name: "2026-10-26 每日简报" }));
    await screen.findByRole("heading", { name: "简报文件 B" });
    if (deleted) briefFiles = briefFiles.slice(1);
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    await waitFor(() => expect(document.querySelector(".brief-library-page")).toBeNull());
    fireEvent.click(recent("简报 A 会话"));
    await waitFor(() => expect(document.querySelector(".brief-library-page")).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText("AI 消息").getAttribute("placeholder")).toContain("简报 A 会话"));
    if (deleted) {
      await screen.findByRole("button", { name: "2026-10-26 每日简报" });
      expect(screen.queryByRole("heading", { name: "简报文件 A" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "简报文件 B" })).toBeNull();
    } else await screen.findByRole("heading", { name: "简报文件 A" });
  });

  it("isolates file previews between sessions and restores legacy previews on return", async () => {
    const a = sessionFixture("会话 A");
    const b = sessionFixture("会话 B");
    const path = "openmind/article/A.md";
    const run = runFixture(a);
    const live = { ...snapshot, sessions: [a, b], runs: [run] };
    const event: AiEvent = { schemaVersion: 1, id: "answer-a", seq: 1, timestamp: a.updatedAt, projectId: a.projectId, sessionId: a.id, runId: run.id, provider: "codex", kind: "assistant-message", payload: { phase: "final", text: `文件：\`${path}\`` }, risks: [] };
    installApi({
      getBootstrap: async () => bootstrap(live), aiRefresh: async () => live,
      readContent: async () => ({ path, name: "A.md", content: "# 属于 A 的文件" }),
      aiListTurns: async (sessionId) => ({ data: sessionId === a.id ? [{ id: run.id, sessionId: a.id, status: "completed", startedAt: run.startedAt, completedAt: run.completedAt, context: null, events: [event], responseItems: [], error: null }] : [], nextCursor: null, total: sessionId === a.id ? 1 : 0, parseErrors: 0 })
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: path }));
    await screen.findByRole("heading", { name: "属于 A 的文件" });
    fireEvent.click(recent(b.id));
    await screen.findByRole("heading", { name: b.title });
    expect(screen.queryByRole("heading", { name: "属于 A 的文件" })).toBeNull();
    fireEvent.click(recent(a.id));
    await screen.findByRole("heading", { name: "属于 A 的文件" });
  });

  it.each([{ deleted: false, kind: "material" }, { deleted: true, kind: "material" }, { deleted: false, kind: "output" }, { deleted: true, kind: "output" }, { deleted: "external", kind: "material" }, { deleted: "external", kind: "output" }] as const)("restores project $kind files beside the conversation with file deleted=$deleted", async ({ deleted, kind }) => {
    const project = { schemaVersion: 2 as const, id: "5a111111-1111-4111-8111-111111111111", name: "项目1", description: "", status: "active" as const, icon: "database", color: "neutral" as const, favorite: false, materialCount: 1, taskCount: 0, outputCount: 0, createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z" };
    const taskId = "7f43fc74-10a1-4e71-97cd-ec90d2660c1c";
    const material = { projectName: project.name, relativePath: `${kind === "material" ? "materials" : "outputs"}/A.md`, title: "A 文件", kind: "document", status: "ready", source: { type: "file", originalName: "A.md" }, createdAt: project.createdAt, updatedAt: project.updatedAt };
    const other = { ...material, relativePath: `${kind === "material" ? "materials" : "outputs"}/B.md`, title: "B 文件" };
    let files = [material, other];
    let fileMissing = false;
    let live: AiSnapshot = { ...snapshot };
    let tasks: any[] = [];
    const createProjectTask = vi.fn(async () => {
      const task = { taskId, projectId: project.id, projectName: project.name, title: "项目文件 A 会话", sessionId: null, previousSessionIds: [], providerId: "codex-native", status: "idle", createdAt: project.createdAt, updatedAt: project.updatedAt };
      tasks = [task];
      return task;
    });
    const projectStartTaskRun = vi.fn(async (input: any) => {
      const session = { ...sessionFixture("项目文件 A 会话", { type: "project-task", projectId: project.id, projectName: project.name, taskId }), origin: input.origin };
      const run = runFixture(session, input);
      live = { ...snapshot, sessions: [session], runs: [run] };
      tasks = [{ ...tasks[0], sessionId: session.id, status: "completed" }];
      return { session, run };
    });
    installApi({
      getBootstrap: async () => bootstrap(live), aiRefresh: async () => live, aiRefreshSkills: async () => [],
      listProjects: async () => [project], getProject: async () => ({ project }), listProjectTasks: async () => tasks,
      listProjectMaterials: async () => kind === "material" ? files : [], listProjectOutputs: async () => kind === "output" ? files : [],
      readProjectOutput: async ({ relativePath: file }: { relativePath: string }) => { if (fileMissing && file === material.relativePath) throw new Error("ENOENT: file removed outside app"); return { output: file === material.relativePath ? material : other, content: file === material.relativePath ? "# 项目 A 文件正文" : "# 项目 B 文件正文" }; },
      readProjectMaterial: async ({ relativePath: file }: { relativePath: string }) => { if (fileMissing && file === material.relativePath) throw new Error("ENOENT: file removed outside app"); return { material: file === material.relativePath ? material : other, content: file === material.relativePath ? "# 项目 A 文件正文" : "# 项目 B 文件正文" }; },
      createProjectTask, projectStartTaskRun
    } as any);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "项目" }));
    fireEvent.click(await screen.findByText("项目1"));
    fireEvent.click(await screen.findByRole("tab", { name: "文件" }));
    await screen.findByRole("heading", { name: "项目 A 文件正文" }, { timeout: LAZY_ROUTE_TIMEOUT_MS });
    await submit("分析 A 文件");
    await waitFor(() => expect(recent("项目文件 A 会话")).toBeTruthy());
    expect(projectStartTaskRun.mock.calls[0][0].origin).toMatchObject({ page: "projects", projectId: project.id, projectName: project.name, section: "materials", filePath: material.relativePath, fileKind: kind });
    if (deleted === true) files = [other];
    fileMissing = Boolean(deleted);
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.click(recent("项目文件 A 会话"));
    await screen.findByRole("tab", { name: "文件" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "文件" }).getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(screen.getByLabelText("AI 消息").getAttribute("placeholder")).toContain("项目文件 A 会话"));
    if (deleted) {
      await screen.findByText("B 文件");
      await waitFor(() => expect(screen.queryByRole("heading", { name: "项目 A 文件正文" })).toBeNull());
      expect(screen.queryByRole("heading", { name: "项目 B 文件正文" })).toBeNull();
    } else await screen.findByRole("heading", { name: "项目 A 文件正文" }, { timeout: LAZY_ROUTE_TIMEOUT_MS });
  });

  it("keeps unsaved brief edits when cancelling a session switch", async () => {
    const session = sessionFixture("另一个会话");
    const live = { ...snapshot, sessions: [session] };
    const path = "openmind/daily-summary/20261025_daily_summary.md";
    installApi({
      getBootstrap: async () => bootstrap(live), aiRefresh: async () => live,
      listContent: async () => [{ path, name: "20261025_daily_summary.md", size: 100, modifiedAt: session.updatedAt }],
      readContent: async () => ({ path, name: "A.md", content: "# 编辑前" })
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "每日简报" }));
    await screen.findByRole("heading", { name: "编辑前" }, { timeout: LAZY_ROUTE_TIMEOUT_MS });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑每日简报" }), { target: { value: "# 未保存修改" } });
    fireEvent.click(recent(session.id));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "编辑每日简报" }).value).toBe("# 未保存修改");
    expect(document.querySelector(".brief-library-page")).toBeTruthy();
  });

  it.each(["project", "topic"] as const)("restores a creative %s file from a freshly mounted app", async kind => {
    const filePath = kind === "project" ? "outline.md" : "openmind/daily-topic/20261025_daily_topic.md";
    const project = { dir: "openmind/creative/research", topic: "创作工程", stage: "drafting" as const, completion: 20, date: "20261025" };
    const origin = { page: "creative" as const, projectDir: kind === "project" ? project.dir : null, filePath, stage: "drafting" as const };
    const session = { ...sessionFixture("创作 A 会话"), origin };
    const live = { ...snapshot, sessions: [session] };
    const readContent = vi.fn(async (path: string) => ({ path, name: "A.md", content: "# 创作原文件 A" }));
    installApi({
      getBootstrap: async () => bootstrap(live), aiRefresh: async () => live,
      getAllCreativeTopics: async () => [], getCreativeProjects: async () => [project],
      getCreativeProject: async () => ({ ...project, files: { "draft.md": "# 其他文件 B", "outline.md": "# 创作原文件 A" }, manifest: { topic: project.topic } }),
      listCreativeVersions: async () => [], readContent
    });
    render(<App />);
    await waitFor(() => expect(recent(session.id)).toBeTruthy());
    fireEvent.click(recent(session.id));
    await screen.findByRole("heading", { name: "创作原文件 A" }, { timeout: LAZY_ROUTE_TIMEOUT_MS });
    expect(screen.queryByRole("heading", { name: "其他文件 B" })).toBeNull();
    expect(screen.getByRole("button", { name: "创作" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByLabelText("AI 消息").getAttribute("placeholder")).toContain(session.title);
    if (kind === "topic") expect(readContent).toHaveBeenCalledWith(filePath);
  });

  it("opens project search results in their owning project with the conversation selected", async () => {
    const session = sessionFixture("搜索项目会话", { type: "project-task", projectId: "5a111111-1111-4111-8111-111111111111", projectName: "项目1", taskId: "7f43fc74-10a1-4e71-97cd-ec90d2660c1c" });
    const live = { ...snapshot, sessions: [session] };
    const project = { schemaVersion: 2 as const, icon: "database", color: "neutral" as const, favorite: false, id: session.projectId, name: "项目1", description: "", status: "active" as const, materialCount: 0, taskCount: 1, outputCount: 0, createdAt: session.createdAt, updatedAt: session.updatedAt };
    const getProject = vi.fn(async () => ({ project }));
    installApi({
      getBootstrap: async () => bootstrap(live), aiRefresh: async () => live, aiRefreshSkills: async () => [], getProject,
      listProjects: async () => [project],
      listProjectTasks: async () => [{ taskId: session.scope.taskId, projectId: session.projectId, projectName: "项目1", title: session.title, sessionId: session.id, previousSessionIds: [], providerId: session.providerId, status: "completed", createdAt: session.createdAt, updatedAt: session.updatedAt }],
      searchWorkspace: async () => [{ id: "session:project", kind: "session", title: session.title, subtitle: "项目1", path: null, date: null, status: null, targetId: session.id }]
    });
    render(<App />);
    await screen.findByRole("button", { name: "新建任务" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByLabelText("说一句话或搜索资料、创作、会话和自动化"), { target: { value: "搜索项目会话" } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByText(session.title));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByRole("heading", { name: session.title });
    expect(getProject).toHaveBeenCalledWith("项目1");
    expect(screen.getByRole("button", { name: "项目" }).getAttribute("aria-current")).toBe("page");
  });
});
