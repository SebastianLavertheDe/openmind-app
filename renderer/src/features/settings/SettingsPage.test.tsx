import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSession, AiSnapshot, DesktopApi, McpServerDefinition, ProviderCapabilities, SkillDefinition, UserPreferences } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { SettingsPage } from "./SettingsPage";

const providers: ProviderCapabilities[] = [
  { id: "codex-preview", provider: "codex", label: "Codex CLI", runtime: "native", available: true, version: "1.0", supportsApprovals: true, supportsResume: true, supportsImages: false, diagnostic: null, detectedModel: null, contextWindow: null, oneMillion: false },
  { id: "claude-preview", provider: "claude", label: "Claude Code", runtime: "native", available: true, version: "1.0", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: "glm-5.2[1m]", contextWindow: 1_000_000, oneMillion: true }
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
    outputArtifacts: ["mymind/article/**/*.md"],
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
  id: "cctools_browser",
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
    inputs: ["url", "quote", "caption", "filename"],
    outputs: ["PNG", "JSON 元数据", "Markdown 图片引用"]
  }]
}];

const defaultPrefs: UserPreferences = {
  schemaVersion: 1, repoRoot: "/repo", themeMode: "light", accentColor: "#2563eb",
  density: "default", fontSize: "default", autoSaveIntervalMs: 30000, maxVersions: 50,
  archiveAfterDays: 90, defaultReadFilter: "all", contentPreviewMode: "sidebar",
  markReadOnOpen: true, defaultProvider: "", providerModels: { codex: "auto", claude: "auto" },
  defaultPermissionProfile: "edit",
  defaultWorkDir: "", notesDir: "mymind", browserAutomationEnabled: false,
  browserReuseExistingTabs: true, browserEvidenceDir: ".cctools/browser-evidence", destructiveOpsRequireApproval: true,
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
    getBrowserAutomationStatus: async () => ({
      backend: "playwright-mcp", enabled: false, reuseExistingTabs: true,
      evidenceDir: ".cctools/browser-evidence", extensionTokenConfigured: false,
      secureStorageAvailable: true, packageAvailable: true, ready: false,
      diagnostic: "AI 写作取证已关闭。"
    }),
    getMcpServers: async () => mcpServers,
    selectRepo: async () => "/repo-next",
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
  window.cctools = makeApi();
});

afterEach(() => cleanup());

describe("SettingsPage", () => {
  it("shows categorized navigation and renders only the active category details", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByRole("heading", { name: "常规" })).toBeTruthy());
    const navigation = screen.getByRole("navigation", { name: "设置分类" });
    expect(screen.getByRole("searchbox", { name: "搜索设置…" })).toBeTruthy();
    expect(within(navigation).getByRole("button", { name: "常规" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "项目路径" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Provider" })).toBeNull();

    openCategory("AI 与模型");
    expect(screen.getByRole("heading", { name: "AI 与模型" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Provider" })).toBeTruthy();
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

  it("lists searchable Skill and MCP details without exposing permission profiles", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const openPath = vi.fn().mockResolvedValue("");
    const aiRefreshSkills = vi.fn().mockResolvedValue(skills);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    window.cctools = makeApi({ openPath, aiRefreshSkills });
    renderSettings(vi.fn(), snapshot, vi.fn(), vi.fn(), skills);
    await screen.findByRole("heading", { name: "常规" });

    openCategory("Skills 与 MCP");

    expect(await screen.findByText("2 Skills · 1 MCP 服务")).toBeTruthy();
    expect(screen.getByText("RSS 文章保存")).toBeTruthy();
    expect(screen.getByText("/rss-article-saver")).toBeTruthy();
    expect(screen.getByText("小说写作")).toBeTruthy();
    expect(screen.queryByText("只读")).toBeNull();
    expect(screen.queryByText("编辑")).toBeNull();
    expect(screen.queryByText("自动执行")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "小说" } });
    expect(screen.getByText("小说写作")).toBeTruthy();
    expect(screen.queryByText("RSS 文章保存")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /Skill 分组/ }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Skill 分组" })).getByRole("option", { name: "内容获取" }));
    expect(screen.getByText("RSS 文章保存")).toBeTruthy();
    expect(screen.queryByText("小说写作")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "查看 Skill 详情：RSS 文章保存" }));
    expect(screen.getByText("/repo/.claude/skills/rss-article-saver")).toBeTruthy();
    expect(screen.getByText("uv run --env-file .env python main.py")).toBeTruthy();
    expect(screen.getByText("2 分钟")).toBeTruthy();
    expect(screen.getByText("mymind/article/**/*.md")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "复制 Skill 调用命令：/rss-article-saver" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/rss-article-saver"));
    fireEvent.click(screen.getByRole("button", { name: "打开 Skill 目录：RSS 文章保存" }));
    await waitFor(() => expect(openPath).toHaveBeenCalledWith("/repo/.claude/skills/rss-article-saver"));
    fireEvent.click(screen.getByRole("button", { name: "刷新能力" }));
    await waitFor(() => expect(aiRefreshSkills).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("tab", { name: /MCP/ }));
    expect(screen.getByText("写作证据截图")).toBeTruthy();
    expect(screen.getByText("cctools_browser")).toBeTruthy();
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
      evidenceDir: ".cctools/browser-evidence", extensionTokenConfigured: false,
      secureStorageAvailable: true, packageAvailable: true, ready: false,
      diagnostic: "AI 写作取证已关闭。"
    });
    const saveBrowserExtensionToken = vi.fn().mockResolvedValue({
      backend: "playwright-mcp", enabled: true, reuseExistingTabs: true,
      evidenceDir: ".cctools/browser-evidence", extensionTokenConfigured: true,
      secureStorageAvailable: true, packageAvailable: true, ready: true,
      diagnostic: "已准备好复用 Chrome 登录状态和扩展授权的标签页。"
    });
    window.cctools = makeApi({ updatePreferences, getBrowserAutomationStatus, saveBrowserExtensionToken });
    renderSettings();
    await screen.findByRole("heading", { name: "常规" });

    openCategory("浏览器");
    expect(screen.getByRole("heading", { name: "写作证据截图" })).toBeTruthy();
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

    const browseButtons = screen.getAllByRole("button", { name: "浏览" });
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
    expect(document.querySelector<HTMLTimeElement>(".settings-archived-item time")?.dateTime).toBe(archivedSession.createdAt);

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
