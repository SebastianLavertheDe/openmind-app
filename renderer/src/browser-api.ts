import type {
  AiEvent,
  AiSnapshot,
  CreativeProjectManifest,
  CreativeStage,
  DesktopApi,
  InstalledSkillView,
  OnboardingState,
  ProvidersYamlInput,
  ProvidersYamlView,
  SkillDefinition,
  SkillPackageInspectionView,
  SourceDefinition,
  UserPreferences
} from "@shared/contracts";
import { DEFAULT_BROWSER_EVIDENCE_DIR } from "@shared/contracts";
import { DEFAULT_AUTOMATION_RULES } from "@shared/automation-defaults";
import type { AutomationRule } from "@shared/contracts";

export function installBrowserPreviewApi(): boolean {
  if (window.openmind) return true;
  if (isElectronRenderer()) return false;
  const previewProjectRoot = "/fixtures/openmind-data";
  // The selected private repository is the content root itself. Keep the
  // preview contract identical to desktop: there is no nested `openmind/`.
  const previewOpenmindRoot = previewProjectRoot;
  const onboardingPreview = new URLSearchParams(window.location.search).get("preview") === "onboarding";
  let previewRootReady = !onboardingPreview;
  let previewSkillsReady = !onboardingPreview;
  let snapshot: AiSnapshot = {
    projectRoot: previewProjectRoot,
    providers: onboardingPreview ? [] : [
      { id: "codex-preview", provider: "codex", label: "Codex · Preview", runtime: "native", available: true, version: "preview", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, installable: false, oneMillion: false },
      { id: "claude-preview", provider: "claude", label: "Claude Code · Preview", runtime: "native", available: true, version: "preview", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: "glm-5.2[1m]", contextWindow: 1_000_000, installable: false, oneMillion: true }
    ],
    sessions: [{
      schemaVersion: 1,
      id: "preview-session",
      projectId: "preview-project",
      projectRoot: previewProjectRoot,
      provider: "claude",
      providerId: "claude-preview",
      providerSessionId: null,
      cwd: ".",
      title: "整理今日内容",
      permissionProfile: "edit",
      status: "idle",
      pinned: true,
      archived: false,
      createdAt: "2026-06-28T08:00:00.000Z",
      updatedAt: "2026-06-28T08:05:00.000Z",
      lastRunId: "preview-run"
    }],
    runs: [{
      schemaVersion: 1,
      id: "preview-run",
      sessionId: "preview-session",
      projectId: "preview-project",
      provider: "claude",
      providerId: "claude-preview",
      permissionProfile: "edit",
      status: "completed",
      prompt: "整理今日内容",
      contexts: [],
      turnContext: null,
      workspacePath: null,
      baseCommit: null,
      startedAt: "2026-06-28T08:00:00.000Z",
      completedAt: "2026-06-28T08:05:00.000Z",
      error: null,
      changeSet: {
        id: "preview-change-set",
        runId: "preview-run",
        baseCommit: "preview-base",
        files: [
          { path: "renderer/src/features/ai-console/AiWorkbench.tsx", status: "modified", additions: 18, deletions: 12, patch: "" },
          { path: "renderer/src/features/ai-console/diff.tsx", status: "modified", additions: 42, deletions: 28, patch: "" },
          { path: "renderer/src/styles/features/ai-console.css", status: "modified", additions: 16, deletions: 9, patch: "" },
          { path: "renderer/src/components/AiWorkbench.test.tsx", status: "modified", additions: 14, deletions: 4, patch: "" },
          { path: "renderer/src/features/ai-console/diff.test.tsx", status: "modified", additions: 20, deletions: 8, patch: "" }
        ],
        patch: "",
        createdAt: "2026-06-28T08:04:50.000Z",
        status: "pending",
        appliedPatches: [],
        appliedFiles: []
      },
      risks: []
    }],
    pendingApprovals: []
  };
  const previewEvents: AiEvent[] = [{
    schemaVersion: 1,
    id: "preview-user",
    seq: 1,
    timestamp: "2026-06-28T08:00:00.000Z",
    projectId: "preview-project",
    sessionId: "preview-session",
    runId: "preview-run",
    provider: "claude",
    kind: "user-message",
    payload: { text: "整理今天的内容并保存为文稿" },
    risks: []
  }, {
    schemaVersion: 1,
    id: "preview-changes",
    seq: 2,
    timestamp: "2026-06-28T08:04:50.000Z",
    projectId: "preview-project",
    sessionId: "preview-session",
    runId: "preview-run",
    provider: "claude",
    kind: "changes",
    payload: { changeSet: snapshot.runs[0].changeSet },
    risks: []
  }, {
    schemaVersion: 1,
    id: "preview-answer",
    seq: 3,
    timestamp: "2026-06-28T08:05:00.000Z",
    projectId: "preview-project",
    sessionId: "preview-session",
    runId: "preview-run",
    provider: "claude",
    kind: "assistant-message",
    payload: { text: "文稿已经生成并保存。\n\n文件：`openmind/article/demo.md`\n\n点击文件路径可在左侧直接预览内容。" },
    risks: []
  }];
  const listeners = new Set<(event: never) => void>();
  let preferences: UserPreferences = {
    schemaVersion: 1,
    openmindRoot: previewOpenmindRoot,
    workspaceRoot: snapshot.projectRoot,
    themeMode: "light" as const,
    density: "default" as const,
    fontSize: "default" as const,
    autoSaveIntervalMs: 30000,
    maxVersions: 50,
    archiveAfterDays: 90,
    defaultReadFilter: "all" as const,
    contentPreviewMode: "sidebar" as const,
    markReadOnOpen: true,
    defaultProvider: "",
    defaultPermissionProfile: "edit" as const,
    notesDir: "openmind",
    browserAutomationEnabled: false,
    browserReuseExistingTabs: true,
    browserEvidenceDir: DEFAULT_BROWSER_EVIDENCE_DIR,
    destructiveOpsRequireApproval: true,
    riskScanEnabled: true,
    defaultPlatform: "公众号",
    defaultLanguage: "zh-CN" as const,
    defaultContentLength: "medium" as const,
    defaultTemplate: "",
    userTags: [],
    workflowAutoSaveDraft: true,
    workflowAutoVersionOnStageChange: true,
    workflowReviewRequiredForReady: true,
    workflowPublishChecklistEnabled: true,
    workflowAutoArchiveEnabled: false
  };
  let onboardingState: OnboardingState = onboardingPreview
    ? { completed: false, skill: "pending", provider: "pending" }
    : { completed: true, skill: "complete", provider: "complete" };
  const skills: SkillDefinition[] = [
    { id: "rss-article-saver", title: "RSS 文章抓取", description: "拉取订阅、提取正文并保存到文章库。", cwd: ".claude/skills/rss-article-saver", command: "uv", runner: "uv", args: ["run", "--env-file", ".env", "python", "main.py"], envFile: ".env", group: "采集", permission: "edit", outputArtifacts: ["openmind/article/${date}/"], timeoutMs: 7200000 },
    { id: "daily-article-summarizer", title: "每日文章总结", description: "总结当天文章并同步每日摘要。", cwd: ".claude/skills/daily-article-summarizer", command: "uv", runner: "uv", args: ["run", "--env-file", ".env", "python", "main.py"], envFile: ".env", group: "分析", permission: "edit", outputArtifacts: ["openmind/daily-summary/${date}_daily_summary.md"], timeoutMs: 3600000 },
    { id: "x-following-fetcher", title: "X 动态抓取", description: "拉取关注列表动态并保存为结构化内容。", cwd: ".claude/skills/x-following-fetcher", command: "uv", runner: "uv", args: ["run", "python", "main.py"], envFile: null, group: "采集", permission: "edit", outputArtifacts: ["openmind/article/${date}/x_*.md", "openmind/post/${date}/"], timeoutMs: 7200000 }
  ];
  const previewSkillMeta = [
    { id: "rss-article-saver", title: "RSS 文章采集", description: "从订阅源采集文章并保存到内容库。", digest: "a".repeat(64) },
    { id: "reddit-fetcher", title: "Reddit 内容抓取", description: "抓取指定社区的热门内容并保存。", digest: "b".repeat(64) },
    { id: "x-following-fetcher", title: "X Following 抓取", description: "抓取关注账号动态并保存为结构化内容。", digest: "c".repeat(64) },
    { id: "daily-article-summarizer", title: "每日文章总结", description: "汇总当天采集内容并生成每日总结。", digest: "d".repeat(64) }
  ] as const;
  let previewInstalledSkills: InstalledSkillView[] = previewSkillMeta.map((skill) => ({
    schemaVersion: 1,
    key: `cctools/${skill.id}`,
    id: skill.id,
    publisherId: "cctools",
    version: "1.0.0",
    digest: skill.digest,
    sourcePath: `https://github.com/SebastianLavertheDe/cctools-skills/${skill.id}`,
    packagePath: `/fixtures/openmind-data/.agent/skills/${skill.id}`,
    usable: true,
    enabled: true,
    signatureStatus: "valid",
    reviewStatus: "manually-reviewed",
    skillUpdatePolicy: "manual",
    installedAt: "2026-08-20T08:00:00.000Z",
    sourceType: "git",
    sourceLocator: "https://github.com/SebastianLavertheDe/cctools-skills",
    sourceRef: "main",
    sourcePackageRef: skill.id,
    sourceRevision: "1".repeat(40)
  }));
  const previewSkillInspections = new Map<string, SkillPackageInspectionView>(previewSkillMeta.map((skill) => [skill.id, {
    sourcePath: `/fixtures/cctools-skills/${skill.id}`,
    sourceKind: "git",
    packageRef: skill.id,
    valid: true,
    digest: skill.digest,
    totalBytes: 4096,
    files: [{ path: "cctools.skill.yaml", type: "file", size: 1024, digest: "manifest" }],
    excludedPaths: [],
    manifest: {
      apiVersion: "openmind.dev/skill/v1",
      id: skill.id,
      version: "1.0.0",
      kind: "process",
      publisher: { id: "cctools", displayName: "cctools" },
      display: { name: skill.title, description: skill.description, group: "采集" },
      config: {},
      capabilities: { openmind: { read: ["**"], write: ["**"] }, network: { required: true, hosts: [] }, browser: false, subprocess: { allowed: false } }
    },
    legacy: null,
    issues: [],
    warnings: []
  }]));
  let previewSources: SourceDefinition[] = [
    { schemaVersion: 1, id: "source-rss-anthropic", name: "Anthropic Blog", kind: "rss", url: "https://www.anthropic.com/rss.xml", skillId: "rss-article-saver", enabled: true, frequency: "每日流水线", tags: ["AI"], lastRunAt: "2026-08-22T10:18:00.000Z", lastSuccessAt: "2026-08-22T10:18:00.000Z", successRate: 100, status: "success", recentError: null, itemCount: 12 },
    { schemaVersion: 1, id: "source-rss-sspai", name: "少数派", kind: "rss", url: "https://sspai.com/feed", skillId: "rss-article-saver", enabled: true, frequency: "每日流水线", tags: ["产品"], lastRunAt: "2026-08-22T09:30:00.000Z", lastSuccessAt: "2026-08-22T09:30:00.000Z", successRate: 100, status: "success", recentError: null, itemCount: 8 },
    { schemaVersion: 1, id: "source-rss-hackernews", name: "Hacker News", kind: "rss", url: "https://hnrss.org/frontpage", skillId: "rss-article-saver", enabled: false, frequency: "每日流水线", tags: ["技术"], lastRunAt: null, lastSuccessAt: null, successRate: null, status: "disabled", recentError: null, itemCount: 0 },
    { schemaVersion: 1, id: "source-reddit", name: "Reddit 社区", kind: "reddit", url: null, skillId: "reddit-fetcher", enabled: true, frequency: "每日流水线", tags: ["社区"], lastRunAt: "2026-08-22T08:45:00.000Z", lastSuccessAt: "2026-08-22T08:45:00.000Z", successRate: 100, status: "success", recentError: null, itemCount: 18 },
    { schemaVersion: 1, id: "source-x", name: "X 关注账号", kind: "x", url: null, skillId: "x-following-fetcher", enabled: true, frequency: "每日流水线", tags: ["动态"], lastRunAt: "2026-08-22T08:15:00.000Z", lastSuccessAt: "2026-08-22T08:15:00.000Z", successRate: 100, status: "success", recentError: null, itemCount: 24 }
  ];
  const previewAutomationRules: AutomationRule[] = DEFAULT_AUTOMATION_RULES.map((input, index) => ({
    schemaVersion: 1,
    ...input,
    lastTriggeredAt: null,
    lastScheduledKey: null,
    createdAt: `2026-06-28T08:0${index}:00.000Z`,
    updatedAt: `2026-06-28T08:0${index}:00.000Z`
  }));
  const api: DesktopApi = {
    getBootstrap: async () => ({
      repoRoot: snapshot.projectRoot,
      openmindRoot: previewRootReady ? previewOpenmindRoot : "",
      workspaceRoot: snapshot.projectRoot,
      validRepo: previewRootReady,
      skillsInstalled: previewSkillsReady,
      onboardingCompleted: onboardingState.completed,
      runtime: "浏览器预览 · Preview 数据",
      environment: { mode: "preview", platform: "web" },
      overview: { repoRoot: snapshot.projectRoot, metrics: { articles: 28, posts: 14, summaries: 1, topics: 9, reddit: 5 }, recent: [] },
      skills: previewSkillsReady ? skills : [],
      ai: snapshot
    }),
    listContent: async (kind) => kind === "summaries" ? [
      { path: "openmind/daily-summary/20260617_daily_summary.md", name: "20260617_daily_summary.md", kind, size: 8632, modifiedAt: "2026-06-17T22:10:00.000Z" },
      { path: "openmind/daily-summary/20260616_daily_summary.md", name: "20260616_daily_summary.md", kind, size: 7540, modifiedAt: "2026-06-16T22:08:00.000Z" }
    ] : [
      { path: "openmind/article/demo.md", name: "工程级 AI 工作台设计.md", kind: "articles" },
      { path: "openmind/article/second.md", name: "本地优先内容工作流.md", kind: "articles" }
    ],
    readContent: async (path) => ({
      path,
      name: path.split("/").at(-1),
      content: path.endsWith("curl.txt")
        ? "curl 'https://x.com/i/api/graphql/HomeLatestTimeline' \\\n  -H 'authorization: Bearer ••••••••' \\\n  -H 'content-type: application/json' \\\n  --data-raw '{\"variables\":{\"count\":20}}'"
        : path.includes("daily-summary")
          ? "# 每日简报\n\n## 今日信号\n\n1. 本地 AI 工作台正在成为内容团队的新基础设施。\n2. 结构化选题文件能显著缩短从阅读到发布的路径。\n\n## 值得细读\n\n- 工程级 AI 工作台设计\n- 可恢复的创作与发布流程"
          : path.includes("daily-topic")
            ? "# 每日选题管理\n\n## 选题 1：本地 AI 工程工作台\n\n- 推荐指数：9/10\n- 目标平台：公众号\n- 状态：待创作"
            : "# 工程级 AI 工作台\n\n这是浏览器预览内容，用于验证长文编辑宽度与 Markdown 表格。\n\n## 今日候选热点池\n\n| 热点 | 来源 | 可靠性 | 传播潜力 | 写作价值 | 框架价值 | 风险 | 主编备注 |\n|---|---|---|---:---:|---:|---:|---|---|\n| Anthropic 系统提示词精简 80% | Thariq 推文 | 高 | 8 | 9 | 9 | 低 | 今日首选 |\n| HuggingFace 越狱研究 | OpenAI | 高 | 8 | 9 | 8 | 中 | 适合深度分析 |\n\n## 目标\n\n- 可恢复会话\n- 执行前审批\n- 直接项目目录运行"
    }),
    writeContent: async (path, content) => ({ path, name: path.split("/").at(-1), content, truncated: false }),
    listSources: async () => previewSources,
    updateSource: async (id, patch) => {
      const current = previewSources.find((source) => source.id === id);
      if (!current) throw new Error("数据源不存在");
      const updated: SourceDefinition = {
        ...current,
        ...patch,
        status: patch.enabled === false ? "disabled" : patch.enabled === true && current.status === "disabled" ? "idle" : current.status
      };
      previewSources = previewSources.map((source) => source.id === id ? updated : source);
      return updated;
    },
    addRssSource: async (input) => {
      const source: SourceDefinition = { schemaVersion: 1, id: `rss:${input.url}`, name: input.name, kind: input.kind || "rss", url: input.url, skillId: (input.kind || "rss") === "rss" ? "rss-article-saver" : null, enabled: true, frequency: input.frequency || "每日流水线", tags: input.tags || [], lastRunAt: null, lastSuccessAt: null, successRate: null, status: "idle", recentError: null, itemCount: 0 };
      previewSources = [...previewSources, source];
      return source;
    },
    importOpml: async () => 2,
    searchWorkspace: async (query) => {
      const normalized = query.toLocaleLowerCase();
      return [
        { id: "content:preview-content-1", kind: "content" as const, title: "工程级 AI 工作台设计", subtitle: "Anthropic · 文章", path: "openmind/article/demo.md", date: "20260615", status: null, targetId: "preview-content-1" },
        { id: "project:openmind/creative/demo", kind: "project" as const, title: "本地 AI 工程工作台", subtitle: "20260615 · 制作中", path: "openmind/creative/demo", date: "20260615", status: "drafting", targetId: "openmind/creative/demo" },
        { id: "skill:rss-article-saver", kind: "skill" as const, title: "RSS 文章抓取", subtitle: "拉取订阅并保存完整文章。", path: ".claude/skills/rss-article-saver", date: null, status: null, targetId: "rss-article-saver" }
      ].filter((item) => `${item.title} ${item.subtitle}`.toLocaleLowerCase().includes(normalized));
    },
    getAllCreativeTopics: async () => [
      { date: "20260617", label: "2026-06-17", topics: [{ id: "topic-preview", title: "全量创作选题", platform: "公众号", section: "today_pick", score: 9, body: "# 全量创作选题\n\n不再只展示当天。", starred: false, ignored: false, projectDir: null }] }
    ],
    getCreativeProjects: async () => [{ dir: "openmind/creative/demo", topic: "本地 AI 工程工作台", stage: "drafting", completion: 72 }],
    getCreativeProject: async (dir) => ({ dir, stage: "drafting", manifest: { topic: "本地 AI 工程工作台" }, files: { "topic-brief.md": "# Topic Brief\n\n工程级本地 AI 对话与任务执行。" } }),
    createCreativeProject: async (input) => ({ dir: `openmind/creative/${input.date}-${input.topic.title}`, stage: "drafting", manifest: { topic: input.topic.title }, files: { "topic-brief.md": input.topic.body || "", "draft.md": `# ${input.topic.title}\n\n` } }),
    saveCreativeFile: async (input) => ({ dir: input.projectDir, stage: "drafting", manifest: { topic: "本地 AI 工程工作台" }, files: { [input.file]: input.content } }),
    advanceCreativeProject: async (dir, stage) => ({ dir, stage, manifest: { topic: "本地 AI 工程工作台", stage: stage as CreativeStage }, files: { "draft.md": "# 本地 AI 工程工作台\n\n草稿内容。" } }),
    updateCreativeManifest: async (dir, patch) => ({ dir, stage: "ready", manifest: { topic: "本地 AI 工作台", ...patch } as Partial<CreativeProjectManifest>, files: { "draft.md": "# 本地 AI 工程工作台\n\n草稿内容。" } }),
    listCreativeVersions: async (_dir, file) => [{ id: "v1", file, path: `versions/${file}/v1.md`, createdAt: new Date().toISOString(), note: "自动保存版本", size: 128 }],
    readCreativeVersion: async (path) => ({ path, content: "# 历史版本\n\n内容。" }),
    restoreCreativeVersion: async (dir, file) => ({ dir, stage: "drafting", manifest: { topic: "本地 AI 工程工作台" }, files: { [file]: "# 历史版本\n\n内容。" } }),
    getCreativeReleaseLog: async () => [{ id: "release-1", createdAt: new Date().toISOString(), action: "content_exported", stage: "ready", status: "exported", detail: "导出 Markdown" }],
    copyCreativeProject: async (dir) => ({ dir: `${dir}-copy`, stage: "drafting", manifest: { topic: "本地 AI 工程工作台（副本）" }, files: { "draft.md": "# 副本" } }),
    archiveCreativeProject: async (dir) => ({ dir: `${dir}-archived`, stage: "archived", manifest: { topic: "本地 AI 工程工作台", stage: "archived" }, files: { "draft.md": "# 已归档" } }),
    getCreativeAnalytics: async () => ({ total: 1, stages: [{ stage: "drafting", count: 1 }], platforms: [{ platform: "wechat", count: 1 }], averageCompletion: 72 }),
    selectFiles: async () => [],
    selectOpenmindFiles: async () => [],
    searchOpenmindFiles: async (query, limit = 40) => {
      const files = [
        "openmind/daily-summary/20260625_daily_summary.md",
        "openmind/post/20260624/posts.json",
        "openmind/wiki/index.md"
      ];
      const normalized = query.toLocaleLowerCase();
      return {
        items: files
          .filter((file) => file.toLocaleLowerCase().includes(normalized))
          .slice(0, limit)
          .map((file) => ({
            path: file,
            name: file.split("/").at(-1) || file,
            directory: file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "",
            extension: file.includes(".") ? file.split(".").at(-1) || "" : ""
          })),
        indexedCount: files.length,
        truncated: false
      };
    },
    openPath: async () => "",
    revealPath: async () => true,
    openExternal: async () => true,
    exportText: async (defaultName) => defaultName,
    setOpenmindRoot: async (p) => { previewRootReady = true; return p; },
    selectOpenmindRoot: async () => previewOpenmindRoot,
    previewOpenmindRoot: async (candidate) => ({
      candidate,
      canonicalRoot: candidate,
      health: {
        configured: true,
        rootId: "preview-root",
        accessible: true,
        readable: true,
        writable: true,
        expectedStructureVersion: "openmind-layout-v3",
        missingInitializeEntries: [],
        missingCreateIfNeededEntries: [],
        optionalObservedEntries: [],
        unknownPreservedEntries: [],
        symlinkWarnings: [],
        activeRunCount: 0,
        warnings: []
      },
      canBind: true,
      blockingReasons: []
    }),
    getOpenmindRoot: async () => ({
      openmindRoot: previewRootReady ? previewOpenmindRoot : "",
      workspaceRoot: snapshot.projectRoot,
      health: {
        configured: previewRootReady,
        rootId: previewRootReady ? "preview-root" : undefined,
        accessible: previewRootReady,
        readable: previewRootReady,
        writable: previewRootReady,
        expectedStructureVersion: "openmind-layout-v3",
        missingInitializeEntries: [],
        missingCreateIfNeededEntries: [],
        optionalObservedEntries: [],
        unknownPreservedEntries: [],
        symlinkWarnings: [],
        activeRunCount: 0,
        warnings: []
      },
      snapshot: previewRootReady ? { rootPath: previewOpenmindRoot, rootId: "preview-root", rootGeneration: 1 } : null
    }),
    selectWorkspaceRoot: async () => snapshot.projectRoot,
    getPreferences: async () => preferences,
    updatePreferences: async (patch) => { preferences = { ...preferences, ...patch }; return preferences; },
    getOnboardingState: async () => onboardingState,
    updateOnboardingState: async (patch) => { onboardingState = { ...onboardingState, ...patch }; return onboardingState; },
    resetPreferences: async () => { preferences = { ...preferences, themeMode: "light", density: "default", fontSize: "default" }; return preferences; },
    getBrowserAutomationStatus: async () => ({
      backend: "playwright-mcp",
      enabled: preferences.browserAutomationEnabled,
      reuseExistingTabs: preferences.browserReuseExistingTabs,
      evidenceDir: preferences.browserEvidenceDir,
      extensionTokenConfigured: false,
      secureStorageAvailable: true,
      packageAvailable: true,
      ready: preferences.browserAutomationEnabled,
      diagnostic: preferences.browserAutomationEnabled ? "浏览器取证已启用（预览）。" : "AI 写作取证已关闭。"
    }),
    getMcpServers: async () => [{
      id: "openmind_browser",
      title: "写作证据截图",
      description: "写作时按需打开来源链接，定位原文并生成可引用的证据截图。",
      backend: "Microsoft Playwright MCP",
      transport: "stdio",
      connection: "Playwright Chrome 扩展",
      enabled: preferences.browserAutomationEnabled,
      available: true,
      status: preferences.browserAutomationEnabled ? "enabled" : "disabled",
      diagnostic: preferences.browserAutomationEnabled ? "浏览器取证已启用（预览）。" : "AI 写作取证已关闭。",
      providers: ["Codex", "Claude"],
      settingsSection: "browser",
      tools: [{
        id: "capture_source_evidence",
        title: "截取原文证据",
        description: "复用 URL 完全匹配的 Chrome 标签页，定位引文、截图并恢复浏览器现场。",
        inputs: ["url", "quote", "capture_scope", "caption", "filename"],
        outputs: ["PNG", "JSON 元数据", "Markdown 图片引用"]
      }]
    }],
    saveBrowserExtensionToken: async () => ({
      backend: "playwright-mcp", enabled: preferences.browserAutomationEnabled, reuseExistingTabs: preferences.browserReuseExistingTabs,
      evidenceDir: preferences.browserEvidenceDir, extensionTokenConfigured: true, secureStorageAvailable: true,
      packageAvailable: true, ready: preferences.browserAutomationEnabled, diagnostic: "已准备好复用 Chrome 登录状态和扩展授权的标签页。"
    }),
    clearBrowserExtensionToken: async () => ({
      backend: "playwright-mcp", enabled: preferences.browserAutomationEnabled, reuseExistingTabs: preferences.browserReuseExistingTabs,
      evidenceDir: preferences.browserEvidenceDir, extensionTokenConfigured: false, secureStorageAvailable: true,
      packageAvailable: true, ready: preferences.browserAutomationEnabled, diagnostic: "首次连接需要在扩展中确认标签页。"
    }),
    getProviders: async (): Promise<ProvidersYamlView> => ({ schemaVersion: 1, default: "", cli: { claude: null, codex: null }, providers: [] }),
    saveProviders: async (_input: ProvidersYamlInput): Promise<ProvidersYamlView> => ({ schemaVersion: 1, default: "", cli: { claude: null, codex: null }, providers: [] }),
    getSharedPythonRuntimeStatus: async () => ({ enabled: false, phase: "disabled", target: "windows-x64", pythonVersion: null, uvVersion: null, managedSkills: 0, ready: false, lastError: null }),
    setSharedPythonRuntimeEnabled: async (enabled) => ({ enabled, phase: enabled ? "ready" : "disabled", target: "windows-x64", pythonVersion: enabled ? "3.12.10" : null, uvVersion: enabled ? "0.8.15" : null, managedSkills: enabled ? 3 : 0, ready: enabled, lastError: null }),
    aiRefresh: async () => snapshot,
    aiRefreshProviders: async () => undefined,
    installCliTool: async () => { throw new Error("浏览器预览不支持一键安装 CLI。 "); },
    upgradeCliTool: async () => { throw new Error("浏览器预览不支持升级 CLI。 "); },
    checkCliToolUpdate: async (cli) => ({ cli, installed: false, currentVersion: null, latestVersion: null, updateAvailable: false, canUpgrade: false, checkedAt: new Date().toISOString(), source: "unknown" }),
    cancelCliToolInstall: async () => false,
    openCliLogin: async () => { throw new Error("浏览器预览不支持打开终端登录。 "); },
    aiRefreshSkills: async () => skills,
    inspectInstalledSkill: async (key) => previewSkillInspections.get(previewInstalledSkills.find((skill) => skill.key === key)?.id || "") || null,
    listInstalledSkills: async () => previewInstalledSkills,
    installSkillSource: async () => { previewSkillsReady = true; return []; },
    listInstalledRunnableSkills: async () => [],
    setInstalledSkillEnabled: async (key, digest, enabled) => {
      const current = previewInstalledSkills.find((skill) => skill.key === key && skill.digest === digest);
      if (!current) throw new Error("Skill 不存在");
      const updated = { ...current, enabled };
      previewInstalledSkills = previewInstalledSkills.map((skill) => skill.key === key ? updated : skill);
      return updated;
    },
    listSkillRuns: async () => [],
    getSkillRun: async () => { throw new Error("浏览器预览不执行真实 Skill Run。 "); },
    getSkillRunEvents: async () => [],
    listRunArtifacts: async () => [],
    retrySkillRun: async () => { throw new Error("浏览器预览不执行真实 Skill Run。 "); },
    retryWorkflowStep: async () => { throw new Error("浏览器预览不执行真实 Workflow。 "); },
    deleteRunHistory: async () => false,
    cancelSkillRun: async () => false,
    listWorkflowRuns: async () => [],
    getWorkflowRun: async () => { throw new Error("浏览器预览不执行真实 Workflow。 "); },
    resumeWorkflowRun: async () => { throw new Error("浏览器预览不执行真实 Workflow。 "); },
    cancelWorkflowRun: async () => false,
    listAutomationRules: async () => previewAutomationRules,
    saveAutomationRule: async () => { throw new Error("浏览器预览不管理 Automation Rule。 "); },
    deleteAutomationRule: async () => false,
    runAutomationNow: async () => { throw new Error("浏览器预览不执行真实 Automation。 "); },
    listAutomationRuns: async () => [],
    listAutomationSchedules: async () => [],
    aiPrewarm: async () => true,
    aiStartRun: async () => { throw new Error("浏览器预览不执行真实 AI 任务。"); },
    aiCancelRun: async () => true,
    aiUpdateSession: async () => { throw new Error("预览模式没有会话。"); },
    aiGetEvents: async () => previewEvents,
    aiResolveApproval: async () => true,
    onAiEvent: (callback) => { listeners.add(callback as never); return () => listeners.delete(callback as never); },
    onSkillEvent: () => () => {},
    onSkillRunEvent: () => () => {},
    onCliInstallProgress: () => () => {}
  };
  window.openmind = api;
  return true;
}

function isElectronRenderer(): boolean {
  return /\bElectron\//i.test(navigator.userAgent);
}
