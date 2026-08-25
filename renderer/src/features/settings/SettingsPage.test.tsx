import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSession, AiSnapshot, DesktopApi, McpServerDefinition, ProviderCapabilities, SkillDefinition, UserPreferences } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { SettingsPage } from "./SettingsPage";

const providers: ProviderCapabilities[] = [
  { id: "codex-preview", provider: "codex", label: "Codex CLI", runtime: "native", available: true, version: "1.0", supportsApprovals: true, supportsResume: true, supportsImages: false, diagnostic: null, detectedModel: null, contextWindow: null, installable: false, oneMillion: false },
  { id: "claude-preview", provider: "claude", label: "Claude Code", runtime: "native", available: true, version: "1.0", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: "glm-5.2[1m]", contextWindow: 1_000_000, installable: false, oneMillion: true }
];

const skills: SkillDefinition[] = [
  {
    id: "rss-article-saver",
    title: "RSS 文章保存",
    description: "抓取订阅文章并保存为 Markdown。",
    cwd: "/repo/.claude/skills/rss-article-saver",
    command: "uv run --env-file .env python main.py",
    envFile: ".env",
    group: "内容获取",
    permission: "auto",
    outputArtifacts: ["openmind/article/**/*.md"],
    timeoutMs: 120_000
  },
  {
    id: "novel-writer",
    title: "小说写作",
    description: "辅助规划并撰写中文小说。",
    cwd: "/repo/.claude/skills/novel-writer",
    command: "python main.py",
    group: "创作",
    permission: "edit"
  }
];

const mcpServers: McpServerDefinition[] = [{
  id: "openmind_browser",
  title: "写作证据截图",
  description: "写作时按需打开来源链接，定位原文并生成可引用的证据截图。",
  backend: "Microsoft Playwright MCP",
  transport: "stdio",
  connection: "Playwright Chrome 扩展",
  enabled: false,
  available: true,
  status: "disabled",
  diagnostic: "AI 写作取证已关闭。",
  providers: ["Codex", "Claude"],
  settingsSection: "browser",
  tools: [{
    id: "capture_source_evidence",
    title: "截取原文证据",
    description: "复用 URL 完全匹配的 Chrome 标签页，定位引文、截图并恢复浏览器现场。",
    inputs: ["url", "quote", "capture_scope", "caption", "filename"],
    outputs: ["PNG", "JSON 元数据", "Markdown 图片引用"]
  }]
}];

const defaultPrefs: UserPreferences = {
  schemaVersion: 1, openmindRoot: "/repo", workspaceRoot: "/repo", themeMode: "light",
  density: "default", fontSize: "default", autoSaveIntervalMs: 30000, maxVersions: 50,
  archiveAfterDays: 90, defaultReadFilter: "all", contentPreviewMode: "sidebar",
  markReadOnOpen: true, defaultProvider: "",
  defaultPermissionProfile: "edit",
  notesDir: "openmind", browserAutomationEnabled: false,
  browserReuseExistingTabs: true, browserEvidenceDir: "assets/browser-evidence", destructiveOpsRequireApproval: true,
  riskScanEnabled: true, defaultPlatform: "公众号", defaultLanguage: "zh-CN",
  defaultContentLength: "medium", defaultTemplate: "", userTags: ["AI", "工程"],
  workflowAutoSaveDraft: true, workflowAutoVersionOnStageChange: true,
  workflowReviewRequiredForReady: true, workflowPublishChecklistEnabled: true,
  workflowAutoArchiveEnabled: false
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
    getBrowserAutomationStatus: async () => ({
      backend: "playwright-mcp", enabled: false, reuseExistingTabs: true,
      evidenceDir: "assets/browser-evidence", extensionTokenConfigured: false,
      secureStorageAvailable: true, packageAvailable: true, ready: false,
      diagnostic: "AI 写作取证已关闭。"
    }),
    getMcpServers: async () => mcpServers,
    getSharedPythonRuntimeStatus: async () => ({ enabled: false, phase: "disabled", target: "linux-x64", pythonVersion: null, uvVersion: null, managedSkills: 0, ready: false, lastError: null }),
    setSharedPythonRuntimeEnabled: async (enabled: boolean) => ({ enabled, phase: enabled ? "ready" : "disabled", target: "linux-x64", pythonVersion: enabled ? "3.12.8" : null, uvVersion: enabled ? "0.5.27" : null, managedSkills: enabled ? 2 : 0, ready: enabled, lastError: null }),
    setOpenmindRoot: async (root: string) => root,
    selectOpenmindRoot: async () => "/repo-next",
    previewOpenmindRoot: async (candidate: string) => ({ candidate, canonicalRoot: candidate, health: { configured: true, accessible: true, readable: true, writable: true, missingInitializeEntries: [], missingCreateIfNeededEntries: [], optionalObservedEntries: [], unknownPreservedEntries: [], symlinkWarnings: [], activeRunCount: 0, warnings: [] }, canBind: true, blockingReasons: [] }),
    openPath: async () => "",
    onAiEvent: () => () => undefined,
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    ...overrides
  } as unknown as DesktopApi;
}

function renderSettings(onRepo = vi.fn(), initial = snapshot, onOpenSession = vi.fn(), onBack = vi.fn(), skillDefinitions: SkillDefinition[] = []) {
  render(<AiProvider initial={initial} skills={skillDefinitions}><SettingsPage repoRoot="/repo" providers={providers} onRepo={onRepo} onBack={onBack} onOpenSession={onOpenSession} /><FeedbackHost /></AiProvider>);
}

function openCategory(name: string) {
  const navigation = screen.getByRole("navigation", { name: "设置分类" });
  fireEvent.click(within(navigation).getByRole("button", { name }));
}

beforeEach(() => {
  window.openmind = makeApi();
});

afterEach(() => cleanup());

describe("SettingsPage", () => {
  it("shows categorized navigation and renders only the active category details", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByRole("heading", { name: "常规" })).toBeTruthy());
    const navigation = screen.getByRole("navigation", { name: "设置分类" });
    expect(screen.getByRole("searchbox", { name: "搜索设置…" })).toBeTruthy();
    expect(within(navigation).getByRole("button", { name: "常规" }).getAttribute("aria-current")).toBe("page");
    expect(document.querySelector(".settings-page")?.getAttribute("data-settings-section")).toBe("general");
    expect(screen.getByRole("heading", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "项目路径" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "模型提供方" })).toBeNull();

    openCategory("AI 与模型");
    expect(screen.getByRole("heading", { name: "AI 与模型" })).toBeTruthy();
    expect(document.querySelector(".settings-page")?.getAttribute("data-settings-section")).toBe("providers");
    expect(screen.getByRole("heading", { name: "模型提供方" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "外观" })).toBeNull();
  });

  it("returns to the application from the dedicated settings sidebar", async () => {
    const onBack = vi.fn();
    renderSettings(vi.fn(), snapshot, vi.fn(), onBack);
    fireEvent.click(await screen.findByRole("button", { name: "返回应用" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("filters setting categories from the sidebar search", async () => {
    renderSettings();
    const search = await screen.findByRole("searchbox", { name: "搜索设置…" });
    fireEvent.change(search, { target: { value: "权限" } });
    const navigation = screen.getByRole("navigation", { name: "设置分类" });
    expect(within(navigation).getByRole("button", { name: "权限与安全" })).toBeTruthy();
    expect(within(navigation).queryByRole("button", { name: "常规" })).toBeNull();
  });

  it("clears pointer focus after choosing a settings category but preserves keyboard focus", async () => {
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    const navigation = screen.getByRole("navigation", { name: "设置分类" });
    const browserTab = within(navigation).getByRole("button", { name: "浏览器" });
    browserTab.focus();
    expect(document.activeElement).toBe(browserTab);
    fireEvent.click(browserTab, { detail: 1 });
    expect(document.activeElement).not.toBe(browserTab);

    const permissionsTab = within(navigation).getByRole("button", { name: "权限与安全" });
    permissionsTab.focus();
    fireEvent.click(permissionsTab, { detail: 0 });
    expect(document.activeElement).toBe(permissionsTab);
  });

  it("offers one-click install for an uninstalled native CLI provider", async () => {
    const unavailable: ProviderCapabilities[] = [{
      id: "claude-native", provider: "claude", label: "Claude Code（本机）", runtime: "native",
      available: false, version: null, supportsApprovals: true, supportsResume: true, supportsImages: true,
      diagnostic: "Claude Code 未安装在 Windows PATH 中。", detectedModel: null, contextWindow: null,
      installable: true, oneMillion: false
    }];
    const installCliTool = vi.fn().mockResolvedValue({ cli: "claude", installed: true, version: "v1.2.3", digest: "d".repeat(64), sourceUrl: "https://github.com", installedAt: "2026-08-14T00:00:00Z", executablePath: "/tools/bin/claude" });
    const aiRefreshProviders = vi.fn().mockResolvedValue(undefined);
    window.openmind = makeApi({ installCliTool, aiRefreshProviders });
    render(
      <AiProvider initial={{ ...snapshot, providers: unavailable }} skills={[]}>
        <SettingsPage repoRoot="/repo" providers={unavailable} onRepo={vi.fn()} onBack={vi.fn()} onOpenSession={vi.fn()} />
        <FeedbackHost />
      </AiProvider>
    );
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");

    const installButton = await screen.findByRole("button", { name: "一键安装" });
    expect(screen.queryByText("安装到应用私有目录，不影响系统环境。")).toBeNull();
    expect(screen.queryByText("不可用")).toBeNull();
    fireEvent.click(installButton);
    await waitFor(() => expect(installCliTool).toHaveBeenCalledWith("claude"));
    await waitFor(() => expect(aiRefreshProviders).toHaveBeenCalled());
  });

  it("shows progress and cancel controls for native CLI installation", async () => {
    const unavailable: ProviderCapabilities[] = [{
      id: "codex-native", provider: "codex", label: "Codex CLI（本机）", runtime: "native",
      available: false, version: null, supportsApprovals: true, supportsResume: true, supportsImages: true,
      diagnostic: "Codex 未安装。", detectedModel: null, contextWindow: null, installable: true, oneMillion: false
    }];
    let progressListener: ((progress: { cli: "codex"; phase: "downloading"; receivedBytes: number; totalBytes: number; message: string }) => void) | undefined;
    const installCliTool = vi.fn(() => new Promise<never>(() => undefined));
    const cancelCliToolInstall = vi.fn().mockResolvedValue(true);
    window.openmind = makeApi({
      installCliTool,
      cancelCliToolInstall,
      onCliInstallProgress: (callback) => { progressListener = callback as typeof progressListener; return () => undefined; }
    });
    render(
      <AiProvider initial={{ ...snapshot, providers: unavailable }} skills={[]}>
        <SettingsPage repoRoot="/repo" providers={unavailable} onRepo={vi.fn()} onBack={vi.fn()} onOpenSession={vi.fn()} />
        <FeedbackHost />
      </AiProvider>
    );
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");
    fireEvent.click(await screen.findByRole("button", { name: "一键安装" }));
    await waitFor(() => expect(installCliTool).toHaveBeenCalledWith("codex"));
    progressListener?.({ cli: "codex", phase: "downloading", receivedBytes: 50, totalBytes: 100, message: "下载中" });
    expect(screen.getByRole("progressbar", { name: /Codex CLI.*安装进度/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消安装" }));
    await waitFor(() => expect(cancelCliToolInstall).toHaveBeenCalledWith("codex"));
    expect(screen.getByRole("button", { name: "一键安装" })).toBeTruthy();
    expect(screen.queryByText("查看手动安装步骤")).toBeNull();
  });

  it("shows retry after a native CLI install failure", async () => {
    const unavailable: ProviderCapabilities[] = [{
      id: "claude-native", provider: "claude", label: "Claude Code（本机）", runtime: "native",
      available: false, version: null, supportsApprovals: true, supportsResume: true, supportsImages: true,
      diagnostic: "Claude Code 未安装。", detectedModel: null, contextWindow: null, installable: true, oneMillion: false
    }];
    const installCliTool = vi.fn()
      .mockRejectedValueOnce(new Error("网络失败"))
      .mockResolvedValueOnce({ cli: "claude", installed: true, version: "2.1.0", digest: "d".repeat(64), sourceUrl: "https://claude.ai/install.sh", installedAt: "2026-08-14T00:00:00Z", executablePath: "/tools/bin/claude" });
    window.openmind = makeApi({ installCliTool, aiRefreshProviders: vi.fn().mockResolvedValue(undefined) });
    render(
      <AiProvider initial={{ ...snapshot, providers: unavailable }} skills={[]}>
        <SettingsPage repoRoot="/repo" providers={unavailable} onRepo={vi.fn()} onBack={vi.fn()} onOpenSession={vi.fn()} />
        <FeedbackHost />
      </AiProvider>
    );
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");
    fireEvent.click(await screen.findByRole("button", { name: "一键安装" }));
    expect(await screen.findByText(/一键安装失败：网络失败/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试安装" }));
    await waitFor(() => expect(installCliTool).toHaveBeenCalledTimes(2));
  });

  it("checks an installed CLI version and refreshes it after upgrade", async () => {
    const checkCliToolUpdate = vi.fn()
      .mockResolvedValueOnce({ cli: "codex", installed: true, currentVersion: "1.0.0", latestVersion: "1.1.0", updateAvailable: true, canUpgrade: true, checkedAt: "2026-08-15T00:00:00Z", source: "npm" })
      .mockResolvedValueOnce({ cli: "codex", installed: true, currentVersion: "1.1.0", latestVersion: "1.1.0", updateAvailable: false, canUpgrade: true, checkedAt: "2026-08-15T00:01:00Z", source: "npm" });
    const upgradeCliTool = vi.fn().mockResolvedValue({ cli: "codex", installed: true, version: "1.1.0", digest: "d".repeat(64), sourceUrl: "https://registry.npmjs.org/@openai%2fcodex", installedAt: "2026-08-15T00:01:00Z", executablePath: "/tools/bin/codex" });
    window.openmind = makeApi({ checkCliToolUpdate, upgradeCliTool, aiRefreshProviders: vi.fn().mockResolvedValue(undefined) });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");

    fireEvent.click(screen.getAllByRole("button", { name: "检查更新" })[0]);
    await waitFor(() => expect(checkCliToolUpdate).toHaveBeenCalledWith("codex"));
    expect(await screen.findByRole("button", { name: "一键更新" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "一键更新" }));
    await waitFor(() => expect(upgradeCliTool).toHaveBeenCalledWith("codex"));
    await waitFor(() => expect(checkCliToolUpdate).toHaveBeenCalledTimes(2));
    expect(screen.getByText("已是最新")).toBeTruthy();
  });

  it("uses manual copy steps for an unavailable WSL provider", async () => {
    const unavailable: ProviderCapabilities[] = [{
      id: "codex-wsl", provider: "codex", label: "Codex CLI（WSL）", runtime: "wsl",
      available: false, version: null, supportsApprovals: true, supportsResume: true, supportsImages: true,
      diagnostic: "WSL 未安装。", detectedModel: null, contextWindow: null, installable: false, oneMillion: false
    }];
    render(
      <AiProvider initial={{ ...snapshot, providers: unavailable }} skills={[]}>
        <SettingsPage repoRoot="/repo" providers={unavailable} onRepo={vi.fn()} onBack={vi.fn()} onOpenSession={vi.fn()} />
        <FeedbackHost />
      </AiProvider>
    );
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");
    expect(screen.queryByRole("button", { name: "一键安装" })).toBeNull();
    fireEvent.click(screen.getByText("查看 WSL 手动安装步骤"));
    expect(screen.getByText("npm install -g @openai/codex")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "复制命令" })).toHaveLength(2);
  });

  it("manages the Provider list inside AI 与模型 without redundant navigation tabs", async () => {
    const providerView = {
      schemaVersion: 1 as const,
      default: "existing",
      providers: [{
        id: "existing", name: "现有 Provider", enabled: true, protocol: "openai-chat" as const,
        baseUrl: "https://api.example.com/v1", model: "example-model", apiKeySet: true,
        proxyUrl: "http://127.0.0.1:7890", proxyPolicy: "explicit" as const, tlsPolicy: "verify" as const
      }]
    };
    const getProviders = vi.fn().mockResolvedValue(providerView);
    const saveProviders = vi.fn().mockResolvedValue(providerView);
    window.openmind = makeApi({ getProviders, saveProviders });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");

    await waitFor(() => expect(getProviders).toHaveBeenCalled());
    const navigation = screen.getByRole("navigation", { name: "设置分类" });
    expect(within(navigation).queryByRole("button", { name: "AI Provider 配置" })).toBeNull();
    expect(within(navigation).queryByRole("button", { name: "Provider 列表" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Provider 列表" })).toBeTruthy();
    expect(screen.queryByLabelText("代理策略")).toBeNull();
    expect(screen.queryByText("TLS")).toBeNull();
    expect(screen.queryByText("代理 URL（可选）")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Claude Code 服务商" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Codex CLI 服务商" })).toBeNull();
    expect(screen.getByRole("button", { name: "添加 Provider" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "添加 Provider" }));
    const dialog = await screen.findByRole("dialog", { name: "添加 Provider" });
    expect(within(dialog).getByLabelText("Provider 预设")).toBeTruthy();
    expect(within(dialog).getByLabelText("API Key")).toBeTruthy();
    expect(within(dialog).queryByText("代理策略")).toBeNull();
    expect(within(dialog).queryByText("TLS")).toBeNull();

    fireEvent.change(within(dialog).getByLabelText("API Key"), { target: { value: "sk-new-provider" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加到列表" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加 Provider" })).toBeNull());
    await waitFor(() => expect(saveProviders).toHaveBeenCalled());
    expect(saveProviders).toHaveBeenCalledWith(expect.objectContaining({
      cli: { claude: null, codex: null },
      providers: expect.arrayContaining([
        expect.objectContaining({ id: "existing", authMode: "bearer", proxyUrl: "http://127.0.0.1:7890", proxyPolicy: "explicit", tlsPolicy: "verify" }),
        expect.objectContaining({ id: "deepseek", apiKey: "sk-new-provider", proxyUrl: "", proxyPolicy: "system", tlsPolicy: "verify" })
      ])
    }));
    expect(screen.queryByText("尚无未保存修改")).toBeNull();
    expect(screen.queryByRole("button", { name: "放弃修改" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保存配置" })).toBeNull();
  });

  it("keeps CLI binding controls out of the compact Provider list", async () => {
    const providerView = {
      schemaVersion: 1 as const,
      default: "general-chat",
      cli: { claude: "claude-a", codex: "codex-a" },
      providers: [{
        id: "general-chat", name: "通用 Chat", enabled: true, protocol: "openai-chat" as const,
        authMode: "bearer" as const, baseUrl: "https://general-chat.example.com/v1", model: "chat-model", apiKeySet: true,
        proxyUrl: "", proxyPolicy: "system" as const, tlsPolicy: "verify" as const
      }]
    };
    window.openmind = makeApi({ getProviders: vi.fn().mockResolvedValue(providerView) });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");

    await waitFor(() => expect(window.openmind.getProviders).toHaveBeenCalled());
    expect(screen.queryByRole("combobox", { name: "Claude Code 服务商" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Codex CLI 服务商" })).toBeNull();
    expect(screen.queryByText("使用 Claude Code 自身配置")).toBeNull();
    expect(screen.queryByText("使用 Codex CLI 自身配置")).toBeNull();
    expect(screen.getByRole("button", { name: "添加 Provider" })).toBeTruthy();
  });

  it("opens Provider configuration in a dialog, cancels local edits, and saves from the dialog", async () => {
    const providerEntry = (id: string, name: string, model: string) => ({
      id, name, enabled: true, protocol: "openai-chat" as const, authMode: "bearer" as const,
      baseUrl: "https://" + id + ".example.com/v1", model, apiKeySet: true,
      proxyUrl: "", proxyPolicy: "system" as const, tlsPolicy: "verify" as const
    });
    const providerView = {
      schemaVersion: 1 as const,
      default: "first",
      cli: { claude: null, codex: null },
      providers: [
        providerEntry("first", "第一 Provider", "first-model"),
        providerEntry("second", "第二 Provider", "second-model")
      ]
    };
    const saveProviders = vi.fn().mockResolvedValue(providerView);
    window.openmind = makeApi({ getProviders: vi.fn().mockResolvedValue(providerView), saveProviders });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");

    const first = await screen.findByRole("button", { name: "编辑 第一 Provider 配置" });
    expect(first.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByDisplayValue("first-model")).toBeNull();
    expect(screen.queryByDisplayValue("second-model")).toBeNull();

    fireEvent.click(first);
    const firstDialog = await screen.findByRole("dialog", { name: "编辑 第一 Provider" });
    expect(within(firstDialog).getByDisplayValue("first-model")).toBeTruthy();
    expect(within(firstDialog).getByLabelText("API Key")).toBeTruthy();
    fireEvent.change(within(firstDialog).getByDisplayValue("first-model"), { target: { value: "changed-model" } });
    fireEvent.click(within(firstDialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑 第一 Provider" })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "编辑 第一 Provider 配置" }));
    const reopenedFirst = await screen.findByRole("dialog", { name: "编辑 第一 Provider" });
    expect(within(reopenedFirst).getByDisplayValue("first-model")).toBeTruthy();
    fireEvent.click(within(reopenedFirst).getByRole("button", { name: /高级设置/ }));
    expect(within(reopenedFirst).getByDisplayValue("first")).toBeTruthy();
    fireEvent.change(within(reopenedFirst).getByDisplayValue("first-model"), { target: { value: "saved-model" } });
    fireEvent.click(within(reopenedFirst).getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(saveProviders).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.arrayContaining([expect.objectContaining({ id: "first", model: "saved-model" })])
    })));
    expect(screen.queryByText("尚无未保存修改")).toBeNull();
    expect(screen.queryByRole("button", { name: "放弃修改" })).toBeNull();
  });

  it("saves a Provider removal immediately", async () => {
    const providerEntry = (id: string, name: string, model: string) => ({
      id, name, enabled: true, protocol: "openai-chat" as const, authMode: "bearer" as const,
      baseUrl: "https://" + id + ".example.com/v1", model, apiKeySet: true,
      proxyUrl: "", proxyPolicy: "system" as const, tlsPolicy: "verify" as const
    });
    const providerView = {
      schemaVersion: 1 as const,
      default: "keep",
      cli: { claude: null, codex: null },
      providers: [
        providerEntry("keep", "保留 Provider", "model-before"),
        providerEntry("remove", "删除 Provider", "remove-model")
      ]
    };
    const getProviders = vi.fn().mockResolvedValue(providerView);
    const saveProviders = vi.fn().mockResolvedValue(providerView);
    window.openmind = makeApi({ getProviders, saveProviders });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");

    fireEvent.click(await screen.findByRole("button", { name: "更多 remove" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除 remove" }));

    expect(screen.queryByText("删除 Provider")).toBeNull();
    await waitFor(() => expect(saveProviders).toHaveBeenCalled());
    expect(saveProviders).toHaveBeenCalledWith(expect.objectContaining({
      default: "keep",
      providers: [expect.objectContaining({ id: "keep", model: "model-before", apiKey: "" })]
    }));
  });

  it("does not delete the only enabled default Provider", async () => {
    const providerView = {
      schemaVersion: 1 as const,
      default: "enabled",
      cli: { claude: null, codex: null },
      providers: [
        {
          id: "enabled", name: "启用项", enabled: true, protocol: "openai-chat" as const, authMode: "bearer" as const,
          baseUrl: "https://enabled.example.com/v1", model: "enabled-model", apiKeySet: true,
          proxyUrl: "", proxyPolicy: "system" as const, tlsPolicy: "verify" as const
        },
        {
          id: "disabled", name: "停用项", enabled: false, protocol: "openai-chat" as const, authMode: "bearer" as const,
          baseUrl: "https://disabled.example.com/v1", model: "disabled-model", apiKeySet: true,
          proxyUrl: "", proxyPolicy: "system" as const, tlsPolicy: "verify" as const
        }
      ]
    };
    window.openmind = makeApi({ getProviders: vi.fn().mockResolvedValue(providerView) });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");

    fireEvent.click(await screen.findByRole("button", { name: "更多 enabled" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除 enabled" }));

    expect(await screen.findByText("请先启用另一个 Provider，再删除当前默认 Provider")).toBeTruthy();
    expect(screen.getByText("启用项")).toBeTruthy();
    expect(screen.getByText("停用项")).toBeTruthy();
  });

  it("shows a recoverable error when preferences fail to load", async () => {
    const getPreferences = vi.fn()
      .mockRejectedValueOnce(new Error("preferences unavailable"))
      .mockResolvedValue(defaultPrefs);
    window.openmind = makeApi({ getPreferences });
    renderSettings();

    expect((await screen.findByRole("alert")).textContent).toContain("设置加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByRole("heading", { name: "外观" })).toBeTruthy();
    expect(getPreferences).toHaveBeenCalledTimes(2);
  });

  it("saves theme, density, and body font size preferences", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.openmind = makeApi({ updatePreferences });
    renderSettings();
    await waitFor(() => expect(screen.getByRole("button", { name: "深色" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "深色" }));
    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    fireEvent.click(screen.getByRole("button", { name: "大" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ themeMode: "dark" })));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ density: "compact" })));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ fontSize: "large" })));
  });

  it("switches the default provider without changing the screen structure", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.openmind = makeApi({ updatePreferences });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");
    await waitFor(() => expect(screen.getByText("Claude Code")).toBeTruthy());

    fireEvent.click(screen.getByRole("radio", { name: "将 Claude Code 设为默认" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ defaultProvider: "claude-preview" })));
    expect(screen.getAllByText("可用").length).toBe(2);
  });

  it("installs and exposes one shared uv-managed Python runtime", async () => {
    const ready = { enabled: true, phase: "ready" as const, target: "linux-x64" as const, pythonVersion: "3.12.10", uvVersion: "0.5.27", managedSkills: 2, ready: true, lastError: null };
    const setSharedPythonRuntimeEnabled = vi.fn().mockResolvedValue(ready);
    window.openmind = makeApi({ setSharedPythonRuntimeEnabled });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("内置运行时");

    const toggle = await screen.findByRole("switch", { name: "启用内置 Python 运行时" });
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(setSharedPythonRuntimeEnabled).toHaveBeenCalledWith(true));
    expect(await screen.findByText("Python 3.12.10")).toBeTruthy();
    expect(screen.getByText(/uv 0.5.27/)).toBeTruthy();
    expect(screen.getByText(/2 个 Skill/)).toBeTruthy();
  });

  it("keeps MCP searchable without exposing permission profiles", async () => {
    window.openmind = makeApi();
    renderSettings(vi.fn(), snapshot, vi.fn(), vi.fn(), skills);
    await screen.findByRole("heading", { name: "常规" });

    openCategory("MCP 服务");
    expect(screen.getByText("写作证据截图")).toBeTruthy();
    expect(screen.getByText("openmind_browser")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /写作证据截图/ }));
    expect(screen.getByText("Microsoft Playwright MCP")).toBeTruthy();
    expect(screen.getByText("capture_source_evidence")).toBeTruthy();
    expect(screen.getByText("PNG · JSON 元数据 · Markdown 图片引用")).toBeTruthy();
    expect(screen.queryByText("browser_run_code_unsafe")).toBeNull();
    expect(screen.queryByText("只读")).toBeNull();
    expect(screen.queryByText("编辑")).toBeNull();
    expect(screen.queryByText("自动执行")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 MCP 服务和工具" }), { target: { value: "capture_source" } });
    expect(screen.getByText("截取原文证据")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前往浏览器设置" }));
    expect(screen.getByRole("heading", { name: "浏览器" })).toBeTruthy();
  });

  it("configures the controlled Chrome evidence workflow without exposing raw browser tools", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    const getBrowserAutomationStatus = vi.fn().mockResolvedValue({
      backend: "playwright-mcp", enabled: false, reuseExistingTabs: true,
      evidenceDir: "assets/browser-evidence", extensionTokenConfigured: false,
      secureStorageAvailable: true, packageAvailable: true, ready: false,
      diagnostic: "AI 写作取证已关闭。"
    });
    const saveBrowserExtensionToken = vi.fn().mockResolvedValue({
      backend: "playwright-mcp", enabled: true, reuseExistingTabs: true,
      evidenceDir: "assets/browser-evidence", extensionTokenConfigured: true,
      secureStorageAvailable: true, packageAvailable: true, ready: true,
      diagnostic: "已准备好复用 Chrome 登录状态和扩展授权的标签页。"
    });
    window.openmind = makeApi({ updatePreferences, getBrowserAutomationStatus, saveBrowserExtensionToken });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });

    openCategory("浏览器");
    expect(screen.getByRole("heading", { name: "浏览器连接" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "证据与授权" })).toBeTruthy();
    expect(screen.getByText(/不能输入密码、提交表单/)).toBeTruthy();
    expect(screen.queryByText("browser_run_code_unsafe")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "允许 AI 自主获取原文截图" }));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ browserAutomationEnabled: true })));

    fireEvent.change(screen.getByLabelText("扩展令牌"), { target: { value: "secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "保存令牌" }));
    await waitFor(() => expect(saveBrowserExtensionToken).toHaveBeenCalledWith("secret-token"));
    expect(await screen.findByText("已安全保存")).toBeTruthy();
  });

  it("saves permission defaults and approval toggles", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.openmind = makeApi({ updatePreferences });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("权限与安全");
    await waitFor(() => expect(screen.getByLabelText("新会话默认权限")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("新会话默认权限"), { target: { value: "read-only" } });
    fireEvent.click(screen.getByRole("switch", { name: "风险扫描" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ defaultPermissionProfile: "read-only" })));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ riskScanEnabled: false })));
  });

  it("keeps project path actions connected to the desktop API", async () => {
    const onRepo = vi.fn();
    const selectWorkspaceRoot = vi.fn().mockResolvedValue("/repo-next");
    const openPath = vi.fn().mockResolvedValue("");
    window.openmind = makeApi({ selectWorkspaceRoot, openPath });
    renderSettings(onRepo);
    await waitFor(() => expect(screen.getByText("工作目录")).toBeTruthy());

    const browseButtons = screen.getAllByRole("button", { name: "浏览" });
    fireEvent.click(browseButtons[0]);
    await waitFor(() => expect(selectWorkspaceRoot).toHaveBeenCalled());
    expect(onRepo).toHaveBeenCalledWith("/repo-next");

    fireEvent.click(browseButtons[1]);
    await waitFor(() => expect(openPath).toHaveBeenCalledWith("openmind"));
  });

  it("shows the model read from each CLI config without credential or profile forms", async () => {
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });
    openCategory("AI 与模型");
    await waitFor(() => expect(screen.getByLabelText("Claude Code 配置模型")).toBeTruthy());
    expect(screen.getByLabelText("Codex CLI 配置模型")).toBeTruthy();
    expect(screen.queryByText("安全凭据")).toBeNull();
    expect(screen.queryByText("Provider Profile")).toBeNull();
    expect(screen.queryByLabelText("凭据名称")).toBeNull();
    expect(screen.queryByLabelText("代理策略")).toBeNull();
    expect(screen.queryByLabelText("TLS 策略")).toBeNull();
    // 探测到的 Claude 模型 glm-5.2[1m] 命中 1M，徽标出现。
    expect(screen.getByText("1M")).toBeTruthy();
    expect(screen.getByLabelText("Claude Code 配置模型").textContent).toContain("glm-5.2[1m]");
    // 未配置模型时明确交还 Provider，而不是展示一份内置候选列表。
    expect(screen.getByText("配置未指定，运行时由 Provider 决定")).toBeTruthy();
  });

  it("previews and persists workflow rules", async () => {
    const updatePreferences = vi.fn().mockImplementation(async (patch: Partial<UserPreferences>) => ({ ...defaultPrefs, ...patch }));
    window.openmind = makeApi({ updatePreferences });
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

  it("resets only the workflow preference group after confirmation", async () => {
    const resetPreferences = vi.fn(async () => defaultPrefs);
    window.openmind = makeApi({ resetPreferences });
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
    window.openmind = makeApi({
      aiUpdateSession,
      aiRefresh: async () => ({ ...snapshot, sessions: [restored] })
    });
    renderSettings(vi.fn(), archivedSnapshot);
    await screen.findByRole("heading", { name: "常规" });
    openCategory("会话归档");

    expect(await screen.findByRole("heading", { name: "已归档会话" })).toBeTruthy();
    expect(screen.getByText("已经归档的研究会话")).toBeTruthy();
    expect(document.querySelector<HTMLTimeElement>(".settings-archived-item time")?.dateTime).toBe(archivedSession.createdAt);

    fireEvent.click(screen.getByRole("button", { name: "恢复归档会话：已经归档的研究会话" }));

    await waitFor(() => expect(aiUpdateSession).toHaveBeenCalledWith(archivedSession.id, { archived: false }));
    await waitFor(() => expect(screen.getByText("暂无已归档会话")).toBeTruthy());
  });

  it("opens an archived session from settings", async () => {
    const onOpenSession = vi.fn();
    window.openmind = makeApi();
    renderSettings(vi.fn(), archivedSnapshot, onOpenSession);
    await screen.findByRole("heading", { name: "常规" });
    openCategory("会话归档");

    fireEvent.click(await screen.findByRole("button", { name: "打开归档会话：已经归档的研究会话" }));

    await waitFor(() => expect(onOpenSession).toHaveBeenCalled());
  });
});
