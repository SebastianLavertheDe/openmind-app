import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSession, AiSnapshot, DesktopApi, ProviderCapabilities, UserPreferences } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { SettingsPage } from "./SettingsPage";

const providers: ProviderCapabilities[] = [
  { id: "codex-preview", provider: "codex", label: "Codex CLI", runtime: "native", available: true, version: "1.0", supportsApprovals: true, supportsResume: true, supportsImages: false, diagnostic: null, detectedModel: null, contextWindow: null, oneMillion: false },
  { id: "claude-preview", provider: "claude", label: "Claude Code", runtime: "native", available: true, version: "1.0", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: "glm-5.2[1m]", contextWindow: 1_000_000, oneMillion: true }
];

const defaultPrefs: UserPreferences = {
  schemaVersion: 1, repoRoot: "/repo", themeMode: "light", accentColor: "#2563eb",
  density: "default", fontSize: "default", autoSaveIntervalMs: 30000, maxVersions: 50,
  archiveAfterDays: 90, defaultReadFilter: "all", contentPreviewMode: "sidebar",
  markReadOnOpen: true, defaultProvider: "", providerModels: { codex: "auto", claude: "auto" },
  defaultPermissionProfile: "edit",
  defaultWorkDir: "", notesDir: "mymind", destructiveOpsRequireApproval: true,
  riskScanEnabled: true, defaultPlatform: "公众号", defaultLanguage: "zh-CN",
  defaultContentLength: "medium", defaultTemplate: "", userTags: ["AI", "工程"],
  notificationsEnabled: true, dndStartHour: 22, dndEndHour: 8,
  maxNotificationHistory: 100, cacheMaxSizeMB: 500, logRetentionDays: 30,
  workflowAutoSaveDraft: true, workflowAutoVersionOnStageChange: true,
  workflowReviewRequiredForReady: true, workflowPublishChecklistEnabled: true,
  workflowAutoArchiveEnabled: false, workflowAutoBriefOnSourceComplete: false
};

const archivedSession: AiSession = {
  schemaVersion: 1,
  id: "archived-session",
  projectId: "project",
  projectRoot: "/repo",
  provider: "codex",
  providerId: "codex-preview",
  providerSessionId: null,
  cwd: "/repo",
  title: "已经归档的研究会话",
  permissionProfile: "edit",
  status: "idle",
  pinned: false,
  archived: true,
  createdAt: "2026-07-18T08:00:00.000Z",
  updatedAt: "2026-07-20T09:30:00.000Z",
  lastRunId: null
};

const snapshot: AiSnapshot = { projectRoot: "/repo", providers, sessions: [], runs: [], pendingApprovals: [] };
const archivedSnapshot: AiSnapshot = { ...snapshot, sessions: [archivedSession] };

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    getPreferences: async () => defaultPrefs,
    updatePreferences: async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }),
    resetPreferences: async () => defaultPrefs,
    selectRepo: async () => "/repo-next",
    openPath: async () => "",
    onAiEvent: () => () => undefined,
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    ...overrides
  } as unknown as DesktopApi;
}

function renderSettings(onRepo = vi.fn(), initial = snapshot, onOpenSession = vi.fn(), onBack = vi.fn()) {
  render(<AiProvider initial={initial}><SettingsPage repoRoot="/repo" runtime="linux" providers={providers} onRepo={onRepo} onBack={onBack} onOpenSession={onOpenSession} /><FeedbackHost /></AiProvider>);
}

function openCategory(name: string) {
  const navigation = screen.getByRole("navigation", { name: "设置分类" });
  fireEvent.click(within(navigation).getByRole("button", { name }));
}

beforeEach(() => {
  window.cctools = makeApi();
});

afterEach(() => cleanup());

describe("SettingsPage", () => {
  it("shows categorized navigation and renders only the active category details", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByRole("heading", { name: "常规" })).toBeTruthy());
    const navigation = screen.getByRole("navigation", { name: "设置分类" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(within(navigation).getByRole("button", { name: "常规" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "项目路径" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Provider" })).toBeNull();

    openCategory("AI 与模型");
    expect(screen.getByRole("heading", { name: "AI 与模型" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Provider" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "外观" })).toBeNull();
  });

  it("returns to the application from the settings navigation", async () => {
    const onBack = vi.fn();
    renderSettings(vi.fn(), snapshot, vi.fn(), onBack);
    fireEvent.click(await screen.findByRole("button", { name: "返回应用" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows a recoverable error when preferences fail to load", async () => {
    const getPreferences = vi.fn()
      .mockRejectedValueOnce(new Error("preferences unavailable"))
      .mockResolvedValue(defaultPrefs);
    window.cctools = makeApi({ getPreferences });
    renderSettings();

    expect((await screen.findByRole("alert")).textContent).toContain("设置加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByRole("heading", { name: "外观" })).toBeTruthy();
    expect(getPreferences).toHaveBeenCalledTimes(2);
  });

  it("saves theme, density, and body font size preferences", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.cctools = makeApi({ updatePreferences });
    renderSettings();
    await waitFor(() => expect(screen.getByRole("button", { name: "深色" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "深色" }));
    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    fireEvent.click(screen.getByRole("button", { name: "大" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ themeMode: "dark", accentColor: "#2563eb" })));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ density: "compact", accentColor: "#2563eb" })));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ fontSize: "large", accentColor: "#2563eb" })));
  });

  it("switches the default provider without changing the screen structure", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.cctools = makeApi({ updatePreferences });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");
    await waitFor(() => expect(screen.getByText("Claude Code")).toBeTruthy());

    fireEvent.click(screen.getByRole("radio", { name: "将 Claude Code 设为默认" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ defaultProvider: "claude-preview", accentColor: "#2563eb" })));
    expect(screen.getAllByText("可用").length).toBe(2);
  });

  it("saves permission defaults and approval toggles", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.cctools = makeApi({ updatePreferences });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("权限与安全");
    await waitFor(() => expect(screen.getByLabelText("新会话默认权限")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("新会话默认权限"), { target: { value: "read-only" } });
    fireEvent.click(screen.getByRole("switch", { name: "风险扫描" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ defaultPermissionProfile: "read-only", accentColor: "#2563eb" })));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ riskScanEnabled: false, accentColor: "#2563eb" })));
  });

  it("keeps project path actions connected to the desktop API", async () => {
    const onRepo = vi.fn();
    const selectRepo = vi.fn().mockResolvedValue("/repo-next");
    const openPath = vi.fn().mockResolvedValue("");
    window.cctools = makeApi({ selectRepo, openPath });
    renderSettings(onRepo);
    await waitFor(() => expect(screen.getByText("工作目录")).toBeTruthy());

    const browseButtons = screen.getAllByRole("button", { name: /浏览/ });
    fireEvent.click(browseButtons[0]);
    await waitFor(() => expect(selectRepo).toHaveBeenCalled());
    expect(onRepo).toHaveBeenCalledWith("/repo-next");

    fireEvent.click(browseButtons[1]);
    await waitFor(() => expect(openPath).toHaveBeenCalledWith("mymind"));
  });

  it("shows the model read from each CLI config without model selectors", async () => {
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");
    await waitFor(() => expect(screen.getByLabelText("Claude Code 配置模型")).toBeTruthy());
    expect(screen.getByLabelText("Codex CLI 配置模型")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    // 探测到的 Claude 模型 glm-5.2[1m] 命中 1M，徽标出现。
    expect(screen.getByText("1M")).toBeTruthy();
    expect(screen.getByLabelText("Claude Code 配置模型").textContent).toContain("glm-5.2[1m]");
    // 未配置模型时明确交还 Provider，而不是展示一份内置候选列表。
    expect(screen.getByText("配置未指定，运行时由 Provider 决定")).toBeTruthy();
  });

  it("previews and persists workflow rules", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.cctools = makeApi({ updatePreferences });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("内容工作流");
    await waitFor(() => expect(screen.getByRole("status", { name: "工作流规则预览" })).toBeTruthy());
    expect(screen.getByText(/每 30 秒自动保存/)).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "进入待发布需审核通过" }));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ workflowReviewRequiredForReady: false })));
    fireEvent.change(screen.getByLabelText("自动保存间隔"), { target: { value: "15000" } });
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ autoSaveIntervalMs: 15000 })));
  });

  it("labels retention values as non-destructive local preferences", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.cctools = makeApi({ updatePreferences });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("数据与存储");
    expect(await screen.findByText(/暂不自动清理文件或历史/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("日志保留天数"), { target: { value: "60" } });
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ logRetentionDays: 60 })));
  });

  it("resets only the workflow preference group after confirmation", async () => {
    const resetPreferences = vi.fn(async () => defaultPrefs);
    window.cctools = makeApi({ resetPreferences });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("内容工作流");
    fireEvent.click(await screen.findByRole("button", { name: "恢复默认值" }));
    const dialog = await screen.findByRole("alertdialog", { name: "恢复默认值" });
    fireEvent.click(within(dialog).getByRole("button", { name: "恢复默认值" }));
    await waitFor(() => expect(resetPreferences).toHaveBeenCalledWith("workflow"));
  });

  it("lists archived sessions and restores them to recent sessions", async () => {
    const restored = { ...archivedSession, archived: false };
    const aiUpdateSession = vi.fn().mockResolvedValue(restored);
    window.cctools = makeApi({
      aiUpdateSession,
      aiRefresh: async () => ({ ...snapshot, sessions: [restored] })
    });
    renderSettings(vi.fn(), archivedSnapshot);
    await screen.findByRole("heading", { name: "常规" });
    openCategory("会话归档");

    expect(await screen.findByRole("heading", { name: "已归档会话" })).toBeTruthy();
    expect(screen.getByText("已经归档的研究会话")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "恢复归档会话：已经归档的研究会话" }));

    await waitFor(() => expect(aiUpdateSession).toHaveBeenCalledWith(archivedSession.id, { archived: false }));
    await waitFor(() => expect(screen.getByText("暂无已归档会话")).toBeTruthy());
  });

  it("opens an archived session from settings", async () => {
    const onOpenSession = vi.fn();
    window.cctools = makeApi();
    renderSettings(vi.fn(), archivedSnapshot, onOpenSession);
    await screen.findByRole("heading", { name: "常规" });
    openCategory("会话归档");

    fireEvent.click(await screen.findByRole("button", { name: "打开归档会话：已经归档的研究会话" }));

    await waitFor(() => expect(onOpenSession).toHaveBeenCalled());
  });
});
