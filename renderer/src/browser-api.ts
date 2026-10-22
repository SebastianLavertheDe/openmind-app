import { messages } from "@shared/messages";
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
import { DEFAULT_AUTOMATION_RULES } from "@shared/automation-defaults";
import { YOUTUBE_TOOLS, type YoutubeToolId, type YoutubeToolStatus } from "@shared/youtube-import";
import type { AutomationRule } from "@shared/contracts";
import type { ProjectDetail, ProjectMaterial, ProjectOutput, ProjectOutputRead, ProjectSummary, ProjectTask, ProjectTaskMessage, ProjectVideoReadMetadata } from "@shared/project-contracts";

export function installBrowserPreviewApi(): boolean {
  if (window.openmind) return true;
  if (isElectronRenderer()) return false;
  const youtubeToolPreview = (id: YoutubeToolId): YoutubeToolStatus => ({ id, state: "missing", version: null, source: null, canInstall: false, operation: "idle", update: "unchecked", latestVersion: null });
  const previewProjectRoot = "/fixtures/openmind-data";
  // The selected private repository is the content root itself. Keep the
  // preview contract identical to desktop: there is no nested `openmind/`.
  const previewOpenmindRoot = previewProjectRoot;
  const previewManagedProjectId = "5a111111-1111-4111-8111-111111111111";
  const onboardingPreview = new URLSearchParams(window.location.search).get("preview") === "onboarding";
  let previewRootReady = !onboardingPreview;
  let previewSkillsReady = !onboardingPreview;
  let previewDefaultSkillsEnabled = !onboardingPreview;
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
      scope: { type: "workspace" },
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
      scope: { type: "workspace" },
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
    uiLanguage: "zh-CN" as const,
    density: "default" as const,
    fontSize: "default" as const,
    autoSaveIntervalMs: 30000,
    maxVersions: 50,
    archiveAfterDays: 90,
    defaultReadFilter: "all" as const,
    contentPreviewMode: "sidebar" as const,
    markReadOnOpen: true,
    defaultProvider: "",
    youtubeBrowser: "",
    defaultPermissionProfile: "auto" as const,
    notesDir: "openmind",
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
    { schemaVersion: 1, id: "source-reddit-local-llama", name: "r/LocalLLaMA", kind: "reddit", url: "https://www.reddit.com/r/LocalLLaMA/hot.json", skillId: "reddit-fetcher", enabled: true, frequency: "每日流水线", tags: ["AI", "社区"], lastRunAt: "2026-08-22T08:45:00.000Z", lastSuccessAt: "2026-08-22T08:45:00.000Z", successRate: 100, status: "success", recentError: null, itemCount: 18 },
    { schemaVersion: 1, id: "source-reddit-claude-ai", name: "r/ClaudeAI", kind: "reddit", url: "https://www.reddit.com/r/ClaudeAI/hot.json", skillId: "reddit-fetcher", enabled: true, frequency: "每日流水线", tags: ["AI", "社区"], lastRunAt: "2026-08-22T08:45:00.000Z", lastSuccessAt: "2026-08-22T08:45:00.000Z", successRate: 100, status: "success", recentError: null, itemCount: 18 },
    { schemaVersion: 1, id: "source-x", name: "X 关注账号", kind: "x", url: null, skillId: "x-following-fetcher", enabled: true, frequency: "每日流水线", tags: ["动态"], lastRunAt: "2026-08-22T08:15:00.000Z", lastSuccessAt: "2026-08-22T08:15:00.000Z", successRate: 100, status: "success", recentError: null, itemCount: 24 }
  ];
  const projectCreatedAt = "2026-08-27T08:00:00.000Z";
  let previewProjects: ProjectSummary[] = [{
    schemaVersion: 2,
    id: previewManagedProjectId,
    name: "AI 安全",
    description: "整理可信资料，并完成 AI 安全主题创作。",
    status: "active",
    icon: "database",
    color: "neutral",
    favorite: false,
    materialCount: 3,
    taskCount: 1,
    outputCount: 1,
    createdAt: projectCreatedAt,
    updatedAt: "2026-08-31T09:30:00.000Z"
  }];
  let previewProjectMaterials: ProjectMaterial[] = [{
    projectName: "AI 安全",
    relativePath: "materials/documents/AI安全研究.md",
    title: "AI 安全研究",
    kind: "document",
    status: "ready",
    source: { type: "file", originalName: "AI安全研究.md" },
    originalRelativePath: null,
    mimeType: "text/markdown",
    byteSize: 2380,
    sha256: null,
    converterId: "markdown-copy",
    errorCode: null,
    errorMessage: null,
    createdAt: projectCreatedAt,
    updatedAt: "2026-08-31T09:00:00.000Z"
  }, {
    projectName: "AI 安全",
    relativePath: "materials/web/Anthropic提示词注入研究.web.md",
    title: "Anthropic 提示词注入研究",
    kind: "web",
    status: "ready",
    source: { type: "url", url: "https://example.com/ai-safety" },
    originalRelativePath: null,
    mimeType: "text/markdown",
    byteSize: 4210,
    sha256: null,
    converterId: "readability-markdown",
    errorCode: null,
    errorMessage: null,
    createdAt: projectCreatedAt,
    updatedAt: "2026-08-31T09:10:00.000Z"
  }, {
    projectName: "AI 安全",
    relativePath: "materials/videos/Steve-Jobs-keynote.video.md",
    title: "Steve Jobs MacWorld keynote",
    kind: "video",
    status: "ready",
    source: { type: "url", url: "https://www.youtube.com/watch?v=MnrJzXM7a6o" },
    originalRelativePath: null,
    mimeType: "text/markdown",
    byteSize: 6320,
    sha256: null,
    converterId: "youtube-caption",
    errorCode: null,
    errorMessage: null,
    createdAt: projectCreatedAt,
    updatedAt: "2026-08-31T09:20:00.000Z"
  }];
  const previewProjectMaterialContent = new Map<string, string>([
    ["materials/documents/AI安全研究.md", "# AI 安全研究\n\n## 关键问题\n\n模型能力提升后，权限边界、指令注入和来源可信度成为产品设计的核心问题。\n\n## 原则\n\n- 资料是参考数据，不是系统指令。\n- 高风险操作需要显式批准。\n- 每次创作保留可追溯引用。"],
    ["materials/web/Anthropic提示词注入研究.web.md", "# Anthropic 提示词注入研究\n\n- URL：https://example.com/ai-safety\n- 抓取时间：2026-08-31\n\n## 摘要\n\n网页正文转换为 Markdown 后，AI 可以通过普通文件搜索按需读取，而无需额外向量索引。"],
    ["materials/videos/Steve-Jobs-keynote.video.md", "# Steve Jobs MacWorld keynote\n\n## 元数据\n\n- 类型：video\n- Provider：youtube\n- URL：https://www.youtube.com/watch?v=MnrJzXM7a6o\n- Video ID：MnrJzXM7a6o\n- 时长：01:20:15\n\n## 字幕\n\n[00:07.000–00:18.000] this is a day I've been looking forward to for two and a half years\n\n[00:19.000–00:25.000] every once in a while a revolutionary product comes along\n\n[00:26.000–00:34.000] today Apple is going to reinvent the phone"]
  ]);
  const previewProjectVideo: ProjectVideoReadMetadata = {
    localMediaUrl: null,
    provider: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=MnrJzXM7a6o",
    embedUrl: "https://www.youtube-nocookie.com/embed/MnrJzXM7a6o?enablejsapi=1",
    videoId: "MnrJzXM7a6o",
    mediaType: "video",
    title: "Steve Jobs MacWorld keynote",
    durationMs: 4_815_000,
    thumbnailUrl: null,
    transcript: [
      { startMs: 7_000, endMs: 18_000, text: "this is a day I've been looking forward to for two and a half years" },
      { startMs: 19_000, endMs: 25_000, text: "every once in a while a revolutionary product comes along" },
      { startMs: 26_000, endMs: 34_000, text: "today Apple is going to reinvent the phone" }
    ],
    transcriptSource: "platform",
    warnings: []
  };
  let previewProjectTasks: ProjectTask[] = [{
    taskId: "3c111111-1111-4111-8111-111111111111",
    projectId: previewManagedProjectId,
    projectName: "AI 安全",
    title: "整理 AI 安全创作框架",
    sessionId: "preview-session",
    previousSessionIds: [],
    providerId: "claude-preview",
    status: "active",
    createdAt: projectCreatedAt,
    updatedAt: "2026-08-31T09:25:00.000Z"
  }];
  let previewProjectOutputs: ProjectOutputRead[] = [{
    output: {
      projectName: "AI 安全",
      relativePath: "outputs/AI安全行业分析.md",
      title: "AI 安全行业分析",
      sourceTaskId: previewProjectTasks[0].taskId,
      sourceSessionId: "preview-session",
      sourceMessageId: "preview-answer",
      createdAt: projectCreatedAt,
      updatedAt: "2026-08-31T09:30:00.000Z"
    },
    content: "# AI 安全行业分析\n\n## 结论\n\n安全能力应与 Agent 权限、资料可信边界和可恢复执行一起设计。\n\n## 建议\n\n1. 默认只读。\n2. 显式展示资料引用。\n3. 输出由应用受控保存。"
  }];
  const previewProjectDetail = (name: string): ProjectDetail => {
    const current = previewProjects.find((project) => project.name === name);
    if (!current) throw new Error(messages.browserPreview.projectMissing);
    const project: ProjectSummary = {
      ...current,
      materialCount: previewProjectMaterials.filter((item) => item.projectName === name).length,
      taskCount: previewProjectTasks.filter((item) => item.projectName === name && item.status !== "archived").length,
      outputCount: previewProjectOutputs.filter((item) => item.output.projectName === name).length
    };
    previewProjects = previewProjects.map((item) => item.name === name ? project : item);
    return { project };
  };
  const previewAutomationRules: AutomationRule[] = DEFAULT_AUTOMATION_RULES.map((input, index) => ({
    schemaVersion: 1,
    ...input,
    lastTriggeredAt: null,
    lastScheduledKey: null,
    createdAt: `2026-06-28T08:0${index}:00.000Z`,
    updatedAt: `2026-06-28T08:0${index}:00.000Z`
  }));
  let previewXFollowingCurls = [[
    "curl 'https://x.com/i/api/graphql/HomeLatestTimeline' \\",
    "  -H 'authorization: Bearer ••••••••' \\",
    "  -H 'content-type: application/json' \\",
    "  --data-raw '{\"variables\":{\"count\":20}}'"
  ].join("\n")];
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
    readImagePreview: async () => { throw new Error(messages.browserPreview.localImageUnavailable); },
    readChatImage: async () => { throw new Error(messages.browserPreview.chatImageUnavailable); },
    getImageConfiguration: async () => ({ defaultSelection: null, providers: [] }),
    selectImageModel: async () => { throw new Error(messages.browserPreview.imageModelUnavailable); },
    getWechatAccount: async () => ({ appId: "", author: "", configured: false }),
    saveWechatAccount: async () => { throw new Error(messages.browserPreview.wechatSaveUnavailable); },
    disconnectWechatAccount: async () => { throw new Error(messages.browserPreview.wechatManageUnavailable); },
    chooseWechatCover: async () => { throw new Error(messages.browserPreview.wechatCoverUnavailable); },
    pushWechatDraft: async () => { throw new Error(messages.browserPreview.wechatDraftUnavailable); },
    copyWechatArticle: async ({ html, text }) => {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined" || ClipboardItem.supports?.("text/html") === false) {
        throw new Error(messages.browserPreview.richClipboardUnavailable);
      }
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })]);
    },
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
    getXFollowingCurls: async () => [...previewXFollowingCurls],
    saveXFollowingCurls: async (contents) => { previewXFollowingCurls = contents.map((content) => content.trim()); },
    listSources: async () => previewSources,
    updateSource: async (id, patch) => {
      const current = previewSources.find((source) => source.id === id);
      if (!current) throw new Error(messages.browserPreview.sourceMissing);
      const updated: SourceDefinition = {
        ...current,
        ...patch,
        status: patch.enabled === false ? "disabled" : patch.enabled === true && current.status === "disabled" ? "idle" : current.status
      };
      previewSources = previewSources.map((source) => source.id === id ? updated : source);
      return updated;
    },
    addRssSource: async (input) => {
      const kind = input.kind || "rss";
      const skillId = kind === "rss" ? "rss-article-saver" : kind === "reddit" ? "reddit-fetcher" : null;
      const source: SourceDefinition = { schemaVersion: 1, id: `${kind}:${input.url}`, name: input.name, kind, url: input.url, skillId, enabled: true, frequency: input.frequency || "每日流水线", tags: input.tags || [], lastRunAt: null, lastSuccessAt: null, successRate: null, status: "idle", recentError: null, itemCount: 0 };
      previewSources = [...previewSources, source];
      return source;
    },
    importOpml: async () => 2,
    listProjects: async () => previewProjects.map((project) => previewProjectDetail(project.name).project),
    createProject: async (input) => {
      if (previewProjects.some((project) => project.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) throw new Error(messages.browserPreview.projectNameExists);
      const now = new Date().toISOString();
      const project: ProjectSummary = { schemaVersion: 2, id: crypto.randomUUID(), name: input.name, description: input.description || "", status: "active", icon: "database", color: "neutral", favorite: false, materialCount: 0, taskCount: 0, outputCount: 0, createdAt: now, updatedAt: now };
      previewProjects = [project, ...previewProjects];
      return { project };
    },
    getProject: async (projectName) => previewProjectDetail(projectName),
    renameProject: async ({ projectName, newName }) => {
      const current = previewProjectDetail(projectName).project;
      const now = new Date().toISOString();
      const renamed = { ...current, name: newName, updatedAt: now };
      previewProjects = previewProjects.map((project) => project.name === projectName ? renamed : project);
      previewProjectMaterials = previewProjectMaterials.map((material) => material.projectName === projectName ? { ...material, projectName: newName, updatedAt: now } : material);
      previewProjectTasks = previewProjectTasks.map((task) => task.projectName === projectName ? { ...task, projectName: newName, updatedAt: now } : task);
      previewProjectOutputs = previewProjectOutputs.map((entry) => entry.output.projectName === projectName ? { ...entry, output: { ...entry.output, projectName: newName, updatedAt: now } } : entry);
      return { project: renamed };
    },
    updateProject: async ({ projectName, icon, color, favorite }) => {
      const current = previewProjectDetail(projectName).project;
      const project = {
        ...current,
        ...(icon !== undefined ? { icon } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(favorite !== undefined ? { favorite } : {}),
        updatedAt: new Date().toISOString()
      };
      previewProjects = previewProjects.map((item) => item.name === projectName ? project : item);
      return { project };
    },
    archiveProject: async ({ projectName, archived }) => {
      const current = previewProjectDetail(projectName).project;
      const project = { ...current, status: archived ? "archived" as const : "active" as const, updatedAt: new Date().toISOString() };
      previewProjects = previewProjects.map((item) => item.name === projectName ? project : item);
      return { project };
    },
    addProjectFiles: async () => [],
    addProjectUrl: async ({ projectName, url }) => {
      const now = new Date().toISOString();
      const isVideo = /(?:youtube\.com|youtu\.be)/i.test(url);
      const relativePath = isVideo ? `materials/videos/video-${previewProjectMaterials.length + 1}.video.md` : `materials/web/web-${previewProjectMaterials.length + 1}.web.md`;
      const material: ProjectMaterial = { projectName, relativePath, title: isVideo ? "新视频资料" : "新网页资料", kind: isVideo ? "video" : "web", status: "ready", source: { type: "url", url }, originalRelativePath: null, mimeType: "text/markdown", byteSize: 0, sha256: null, converterId: isVideo ? "youtube-caption" : "readability-markdown", errorCode: null, errorMessage: null, createdAt: now, updatedAt: now };
      previewProjectMaterials = [material, ...previewProjectMaterials];
      previewProjectMaterialContent.set(relativePath, `# ${material.title}\n\n- URL：${url}\n\n浏览器预览不会执行真实抓取。`);
      previewProjectDetail(projectName);
      return material;
    },
    retryMaterialExtraction: async ({ projectName, relativePath }) => {
      const current = previewProjectMaterials.find((item) => item.projectName === projectName && item.relativePath === relativePath);
      if (!current) throw new Error(messages.browserPreview.materialMissing);
      const material = { ...current, status: "ready" as const, errorCode: null, errorMessage: null, updatedAt: new Date().toISOString() };
      previewProjectMaterials = previewProjectMaterials.map((item) => item === current ? material : item);
      return material;
    },
    removeProjectMaterial: async ({ projectName, relativePath }) => {
      const before = previewProjectMaterials.length;
      previewProjectMaterials = previewProjectMaterials.filter((item) => !(item.projectName === projectName && item.relativePath === relativePath));
      previewProjectMaterialContent.delete(relativePath);
      previewProjectDetail(projectName);
      return previewProjectMaterials.length < before;
    },
    renameProjectMaterial: async ({ projectName, relativePath, newTitle }) => {
      const current = previewProjectMaterials.find((item) => item.projectName === projectName && item.relativePath === relativePath);
      if (!current) throw new Error(messages.browserPreview.materialMissing);
      const material: ProjectMaterial = { ...current, title: newTitle, updatedAt: new Date().toISOString() };
      previewProjectMaterials = previewProjectMaterials.map((item) => item === current ? material : item);
      return material;
    },
    moveProjectMaterial: async ({ projectName, relativePath, targetProjectName }) => {
      const current = previewProjectMaterials.find((item) => item.projectName === projectName && item.relativePath === relativePath);
      if (!current) throw new Error(messages.browserPreview.materialMissing);
      const material: ProjectMaterial = { ...current, projectName: targetProjectName, updatedAt: new Date().toISOString() };
      previewProjectMaterials = previewProjectMaterials.map((item) => item === current ? material : item);
      previewProjectDetail(projectName);
      previewProjectDetail(targetProjectName);
      return material;
    },
    readProjectMaterial: async ({ projectName, relativePath }) => {
      const material = previewProjectMaterials.find((item) => item.projectName === projectName && item.relativePath === relativePath);
      if (!material) throw new Error(messages.browserPreview.materialMissing);
      return { material, content: previewProjectMaterialContent.get(relativePath) || "", truncated: false, ...(material.kind === "video" ? { video: previewProjectVideo } : {}) };
    },
    readProjectMaterialOriginal: async () => {
      throw new Error(messages.browserPreview.originalPdfUnavailable);
    },
    listProjectMaterials: async (projectName) => previewProjectMaterials.filter((item) => item.projectName === projectName),
    createProjectTask: async ({ projectName, title, providerId }) => {
      const now = new Date().toISOString();
      const projectId = previewProjectDetail(projectName).project.id;
      const task: ProjectTask = { taskId: crypto.randomUUID(), projectId, projectName, title, sessionId: null, previousSessionIds: [], providerId, status: "active", createdAt: now, updatedAt: now };
      previewProjectTasks = [task, ...previewProjectTasks];
      previewProjectDetail(projectName);
      return task;
    },
    listProjectTasks: async (projectName) => previewProjectTasks.filter((task) => task.projectName === projectName && task.status !== "archived"),
    listProjectTaskMessages: async ({ projectName, taskId }) => {
      const task = previewProjectTasks.find((item) => item.projectName === projectName && item.taskId === taskId);
      if (!task) throw new Error(messages.browserPreview.taskMissing);
      return [] as ProjectTaskMessage[];
    },
    renameProjectTask: async ({ projectName, taskId, title }) => {
      const current = previewProjectTasks.find((task) => task.projectName === projectName && task.taskId === taskId);
      if (!current) throw new Error(messages.browserPreview.taskMissing);
      const task: ProjectTask = { ...current, title, updatedAt: new Date().toISOString() };
      previewProjectTasks = previewProjectTasks.map((item) => item.taskId === taskId ? task : item);
      return task;
    },
    archiveProjectTask: async ({ projectName, taskId }) => {
      const current = previewProjectTasks.find((task) => task.projectName === projectName && task.taskId === taskId);
      if (!current) throw new Error(messages.browserPreview.taskMissing);
      const task: ProjectTask = { ...current, status: "archived", updatedAt: new Date().toISOString() };
      previewProjectTasks = previewProjectTasks.map((item) => item.taskId === taskId ? task : item);
      return task;
    },
    projectStartTaskRun: async ({ projectName, taskId }) => {
      const current = previewProjectTasks.find((task) => task.projectName === projectName && task.taskId === taskId);
      if (!current) throw new Error(messages.browserPreview.taskMissing);
      const task = { ...current, sessionId: "preview-session", updatedAt: new Date().toISOString() };
      previewProjectTasks = previewProjectTasks.map((item) => item.taskId === taskId ? task : item);
      return { task, session: snapshot.sessions[0], run: snapshot.runs[0] };
    },
    listProjectOutputs: async (projectName) => previewProjectOutputs.filter((entry) => entry.output.projectName === projectName).map((entry) => entry.output),
    createProjectOutput: async (input) => {
      const now = new Date().toISOString();
      const base = input.title.trim().replace(/[\\/:*?"<>|]/g, "-") || "未命名成品";
      const output: ProjectOutput = { projectName: input.projectName, relativePath: `outputs/${base}.md`, title: input.title, sourceTaskId: input.sourceTaskId || null, sourceSessionId: input.sourceSessionId || null, sourceMessageId: input.sourceMessageId || null, createdAt: now, updatedAt: now };
      const result = { output, content: input.content || "" };
      previewProjectOutputs = [result, ...previewProjectOutputs.filter((entry) => entry.output.relativePath !== output.relativePath || entry.output.projectName !== output.projectName)];
      previewProjectDetail(input.projectName);
      return result;
    },
    readProjectOutput: async ({ projectName, relativePath }) => {
      const result = previewProjectOutputs.find((entry) => entry.output.projectName === projectName && entry.output.relativePath === relativePath);
      if (!result) throw new Error(messages.browserPreview.outputMissing);
      return result;
    },
    saveProjectOutput: async ({ projectName, relativePath, title, content }) => {
      const current = previewProjectOutputs.find((entry) => entry.output.projectName === projectName && entry.output.relativePath === relativePath);
      if (!current) throw new Error(messages.browserPreview.outputMissing);
      const result = { output: { ...current.output, title: title || current.output.title, updatedAt: new Date().toISOString() }, content };
      previewProjectOutputs = previewProjectOutputs.map((entry) => entry === current ? result : entry);
      return result;
    },
    removeProjectOutput: async ({ projectName, relativePath }) => {
      const before = previewProjectOutputs.length;
      previewProjectOutputs = previewProjectOutputs.filter((entry) => !(entry.output.projectName === projectName && entry.output.relativePath === relativePath));
      previewProjectDetail(projectName);
      return previewProjectOutputs.length < before;
    },
    renameProjectOutput: async ({ projectName, relativePath, newTitle }) => {
      const current = previewProjectOutputs.find((entry) => entry.output.projectName === projectName && entry.output.relativePath === relativePath);
      if (!current) throw new Error(messages.browserPreview.outputMissing);
      const result = { output: { ...current.output, title: newTitle, updatedAt: new Date().toISOString() }, content: current.content };
      previewProjectOutputs = previewProjectOutputs.map((entry) => entry === current ? result : entry);
      return result;
    },
    moveProjectOutput: async ({ projectName, relativePath, targetProjectName }) => {
      const current = previewProjectOutputs.find((entry) => entry.output.projectName === projectName && entry.output.relativePath === relativePath);
      if (!current) throw new Error(messages.browserPreview.outputMissing);
      const result = { output: { ...current.output, projectName: targetProjectName, sourceTaskId: null, sourceSessionId: null, sourceMessageId: null, updatedAt: new Date().toISOString() }, content: current.content };
      previewProjectOutputs = previewProjectOutputs.map((entry) => entry === current ? result : entry);
      previewProjectDetail(projectName);
      previewProjectDetail(targetProjectName);
      return result;
    },
    downloadProjectFile: async () => ({ canceled: true, savedPath: null }),
    searchWorkspace: async (query) => {
      const normalized = query.toLocaleLowerCase();
      return [
        { id: "content:preview-content-1", kind: "content" as const, title: "工程级 AI 工作台设计", subtitle: "Anthropic · 文章", path: "openmind/article/demo.md", date: "20260615", status: null, targetId: "preview-content-1" },
        { id: "project:演示项目", kind: "project" as const, title: "演示项目", subtitle: "1 份资料 · 1 个任务 · 1 个成品", path: "projects/演示项目", date: "20260616", status: "active", targetId: "演示项目" },
        { id: "creative-project:openmind/creative/demo", kind: "creative-project" as const, title: "本地 AI 工程工作台", subtitle: "20260615 · 制作中", path: "openmind/creative/demo", date: "20260615", status: "drafting", targetId: "openmind/creative/demo" },
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
    pathForFile: (file) => `/preview/${file.name}`,
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
        expectedStructureVersion: "openmind-layout-v4",
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
        expectedStructureVersion: "openmind-layout-v4",
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
    getYoutubeImportStatus: async () => ({ browsers: [], downloaderAvailable: false, ffmpegAvailable: false, javascriptRuntimeAvailable: false, tools: YOUTUBE_TOOLS.map(youtubeToolPreview) }),
    checkYoutubeToolUpdate: async (id) => youtubeToolPreview(id),
    installYoutubeTool: async (id) => youtubeToolPreview(id),
    updatePreferences: async (patch) => { preferences = { ...preferences, ...patch }; return preferences; },
    getOnboardingState: async () => onboardingState,
    updateOnboardingState: async (patch) => { onboardingState = { ...onboardingState, ...patch }; return onboardingState; },
    resetPreferences: async () => { preferences = { ...preferences, themeMode: "light", density: "default", fontSize: "default" }; return preferences; },
    getBrowserSkillStatus: async () => ({ skillInstalled: false, skillEnabled: false, cliAvailable: false, cliVersion: null, browserConnected: false, ready: false, diagnostic: messages.browserPreview.browserDisconnected }),
    installBrowserSkill: async () => { throw new Error(messages.browserPreview.browserSkillInstallUnavailable); },
    getMcpServers: async () => [],
    getProviders: async (): Promise<ProvidersYamlView> => ({ schemaVersion: 1, default: "", cli: { claude: null, codex: null }, providers: [] }),
    getProviderApiKey: async (): Promise<string> => "",
    saveProviders: async (_input: ProvidersYamlInput): Promise<ProvidersYamlView> => ({ schemaVersion: 1, default: "", cli: { claude: null, codex: null }, providers: [] }),
    getSharedPythonRuntimeStatus: async () => ({ enabled: false, phase: "disabled", target: "windows-x64", pythonVersion: null, uvVersion: null, managedSkills: 0, ready: false, lastError: null }),
    setSharedPythonRuntimeEnabled: async (enabled) => ({ enabled, phase: enabled ? "ready" : "disabled", target: "windows-x64", pythonVersion: enabled ? "3.12.10" : null, uvVersion: enabled ? "0.8.15" : null, managedSkills: enabled ? 3 : 0, ready: enabled, lastError: null }),
    aiRefresh: async () => snapshot,
    aiRefreshProviders: async () => undefined,
    installCliTool: async () => { throw new Error(messages.browserPreview.cliInstallUnavailable); },
    upgradeCliTool: async () => { throw new Error(messages.browserPreview.cliUpgradeUnavailable); },
    checkCliToolUpdate: async (cli) => ({ cli, installed: false, currentVersion: null, latestVersion: null, updateAvailable: false, canUpgrade: false, checkedAt: new Date().toISOString(), source: "unknown" }),
    cancelCliToolInstall: async () => false,
    openCliLogin: async () => { throw new Error(messages.browserPreview.cliLoginUnavailable); },
    aiRefreshSkills: async () => skills,
    inspectInstalledSkill: async (key) => previewSkillInspections.get(previewInstalledSkills.find((skill) => skill.key === key)?.id || "") || null,
    listInstalledSkills: async () => previewSkillsReady ? previewInstalledSkills : [],
    getDefaultSkillsEnabled: async () => previewDefaultSkillsEnabled,
    setDefaultSkillsEnabled: async (enabled) => {
      previewDefaultSkillsEnabled = enabled;
      previewSkillsReady = enabled;
      return enabled;
    },
    installSkillSource: async () => { previewSkillsReady = true; return []; },
    listInstalledRunnableSkills: async () => [],
    setInstalledSkillEnabled: async (key, digest, enabled) => {
      const current = previewInstalledSkills.find((skill) => skill.key === key && skill.digest === digest);
      if (!current) throw new Error(messages.browserPreview.skillMissing);
      const updated = { ...current, enabled };
      previewInstalledSkills = previewInstalledSkills.map((skill) => skill.key === key ? updated : skill);
      return updated;
    },
    listSkillRuns: async () => [],
    getSkillRun: async () => { throw new Error(messages.browserPreview.skillRunUnavailable); },
    getSkillRunEvents: async () => [],
    listRunArtifacts: async () => [],
    retrySkillRun: async () => { throw new Error(messages.browserPreview.skillRunUnavailable); },
    retryWorkflowStep: async () => { throw new Error(messages.browserPreview.workflowUnavailable); },
    deleteRunHistory: async () => false,
    cancelSkillRun: async () => false,
    listWorkflowRuns: async () => [],
    getWorkflowRun: async () => { throw new Error(messages.browserPreview.workflowUnavailable); },
    resumeWorkflowRun: async () => { throw new Error(messages.browserPreview.workflowUnavailable); },
    cancelWorkflowRun: async () => false,
    listAutomationRules: async () => !previewSkillsReady && onboardingPreview ? []
      : previewAutomationRules.map((rule) => ({ ...rule, enabled: previewDefaultSkillsEnabled })),
    saveAutomationRule: async () => { throw new Error(messages.browserPreview.automationRuleUnavailable); },
    deleteAutomationRule: async () => false,
    runAutomationNow: async () => { throw new Error(messages.browserPreview.automationRunUnavailable); },
    listAutomationRuns: async () => [],
    listAutomationSchedules: async () => [],
    aiPrewarm: async () => true,
    aiStartRun: async () => { throw new Error(messages.browserPreview.aiRunUnavailable); },
    aiCancelRun: async () => true,
    aiUpdateSession: async () => { throw new Error(messages.browserPreview.sessionUnavailable); },
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
