import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, ProviderCapabilities, UserPreferences } from "@shared/contracts";
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

const snapshot = { projectRoot: "/repo", providers, sessions: [], runs: [], pendingApprovals: [] };

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    getPreferences: async () => defaultPrefs,
    updatePreferences: async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }),
    resetPreferences: async () => defaultPrefs,
    selectRepo: async () => "/repo-next",
    openPath: async () => "",
    onAiEvent: () => () => undefined,
    aiRefresh: async () => snapshot,
    ...overrides
  } as unknown as DesktopApi;
}

function renderSettings(onRepo = vi.fn()) {
  render(<AiProvider initial={snapshot}><SettingsPage repoRoot="/repo" runtime="linux" providers={providers} onRepo={onRepo} /><FeedbackHost /></AiProvider>);
}

beforeEach(() => {
  window.cctools = makeApi();
});

afterEach(() => cleanup());

describe("SettingsPage", () => {
  it("shows the four settings panels from the design mockup", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByRole("heading", { name: "偏好与连接" })).toBeTruthy());
    expect(screen.getByRole("heading", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Provider" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "权限与审批" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "项目路径" })).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("Claude Code")).toBeTruthy());

    fireEvent.click(screen.getByRole("switch", { name: "将 Claude Code 设为默认" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ defaultProvider: "claude-preview", accentColor: "#2563eb" })));
    expect(screen.getAllByText("可用").length).toBe(2);
  });

  it("saves permission defaults and approval toggles", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.cctools = makeApi({ updatePreferences });
    renderSettings();
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

  it("shows a model selector per provider and marks the detected 1M model", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText("Claude Code 模型")).toBeTruthy());
    // 两个 provider 各有一个模型下拉。
    expect(screen.getByLabelText("Codex CLI 模型")).toBeTruthy();
    // 探测到的 Claude 模型 glm-5.2[1m] 命中 1M，徽标出现。
    expect(screen.getByText("1M")).toBeTruthy();
    // auto 时回落展示探测到的 CLI 模型。
    expect(screen.getByText(/CLI: glm-5\.2\[1m\]/)).toBeTruthy();
  });

  it("saves the selected model as a providerModels override", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.cctools = makeApi({ updatePreferences });
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText("Claude Code 模型")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Claude Code 模型"), { target: { value: "claude-opus-4-8" } });

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({
      providerModels: { codex: "auto", claude: "claude-opus-4-8" },
      accentColor: "#2563eb"
    })));
  });

  it("previews and persists workflow rules", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.cctools = makeApi({ updatePreferences });
    renderSettings();
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
    expect(await screen.findByText(/暂不自动清理文件或历史/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("日志保留天数"), { target: { value: "60" } });
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ logRetentionDays: 60 })));
  });

  it("resets only the workflow preference group after confirmation", async () => {
    const resetPreferences = vi.fn(async () => defaultPrefs);
    window.cctools = makeApi({ resetPreferences });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "恢复默认值" }));
    const dialog = await screen.findByRole("alertdialog", { name: "恢复默认值" });
    fireEvent.click(within(dialog).getByRole("button", { name: "恢复默认值" }));
    await waitFor(() => expect(resetPreferences).toHaveBeenCalledWith("workflow"));
  });
});
