import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, AppOverview, DesktopApi, SkillDefinition, UserPreferences } from "@shared/contracts";
import { App } from "./App";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{ id: "codex-native", provider: "codex", label: "Codex", runtime: "native", available: true, version: "1", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, oneMillion: false }],
  sessions: [], runs: [], pendingApprovals: []
};

const overview: AppOverview = { repoRoot: "/project", metrics: {}, recent: [] };
const skills: SkillDefinition[] = [];
const preferences: UserPreferences = {
  schemaVersion: 1, repoRoot: "/project", themeMode: "light", accentColor: "#2563eb", density: "default", fontSize: "default",
  autoSaveIntervalMs: 30000, maxVersions: 50, archiveAfterDays: 90, defaultReadFilter: "all", contentPreviewMode: "sidebar",
  markReadOnOpen: true, defaultProvider: "", providerModels: { codex: "auto", claude: "auto" }, defaultPermissionProfile: "edit",
  defaultWorkDir: "", notesDir: "mymind", browserAutomationEnabled: false, browserReuseExistingTabs: true,
  browserEvidenceDir: ".cctools/browser-evidence", destructiveOpsRequireApproval: true, riskScanEnabled: true, defaultPlatform: "公众号",
  defaultLanguage: "zh-CN", defaultContentLength: "medium", defaultTemplate: "", userTags: [], notificationsEnabled: true,
  dndStartHour: 22, dndEndHour: 8, maxNotificationHistory: 100, cacheMaxSizeMB: 500, logRetentionDays: 30,
  workflowAutoSaveDraft: true, workflowAutoVersionOnStageChange: true, workflowReviewRequiredForReady: true,
  workflowPublishChecklistEnabled: true, workflowAutoArchiveEnabled: false, workflowAutoBriefOnSourceComplete: false
};

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.cctools = {
    getBootstrap: async () => ({ repoRoot: "/project", validRepo: true, runtime: "test", environment: { mode: "desktop" }, overview, skills, ai: snapshot }),
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
    selectMymindFiles: async () => [],
    searchMymindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
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

  it("renders a fatal error screen when window.cctools is missing", () => {
    delete (window as unknown as { cctools?: unknown }).cctools;
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
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeTruthy();
    });
  });

  it("Cmd+N navigates to a new AI session without throwing (after bootstrap)", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    // no throw, no fatal screen
    expect(document.querySelector(".fatal")).toBeNull();
  });

  it("MOTION-P0-002: clicking the already-active nav does not remount the page", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "创作" })));
    await waitFor(() => expect(document.querySelector(".creative-workspace-page")).toBeTruthy());
    const firstCreativeNode = document.querySelector(".creative-workspace-page");
    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    // the same DOM node should still be present (React reused it)
    expect(document.querySelector(".creative-workspace-page")).toBe(firstCreativeNode);
  });

  it("opens immersive settings and returns to the page that launched it", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector(".splash")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "创作" }));
    await waitFor(() => expect(document.querySelector(".creative-workspace-page")).toBeTruthy());
    const creativePage = document.querySelector(".creative-workspace-page");

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    await waitFor(() => expect(document.querySelector(".settings-page")).toBeTruthy());
    expect(document.querySelector(".app-nav")).toBeNull();
    expect(document.querySelector(".global-toolbar")).toBeNull();
    expect(document.querySelector(".creative-workspace-page")).toBe(creativePage);
    expect(creativePage?.closest(".settings-preserved-route")?.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "返回应用" })));

    fireEvent.click(screen.getByRole("button", { name: "返回应用" }));
    await waitFor(() => expect(document.querySelector(".creative-workspace-page")).toBeTruthy());
    expect(document.querySelector(".creative-workspace-page")).toBe(creativePage);
    expect(screen.getByRole("button", { name: "创作" }).getAttribute("aria-current")).toBe("page");
    expect(document.querySelector(".global-toolbar")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "设置" })));
  });

  it("keeps the primary navigation expanded when opening creative and leaves the AI companion opt-in", async () => {
    window.localStorage.setItem("cctools.nav.collapsed.v1", JSON.stringify(false));
    // Reproduce a stale expanded companion preference from an earlier app run.
    window.localStorage.setItem("cctools.ai.panel-mode.v1", JSON.stringify("default"));

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
    });

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "展开 AI 侧栏" })).toBeTruthy());
  });

  it("keeps a fullscreen AI companion underneath the body-level global search", async () => {
    window.localStorage.setItem("cctools.nav.collapsed.v1", JSON.stringify(false));
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
    window.localStorage.setItem("cctools.nav.collapsed.v1", JSON.stringify(false));
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
      getBootstrap: async () => ({ repoRoot: "/project", validRepo: true, runtime: "test", environment: { mode: "desktop" }, overview, skills, ai: sessionSnapshot }),
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
