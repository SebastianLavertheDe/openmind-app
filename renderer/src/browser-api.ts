import type { AiEvent, AiSnapshot, CreativeProjectManifest, CreativeStage, DesktopApi, SkillDefinition, UserPreferences } from "@shared/contracts";

export function installBrowserPreviewApi(): boolean {
  if (window.cctools) return true;
  if (isElectronRenderer()) return false;
  let snapshot: AiSnapshot = {
    projectRoot: "/home/say/work/github/cctools",
    providers: [
      { id: "codex-preview", provider: "codex", label: "Codex · Preview", runtime: "native", available: true, version: "preview", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, oneMillion: false },
      { id: "claude-preview", provider: "claude", label: "Claude Code · Preview", runtime: "native", available: true, version: "preview", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: "glm-5.2[1m]", contextWindow: 1_000_000, oneMillion: true }
    ],
    sessions: [{
      schemaVersion: 1,
      id: "preview-session",
      projectId: "preview-project",
      projectRoot: "/home/say/work/github/cctools",
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
      changeSet: null,
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
    id: "preview-answer",
    seq: 2,
    timestamp: "2026-06-28T08:05:00.000Z",
    projectId: "preview-project",
    sessionId: "preview-session",
    runId: "preview-run",
    provider: "claude",
    kind: "assistant-message",
    payload: { text: "文稿已经生成并保存。\n\n文件：`mymind/article/demo.md`\n\n点击文件路径可在右侧直接预览内容。" },
    risks: []
  }];
  const listeners = new Set<(event: never) => void>();
  let preferences: UserPreferences = {
    schemaVersion: 1,
    repoRoot: snapshot.projectRoot,
    themeMode: "light" as const,
    accentColor: "#2563eb",
    density: "default" as const,
    fontSize: "default" as const,
    autoSaveIntervalMs: 30000,
    maxVersions: 50,
    archiveAfterDays: 90,
    defaultReadFilter: "all" as const,
    contentPreviewMode: "sidebar" as const,
    markReadOnOpen: true,
    defaultProvider: "",
    providerModels: { codex: "auto", claude: "auto" },
    defaultPermissionProfile: "edit" as const,
    defaultWorkDir: "",
    notesDir: "mymind",
    destructiveOpsRequireApproval: true,
    riskScanEnabled: true,
    defaultPlatform: "公众号",
    defaultLanguage: "zh-CN" as const,
    defaultContentLength: "medium" as const,
    defaultTemplate: "",
    userTags: [],
    notificationsEnabled: true,
    dndStartHour: 22,
    dndEndHour: 8,
    maxNotificationHistory: 100,
    cacheMaxSizeMB: 500,
    logRetentionDays: 30,
    workflowAutoSaveDraft: true,
    workflowAutoVersionOnStageChange: true,
    workflowReviewRequiredForReady: true,
    workflowPublishChecklistEnabled: true,
    workflowAutoArchiveEnabled: false,
    workflowAutoBriefOnSourceComplete: false
  };
  const skills: SkillDefinition[] = [
    { id: "rss-article-saver", title: "RSS 文章抓取", description: "拉取订阅、提取正文并保存到文章库。", cwd: ".claude/skills/rss-article-saver", command: "uv", runner: "uv", args: ["run", "--env-file", ".env", "python", "main.py"], envFile: ".env", group: "采集", permission: "edit", outputArtifacts: ["mymind/article/${date}/"], timeoutMs: 7200000 },
    { id: "daily-article-summarizer", title: "每日文章总结", description: "总结当天文章并同步每日摘要。", cwd: ".claude/skills/daily-article-summarizer", command: "uv", runner: "uv", args: ["run", "--env-file", ".env", "python", "main.py"], envFile: ".env", group: "分析", permission: "edit", outputArtifacts: ["mymind/daily-summary/${date}_daily_summary.md"], timeoutMs: 3600000 },
    { id: "x-following-fetcher", title: "X 动态抓取", description: "拉取关注列表动态并保存为结构化内容。", cwd: ".claude/skills/x-following-fetcher", command: "uv", runner: "uv", args: ["run", "python", "main.py"], envFile: null, group: "采集", permission: "edit", outputArtifacts: ["mymind/article/${date}/x_*.md", "mymind/post/${date}/"], timeoutMs: 7200000 }
  ];
  const api: DesktopApi = {
    getBootstrap: async () => ({
      repoRoot: snapshot.projectRoot,
      validRepo: true,
      runtime: "浏览器预览 · Preview 数据",
      environment: { mode: "preview" },
      overview: { repoRoot: snapshot.projectRoot, metrics: { articles: 28, posts: 14, summaries: 1, topics: 9, reddit: 5 }, recent: [] },
      skills,
      ai: snapshot
    }),
    listContent: async (kind) => kind === "summaries" ? [
      { path: "mymind/daily-summary/20260617_daily_summary.md", name: "20260617_daily_summary.md", kind, size: 8632, modifiedAt: "2026-06-17T22:10:00.000Z" },
      { path: "mymind/daily-summary/20260616_daily_summary.md", name: "20260616_daily_summary.md", kind, size: 7540, modifiedAt: "2026-06-16T22:08:00.000Z" }
    ] : [
      { path: "mymind/article/demo.md", name: "工程级 AI 工作台设计.md", kind: "articles" },
      { path: "mymind/article/second.md", name: "本地优先内容工作流.md", kind: "articles" }
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
            : "# 工程级 AI 工作台\n\n这是浏览器预览内容。\n\n## 目标\n\n- 可恢复会话\n- 执行前审批\n- 直接项目目录运行"
    }),
    writeContent: async (path, content) => ({ path, name: path.split("/").at(-1), content, truncated: false }),
    listInbox: async (query) => ({
      items: [
        {
          schemaVersion: 1,
          id: "preview-content-1",
          path: "mymind/article/demo.md",
          name: "工程级 AI 工作台设计.md",
          title: "工程级 AI 工作台设计",
          kind: "article",
          source: "Anthropic",
          author: "CC Tools",
          originalUrl: "https://example.com/article",
          publishedAt: query.date,
          capturedAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          size: 4096,
          excerpt: "本地优先的内容与 AI 工程工作台设计。",
          state: { read: false, starred: true, score: 92, tags: ["AI", "工程"], lastViewedAt: null }
        }
      ],
      total: 1,
      nextCursor: null
    }),
    getInboxFacets: async () => ({ total: 1, kindCounts: { article: 1 }, tags: [{ tag: "AI", count: 1 }, { tag: "工程", count: 1 }] }),
    updateContentState: async (id, path, patch) => ({
      schemaVersion: 1,
      id,
      path,
      name: "工程级 AI 工作台设计.md",
      title: "工程级 AI 工作台设计",
      kind: "article",
      source: "Anthropic",
      author: "CC Tools",
      originalUrl: "https://example.com/article",
      publishedAt: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      size: 4096,
      excerpt: "本地优先的内容与 AI 工程工作台设计。",
      state: { read: false, starred: true, score: 92, tags: ["AI", "工程"], lastViewedAt: null, ...patch }
    }),
    listSources: async () => [
      { schemaVersion: 1, id: "source-rss", name: "Anthropic Blog", kind: "rss", url: "https://www.anthropic.com/rss.xml", skillId: "rss-article-saver", enabled: true, frequency: "每日流水线", tags: ["AI"], lastRunAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), successRate: 100, status: "success", recentError: null, itemCount: 12 },
      { schemaVersion: 1, id: "source-x", name: "X 关注动态", kind: "x", url: null, skillId: "x-following-fetcher", enabled: true, frequency: "每日流水线", tags: ["动态"], lastRunAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), successRate: 100, status: "success", recentError: null, itemCount: 24 }
    ],
    updateSource: async (id, patch) => ({
      schemaVersion: 1,
      id,
      name: patch.name || "预览数据源",
      kind: "rss",
      url: patch.url || "https://example.com/feed.xml",
      skillId: "rss-article-saver",
      enabled: patch.enabled ?? true,
      frequency: patch.frequency || "每日流水线",
      tags: patch.tags || [],
      lastRunAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      successRate: 100,
      status: patch.enabled === false ? "disabled" : "success",
      recentError: null,
      itemCount: 12
    }),
    deleteSource: async () => true,
    addRssSource: async (input) => ({ schemaVersion: 1, id: `${input.kind || "rss"}:${input.url}`, name: input.name, kind: input.kind || "rss", url: input.url, skillId: (input.kind || "rss") === "rss" ? "rss-article-saver" : null, enabled: true, frequency: input.frequency || "每日流水线", tags: input.tags || [], lastRunAt: null, lastSuccessAt: null, successRate: null, status: "idle", recentError: null, itemCount: 0 }),
    importOpml: async () => 2,
    listSourceRuns: async (sourceId) => [{ schemaVersion: 1, id: "preview-run", sourceId: sourceId || "source-rss", skillId: "rss-article-saver", status: "success", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 1200, code: 0, error: null, itemCount: 3, logs: [{ timestamp: new Date().toISOString(), stream: "stdout", text: "抓取完成，新增 3 篇文章。\n" }] }],
    runSource: async () => true,
    stopSource: async () => true,
    getDailyBrief: async (date) => ({
      schemaVersion: 1,
      date: date.replaceAll("-", ""),
      generatedAt: new Date().toISOString(),
      sourcePath: "mymind/daily-summary/demo.md",
      counts: { content: 42, unread: 12, articles: 30, posts: 6, reddit: 6, important: 4, topics: 3 },
      topics: [{ id: "topic-1", title: "本地 AI 工程工作台", summary: "围绕本地 Provider、上下文和可审核执行建立内容工作流。", score: 92, sourceCount: 6, contentIds: [] }],
      signals: ["本地 AI 工具正在从对话界面转向完整工程工作台"],
      watchlist: [],
      sourceContribution: [{ source: "Anthropic", count: 12 }, { source: "X", count: 10 }],
      recommendations: ["将本地 AI 工作台主题加入创作中心。"],
      markdown: "# 每日简报\n\n今天的核心信号是本地 AI 工程能力。"
    }),
    updateBriefWatchlist: async (input) => ({ schemaVersion: 1, date: input.date.replaceAll("-", ""), generatedAt: new Date().toISOString(), sourcePath: null, counts: { content: 0, unread: 0, articles: 0, posts: 0, reddit: 0, important: 0, topics: 0 }, topics: [], signals: [], watchlist: [], sourceContribution: [], recommendations: [], markdown: "" }),
    getDashboard: async (date) => ({
      schemaVersion: 1,
      date: date.replaceAll("-", ""),
      refreshedAt: new Date().toISOString(),
      metrics: { collected: 42, unread: 12, articles: 30, posts: 6, reddit: 6, drafting: 3, review: 1, ready: 1, failedSources: 0, pendingApprovals: 0 },
      sourceCounts: { articles: 6, posts: 9, reddit: 3 },
      recommendedTopics: [{ id: "topic-1", title: "本地 AI 工程工作台", summary: "完整的本地 AI 产品体验。", score: 92, sourceCount: 6, contentIds: [] }],
      creativeStages: [{ stage: "drafting", count: 3 }, { stage: "review", count: 1 }, { stage: "ready", count: 1 }, { stage: "published", count: 8 }],
      trend: Array.from({ length: 7 }, (_, index) => ({ date: `2026060${index + 1}`, content: 12 + index * 3, creative: index % 3 })),
      attention: []
    }),
    searchWorkspace: async (query) => {
      const normalized = query.toLocaleLowerCase();
      return [
        { id: "content:preview-content-1", kind: "content" as const, title: "工程级 AI 工作台设计", subtitle: "Anthropic · 文章", path: "mymind/article/demo.md", date: "20260615", status: null, targetId: "preview-content-1" },
        { id: "project:mymind/creative/demo", kind: "project" as const, title: "本地 AI 工程工作台", subtitle: "20260615 · 制作中", path: "mymind/creative/demo", date: "20260615", status: "drafting", targetId: "mymind/creative/demo" },
        { id: "skill:rss-article-saver", kind: "skill" as const, title: "RSS 文章抓取", subtitle: "拉取订阅并保存完整文章。", path: ".claude/skills/rss-article-saver", date: null, status: null, targetId: "rss-article-saver" }
      ].filter((item) => `${item.title} ${item.subtitle}`.toLocaleLowerCase().includes(normalized));
    },
    getCreativeTopics: async (date) => ({ date: date.replaceAll("-", ""), topics: [{ id: "topic-preview", title: "当天创作选题", platform: "公众号", section: "today_pick", score: 9, body: "# 当天创作选题\n\n根据所选日期加载。", starred: false, ignored: false, projectDir: null }] }),
    getAllCreativeTopics: async () => [
      { date: "20260617", label: "2026-06-17", topics: [{ id: "topic-preview", title: "全量创作选题", platform: "公众号", section: "today_pick", score: 9, body: "# 全量创作选题\n\n不再只展示当天。", starred: false, ignored: false, projectDir: null }] }
    ],
    addCreativeTopic: async (input) => ({ date: input.date.replaceAll("-", ""), topics: [{ id: `manual-${input.title}`, title: input.title, platform: input.platform || "未指定", section: "manual", score: input.score ?? 0, body: input.body, starred: false, ignored: false, projectDir: null }] }),
    getCreativeProjects: async () => [{ dir: "mymind/creative/demo", topic: "本地 AI 工程工作台", stage: "drafting", completion: 72 }],
    getCreativeProject: async (dir) => ({ dir, stage: "drafting", manifest: { topic: "本地 AI 工程工作台" }, files: { "topic-brief.md": "# Topic Brief\n\n工程级本地 AI 对话与任务执行。" } }),
    createCreativeProject: async (input) => ({ dir: `mymind/creative/${input.date}-${input.topic.title}`, stage: "drafting", manifest: { topic: input.topic.title }, files: { "topic-brief.md": input.topic.body || "", "draft.md": `# ${input.topic.title}\n\n` } }),
    saveCreativeFile: async (input) => ({ dir: input.projectDir, stage: "drafting", manifest: { topic: "本地 AI 工程工作台" }, files: { [input.file]: input.content } }),
    advanceCreativeProject: async (dir, stage) => ({ dir, stage, manifest: { topic: "本地 AI 工程工作台", stage: stage as CreativeStage }, files: { "draft.md": "# 本地 AI 工程工作台\n\n草稿内容。" } }),
    updateCreativeManifest: async (dir, patch) => ({ dir, stage: "ready", manifest: { topic: "本地 AI 工作台", ...patch } as Partial<CreativeProjectManifest>, files: { "draft.md": "# 本地 AI 工程工作台\n\n草稿内容。" } }),
    updateCreativeTopicState: async (date, topicId, patch) => ({ date: date.replaceAll("-", ""), topics: [{ id: topicId, title: "当天创作选题", body: "选题内容", ...patch }] }),
    reviewCreativeProject: async (dir) => ({ dir, stage: "review", manifest: { topic: "本地 AI 工程工作台" }, files: { "draft.md": "# 本地 AI 工程工作台\n\n草稿内容。" }, reviewReport: { score: 86, status: "pending", dimensions: { structure: 90, accuracy: 82, readability: 88, platform: 84, seo: 86 }, issues: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
    setCreativeReviewStatus: async (dir, status) => ({ dir, stage: "review", manifest: { topic: "本地 AI 工程工作台" }, files: { "draft.md": "# 本地 AI 工程工作台\n\n草稿内容。" }, reviewReport: { score: 86, status, dimensions: { structure: 90, accuracy: 82, readability: 88, platform: 84, seo: 86 }, issues: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
    listCreativeVersions: async (_dir, file) => [{ id: "v1", file, path: `versions/${file}/v1.md`, createdAt: new Date().toISOString(), note: "自动保存版本", size: 128 }],
    readCreativeVersion: async (path) => ({ path, content: "# 历史版本\n\n内容。" }),
    restoreCreativeVersion: async (dir, file) => ({ dir, stage: "drafting", manifest: { topic: "本地 AI 工程工作台" }, files: { [file]: "# 历史版本\n\n内容。" } }),
    getCreativeReleaseLog: async () => [{ id: "release-1", createdAt: new Date().toISOString(), action: "content_exported", stage: "ready", status: "exported", detail: "导出 Markdown" }],
    copyCreativeProject: async (dir) => ({ dir: `${dir}-copy`, stage: "drafting", manifest: { topic: "本地 AI 工程工作台（副本）" }, files: { "draft.md": "# 副本" } }),
    archiveCreativeProject: async (dir) => ({ dir: `${dir}-archived`, stage: "archived", manifest: { topic: "本地 AI 工程工作台", stage: "archived" }, files: { "draft.md": "# 已归档" } }),
    restoreCreativeProject: async (dir) => ({ dir, stage: "drafting", manifest: { topic: "本地 AI 工程工作台", stage: "drafting" }, files: { "draft.md": "# 已恢复" } }),
    deleteCreativeProject: async () => true,
    getCreativeAnalytics: async () => ({ total: 1, stages: [{ stage: "drafting", count: 1 }], platforms: [{ platform: "wechat", count: 1 }], averageCompletion: 72 }),
    bindCreativeSession: async () => ({ dir: "mymind/creative/demo", stage: "drafting", manifest: { topic: "测试项目", aiSessionIds: ["session-1"] }, files: {} }),
    selectFiles: async () => [],
    selectMymindFiles: async () => [],
    searchMymindFiles: async (query, limit = 40) => {
      const files = [
        "mymind/daily-summary/20260625_daily_summary.md",
        "mymind/post/20260624/posts.json",
        "mymind/wiki/index.md"
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
    setRepo: async (path) => path,
    detectRepo: async () => snapshot.projectRoot,
    selectRepo: async () => snapshot.projectRoot,
    getPreferences: async () => preferences,
    updatePreferences: async (patch) => { preferences = { ...preferences, ...patch }; return preferences; },
    resetPreferences: async () => { preferences = { ...preferences, themeMode: "light", accentColor: "#2563eb", density: "default", fontSize: "default" }; return preferences; },
    importPreferences: async () => ({ imported: true, preferences }),
    getEnvironmentDiagnostics: async () => [
      { id: "repo", label: "项目目录", status: "ok", value: snapshot.projectRoot, detail: null, path: snapshot.projectRoot },
      { id: "node", label: "Node.js", status: "ok", value: "preview", detail: null, path: null },
      { id: "git", label: "Git", status: "ok", value: "preview", detail: null, path: null }
    ],
    rebuildContentIndex: async () => ({ schemaVersion: 1, indexedDates: ["20260610"], itemCount: 1, indexPath: ".cctools/content-index.json", statePath: ".cctools/content-state.json", rebuiltAt: new Date().toISOString() }),
    aiRefresh: async () => snapshot,
    aiRefreshProviders: async () => undefined,
    aiRefreshSkills: async () => skills,
    aiPrewarm: async () => true,
    aiSearchSessions: async () => snapshot.sessions,
    aiStartRun: async () => { throw new Error("浏览器预览不执行真实 AI 任务。"); },
    aiCancelRun: async () => true,
    aiUpdateSession: async () => { throw new Error("预览模式没有会话。"); },
    aiDeleteSession: async () => true,
    aiGetEvents: async () => previewEvents,
    aiResolveApproval: async () => true,
    aiGetChangeSet: async () => null,
    aiApplyChange: async () => ({ applied: true }),
    aiRevertChange: async () => ({ applied: true }),
    aiDiscardChange: async () => null,
    aiDiscardRun: async () => true,
    runSkill: async () => true,
    stopSkill: async () => true,
    onAiEvent: (callback) => { listeners.add(callback as never); return () => listeners.delete(callback as never); },
    onSkillEvent: () => () => {}
  };
  window.cctools = api;
  return true;
}

function isElectronRenderer(): boolean {
  return /\bElectron\//i.test(navigator.userAgent);
}
