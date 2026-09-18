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
  notesDir: "openmind", destructiveOpsRequireApproval: true, riskScanEnabled: true, defaultPlatform: "公众号",
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
    expect(screen.getAllByRole("main")).toHaveLength(1);
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
    // 品牌区搜索按钮已移除，以主导航就绪作为应用壳就绪信号。
    await waitFor(() => expect(screen.getByRole("button", { name: "新建任务" })).toBeTruthy());
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
        scope: { type: "workspace" },
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
        scope: { type: "workspace" },
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
    // 桌面壳的全局工具条已移除，返回后以主导航恢复作为应用壳还原的标志。
    expect(document.querySelector(".app-nav")).toBeTruthy();
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

  it("opens the AI companion by default on the daily brief page without a header toolbar", async () => {
    installApi({ listContent: async () => [] });
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "每日简报" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "每日简报" }).getAttribute("aria-current")).toBe("page");
      expect(document.querySelector(".ai-sidebar.mode-default")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "展开 AI 侧栏" })).toBeNull();
      expect(document.querySelector(".ai-sidebar > header")).toBeNull();
    }, { timeout: LAZY_ROUTE_TIMEOUT_MS });
  }, 15_000);

  it("keeps the daily brief visible instead of auto-opening a full-canvas AI companion", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(max-width: 840px)" || query === "(max-width: 1480px)" || query === "(max-width: 720px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      addListener: vi.fn(),
      removeListener: vi.fn()
    } as MediaQueryList));
    window.localStorage.setItem("openmind.ai.panel-mode.v1", JSON.stringify("collapsed"));
    installApi({ listContent: async () => [] });

    try {
      render(<App />);
      await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }));
      fireEvent.click(await screen.findByRole("button", { name: "每日简报" }));

      await waitFor(() => expect(document.querySelector(".brief-library-page")).toBeTruthy(), { timeout: LAZY_ROUTE_TIMEOUT_MS });
      expect(document.querySelector(".ai-sidebar")).toBeNull();
      expect(screen.getByRole("button", { name: "展开 AI 侧栏" })).toBeTruthy();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  }, 15_000);

  it("docks the AI companion beside Project files and closes it for Project tasks", async () => {
    const project = {
      schemaVersion: 2 as const,
      id: "5a111111-1111-4111-8111-111111111111",
      name: "AI 安全",
      description: "研究与写作",
      status: "active" as const,
      icon: "database",
      color: "neutral" as const,
      favorite: false,
      materialCount: 0,
      taskCount: 0,
      outputCount: 0,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    installApi({
      listProjects: async () => [project],
      getProject: async () => ({ project }),
      listProjectTasks: async () => [],
      listProjectMaterials: async () => [],
      listProjectOutputs: async () => []
    });
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "项目" }));
    fireEvent.click(await screen.findByRole("button", { name: "AI 安全" }, { timeout: LAZY_ROUTE_TIMEOUT_MS }));
    fireEvent.click(await screen.findByRole("tab", { name: "文件" }));

    await waitFor(() => expect(document.querySelector(".app-shell.page-projects > .ai-sidebar.mode-default")).toBeTruthy());
    expect(screen.getByRole("separator", { name: /AI 侧栏宽度/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "任务" }));
    await waitFor(() => expect(document.querySelector(".ai-sidebar")).toBeNull());
    expect(screen.getByRole("button", { name: "展开 AI 侧栏" })).toBeTruthy();
  }, 15_000);

  it("opens companion file references in the brief detail pane while keeping the file list", async () => {
    const path = "openmind/daily-topic/20260728_daily_topic.md";
    const briefPath = "openmind/daily-summary/20260728_daily_summary.md";
    const openPath = vi.fn(async (value: string) => value);
    const readContent = vi.fn(async (requestedPath: string) => ({
      path: requestedPath,
      name: requestedPath === path ? "20260728_daily_topic.md" : "20260728_daily_summary.md",
      content: requestedPath === path ? "# 左侧文件预览" : "# 当前每日简报",
      ext: "md",
      truncated: false
    }));
    const run: AiRun = {
      schemaVersion: 1,
      id: "run-1",
      sessionId: "session-1",
      projectId: "project-1",
      scope: { type: "workspace" },
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
        scope: { type: "workspace" },
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
      listContent: async () => [{ path: briefPath, name: "20260728_daily_summary.md", size: 1280, modifiedAt: "2026-07-28T14:00:00.000Z" }],
      readContent,
      openPath
    });

    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "每日简报" }));
    fireEvent.click(await screen.findByRole("button", { name: path }));

    const preview = await screen.findByRole("complementary", { name: "文件预览" });
    const briefList = document.querySelector(".brief-library-page .document-library-list");
    expect(briefList).toBeTruthy();
    expect(briefList?.closest(".settings-preserved-route")?.getAttribute("aria-hidden")).toBeNull();
    expect(preview.closest(".document-library-detail")).toBeTruthy();
    expect(preview.classList.contains("is-embedded")).toBe(true);
    expect(await screen.findByRole("heading", { name: "左侧文件预览" })).toBeTruthy();
    expect(readContent).toHaveBeenCalledWith(path);
    expect(openPath).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(openPath).toHaveBeenCalledWith(path);

    fireEvent.click(screen.getByRole("button", { name: "关闭文件预览" }));
    expect(await screen.findByRole("heading", { name: "当前每日简报" })).toBeTruthy();
    expect(briefList).toBeTruthy();
  });

  it("restores the AI file split for a conversation but clears it for a new task", async () => {
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
      scope: { type: "workspace" as const },
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
      scope: session.scope,
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

    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "文件预览" })).toBeNull());
    expect(screen.queryByRole("heading", { name: "返回后仍在左侧" })).toBeNull();
    expect(document.querySelector(".ai-workbench.with-file-preview")).toBeNull();
  });

  it("keeps an expanded AI companion underneath the body-level global search", async () => {
    window.localStorage.setItem("openmind.nav.collapsed.v1", JSON.stringify(false));
    const view = render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "展开 AI 侧栏" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "展开 AI 侧栏" }));
    await waitFor(() => expect(document.querySelector(".ai-sidebar")).toBeTruthy());

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(document.querySelector(".global-search-dialog")).toBeTruthy());

    const scrim = document.querySelector<HTMLElement>(".global-search-scrim");
    expect(scrim?.parentElement).toBe(document.body);
    expect(view.container.contains(scrim)).toBe(false);
    expect(view.container.inert).toBe(true);
    expect(view.container.getAttribute("aria-hidden")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".global-search-scrim")).toBeNull());
    expect(document.querySelector(".ai-sidebar")).toBeTruthy();
  });

  it("clears the recent-session selection when navigating to a feature page", async () => {
    window.localStorage.setItem("openmind.nav.collapsed.v1", JSON.stringify(false));
    const sessionSnapshot = {
      ...snapshot,
      sessions: [{
        schemaVersion: 1 as const,
        id: "session-1",
        projectId: "project-1",
        scope: { type: "workspace" as const },
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

  it("opens a recent Project Task in its owning Project conversation", async () => {
    window.localStorage.setItem("openmind.nav.collapsed.v1", JSON.stringify(false));
    const projectId = "5a111111-1111-4111-8111-111111111111";
    const taskId = "7f43fc74-10a1-4e71-97cd-ec90d2660c1c";
    const projectSession = {
      schemaVersion: 1 as const,
      id: "project-session-1",
      projectId,
      scope: { type: "project-task" as const, projectId, projectName: "AI 安全", taskId },
      projectRoot: "/project/openmind/projects/AI 安全",
      title: "项目内部对话",
      provider: "codex" as const,
      providerId: "codex-native",
      providerSessionId: null,
      cwd: ".",
      permissionProfile: "read-only" as const,
      status: "idle" as const,
      pinned: false,
      archived: false,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:01:00.000Z",
      lastRunId: null
    };
    const project = {
      schemaVersion: 2 as const,
      id: projectId,
      name: "AI 安全",
      description: "研究与写作",
      status: "active" as const,
      icon: "database",
      color: "neutral" as const,
      favorite: false,
      materialCount: 0,
      taskCount: 1,
      outputCount: 0,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-10T00:01:00.000Z"
    };
    const task = {
      taskId,
      projectId,
      projectName: project.name,
      title: projectSession.title,
      sessionId: projectSession.id,
      previousSessionIds: [],
      providerId: projectSession.providerId,
      status: "completed" as const,
      createdAt: projectSession.createdAt,
      updatedAt: projectSession.updatedAt
    };
    const projectSnapshot = { ...snapshot, sessions: [projectSession] };
    const getProject = vi.fn(async (_projectName: string) => project);
    const listProjectTasks = vi.fn(async () => [task]);
    installApi({
      getBootstrap: async () => ({ repoRoot: "/project", openmindRoot: "/project/openmind", workspaceRoot: "/project", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview, skills, ai: projectSnapshot }),
      aiRefresh: async () => projectSnapshot,
      listProjects: async () => [project],
      getProject: async (projectName) => ({ project: await getProject(projectName) }),
      listProjectTasks
    });

    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(await screen.findByText(projectSession.title));

    await waitFor(() => expect(getProject).toHaveBeenCalledWith(project.name));
    await waitFor(() => expect(listProjectTasks).toHaveBeenCalledWith(project.name));
    await waitFor(() => {
      const selected = document.querySelector(".project-task-row.active");
      expect(selected?.textContent).toContain(projectSession.title);
      expect(screen.getByRole("button", { name: "项目" }).getAttribute("aria-current")).toBe("page");
    });
  });
});
