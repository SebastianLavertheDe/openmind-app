const { contextBridge } = require("electron");

const now = "2026-06-17T02:20:00.000Z";
const date = "20260617";
const repoRoot = "/home/say/work/github/cctools";
const longPath = "mymind/article/20260617/very-long-title-with-English-and-中文混排-provider-unavailable-state-validation.md";
const approvalCommand = String.raw`powershell.exe -NoProfile -Command "Get-ChildItem -LiteralPath '\\wsl.localhost\Ubuntu\home\say\work\github\cctools\mymind\daily-summary\20260617_daily_summary.md' -Force | Select-Object FullName,Length,LastWriteTime; wsl.exe -d Ubuntu -- bash -lc 'test -f /home/say/work/github/cctools/mymind/post/20260617/posts.json && ls -la /home/say/work/github/cctools/mymind/post/20260617/posts.json'"`;
let visualMode = "normal";
let approvalResolved = false;

const providers = [
  { id: "codex:native", provider: "codex", label: "Codex · 本机", runtime: "native", available: true, version: "1.0.17", supportsApprovals: true, supportsResume: true, supportsImages: false, diagnostic: null },
  { id: "claude:wsl", provider: "claude", label: "Claude Code · WSL Ubuntu", runtime: "wsl", available: false, version: null, supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: "Claude Code 未登录。请在 WSL 终端运行 claude /login。" }
];

const contentState = { read: false, starred: true, score: 92, tags: ["AI", "长标题", "Provider"], lastViewedAt: null };
const contentItems = [
  {
    schemaVersion: 1,
    id: "content-long",
    path: longPath,
    name: "very-long-title-with-English-and-中文混排-provider-unavailable-state-validation.md",
    title: "一个用于视觉验收的超长标题：Agentic AI workflow, Provider unavailable diagnostics, Windows/WSL path boundaries 与中文混排不会挤压布局",
    kind: "article",
    source: "Local Visual Audit",
    author: "CC Tools",
    originalUrl: "https://example.com/visual-audit",
    publishedAt: "2026-06-17",
    capturedAt: now,
    modifiedAt: now,
    size: 14200,
    excerpt: "This mixed Chinese/English excerpt intentionally includes a long local path, Provider unavailable state, and dense technical text for responsive visual validation.",
    state: contentState
  },
  {
    schemaVersion: 1,
    id: "content-reddit",
    path: "mymind/reddit/20260617/OpenAI.md",
    name: "OpenAI.md",
    title: "Reddit 讨论：长会话、工具输出和审批体验",
    kind: "reddit",
    source: "Reddit",
    author: null,
    originalUrl: null,
    publishedAt: "2026-06-17",
    capturedAt: now,
    modifiedAt: now,
    size: 8200,
    excerpt: "多来源资料进入收集箱后，需要可以加入 AI 上下文并创建创作项目。",
    state: { read: true, starred: false, score: 76, tags: ["讨论"], lastViewedAt: now }
  },
  {
    schemaVersion: 1,
    id: "content-summary",
    path: "mymind/daily-summary/20260617_daily_summary.md",
    name: "20260617_daily_summary.md",
    title: "20260617 每日总结",
    kind: "summary",
    source: "Daily Summary",
    author: null,
    originalUrl: null,
    publishedAt: "2026-06-17",
    capturedAt: now,
    modifiedAt: now,
    size: 6400,
    excerpt: "核心信号、推荐主题、关注列表和后续行动建议。",
    state: { read: false, starred: false, score: 88, tags: ["summary"], lastViewedAt: null }
  }
];

const briefTopics = [
  { id: "topic-1", title: "本地 AI 工作台的真实 Provider E2E 验收", summary: "围绕 Provider 登录、工具调用、审批和取消运行形成完整验收路径。", score: 94, sourceCount: 5, contentIds: ["content-long", "content-reddit"] },
  { id: "topic-2", title: "视觉矩阵：长标题、空状态、错误状态和深色界面", summary: "把 40 张参考图对应到可复现截图矩阵和状态矩阵。", score: 89, sourceCount: 4, contentIds: ["content-summary"] }
];

const sources = [
  { schemaVersion: 1, id: "rss-main", name: "AI Newsletter With A Very Long Source Name", kind: "rss", url: "https://example.com/feed.xml", skillId: "rss-article-saver", enabled: true, frequency: "每日流水线", lastRunAt: now, lastSuccessAt: now, successRate: 100, status: "success", recentError: null, itemCount: 18 },
  { schemaVersion: 1, id: "x-following", name: "X 关注动态", kind: "x", url: null, skillId: "x-following-fetcher", enabled: true, frequency: "每日流水线", lastRunAt: now, lastSuccessAt: null, successRate: 67, status: "warning", recentError: "最近一次运行未发现新增内容。", itemCount: 0 },
  { schemaVersion: 1, id: "reddit", name: "Reddit 订阅", kind: "reddit", url: null, skillId: "reddit-fetcher", enabled: false, frequency: "每日流水线", lastRunAt: now, lastSuccessAt: null, successRate: 50, status: "disabled", recentError: "已暂停。", itemCount: 12 }
];

const sourceRuns = [
  { schemaVersion: 1, id: "run-success", sourceId: "rss-main", skillId: "rss-article-saver", status: "success", startedAt: "2026-06-17T01:00:00.000Z", completedAt: "2026-06-17T01:00:12.000Z", durationMs: 12000, code: 0, error: null, itemCount: 18, logs: [{ timestamp: now, stream: "stdout", text: "Fetched 18 items\n" }] },
  { schemaVersion: 1, id: "run-failed", sourceId: "x-following", skillId: "x-following-fetcher", status: "failed", startedAt: "2026-06-17T01:10:00.000Z", completedAt: "2026-06-17T01:10:05.000Z", durationMs: 5000, code: 1, error: "Token expired", itemCount: 0, logs: [{ timestamp: now, stream: "stderr", text: "Token expired. Please refresh credentials.\n" }] }
];

const automationRules = [
  { schemaVersion: 1, id: "daily-brief", name: "每日简报生成", description: "每天早晨汇总过去 24 小时的资料并生成本地 Markdown 简报。", enabled: true, target: { type: "skill", id: "daily-article-summarizer", versionPolicy: "*" }, trigger: { type: "daily", at: "08:00" }, inputs: {}, providerBindings: {}, externalExportBindingIds: [], concurrencyPolicy: "skip", missedRunPolicy: "run-once", retryPolicy: { maxAttempts: 1, backoffMs: 30000 }, timezone: "UTC", lastTriggeredAt: now, lastScheduledKey: date, createdAt: "2026-06-01T08:00:00.000Z", updatedAt: now },
  { schemaVersion: 1, id: "classify-new-content", name: "新资料自动归类", description: "采集完成后扫描新增资料并生成候选选题。", enabled: false, target: { type: "skill", id: "daily-article-summarizer", versionPolicy: "*" }, trigger: { type: "run-completed", skillId: "rss-article-saver" }, inputs: {}, providerBindings: {}, externalExportBindingIds: [], concurrencyPolicy: "skip", missedRunPolicy: "run-once", retryPolicy: { maxAttempts: 1, backoffMs: 30000 }, timezone: "UTC", lastTriggeredAt: null, lastScheduledKey: null, createdAt: "2026-06-01T08:05:00.000Z", updatedAt: now },
  { schemaVersion: 1, id: "rss-capture", name: "RSS 定时抓取", description: "按固定频率通过统一 Skill Broker 拉取订阅源。", enabled: true, target: { type: "skill", id: "rss-article-saver", versionPolicy: "*" }, trigger: { type: "interval", everyMinutes: 15 }, inputs: {}, providerBindings: {}, externalExportBindingIds: [], concurrencyPolicy: "skip", missedRunPolicy: "run-once", retryPolicy: { maxAttempts: 1, backoffMs: 30000 }, timezone: "UTC", lastTriggeredAt: "2026-06-17T02:15:00.000Z", lastScheduledKey: "20260617T0215", createdAt: "2026-06-01T08:10:00.000Z", updatedAt: now }
];

const automationSchedules = [
  { ruleId: "daily-brief", nextRunAt: "2026-06-18T08:00:00.000Z", blockedReason: null },
  { ruleId: "classify-new-content", nextRunAt: null, blockedReason: "规则已停用" },
  { ruleId: "rss-capture", nextRunAt: "2026-06-17T02:30:00.000Z", blockedReason: null }
];

const automationRuns = [
  { schemaVersion: 1, id: "automation-run-daily-brief", ruleId: "daily-brief", target: automationRules[0].target, state: "succeeded", attempt: 1, retryAt: null, childRunId: "run-ai-2", triggerReason: "scheduled", scheduledFor: "2026-06-17T08:00:00.000Z", createdAt: "2026-06-17T08:00:00.000Z", completedAt: "2026-06-17T08:01:12.000Z", error: null },
  { schemaVersion: 1, id: "automation-run-rss", ruleId: "rss-capture", target: automationRules[2].target, state: "failed", attempt: 1, retryAt: null, childRunId: null, triggerReason: "scheduled", scheduledFor: "2026-06-17T02:15:00.000Z", createdAt: "2026-06-17T02:15:00.000Z", completedAt: "2026-06-17T02:15:05.000Z", error: "Provider unavailable: RSS runner returned exit code 1" }
];

const creativeTopics = [
  { id: "creative-topic-1", title: "如何完整验收本地 AI 桌面工作台", platform: "wechat", section: "AI 产品", score: 96, body: "推荐理由：Provider、视觉、性能和安全边界都需要从真实工作流闭环。\\n\\n预计大纲：背景、验收矩阵、风险清单、发布建议。", ignored: false, projectDir: null },
  { id: "creative-topic-2", title: "Windows/WSL 桌面应用验收手册", platform: "xiaohongshu", section: "工程效率", score: 88, body: "覆盖 portable、NSIS、UNC 路径和 Provider 登录态。", ignored: false, projectDir: "mymind/creative/visual-audit-project" }
];

const projectSummary = {
  dir: "mymind/creative/visual-audit-project",
  topic: "Windows/WSL 桌面应用验收手册",
  stage: "ready",
  completion: 82,
  date,
  updatedAt: now,
  platforms: { wechat: "draft" },
  tags: ["验收", "Windows", "AI"],
  archived: false
};

const projectDetail = {
  ...projectSummary,
  files: {
    "draft.md": "# Windows/WSL 桌面应用验收手册\n\n## 核心结论\n\n这份稿件用于验证长标题、长路径、中英文混排和发布前检查清单。\n\n- Portable EXE\n- NSIS installer\n- Provider E2E\n- Visual matrix\n",
    "materials.md": "关联资料：mymind/article/20260617/very-long-title-with-English-and-中文混排-provider-unavailable-state-validation.md"
  },
  truncatedFiles: [],
  manifest: {
    schemaVersion: 1,
    topic: "Windows/WSL 桌面应用验收手册",
    date,
    stage: "ready",
    platforms: { wechat: "draft" },
    tags: ["验收", "Windows", "AI"],
    notes: "发布前需要补齐 Windows GUI 与真实 Provider 证据。",
    assets: [],
    aiSessionIds: ["session-1"],
    publish: { platform: "wechat", title: "Windows/WSL 桌面应用验收手册", summary: "完整验收路径", tags: ["AI", "桌面应用"], coverPath: "", targetPath: "exports/visual-audit.md" },
    createdAt: now,
    updatedAt: now,
    created_at: now,
    updated_at: now
  },
  reviewReport: {
    generatedAt: now,
    status: "approved",
    score: 86,
    dimensions: [
      { name: "结构逻辑", score: 88, comment: "主线清晰。" },
      { name: "准确性", score: 84, comment: "人工验收项已明确标记。" }
    ],
    issues: [
      { severity: "warning", title: "缺少真实 Windows 截图", detail: "发布前需补齐。", anchor: "视觉矩阵" }
    ]
  },
  releaseLog: [
    { id: "release-1", createdAt: now, action: "export", stage: "ready", platform: "wechat", status: "success", file: "exports/visual-audit.md", detail: "导出成功" }
  ]
};

const sessions = [
  { schemaVersion: 1, id: "session-1", projectId: "visual", projectRoot: repoRoot, title: "真实 Provider E2E 验收：Claude/Codex 权限与审批", provider: "claude", providerId: "claude:wsl", providerSessionId: null, cwd: ".", permissionProfile: "edit", status: "waiting-approval", pinned: true, archived: false, createdAt: now, updatedAt: now, lastRunId: "run-ai-1" },
  { schemaVersion: 1, id: "session-2", projectId: "visual", projectRoot: repoRoot, title: "长会话性能验证 10000 events", provider: "codex", providerId: "codex:native", providerSessionId: null, cwd: ".", permissionProfile: "read-only", status: "idle", pinned: false, archived: false, createdAt: now, updatedAt: now, lastRunId: "run-ai-2" }
];

const changePatch = "diff --git a/todo.md b/todo.md\n--- a/todo.md\n+++ b/todo.md\n@@ -1,2 +1,2 @@\n- pending\n+ visual evidence\n";
const runs = [
  { schemaVersion: 1, id: "run-ai-1", sessionId: "session-1", projectId: "visual", provider: "claude", providerId: "claude:wsl", permissionProfile: "edit", status: "waiting-approval", prompt: "验证删除操作必须暂停审批", contexts: [{ id: "content-long", kind: "content", label: contentItems[0].title, path: contentItems[0].path, content: contentItems[0].excerpt }], workspacePath: null, baseCommit: null, startedAt: now, completedAt: null, error: null, changeSet: { id: "change-1", runId: "run-ai-1", baseCommit: "abc123", files: [{ path: "todo.md", status: "modified", additions: 1, deletions: 1, patch: changePatch }], patch: changePatch, createdAt: now, status: "pending", appliedPatches: [], appliedFiles: [] }, risks: [] },
  { schemaVersion: 1, id: "run-ai-2", sessionId: "session-2", projectId: "visual", provider: "codex", providerId: "codex:native", permissionProfile: "read-only", status: "completed", prompt: "总结规模验证报告", contexts: [], workspacePath: null, baseCommit: null, startedAt: "2026-06-17T02:16:46.000Z", completedAt: now, error: null, changeSet: null, risks: [] }
];

const approval = { id: "approval-1", runId: "run-ai-1", sessionId: "session-1", providerRequestId: "provider-approval-1", category: "command", title: "运行跨 Windows/WSL 命令前需要审批", detail: `Provider 请求执行跨 Windows/WSL 文件检查命令，用于验证超长 UNC 路径下的审批卡布局。\n\n${approvalCommand}`, cwd: repoRoot, command: approvalCommand, paths: [String.raw`\\wsl.localhost\Ubuntu\home\say\work\github\cctools\mymind\daily-summary\20260617_daily_summary.md`, "/home/say/work/github/cctools/mymind/post/20260617/posts.json"], createdAt: now, status: "pending" };

const aiSnapshot = { projectRoot: repoRoot, providers, sessions, runs, pendingApprovals: [approval] };

const aiEvents = [
  event("e1", 1, "session-1", "run-ai-1", "user-message", { text: "验证删除操作必须暂停审批" }),
  event("e2", 2, "session-1", "run-ai-1", "reasoning-summary", { text: "我会先检查路径边界，再请求危险操作审批。", source: "visual-fixture" }),
  event("e3", 3, "session-1", "run-ai-1", "tool-start", { tool: "PowerShell", input: { command: approvalCommand } }),
  event("e4", 4, "session-1", "run-ai-1", "approval-request", { approval }),
  event("e5", 5, "session-1", "run-ai-1", "changes", { changeSet: runs[0].changeSet }),
  event("e6", 6, "session-1", "run-ai-1", "assistant-message", { text: "危险操作已暂停，等待用户审批。下方变更区展示将修改的文件。" }),
  event("e7", 1, "session-2", "run-ai-2", "user-message", { text: "总结规模验证报告" }),
  event("e8", 2, "session-2", "run-ai-2", "reasoning-summary", { text: "我会先核对会话、事件与输出重组指标，再运行对应测试，确认长会话在桌面端仍然保持稳定。" }),
  event("tools-1-start", 3, "session-2", "run-ai-2", "tool-start", { itemId: "source-files", tool: "Glob", input: { pattern: "renderer/src/**/*.tsx", path: "desktop-app" } }),
  event("tools-1-done", 4, "session-2", "run-ai-2", "tool-complete", { itemId: "source-files", output: "renderer/src/features/ai-console/Chat.tsx" }),
  event("tools-2-start", 5, "session-2", "run-ai-2", "tool-start", { itemId: "group-usage", tool: "Grep", input: { pattern: "command-group", path: "desktop-app/renderer/src" } }),
  event("tools-2-done", 6, "session-2", "run-ai-2", "tool-complete", { itemId: "group-usage", output: "renderer/src/features/ai-console/tool.tsx" }),
  event("tools-3-start", 7, "session-2", "run-ai-2", "tool-start", { itemId: "chat-source", tool: "Read", input: { file_path: "desktop-app/renderer/src/features/ai-console/Chat.tsx" } }),
  event("tools-3-done", 8, "session-2", "run-ai-2", "tool-complete", { itemId: "chat-source", output: "TraceStepBlocks groups adjacent tool steps." }),
  event("tools-4-start", 9, "session-2", "run-ai-2", "tool-start", { itemId: "style-files", tool: "Glob", input: { pattern: "renderer/src/styles/**/*.css", path: "desktop-app" } }),
  event("tools-4-done", 10, "session-2", "run-ai-2", "tool-complete", { itemId: "style-files", output: "renderer/src/styles/features/ai-console.css" }),
  event("tools-5-start", 11, "session-2", "run-ai-2", "tool-start", { itemId: "tool-styles", tool: "Grep", input: { pattern: "grouped-command", path: "desktop-app/renderer/src" } }),
  event("tools-5-done", 12, "session-2", "run-ai-2", "tool-complete", { itemId: "tool-styles", output: "renderer/src/styles.css" }),
  event("tools-6-start", 13, "session-2", "run-ai-2", "tool-start", { itemId: "tool-source", tool: "Read", input: { file_path: "desktop-app/renderer/src/features/ai-console/tool.tsx" } }),
  event("tools-6-done", 14, "session-2", "run-ai-2", "tool-complete", { itemId: "tool-source", output: "CommandGroup renders compact tool rows." }),
  event("tools-7-start", 15, "session-2", "run-ai-2", "tool-start", { itemId: "test-files", tool: "Glob", input: { pattern: "renderer/src/**/*.test.tsx", path: "desktop-app" } }),
  event("tools-7-done", 16, "session-2", "run-ai-2", "tool-complete", { itemId: "test-files", output: "renderer/src/components/Chat.test.tsx" }),
  event("tools-8-start", 17, "session-2", "run-ai-2", "tool-start", { itemId: "message-usage", tool: "Grep", input: { pattern: "commandGroupRan", path: "desktop-app" } }),
  event("tools-8-done", 18, "session-2", "run-ai-2", "tool-complete", { itemId: "message-usage", output: "shared/messages/zh-CN/ai.ts" }),
  event("tools-9-start", 19, "session-2", "run-ai-2", "tool-start", { itemId: "messages", tool: "Read", input: { file_path: "desktop-app/shared/messages/zh-CN/ai.ts" } }),
  event("tools-9-done", 20, "session-2", "run-ai-2", "tool-complete", { itemId: "messages", output: "Tool group labels are localized." }),
  event("tools-10-start", 21, "session-2", "run-ai-2", "tool-start", { itemId: "snapshots", tool: "Glob", input: { pattern: "scripts/visual-snapshot*.js", path: "desktop-app" } }),
  event("tools-10-done", 22, "session-2", "run-ai-2", "tool-complete", { itemId: "snapshots", output: "scripts/visual-snapshot-electron.js" }),
  event("e12b", 23, "session-2", "run-ai-2", "reasoning-summary", { text: "核心单元测试和集成 smoke 已通过。接下来检查不同窗口尺寸下的对话层级，并确认命令输出在展开时仍然可读。" }),
  event("e13", 24, "session-2", "run-ai-2", "tool-start", { itemId: "visual", tool: "PowerShell", input: { command: "npm run visual:snapshot" } }),
  event("e14", 25, "session-2", "run-ai-2", "tool-complete", { itemId: "visual", output: "48 visual snapshots passed." }),
  event("e15", 26, "session-2", "run-ai-2", "tool-start", { itemId: "package", tool: "PowerShell", input: { command: "Get-ChildItem dist | Select-Object Name,Length" } }),
  event("e16", 27, "session-2", "run-ai-2", "tool-complete", { itemId: "package", output: "CC-Tools-Portable-1.0.22-x64.exe 141388687" }),
  event("e16b", 28, "session-2", "run-ai-2", "reasoning-summary", { text: "视觉矩阵与 Windows 产物均正常，最后汇总规模验证结果，并保留命令明细供需要时展开核对。" }),
  event("e17", 29, "session-2", "run-ai-2", "assistant-message", { text: "规模验证通过：1000 sessions、10000 events、1 MiB 输出重组正常。" })
];

const preferences = {
  schemaVersion: 1,
  repoRoot,
  themeMode: "light",
  accentColor: "#2563eb",
  density: "default",
  fontSize: "default",
  autoSaveIntervalMs: 30000,
  maxVersions: 50,
  archiveAfterDays: 90,
  defaultReadFilter: "all",
  contentPreviewMode: "sidebar",
  markReadOnOpen: true,
  defaultProvider: "codex:native",
  providerModels: { codex: "auto", claude: "auto" },
  defaultPermissionProfile: "edit",
  defaultWorkDir: ".",
  defaultPlatform: "公众号",
  defaultLanguage: "zh-CN",
  defaultContentLength: "medium",
  defaultTemplate: "深度分析",
  userTags: ["AI", "工程", "验收"],
  notificationsEnabled: true,
  dndStartHour: 22,
  dndEndHour: 8,
  maxNotificationHistory: 100,
  cacheMaxSizeMB: 500,
  logRetentionDays: 30
};

const api = {
  getBootstrap: async () => ({
    repoRoot,
    validRepo: true,
    runtime: "Linux Visual Snapshot",
    environment: { mode: "desktop" },
    overview: { repoRoot, metrics: { articles: 18, posts: 12, reddit: 6, summaries: 1 }, recent: contentItems },
    skills: skillDefinitions(),
    ai: currentAiSnapshot()
  }),
  listContent: async () => contentItems.map((item) => ({ path: item.path, name: item.name, title: item.title, kind: item.kind, size: item.size, modifiedAt: item.modifiedAt })),
  readContent: async (itemPath) => ({
    path: itemPath,
    name: itemPath.split(/[\\/]/).pop() || itemPath,
    content: "# Visual Audit Sample\n\n## Provider unavailable state\n\n这段 Markdown 覆盖长标题、长路径、中英文混排和 TOC 高亮。\n\n```bash\nnpm run verify\n```\n\n## Error state\n\nToken expired / Provider unavailable / Windows path boundary.",
    type: itemPath.endsWith(".html") ? "html" : "markdown"
  }),
  listInbox: async (query) => {
    const search = String(query && query.search || "").toLocaleLowerCase();
    const filtered = search ? contentItems.filter((item) => `${item.title} ${item.excerpt}`.toLocaleLowerCase().includes(search)) : contentItems;
    return { items: filtered, total: filtered.length, nextCursor: null };
  },
  getInboxFacets: async () => ({
    total: contentItems.length,
    kindCounts: contentItems.reduce((counts, item) => ({ ...counts, [item.kind]: (counts[item.kind] || 0) + 1 }), {}),
    tags: [{ tag: "AI", count: contentItems.length }, { tag: "工程", count: 1 }]
  }),
  updateContentState: async (id, itemPath, patch) => ({ ...contentItems.find((item) => item.id === id) || contentItems[0], path: itemPath, state: { ...contentState, ...patch } }),
  listSources: async () => {
    if (visualMode === "error") throw new Error("视觉验收模拟错误：数据源读取失败，请检查日志后重试。");
    return visualMode === "empty" ? [] : sources;
  },
  updateSource: async (id, patch) => ({ ...sources.find((source) => source.id === id) || sources[0], ...patch }),
  addRssSource: async (input) => ({ ...sources[0], id: "rss-added", name: input.name, url: input.url }),
  importOpml: async () => 2,
  listSourceRuns: async (sourceId) => sourceId ? sourceRuns.filter((run) => run.sourceId === sourceId || run.skillId === sourceId) : sourceRuns,
  listAutomationRules: async () => automationRules,
  listAutomationSchedules: async () => automationSchedules,
  listAutomationRuns: async (ruleId) => ruleId ? automationRuns.filter((run) => run.ruleId === ruleId) : automationRuns,
  saveAutomationRule: async (input) => ({ schemaVersion: 1, ...input, lastTriggeredAt: null, lastScheduledKey: null, createdAt: now, updatedAt: now }),
  deleteAutomationRule: async () => true,
  runAutomationNow: async (ruleId) => automationRuns.find((run) => run.ruleId === ruleId) || automationRuns[0],
  runSource: async () => true,
  stopSource: async () => true,
  getDailyBrief: async () => dailyBrief(),
  updateBriefWatchlist: async () => dailyBrief(),
  getDashboard: async () => {
    if (visualMode === "error") throw new Error("视觉验收模拟错误：Dashboard 数据读取失败，请检查日志后重试。");
    return dashboardData();
  },
  searchWorkspace: async (query) => [
    { id: "content:long", kind: "content", title: contentItems[0].title, subtitle: "Local Visual Audit · 文章", path: contentItems[0].path, date, status: "未读", targetId: contentItems[0].id },
    { id: "project:visual", kind: "project", title: projectSummary.topic, subtitle: "ready · wechat", path: projectSummary.dir, date, status: "ready", targetId: projectSummary.dir },
    { id: "session:1", kind: "session", title: sessions[0].title, subtitle: "Claude Code · waiting-approval", path: ".", date: now, status: "waiting-approval", targetId: sessions[0].id },
    { id: "skill:rss", kind: "skill", title: "RSS Article Saver", subtitle: "自动化", path: ".claude/skills/rss-article-saver", date: null, status: "ready", targetId: "rss-article-saver" }
  ].filter((item) => item.title.toLocaleLowerCase().includes(String(query || "").toLocaleLowerCase()) || !query),
  getCreativeTopics: async () => ({ date, topics: creativeTopics }),
  getAllCreativeTopics: async () => [{ date, label: "今日选题", topics: creativeTopics }],
  addCreativeTopic: async (input) => ({ date: input.date, topics: creativeTopics.concat({ id: "new-topic", title: input.title, body: input.body, score: input.score || 80 }) }),
  getCreativeProjects: async () => [projectSummary, { ...projectSummary, dir: "mymind/creative/review-project", topic: "审核中的长标题项目 Review Stage", stage: "review", completion: 55 }],
  getCreativeProject: async () => projectDetail,
  createCreativeProject: async () => projectDetail,
  saveCreativeFile: async () => projectDetail,
  advanceCreativeProject: async (_path, stage) => ({ ...projectDetail, stage, manifest: { ...projectDetail.manifest, stage } }),
  updateCreativeManifest: async (_path, patch) => ({ ...projectDetail, manifest: { ...projectDetail.manifest, ...patch } }),
  updateCreativeTopicState: async () => ({ date, topics: creativeTopics }),
  reviewCreativeProject: async () => projectDetail,
  setCreativeReviewStatus: async () => projectDetail,
  listCreativeVersions: async () => [{ id: "v1", file: "draft.md", path: "mymind/creative/visual-audit-project/versions/draft-v1.md", createdAt: now, note: "视觉验收版本", size: 2048 }],
  readCreativeVersion: async () => ({ path: "versions/draft-v1.md", content: projectDetail.files["draft.md"] }),
  restoreCreativeVersion: async () => projectDetail,
  getCreativeReleaseLog: async () => projectDetail.releaseLog,
  copyCreativeProject: async () => projectDetail,
  archiveCreativeProject: async () => projectDetail,
  restoreCreativeProject: async () => projectDetail,
  deleteCreativeProject: async () => true,
  getCreativeAnalytics: async () => ({ total: 2, stages: [{ stage: "drafting", count: 1 }, { stage: "review", count: 1 }, { stage: "ready", count: 1 }, { stage: "published", count: 0 }], platforms: [{ platform: "wechat", count: 1 }], averageCompletion: 68, averageCycleHours: 18, stageDurations: [{ stage: "drafting", averageHours: 10 }, { stage: "review", averageHours: 4 }] }),
  bindCreativeSession: async () => projectDetail,
  selectFiles: async () => [longPath],
  selectMymindFiles: async () => ["mymind/daily-summary/20260625_daily_summary.md"],
  searchMymindFiles: async (query, limit = 40) => {
    const files = [
      "mymind/daily-summary/20260625_daily_summary.md",
      "mymind/creative/01-内容生产/文稿库/composer-workflow.md",
      "mymind/wiki/concepts/composer.md"
    ];
    const normalized = String(query || "").toLocaleLowerCase();
    return {
      items: files
        .filter((file) => file.toLocaleLowerCase().includes(normalized))
        .slice(0, limit)
        .map((file) => ({
          path: file,
          name: file.split("/").at(-1),
          directory: file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "",
          extension: file.includes(".") ? file.split(".").at(-1) : ""
        })),
      indexedCount: 1842,
      truncated: false
    };
  },
  openPath: async (target) => target,
  revealPath: async () => true,
  openExternal: async () => true,
  exportText: async (name) => `exports/${name}`,
  getPreferences: async () => preferences,
  updatePreferences: async (patch) => ({ ...preferences, ...patch }),
  resetPreferences: async () => preferences,
  importPreferences: async () => ({ imported: true, preferences }),
  getSharedPythonRuntimeStatus: async () => ({ enabled: true, phase: "ready", target: "windows-x64", pythonVersion: "3.12.8", uvVersion: "0.5.27", managedSkills: 16, ready: true, lastError: null }),
  setSharedPythonRuntimeEnabled: async (enabled) => ({ enabled, phase: enabled ? "ready" : "disabled", target: "windows-x64", pythonVersion: enabled ? "3.12.8" : null, uvVersion: enabled ? "0.5.27" : null, managedSkills: enabled ? 16 : 0, ready: enabled, lastError: null }),
  getMcpServers: async () => [{
    schemaVersion: 1,
    id: "cctools_browser",
    title: "写作证据截图",
    description: "写作时按需打开来源链接，定位原文并生成可引用的证据截图。",
    backend: "Microsoft Playwright MCP",
    transport: "stdio",
    connection: "Playwright Chrome 扩展",
    providers: ["Codex", "Claude"],
    status: "enabled",
    diagnostic: "可用；首次连接时需要在 Playwright Chrome 扩展中确认标签页。",
    settingsSection: "browser",
    tools: [{ id: "capture_source_evidence", title: "截取原文证据", description: "复用 URL 完全匹配的 Chrome 标签页，定位引文、截图并恢复浏览器现场。", inputs: ["url", "quote", "capture_scope", "caption", "filename"], outputs: ["PNG", "JSON 元数据", "Markdown 图片引用"] }]
  }],
  inspectSkillWorkspace: async () => [],
  listInstalledSkills: async () => [],
  listInstalledRunnableSkills: async () => [],
  listSkillRuns: async () => [],
  rebuildContentIndex: async () => ({ schemaVersion: 1, indexedDates: [date], itemCount: contentItems.length, indexPath: ".cctools/content-index.json", statePath: ".cctools/content-state.json", rebuiltAt: now }),
  aiRefresh: async () => currentAiSnapshot(),
  aiPrewarm: async () => true,
  aiSearchSessions: async () => sessions,
  aiStartRun: async () => ({ session: sessions[0], run: runs[0] }),
  aiCancelRun: async () => true,
  aiUpdateSession: async (_id, patch) => ({ ...sessions[0], ...patch }),
  aiDeleteSession: async () => true,
  aiGetEvents: async (sessionId) => aiEvents.filter((item) => item.sessionId === sessionId),
  aiResolveApproval: async () => {
    approvalResolved = true;
    return true;
  },
  aiGetChangeSet: async () => runs[0].changeSet,
  aiApplyChange: async () => ({ applied: true }),
  aiRevertChange: async () => ({ applied: true }),
  aiDiscardChange: async () => runs[0].changeSet,
  aiDiscardRun: async () => true,
  runSkill: async () => true,
  stopSkill: async () => true,
  onAiEvent: () => () => undefined,
  onSkillEvent: () => () => undefined,
  __setVisualMode: (mode) => { visualMode = mode || "normal"; }
};

contextBridge.exposeInMainWorld("cctools", api);

function currentAiSnapshot() {
  if (!approvalResolved) return aiSnapshot;
  return {
    ...aiSnapshot,
    sessions: aiSnapshot.sessions.map((session) => session.id === approval.sessionId ? { ...session, status: "idle" } : session),
    runs: aiSnapshot.runs.map((run) => run.id === approval.runId ? { ...run, status: "completed", completedAt: now } : run),
    pendingApprovals: []
  };
}

function dashboardData() {
  return {
    schemaVersion: 1,
    date,
    refreshedAt: now,
    metrics: { collected: 36, unread: 12, articles: 18, posts: 12, reddit: 6, drafting: 1, review: 1, ready: 1, failedSources: 1, pendingApprovals: 1 },
    sourceCounts: { articles: 1, posts: 1, reddit: 1 },
    recommendedTopics: briefTopics,
    creativeStages: [{ stage: "drafting", count: 1 }, { stage: "review", count: 1 }, { stage: "ready", count: 1 }, { stage: "published", count: 0 }],
    trend: Array.from({ length: 7 }, (_, index) => ({ date: `202606${11 + index}`, content: 20 + index * 3, creative: index % 3 })),
    attention: [
      { id: "source:x", kind: "source", title: "X 关注动态需要处理", detail: "Token expired / Provider unavailable" },
      { id: "approval:1", kind: "approval", title: approval.title, detail: approval.detail },
      { id: "publish:visual", kind: "publish", title: projectSummary.topic, detail: "稿件已准备导出。" }
    ]
  };
}

function dailyBrief() {
  return {
    schemaVersion: 1,
    date,
    generatedAt: now,
    sourcePath: "mymind/daily-summary/20260617_daily_summary.md",
    counts: { content: 36, unread: 12, articles: 18, posts: 12, reddit: 6, important: 8, topics: 2 },
    topics: briefTopics,
    signals: ["Provider E2E 仍需真实账号验收", "视觉截图矩阵需要覆盖长标题和错误状态", "性能预算已进入 verify"],
    watchlist: contentItems.slice(0, 2),
    sourceContribution: [{ source: "RSS", count: 18 }, { source: "Reddit", count: 12 }, { source: "X", count: 6 }],
    recommendations: ["补齐 Windows GUI 验收截图。", "运行真实 Claude/Codex Provider E2E。"],
    markdown: "# 每日简报\n\n## 核心信号\n\nProvider E2E 和视觉矩阵是发布前最后的人工验收项。\n\n## 推荐主题\n\n- 本地 AI 工作台验收\n- Windows/WSL 桌面应用发布"
  };
}

function skillDefinitions() {
  return [
    { id: "rss-article-saver", title: "RSS 文章抓取", description: "拉取订阅、提取正文并保存到文章库。", cwd: ".claude/skills/rss-article-saver", command: "uv", runner: "uv", args: ["run", "python", "main.py"], envFile: ".env", group: "采集", permission: "edit", outputArtifacts: ["mymind/article/${date}"], timeoutMs: 1800000 },
    { id: "daily-article-summarizer", title: "每日文章总结", description: "总结当天文章并同步每日摘要。", cwd: ".claude/skills/daily-article-summarizer", command: "uv", runner: "uv", args: ["run", "python", "main.py"], envFile: ".env", group: "分析", permission: "edit", outputArtifacts: ["mymind/daily-summary"], timeoutMs: 1800000 },
    { id: "x-following-fetcher", title: "X 动态抓取", description: "拉取关注列表动态并保存为结构化内容。", cwd: ".claude/skills/x-following-fetcher", command: "uv", runner: "uv", args: ["run", "python", "main.py"], envFile: null, group: "采集", permission: "edit", outputArtifacts: ["mymind/article/${date}/x_*.md", "mymind/post/${date}/"], timeoutMs: 1800000 }
  ];
}

function event(id, seq, sessionId, runId, kind, payload) {
  return { schemaVersion: 1, id, seq, timestamp: now, projectId: "visual", sessionId, runId, provider: sessionId === "session-1" ? "claude" : "codex", kind, payload, risks: [] };
}
