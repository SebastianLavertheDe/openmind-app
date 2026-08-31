import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, AiRun, AiSnapshot, AppBootstrap, AppOverview, DesktopApi, OnboardingState, SkillDefinition, UserPreferences } from "@shared/contracts";
import { App } from "./App";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{ id: "codex-native", provider: "codex", label: "Codex", runtime: "native", available: true, version: "1", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, installable: false, oneMillion: false }],
  sessions: [], runs: [], pendingApprovals: []
};

const overview: AppOverview = { repoRoot: "/project", metrics: {}, recent: [] };
const skills: SkillDefinition[] = [];
const LAZY_ROUTE_TIMEOUT_MS = 10_000;
const preferences: UserPreferences = {
  schemaVersion: 1, openmindRoot: "/project/openmind", workspaceRoot: "/project", themeMode: "light", density: "default", fontSize: "default",
  autoSaveIntervalMs: 30000, maxVersions: 50, archiveAfterDays: 90, defaultReadFilter: "all", contentPreviewMode: "sidebar",
  markReadOnOpen: true, defaultProvider: "", defaultPermissionProfile: "edit",
  notesDir: "openmind", browserAutomationEnabled: false, browserReuseExistingTabs: true,
  browserEvidenceDir: "assets/browser-evidence", destructiveOpsRequireApproval: true, riskScanEnabled: true, defaultPlatform: "公众号",
  defaultLanguage: "zh-CN", defaultContentLength: "medium", defaultTemplate: "", userTags: [],
  workflowAutoSaveDraft: true, workflowAutoVersionOnStageChange: true, workflowReviewRequiredForReady: true,
  workflowPublishChecklistEnabled: true, workflowAutoArchiveEnabled: false
};

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.openmind = {
    getBootstrap: async () => ({ repoRoot: "/project", openmindRoot: "/project/openmind", workspaceRoot: "/project", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview, skills, ai: snapshot }),
    getPreferences: async () => preferences,
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
});

describe("App bootstrap", () => {
  it("renders the splash, then the workspace shell once bootstrap resolves", async () => {
    render(<App />);
    // splash shows first
    expect(document.querySelector(".splash")).toBeTruthy();
    // wait for the shell to mount
    await waitFor(() => {
      expect(document.querySelector(".splash")).toBeNull();
    });
  });

  it("opens an already configured workspace despite a stale onboarding completion flag", async () => {
    installApi({
      getBootstrap: async () => ({
        repoRoot: "/project",
        openmindRoot: "/project/openmind",
        workspaceRoot: "/project",
        validRepo: true,
        skillsInstalled: true,
        onboardingCompleted: false,
        runtime: "test",
        environment: { mode: "desktop", platform: "linux" },
        overview,
        skills,
        ai: snapshot
      })
    });

    render(<App />);

    await waitFor(() => expect(document.querySelector(".ai-workbench")).toBeTruthy(), { timeout: LAZY_ROUTE_TIMEOUT_MS });
    expect(document.querySelector(".onboarding-page")).toBeNull();
  });

  it("renders a fatal error screen when window.openmind is missing", () => {
    delete (window as unknown as { openmind?: unknown }).openmind;
    render(<App />);
    expect(document.querySelector(".fatal")).toBeTruthy();
  });

  it("renders a fatal error when getBootstrap rejects", async () => {
    installApi({ getBootstrap: async () => { throw new Error("disk on fire"); } });
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector(".fatal")).toBeTruthy();
    });
  });

  it("opens the global search on Cmd/Ctrl+K after bootstrap", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    await waitFor(() => expect(screen.getAllByRole("button", { name: "搜索资料、创作和会话" }).length).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeTruthy();
    });
  });

  it("opens a content search result in the final workspace preview", async () => {
    const readContent = vi.fn(async (path: string) => ({ path, name: "result.md", content: "# Search destination", type: "markdown" as const }));
    installApi({
      searchWorkspace: async () => [{ id: "content:result", kind: "content", title: "Search Result", subtitle: "资料", path: "openmind/article/result.md", date: null, status: null, targetId: "result" }],
      readContent
    });
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("说一句话或搜索资料、创作、会话和自动化");
    fireEvent.change(input, { target: { value: "Search Result" } });
    fireEvent.click(await screen.findByText("Search Result", {}, { timeout: LAZY_ROUTE_TIMEOUT_MS }));
    await waitFor(() => expect(readContent).toHaveBeenCalledWith("openmind/article/result.md"));
    expect(await screen.findByRole("heading", { name: "Search destination" })).toBeTruthy();
  });

  it("Cmd+N navigates to a new AI session without throwing (after bootstrap)", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    // no throw, no fatal screen
    expect(document.querySelector(".fatal")).toBeNull();
  });

  it("keeps global search and new-session shortcuts inert until setup is complete", async () => {
    const setupBootstrap: AppBootstrap = {
      repoRoot: "/project",
      openmindRoot: "",
      workspaceRoot: "",
      validRepo: false,
      skillsInstalled: false,
      onboardingCompleted: false,
      runtime: "test",
      environment: { mode: "desktop" as const, platform: "linux" },
      overview,
      skills,
      ai: { ...snapshot, providers: [], sessions: [] }
    };
    installApi({
      getBootstrap: async () => setupBootstrap,
      getOpenmindRoot: async () => ({
        openmindRoot: "",
        workspaceRoot: "",
        health: {
          configured: false,
          accessible: false,
          readable: false,
          writable: false,
          missingInitializeEntries: [],
          missingCreateIfNeededEntries: [],
          optionalObservedEntries: [],
          symlinkWarnings: [],
          unknownPreservedEntries: [],
          activeRunCount: 0,
          warnings: []
        },
        snapshot: null
      })
    });

    render(<App />);
    await screen.findByRole(
      "heading",
      { level: 2, name: "选择 OpenMind 私人数据仓库" },
      { timeout: LAZY_ROUTE_TIMEOUT_MS }
    );

    for (const shortcut of [
      { key: "k", ctrlKey: true },
      { key: "k", metaKey: true },
      { key: "n", ctrlKey: true },
      { key: "n", metaKey: true }
    ]) fireEvent.keyDown(window, shortcut);

    expect(document.querySelector(".global-search-dialog")).toBeNull();
    expect(document.querySelector(".ai-workbench")).toBeNull();
    expect(document.querySelector(".onboarding-page")).toBeTruthy();
    expect(document.querySelector<HTMLElement>(".onboarding-step-track")?.dataset.currentStep).toBe("1");
  });

  it("keeps the same setup track mounted while the root and RSS gates advance", async () => {
    const setupSnapshot: AiSnapshot = { ...snapshot, providers: [], sessions: [] };
    let rootSelected = false;
    let rssInstalled = false;
    const getBootstrap = vi.fn(async (): Promise<AppBootstrap> => ({
      repoRoot: rootSelected ? "/project" : "",
      openmindRoot: rootSelected ? "/project/openmind" : "",
      workspaceRoot: rootSelected ? "/project" : "",
      validRepo: rootSelected,
      skillsInstalled: rssInstalled,
      onboardingCompleted: false,
      runtime: "test",
      environment: { mode: "desktop", platform: "linux" },
      overview,
      skills,
      ai: setupSnapshot
    }));
    const rootHealth = () => ({
      configured: rootSelected,
      accessible: rootSelected,
      readable: rootSelected,
      writable: rootSelected,
      missingInitializeEntries: [],
      missingCreateIfNeededEntries: [],
      optionalObservedEntries: [],
      symlinkWarnings: [],
      unknownPreservedEntries: [],
      activeRunCount: 0,
      warnings: []
    });
    installApi({
      getBootstrap,
      getOpenmindRoot: async () => ({
        openmindRoot: rootSelected ? "/project/openmind" : "",
        workspaceRoot: rootSelected ? "/project" : "",
        health: rootHealth(),
        snapshot: rootSelected ? { rootPath: "/project/openmind", rootId: "root", rootGeneration: 1 } : null
      }),
      selectOpenmindRoot: async () => "/project/openmind",
      previewOpenmindRoot: async () => ({ candidate: "/project/openmind", canonicalRoot: "/project/openmind", health: { ...rootHealth(), configured: true, accessible: true, readable: true, writable: true }, canBind: true, blockingReasons: [] }),
      setOpenmindRoot: async () => {
        rootSelected = true;
        return "/project/openmind";
      },
      getOnboardingState: async () => ({ completed: false, skill: "pending", provider: "pending" }),
      getProviders: async () => ({ schemaVersion: 1, default: "", cli: { claude: null, codex: null }, providers: [] }),
      installSkillSource: async () => {
        rssInstalled = true;
        return [];
      }
    });

    render(<App />);
    await screen.findByRole("heading", { level: 2, name: "选择 OpenMind 私人数据仓库" });
    const track = document.querySelector<HTMLElement>(".onboarding-step-track");
    expect(track?.dataset.currentStep).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "选择文件夹" }));
    const confirm = await screen.findByRole("alertdialog", { name: "确认绑定 OpenMind 私人数据仓库" });
    fireEvent.click(within(confirm).getByRole("button", { name: "确认绑定" }));

    await screen.findByRole("heading", { level: 2, name: "安装 RSS 源" });
    expect(document.querySelector(".onboarding-step-track")).toBe(track);
    expect(track?.dataset.currentStep).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "安装 RSS 源" }));
    await screen.findByRole("heading", { level: 2, name: "连接 AI Provider" });
    expect(document.querySelector(".onboarding-step-track")).toBe(track);
    expect(track?.dataset.currentStep).toBe("3");
  }, 15_000);

  it("remounts AI state when openmindRoot changes", async () => {
    const rootASnapshot: AiSnapshot = {
      ...snapshot,
      projectRoot: "/openmind-a",
      sessions: [{
        schemaVersion: 1,
        id: "root-a-session",
        projectId: "openmind-a",
        projectRoot: "/openmind-a",
        title: "Root A Session",
        provider: "codex",
        providerId: "codex-native",
        providerSessionId: null,
        cwd: ".",
        permissionProfile: "edit",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
        lastRunId: null,
        skillSnapshot: []
      }]
    };
    const rootBSnapshot: AiSnapshot = { ...snapshot, projectRoot: "/openmind-b", sessions: [] };
    let bootstrapCalls = 0;
    installApi({
      getBootstrap: async () => {
        bootstrapCalls += 1;
        return bootstrapCalls === 1
          ? { repoRoot: "/openmind-a", openmindRoot: "/openmind-a", workspaceRoot: "/openmind-a", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview, skills, ai: rootASnapshot }
          : { repoRoot: "/openmind-b", openmindRoot: "/openmind-b", workspaceRoot: "/openmind-b", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview, skills, ai: rootBSnapshot };
      },
      selectOpenmindRoot: async () => "/openmind-b",
      previewOpenmindRoot: async () => ({
        candidate: "/openmind-b",
        canonicalRoot: "/openmind-b",
        health: {
          configured: true,
          accessible: true,
          readable: true,
          writable: true,
          missingInitializeEntries: [],
          missingCreateIfNeededEntries: [],
          optionalObservedEntries: [],
          symlinkWarnings: [],
          unknownPreservedEntries: [],
          activeRunCount: 0,
          warnings: []
        },
        canBind: true,
        blockingReasons: []
      }),
      setOpenmindRoot: async () => "/openmind-b"
    });

    render(<App />);
    expect((await screen.findAllByText("Root A Session")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    await waitFor(() => expect(document.querySelector(".creative-workspace-page")).toBeTruthy(), { timeout: LAZY_ROUTE_TIMEOUT_MS });
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    await waitFor(() => expect(document.querySelector(".settings-page")).toBeTruthy(), { timeout: LAZY_ROUTE_TIMEOUT_MS });
    fireEvent.click(await screen.findByRole("button", { name: "选择" }, { timeout: LAZY_ROUTE_TIMEOUT_MS }));
    fireEvent.click(await screen.findByRole("button", { name: "确认绑定" }));

    await waitFor(() => expect(bootstrapCalls).toBe(2));
    await waitFor(() => expect(screen.queryAllByText("Root A Session")).toHaveLength(0));
    await waitFor(() => expect(document.querySelector(".ai-workbench")).toBeTruthy(), { timeout: LAZY_ROUTE_TIMEOUT_MS });
    expect(document.querySelector(".settings-page")).toBeNull();
    expect(document.querySelector(".creative-workspace-page")).toBeNull();
  }, 15_000);

  it("keeps setup open through the ready AI remount and hydrates that snapshot after finishing", async () => {
    const setupSnapshot: AiSnapshot = { ...snapshot, providers: [], sessions: [] };
    const readySnapshot: AiSnapshot = {
      ...snapshot,
      providers: [],
      sessions: [{
        schemaVersion: 1,
        id: "first-ready-session",
        projectId: "project",
        projectRoot: "/project",
        title: "Ready after Skill install",
        provider: "codex",
        providerId: "codex-native",
        providerSessionId: null,
        cwd: ".",
        permissionProfile: "edit",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
        lastRunId: null,
        skillSnapshot: []
      }]
    };
    let installed = false;
    let onboardingState: OnboardingState = { completed: false, skill: "pending", provider: "pending" };
    installApi({
      getBootstrap: async () => ({
        repoRoot: "/project",
        openmindRoot: "/project/openmind",
        workspaceRoot: "/project",
        validRepo: true,
        skillsInstalled: installed,
        onboardingCompleted: onboardingState.completed,
        runtime: "test",
        environment: { mode: "desktop", platform: "linux" },
        overview,
        skills,
        ai: installed ? readySnapshot : setupSnapshot
      }),
      getOpenmindRoot: async () => ({
        openmindRoot: "/project/openmind",
        workspaceRoot: "/project",
        health: {
          configured: true,
          accessible: true,
          readable: true,
          writable: true,
          missingInitializeEntries: [],
          missingCreateIfNeededEntries: [],
          optionalObservedEntries: [],
          symlinkWarnings: [],
          unknownPreservedEntries: [],
          activeRunCount: 0,
          warnings: []
        },
        snapshot: null
      }),
      getOnboardingState: async () => onboardingState,
      updateOnboardingState: async (patch) => {
        onboardingState = { ...onboardingState, ...patch };
        return onboardingState;
      },
      getProviders: async () => ({ schemaVersion: 1, default: "", cli: { claude: null, codex: null }, providers: [] }),
      installSkillSource: async () => {
        installed = true;
        return [];
      }
    });

    render(<App />);
    const install = await screen.findByRole("button", { name: "安装 RSS 源" });
    await waitFor(() => expect((install as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(install);

    const providerHeading = await screen.findByRole("heading", { level: 2, name: "连接 AI Provider" }, { timeout: LAZY_ROUTE_TIMEOUT_MS });
    expect(document.querySelector(".onboarding-page")).toBeTruthy();
    expect(document.querySelector<HTMLElement>(".onboarding-step-track")?.dataset.currentStep).toBe("3");
    await waitFor(() => expect(document.activeElement).toBe(providerHeading));
    fireEvent.click(screen.getByRole("button", { name: "稍后配置" }));
    const finishHeading = await screen.findByRole("heading", { level: 2, name: "准备完成" });
    expect(document.querySelector<HTMLElement>(".onboarding-step-track")?.dataset.currentStep).toBe("4");
    await waitFor(() => expect(document.activeElement).toBe(finishHeading));
    fireEvent.click(screen.getByRole("button", { name: "进入工作台" }));

    expect((await screen.findAllByText("Ready after Skill install", {}, { timeout: LAZY_ROUTE_TIMEOUT_MS })).length).toBeGreaterThan(0);
    expect(document.querySelector(".onboarding-page")).toBeNull();
  }, 15_000);

  it("MOTION-P0-002: clicking the already-active nav does not remount the page", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "创作" })));
    await waitFor(() => expect(document.querySelector(".creative-workspace-page")).toBeTruthy(), { timeout: LAZY_ROUTE_TIMEOUT_MS });
    const firstCreativeNode = document.querySelector(".creative-workspace-page");
    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    // the same DOM node should still be present (React reused it)
    expect(document.querySelector(".creative-workspace-page")).toBe(firstCreativeNode);
  }, 15_000);

  it("opens settings with a dedicated sidebar and returns to the page that launched it", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    await waitFor(() => expect(document.querySelector(".creative-workspace-page")).toBeTruthy(), { timeout: LAZY_ROUTE_TIMEOUT_MS });
    const creativePage = document.querySelector(".creative-workspace-page");

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    await waitFor(() => expect(document.querySelector(".settings-page")).toBeTruthy(), { timeout: LAZY_ROUTE_TIMEOUT_MS });
    expect(document.querySelector(".app-nav")).toBeNull();
    expect(document.querySelector(".global-toolbar")).toBeNull();
    expect(screen.getByRole("navigation", { name: "设置分类" })).toBeTruthy();
    expect(document.querySelector(".creative-workspace-page")).toBe(creativePage);
    expect(creativePage?.closest(".settings-preserved-route")?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "返回应用" }));
    await waitFor(() => expect(document.querySelector(".creative-workspace-page")).toBeTruthy(), { timeout: LAZY_ROUTE_TIMEOUT_MS });
    expect(document.querySelector(".creative-workspace-page")).toBe(creativePage);
    expect(screen.getByRole("button", { name: "创作" }).getAttribute("aria-current")).toBe("page");
    expect(document.querySelector(".global-toolbar")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "设置" })));
  }, 15_000);

  it("does not expose the Skill import entry while the required RSS setup is incomplete", async () => {
    installApi({
      getBootstrap: async () => ({
        repoRoot: "/project",
        openmindRoot: "/project/openmind",
        workspaceRoot: "/project",
        validRepo: true,
        skillsInstalled: false,
        onboardingCompleted: false,
        runtime: "test",
        environment: { mode: "desktop", platform: "linux" },
        overview,
        skills,
        ai: snapshot
      })
    });
    render(<App />);
    await waitFor(() => expect(document.querySelector(".onboarding-page")).toBeTruthy());

    expect(await screen.findByRole("heading", { level: 2, name: "安装 RSS 源" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开导入入口" })).toBeNull();
    expect(document.querySelector(".settings-page")).toBeNull();
  }, 15_000);

  it("keeps the primary navigation expanded when opening creative and leaves the AI companion opt-in", async () => {
    window.localStorage.setItem("openmind.nav.collapsed.v1", JSON.stringify(false));
    // Reproduce a stale expanded companion preference from an earlier app run.
    window.localStorage.setItem("openmind.ai.panel-mode.v1", JSON.stringify("default"));

    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "创作" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "创作" }).getAttribute("aria-current")).toBe("page");
      expect(document.querySelector(".app-nav")?.classList.contains("collapsed")).toBe(false);
      expect(screen.getByRole("button", { name: "展开 AI 侧栏" })).toBeTruthy();
      expect(document.querySelector(".ai-sidebar")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "展开 AI 侧栏" }));
    await waitFor(() => expect(document.querySelector(".ai-sidebar")).toBeTruthy());
  });

  it("opens the AI companion by default on the daily brief page and respects a manual collapse", async () => {
    installApi({ listContent: async () => [] });
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "每日简报" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "每日简报" }).getAttribute("aria-current")).toBe("page");
      expect(document.querySelector(".ai-sidebar.mode-default")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "展开 AI 侧栏" })).toBeNull();
    }, { timeout: LAZY_ROUTE_TIMEOUT_MS });

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "展开 AI 侧栏" })).toBeTruthy());
  }, 15_000);

  it("opens companion file references inside the left workspace instead of the external editor", async () => {
    const path = "openmind/daily-topic/20260728_daily_topic.md";
    const openPath = vi.fn(async (value: string) => value);
    const readContent = vi.fn(async () => ({
      path,
      name: "20260728_daily_topic.md",
      content: "# 左侧文件预览",
      ext: "md",
      truncated: false
    }));
    const run: AiRun = {
      schemaVersion: 1,
      id: "run-1",
      sessionId: "session-1",
      projectId: "project-1",
      provider: "codex",
      providerId: "codex-native",
      permissionProfile: "auto",
      status: "completed",
      prompt: "生成选题",
      contexts: [],
      turnContext: null,
      workspacePath: null,
      baseCommit: null,
      startedAt: "2026-07-28T14:00:00.000Z",
      completedAt: "2026-07-28T14:01:00.000Z",
      error: null,
      changeSet: null,
      risks: []
    };
    const event: AiEvent = {
      schemaVersion: 1,
      id: "answer-1",
      seq: 1,
      timestamp: "2026-07-28T14:01:00.000Z",
      projectId: "project-1",
      sessionId: "session-1",
      runId: "run-1",
      provider: "codex",
      kind: "assistant-message",
      payload: { phase: "final", text: `结果：\`${path}\`` },
      risks: []
    };
    const sessionSnapshot: AiSnapshot = {
      ...snapshot,
      sessions: [{
        schemaVersion: 1,
        id: "session-1",
        projectId: "project-1",
        projectRoot: "/project",
        title: "每日选题",
        provider: "codex",
        providerId: "codex-native",
        providerSessionId: null,
        cwd: ".",
        permissionProfile: "auto",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: "2026-07-28T14:00:00.000Z",
        updatedAt: "2026-07-28T14:01:00.000Z",
        lastRunId: "run-1"
      }],
      runs: [run]
    };
    installApi({
      getBootstrap: async () => ({ repoRoot: "/project", openmindRoot: "/project/openmind", workspaceRoot: "/project", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview, skills, ai: sessionSnapshot }),
      aiRefresh: async () => sessionSnapshot,
      aiListTurns: async () => ({
        data: [{
          id: run.id,
          sessionId: run.sessionId,
          status: "completed",
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          context: null,
          events: [event],
          responseItems: [],
          error: null
        }],
        nextCursor: null,
        total: 1,
        parseErrors: 0
      }),
      listContent: async () => [],
      readContent,
      openPath
    });

    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "每日简报" }));
    fireEvent.click(await screen.findByRole("button", { name: path }));

    expect(await screen.findByRole("complementary", { name: "文件预览" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "左侧文件预览" })).toBeTruthy();
    expect(readContent).toHaveBeenCalledWith(path);
    expect(openPath).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(openPath).toHaveBeenCalledWith(path);
  });

  it("restores the AI file split after navigating away and returning to the conversation", async () => {
    const path = "openmind/daily-summary/20260728_daily_summary.md";
    const readContent = vi.fn(async () => ({
      path,
      name: "20260728_daily_summary.md",
      content: "# 返回后仍在左侧",
      ext: "md",
      truncated: false
    }));
    const session = {
      schemaVersion: 1 as const,
      id: "session-preview",
      projectId: "project-1",
      projectRoot: "/project",
      title: "保留分栏的对话",
      provider: "codex" as const,
      providerId: "codex-native",
      providerSessionId: null,
      cwd: ".",
      permissionProfile: "auto" as const,
      status: "idle" as const,
      pinned: false,
      archived: false,
      createdAt: "2026-07-28T14:00:00.000Z",
      updatedAt: "2026-07-28T14:01:00.000Z",
      lastRunId: "run-preview"
    };
    const run: AiRun = {
      schemaVersion: 1,
      id: "run-preview",
      sessionId: session.id,
      projectId: session.projectId,
      provider: "codex",
      providerId: "codex-native",
      permissionProfile: "auto",
      status: "completed",
      prompt: "查看总结",
      contexts: [],
      turnContext: null,
      workspacePath: null,
      baseCommit: null,
      startedAt: session.createdAt,
      completedAt: session.updatedAt,
      error: null,
      changeSet: null,
      risks: []
    };
    const event: AiEvent = {
      schemaVersion: 1,
      id: "answer-preview",
      seq: 1,
      timestamp: session.updatedAt,
      projectId: session.projectId,
      sessionId: session.id,
      runId: run.id,
      provider: "codex",
      kind: "assistant-message",
      payload: { phase: "final", text: `文件：\`${path}\`` },
      risks: []
    };
    const sessionSnapshot: AiSnapshot = {
      ...snapshot,
      sessions: [session],
      runs: [run]
    };
    installApi({
      getBootstrap: async () => ({ repoRoot: "/project", openmindRoot: "/project/openmind", workspaceRoot: "/project", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview, skills, ai: sessionSnapshot }),
      aiRefresh: async () => sessionSnapshot,
      aiListTurns: async () => ({
        data: [{
          id: run.id,
          sessionId: run.sessionId,
          status: "completed",
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          context: null,
          events: [event],
          responseItems: [],
          error: null
        }],
        nextCursor: null,
        total: 1,
        parseErrors: 0
      }),
      listContent: async () => [],
      readContent
    });

    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: path }));
    expect(await screen.findByRole("heading", { name: "返回后仍在左侧" })).toBeTruthy();
    expect(readContent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "每日简报" }));
    await waitFor(() => expect(document.querySelector(".brief-library-page")).toBeTruthy());
    fireEvent.click(document.querySelector<HTMLButtonElement>(".nav-recent-item")!);

    expect(await screen.findByRole("heading", { name: "返回后仍在左侧" })).toBeTruthy();
    expect(await screen.findByRole("complementary", { name: "文件预览" })).toBeTruthy();
    await waitFor(() => expect(readContent).toHaveBeenCalledTimes(2));
  });

  it("keeps a fullscreen AI companion underneath the body-level global search", async () => {
    window.localStorage.setItem("openmind.nav.collapsed.v1", JSON.stringify(false));
    const view = render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "展开 AI 侧栏" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "展开 AI 侧栏" }));
    await waitFor(() => expect(document.querySelector(".ai-sidebar")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^全屏$/ }));
    await waitFor(() => expect(document.querySelector(".ai-sidebar.mode-full")).toBeTruthy());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(document.querySelector(".global-search-dialog")).toBeTruthy());

    const scrim = document.querySelector<HTMLElement>(".global-search-scrim");
    expect(scrim?.parentElement).toBe(document.body);
    expect(view.container.contains(scrim)).toBe(false);
    expect(view.container.inert).toBe(true);
    expect(view.container.getAttribute("aria-hidden")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".global-search-scrim")).toBeNull());
    expect(document.querySelector(".ai-sidebar.mode-full")).toBeTruthy();
  });

  it("clears the recent-session selection when navigating to a feature page", async () => {
    window.localStorage.setItem("openmind.nav.collapsed.v1", JSON.stringify(false));
    const sessionSnapshot = {
      ...snapshot,
      sessions: [{
        schemaVersion: 1 as const,
        id: "session-1",
        projectId: "project-1",
        projectRoot: "/project",
        title: "测试会话",
        provider: "codex" as const,
        providerId: "codex-native",
        providerSessionId: null,
        cwd: ".",
        permissionProfile: "edit" as const,
        status: "idle" as const,
        pinned: false,
        archived: false,
        createdAt: "2026-07-13T00:00:00.000Z",
        updatedAt: "2026-07-13T00:00:00.000Z",
        lastRunId: null
      }]
    };
    installApi({
      getBootstrap: async () => ({ repoRoot: "/project", openmindRoot: "/project/openmind", workspaceRoot: "/project", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview, skills, ai: sessionSnapshot }),
      aiRefresh: async () => sessionSnapshot
    });

    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());

    const recentSession = document.querySelector<HTMLButtonElement>(".nav-recent-item");
    expect(recentSession).toBeTruthy();
    fireEvent.click(recentSession!);
    await waitFor(() => expect(recentSession?.classList.contains("active")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "每日简报" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "每日简报" }).getAttribute("aria-current")).toBe("page");
      expect(recentSession?.classList.contains("active")).toBe(false);
      expect(recentSession?.getAttribute("aria-current")).toBeNull();
    });
  });
});
