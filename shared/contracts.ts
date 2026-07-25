import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const IpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  detail: z.string().nullable().default(null),
  recoverable: z.boolean().default(true)
});
export type IpcErrorPayload = z.infer<typeof IpcErrorSchema>;

export const ProviderKindSchema = z.enum(["codex", "claude"]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const AiProjectSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  root: z.string(),
  createdAt: z.string()
});
export type AiProject = z.infer<typeof AiProjectSchema>;

export const PermissionProfileSchema = z.enum(["read-only", "edit", "auto"]);
export type PermissionProfile = z.infer<typeof PermissionProfileSchema>;

/** Provider 原生交互模式。与文件/命令权限分开，避免把只读权限误当成 Plan 模式。 */
export const InteractionModeSchema = z.enum(["default", "plan"]);
export type InteractionMode = z.infer<typeof InteractionModeSchema>;

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting-approval",
  "completed",
  "failed",
  "cancelled",
  "applying",
  "conflicted"
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const EventKindSchema = z.enum([
  "user-message",
  "assistant-message",
  "assistant-delta",
  "reasoning-delta",
  "reasoning-summary",
  "plan",
  "todo",
  "tool-start",
  "tool-output",
  "tool-complete",
  "approval-request",
  "approval-decision",
  "status",
  "usage",
  "changes",
  "risk",
  "error",
  "system"
]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const ContextReferenceSchema = z.object({
  id: z.string(),
  kind: z.enum(["content", "creative", "file", "image", "selection"]),
  label: z.string(),
  path: z.string().optional(),
  content: z.string().optional(),
  mediaType: z.string().optional(),
  byteSize: z.number().int().nonnegative().optional()
});
export type ContextReference = z.infer<typeof ContextReferenceSchema>;

export const AiTurnContextSchema = z.object({
  cwd: z.string(),
  currentDate: z.string(),
  timezone: z.string(),
  capturedAt: z.string()
});
export type AiTurnContext = z.infer<typeof AiTurnContextSchema>;

export const ProjectFileMatchSchema = z.object({
  path: z.string(),
  name: z.string(),
  directory: z.string(),
  extension: z.string()
});
export type ProjectFileMatch = z.infer<typeof ProjectFileMatchSchema>;

export const ProjectFileSearchResultSchema = z.object({
  items: z.array(ProjectFileMatchSchema),
  indexedCount: z.number().int().nonnegative(),
  truncated: z.boolean()
});
export type ProjectFileSearchResult = z.infer<typeof ProjectFileSearchResultSchema>;

export const RiskFindingSchema = z.object({
  id: z.string(),
  kind: z.enum(["token", "private-key", "cookie", "credential", "absolute-path"]),
  severity: z.enum(["warning", "high"]),
  summary: z.string(),
  eventId: z.string().optional()
});
export type RiskFinding = z.infer<typeof RiskFindingSchema>;

export const ChangeFileSchema = z.object({
  path: z.string(),
  status: z.enum(["created", "modified", "deleted", "renamed"]),
  additions: z.number().default(0),
  deletions: z.number().default(0),
  patch: z.string().default("")
});
export type ChangeFile = z.infer<typeof ChangeFileSchema>;

export const ChangeSetSchema = z.object({
  id: z.string(),
  runId: z.string(),
  baseCommit: z.string(),
  files: z.array(ChangeFileSchema),
  patch: z.string(),
  createdAt: z.string(),
  status: z.enum(["pending", "partially-applied", "applied", "discarded", "conflicted"]).default("pending"),
  appliedPatches: z.array(z.string()).default([]),
  appliedFiles: z.array(z.string()).default([]),
  appliedAt: z.string().optional(),
  discardedAt: z.string().optional()
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sessionId: z.string(),
  providerRequestId: z.union([z.string(), z.number()]),
  category: z.enum(["command", "file-change", "delete", "outside-workspace", "network", "elevation", "tool"]),
  title: z.string(),
  detail: z.string(),
  cwd: z.string().optional(),
  command: z.string().optional(),
  paths: z.array(z.string()).default([]),
  createdAt: z.string(),
  status: z.enum(["pending", "accepted", "accepted-session", "declined"]).default("pending")
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ToolInvocationSchema = z.object({
  id: z.string(),
  runId: z.string(),
  provider: ProviderKindSchema,
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "running", "completed", "failed", "declined"]),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  output: z.unknown().optional(),
  error: z.string().nullable().default(null)
});
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;

export const AiSessionSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  projectId: z.string(),
  projectRoot: z.string(),
  title: z.string(),
  provider: ProviderKindSchema,
  providerId: z.string(),
  providerSessionId: z.string().nullable().default(null),
  forkedFromId: z.string().nullable().optional(),
  cwd: z.string(),
  permissionProfile: PermissionProfileSchema,
  interactionMode: InteractionModeSchema.default("default"),
  status: z.enum(["idle", "running", "waiting-approval", "failed"]).default("idle"),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunId: z.string().nullable().default(null)
});
type ParsedAiSession = z.infer<typeof AiSessionSchema>;
/** interactionMode 可选仅用于兼容旧持久化对象与既有调用方；Schema 解析后始终补 default。 */
export type AiSession = Omit<ParsedAiSession, "interactionMode"> & { interactionMode?: InteractionMode };

export const AiRunSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  sessionId: z.string(),
  projectId: z.string(),
  provider: ProviderKindSchema,
  providerId: z.string().default("legacy"),
  permissionProfile: PermissionProfileSchema.default("edit"),
  interactionMode: InteractionModeSchema.default("default"),
  status: RunStatusSchema,
  prompt: z.string(),
  contexts: z.array(ContextReferenceSchema).default([]),
  turnContext: AiTurnContextSchema.nullable().default(null),
  workspacePath: z.string().nullable().default(null),
  baseCommit: z.string().nullable().default(null),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  changeSet: ChangeSetSchema.nullable().default(null),
  risks: z.array(RiskFindingSchema).default([]),
  rolledBackAt: z.string().nullable().optional()
});
type ParsedAiRun = z.infer<typeof AiRunSchema>;
export type AiRun = Omit<ParsedAiRun, "interactionMode"> & { interactionMode?: InteractionMode };

export const AiEventSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  seq: z.number(),
  timestamp: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  runId: z.string(),
  provider: ProviderKindSchema,
  kind: EventKindSchema,
  payload: z.record(z.string(), z.unknown()),
  risks: z.array(RiskFindingSchema).default([])
});
export type AiEvent = z.infer<typeof AiEventSchema>;

export const AiRolloutResponseItemSchema = z.object({
  id: z.string(),
  turnId: z.string(),
  kind: z.enum(["message", "reasoning", "function_call", "function_call_output"]),
  role: z.enum(["user", "assistant", "developer", "tool"]).nullable().default(null),
  name: z.string().nullable().default(null),
  callId: z.string().nullable().default(null),
  content: z.string().default(""),
  payload: z.record(z.string(), z.unknown()).default({})
});
export type AiRolloutResponseItem = z.infer<typeof AiRolloutResponseItemSchema>;

export const AiRolloutSessionMetaSchema = z.object({
  sessionId: z.string(),
  threadId: z.string(),
  forkedFromId: z.string().nullable().default(null),
  timestamp: z.string(),
  cwd: z.string(),
  originator: z.string(),
  appVersion: z.string(),
  provider: ProviderKindSchema,
  providerId: z.string(),
  baseInstructions: z.string().nullable().default(null),
  dynamicTools: z.array(z.string()).default([]),
  selectedCapabilityRoots: z.array(z.string()).default([]),
  historyMode: z.literal("save-all").default("save-all")
});
export type AiRolloutSessionMeta = z.infer<typeof AiRolloutSessionMetaSchema>;

export const AiRolloutTurnContextSchema = AiTurnContextSchema.extend({
  turnId: z.string(),
  workspaceRoots: z.array(z.string()).default([]),
  approvalPolicy: z.enum(["never", "on-request"]).default("on-request"),
  sandboxPolicy: z.enum(["read-only", "workspace-write"]).default("workspace-write"),
  permissionProfile: PermissionProfileSchema,
  provider: ProviderKindSchema,
  providerId: z.string(),
  model: z.string().default("legacy"),
  contextHash: z.string().nullable().default(null)
});
export type AiRolloutTurnContext = z.infer<typeof AiRolloutTurnContextSchema>;

// rollout event_msg payload 的 type 分两组（rollout 线磁盘格式，type 值不可改）：
// - lifecycle marker（ROLLOUT_LIFECYCLE_EVENT_TYPES）：turn 起止 / 回滚的合成标记，
//   不承载真 AiEvent，构造时省略 event 字段（历史写 null 占位，现统一省略）。
// - real event（ROLLOUT_REAL_EVENT_TYPES）：承载完整 AiEvent（user/agent 消息、token 等）。
// event 字段 optional：兼容省略写法与旧文件残留的 null 两种历史。
export const ROLLOUT_LIFECYCLE_EVENT_TYPES = [
  "turn_started",
  "turn_complete",
  "turn_aborted",
  "thread_rolled_back"
] as const;
export const ROLLOUT_REAL_EVENT_TYPES = [
  "user_message",
  "agent_message",
  "agent_reasoning",
  "semantic_event",
  "token_count",
  "context_compacted"
] as const;
export const ROLLOUT_EVENT_TYPES = [
  ...ROLLOUT_LIFECYCLE_EVENT_TYPES,
  ...ROLLOUT_REAL_EVENT_TYPES
] as const;
export type RolloutLifecycleEventType = (typeof ROLLOUT_LIFECYCLE_EVENT_TYPES)[number];
export type RolloutRealEventType = (typeof ROLLOUT_REAL_EVENT_TYPES)[number];

export const AiRolloutEventMessageSchema = z.object({
  type: z.enum(ROLLOUT_EVENT_TYPES),
  turnId: z.string().nullable().default(null),
  event: AiEventSchema.nullable().optional(),
  data: z.record(z.string(), z.unknown()).default({})
});
export type AiRolloutEventMessage = z.infer<typeof AiRolloutEventMessageSchema>;

export const AiRolloutCompactedSchema = z.object({
  turnId: z.string().nullable().default(null),
  message: z.string(),
  replacementHistory: z.array(AiRolloutResponseItemSchema).nullable().default(null),
  windowNumber: z.number().int().nonnegative(),
  previousWindowId: z.string().nullable().default(null),
  windowId: z.string()
});
export type AiRolloutCompacted = z.infer<typeof AiRolloutCompactedSchema>;

export const AiRolloutWorldStateSchema = z.object({
  turnId: z.string(),
  full: z.boolean(),
  state: z.record(z.string(), z.unknown())
});
export type AiRolloutWorldState = z.infer<typeof AiRolloutWorldStateSchema>;

export const AiRolloutItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session_meta"), payload: AiRolloutSessionMetaSchema }),
  z.object({ type: z.literal("response_item"), payload: AiRolloutResponseItemSchema }),
  z.object({ type: z.literal("turn_context"), payload: AiRolloutTurnContextSchema }),
  z.object({ type: z.literal("world_state"), payload: AiRolloutWorldStateSchema }),
  z.object({ type: z.literal("compacted"), payload: AiRolloutCompactedSchema }),
  z.object({ type: z.literal("event_msg"), payload: AiRolloutEventMessageSchema })
]);
export type AiRolloutItem = z.infer<typeof AiRolloutItemSchema>;

export const AiRolloutLineSchema = z.object({
  timestamp: z.string(),
  type: z.enum(["session_meta", "response_item", "turn_context", "world_state", "compacted", "event_msg"]),
  payload: z.unknown()
}).transform((line, context) => {
  const item = AiRolloutItemSchema.safeParse({ type: line.type, payload: line.payload });
  if (!item.success) {
    context.addIssue({ code: "custom", message: item.error.message });
    return z.NEVER;
  }
  return { timestamp: line.timestamp, ...item.data };
});
export type AiRolloutLine = z.infer<typeof AiRolloutLineSchema>;

export const AiTurnSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: z.enum(["in_progress", "completed", "aborted"]),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  context: AiRolloutTurnContextSchema.nullable().default(null),
  events: z.array(AiEventSchema),
  responseItems: z.array(AiRolloutResponseItemSchema),
  error: z.string().nullable().default(null)
});
export type AiTurn = z.infer<typeof AiTurnSchema>;

export const AiTurnListParamsSchema = z.object({
  cursor: z.string().nullable().default(null),
  limit: z.number().int().min(1).max(100).default(20),
  sortDirection: z.enum(["asc", "desc"]).default("desc")
});
export type AiTurnListParams = z.input<typeof AiTurnListParamsSchema>;

export const AiTurnPageSchema = z.object({
  data: z.array(AiTurnSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
  parseErrors: z.number().int().nonnegative().default(0)
});
export type AiTurnPage = z.infer<typeof AiTurnPageSchema>;

export const AiContextStateSchema = z.object({
  sessionId: z.string(),
  history: z.array(AiRolloutResponseItemSchema),
  historyVersion: z.number().int().nonnegative(),
  referenceContext: AiRolloutTurnContextSchema.nullable(),
  worldState: z.record(z.string(), z.unknown()).nullable(),
  windowNumber: z.number().int().nonnegative(),
  windowId: z.string().nullable(),
  tokenInfo: z.record(z.string(), z.unknown()).nullable(),
  estimatedTokens: z.number().int().nonnegative(),
  parseErrors: z.number().int().nonnegative()
});
export type AiContextState = z.infer<typeof AiContextStateSchema>;

export const ProviderCapabilitiesSchema = z.object({
  id: z.string(),
  provider: ProviderKindSchema,
  label: z.string(),
  runtime: z.enum(["native", "wsl"]),
  available: z.boolean(),
  version: z.string().nullable(),
  supportsApprovals: z.boolean(),
  supportsResume: z.boolean(),
  supportsImages: z.boolean(),
  diagnostic: z.string().nullable().default(null),
  /** 探测到的 provider 当前生效模型 id（读 codex config / Claude settings），探测不到为 null。 */
  detectedModel: z.string().nullable().default(null),
  /** 该模型的上下文窗口（token），未知为 null。 */
  contextWindow: z.number().int().nullable().default(null),
  /** 该模型是否支持 1M 上下文窗口。 */
  oneMillion: z.boolean().default(false)
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const StartRunInputSchema = z.object({
  sessionId: z.string().optional(),
  providerId: z.string(),
  permissionProfile: PermissionProfileSchema,
  interactionMode: InteractionModeSchema.default("default"),
  cwd: z.string(),
  prompt: z.string().min(1),
  contexts: z.array(ContextReferenceSchema).default([])
});
export type StartRunInput = z.input<typeof StartRunInputSchema>;

export const SessionPatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional()
});
export type SessionPatch = z.infer<typeof SessionPatchSchema>;

export const ApprovalDecisionSchema = z.enum(["accept", "accept-session", "decline"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export interface AiSnapshot {
  projectRoot: string;
  providers: ProviderCapabilities[];
  sessions: AiSession[];
  runs: AiRun[];
  pendingApprovals: ApprovalRequest[];
}

export interface AppOverview {
  repoRoot: string;
  metrics: Record<string, number>;
  recent: Array<Record<string, unknown>>;
}

export const ContentKindSchema = z.enum(["article", "post", "summary", "topic", "reddit", "html", "unknown"]);
export type ContentKind = z.infer<typeof ContentKindSchema>;

export const ContentStateSchema = z.object({
  read: z.boolean().default(false),
  starred: z.boolean().default(false),
  score: z.number().min(0).max(100).nullable().default(null),
  tags: z.array(z.string()).default([]),
  lastViewedAt: z.string().nullable().default(null)
});
export type ContentState = z.infer<typeof ContentStateSchema>;

export const ContentItemSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  path: z.string(),
  name: z.string(),
  title: z.string(),
  kind: ContentKindSchema,
  source: z.string(),
  author: z.string().nullable().default(null),
  originalUrl: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null),
  capturedAt: z.string(),
  modifiedAt: z.string(),
  size: z.number().nonnegative(),
  excerpt: z.string().default(""),
  state: ContentStateSchema
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

export const ContentQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-?\d{2}-?\d{2}$/),
  kinds: z.array(ContentKindSchema).default([]),
  search: z.string().default(""),
  source: z.string().optional(),
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
  minScore: z.number().min(0).max(100).optional(),
  tags: z.array(z.string()).default([]),
  sort: z.enum(["newest", "oldest", "title", "score", "source"]).default("newest"),
  cursor: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(500).default(100)
});
export type ContentQuery = z.infer<typeof ContentQuerySchema>;

export const ContentPageSchema = z.object({
  items: z.array(ContentItemSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.number().int().nonnegative().nullable()
});
export type ContentPage = z.infer<typeof ContentPageSchema>;

export const ContentFacetsQuerySchema = ContentQuerySchema.pick({
  date: true,
  search: true,
  tags: true
});
export type ContentFacetsQuery = z.infer<typeof ContentFacetsQuerySchema>;

export const ContentFacetsSchema = z.object({
  total: z.number().int().nonnegative(),
  kindCounts: z.record(z.string(), z.number().int().nonnegative()),
  tags: z.array(z.object({
    tag: z.string(),
    count: z.number().int().nonnegative()
  }))
});
export type ContentFacets = z.infer<typeof ContentFacetsSchema>;

export const ContentStatePatchSchema = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
  score: z.number().min(0).max(100).nullable().optional(),
  tags: z.array(z.string()).optional(),
  lastViewedAt: z.string().nullable().optional()
});
export type ContentStatePatch = z.infer<typeof ContentStatePatchSchema>;

export const SourceKindSchema = z.enum(["rss", "web", "x", "reddit", "manual", "api"]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const SourceDefinitionSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  kind: SourceKindSchema,
  url: z.string().nullable().default(null),
  skillId: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  frequency: z.string(),
  tags: z.array(z.string()).default([]),
  lastRunAt: z.string().nullable().default(null),
  lastSuccessAt: z.string().nullable().default(null),
  successRate: z.number().min(0).max(100).nullable().default(null),
  status: z.enum(["idle", "running", "success", "warning", "failed", "disabled"]),
  recentError: z.string().nullable().default(null),
  itemCount: z.number().int().nonnegative().default(0)
});
export type SourceDefinition = z.infer<typeof SourceDefinitionSchema>;

export const SourceRunSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  sourceId: z.string(),
  skillId: z.string(),
  status: z.enum(["running", "success", "failed", "stopped", "timed-out"]),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  durationMs: z.number().nonnegative().nullable().default(null),
  code: z.number().nullable().default(null),
  error: z.string().nullable().default(null),
  itemCount: z.number().int().nonnegative().default(0),
  logs: z.array(z.object({
    timestamp: z.string(),
    stream: z.enum(["system", "stdout", "stderr"]),
    text: z.string()
  })).default([])
});
export type SourceRun = z.infer<typeof SourceRunSchema>;

export const SourcePatchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  url: z.string().url().optional(),
  enabled: z.boolean().optional(),
  frequency: z.string().min(1).max(80).optional(),
  tags: z.array(z.string().min(1).max(40)).optional()
});
export type SourcePatch = z.infer<typeof SourcePatchSchema>;

export const AddRssSourceInputSchema = z.object({
  name: z.string().min(1).max(160),
  url: z.string().min(1).max(2048),
  kind: SourceKindSchema.default("rss"),
  frequency: z.string().min(1).max(80).default("每日流水线"),
  tags: z.array(z.string().min(1).max(40)).default([])
});
export type AddRssSourceInput = z.input<typeof AddRssSourceInputSchema>;

export const BriefTopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  score: z.number().min(0).max(100).nullable().default(null),
  sourceCount: z.number().int().nonnegative(),
  contentIds: z.array(z.string()).default([])
});
export type BriefTopic = z.infer<typeof BriefTopicSchema>;

export const DailyBriefSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  date: z.string(),
  generatedAt: z.string().nullable().default(null),
  sourcePath: z.string().nullable().default(null),
  counts: z.object({
    content: z.number().int().nonnegative(),
    unread: z.number().int().nonnegative(),
    articles: z.number().int().nonnegative().default(0),
    posts: z.number().int().nonnegative().default(0),
    reddit: z.number().int().nonnegative().default(0),
    important: z.number().int().nonnegative(),
    topics: z.number().int().nonnegative()
  }),
  topics: z.array(BriefTopicSchema),
  signals: z.array(z.string()),
  watchlist: z.array(ContentItemSchema),
  sourceContribution: z.array(z.object({ source: z.string(), count: z.number().int().nonnegative() })),
  recommendations: z.array(z.string()),
  markdown: z.string()
});
export type DailyBrief = z.infer<typeof DailyBriefSchema>;

export const DashboardDataSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  date: z.string(),
  refreshedAt: z.string(),
  metrics: z.object({
    collected: z.number().int().nonnegative(),
    unread: z.number().int().nonnegative(),
    articles: z.number().int().nonnegative(),
    posts: z.number().int().nonnegative(),
    reddit: z.number().int().nonnegative(),
    drafting: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    failedSources: z.number().int().nonnegative(),
    pendingApprovals: z.number().int().nonnegative()
  }),
  sourceCounts: z.object({
    articles: z.number().int().nonnegative().default(0),
    posts: z.number().int().nonnegative().default(0),
    reddit: z.number().int().nonnegative().default(0)
  }).default({ articles: 0, posts: 0, reddit: 0 }),
  recommendedTopics: z.array(BriefTopicSchema),
  creativeStages: z.array(z.object({ stage: z.string(), count: z.number().int().nonnegative() })),
  trend: z.array(z.object({ date: z.string(), content: z.number().int().nonnegative(), creative: z.number().int().nonnegative() })),
  attention: z.array(z.object({
    id: z.string(),
    kind: z.enum(["source", "approval", "review", "publish"]),
    title: z.string(),
    detail: z.string()
  }))
});
export type DashboardData = z.infer<typeof DashboardDataSchema>;

export const GlobalSearchResultSchema = z.object({
  id: z.string(),
  kind: z.enum(["content", "project", "session", "skill"]),
  title: z.string(),
  subtitle: z.string(),
  path: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  targetId: z.string()
});
export type GlobalSearchResult = z.infer<typeof GlobalSearchResultSchema>;

export interface SkillDefinition {
  id: string;
  title: string;
  description: string;
  cwd: string;
  command: string;
  runner?: string;
  args?: string[];
  envFile?: string | null;
  group?: string;
  permission?: "read-only" | "edit" | "auto";
  outputArtifacts?: string[];
  timeoutMs?: number;
}

export const McpToolDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string())
});
export type McpToolDefinition = z.infer<typeof McpToolDefinitionSchema>;

export const McpServerDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  backend: z.string().min(1),
  transport: z.enum(["stdio", "http"]),
  connection: z.string(),
  enabled: z.boolean(),
  available: z.boolean(),
  status: z.enum(["enabled", "disabled", "unavailable"]),
  diagnostic: z.string(),
  providers: z.array(z.string()),
  settingsSection: z.enum(["browser"]).nullable().default(null),
  tools: z.array(McpToolDefinitionSchema)
});
export type McpServerDefinition = z.infer<typeof McpServerDefinitionSchema>;

export const McpServerCatalogSchema = z.array(McpServerDefinitionSchema);

export interface ContentEntry { path: string; name?: string; title?: string; kind?: string; type?: string; size?: number; modifiedAt?: string; }
export interface ContentRecord { path: string; name?: string; content?: string; ext?: string; extension?: string; truncated?: boolean; }
export const CreativeStageSchema = z.enum(["today", "drafting", "review", "ready", "published", "archived"]);
export type CreativeStage = z.infer<typeof CreativeStageSchema>;

export const CreativeReviewIssueSchema = z.object({
  id: z.string(),
  dimension: z.enum(["structure", "accuracy", "readability", "platform", "seo"]),
  severity: z.enum(["info", "warning", "error"]),
  title: z.string(),
  detail: z.string(),
  line: z.number().int().positive().nullable().default(null)
});
export type CreativeReviewIssue = z.infer<typeof CreativeReviewIssueSchema>;

export const CreativeReviewReportSchema = z.object({
  score: z.number().min(0).max(100),
  status: z.enum(["pending", "changes-requested", "approved"]),
  dimensions: z.record(z.string(), z.number().min(0).max(100)),
  issues: z.array(CreativeReviewIssueSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type CreativeReviewReport = z.infer<typeof CreativeReviewReportSchema>;

export const CreativePublishConfigSchema = z.object({
  platform: z.string().default(""),
  scheduledAt: z.string().nullable().default(null),
  coverPath: z.string().nullable().default(null),
  summary: z.string().default(""),
  tags: z.array(z.string()).default([]),
  status: z.enum(["draft", "scheduled", "exported", "cancelled"]).default("draft"),
  exportedPath: z.string().nullable().default(null),
  publishedUrl: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null)
});
export type CreativePublishConfig = z.infer<typeof CreativePublishConfigSchema>;
export const CreativePublishPatchSchema = z.object({
  platform: z.string().optional(),
  scheduledAt: z.string().nullable().optional(),
  coverPath: z.string().nullable().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["draft", "scheduled", "exported", "cancelled"]).optional(),
  exportedPath: z.string().nullable().optional(),
  publishedUrl: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional()
});
export type CreativePublishPatch = z.infer<typeof CreativePublishPatchSchema>;

export const CreativeProjectManifestSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  date: z.string(),
  topic: z.string(),
  stage: CreativeStageSchema.default("drafting"),
  status: z.string().default("topic_ready"),
  sourceTopicId: z.string().nullable().default(null),
  sources: z.array(z.string()).default([]),
  platforms: z.record(z.string(), z.string()).default({}),
  tags: z.array(z.string()).default([]),
  owner: z.string().default("本地用户"),
  notes: z.string().max(20000).default(""),
  progress: z.number().min(0).max(100).default(0),
  asset_collection: z.string().nullable().default(null),
  reviewReport: CreativeReviewReportSchema.nullable().default(null),
  publish: CreativePublishConfigSchema.default(CreativePublishConfigSchema.parse({})),
  aiSessionIds: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string()
});
export type CreativeProjectManifest = z.infer<typeof CreativeProjectManifestSchema>;

export interface CreativeTopic {
  id?: string;
  title?: string;
  platform?: string;
  section?: string;
  score?: number;
  body?: string;
  ignored?: boolean;
  projectDir?: string | null;
}
export interface CreativeProjectSummary {
  id?: string;
  dir: string;
  topic: string;
  stage: string;
  completion: number;
  date?: string;
  updatedAt?: string;
  platforms?: Record<string, string>;
  tags?: string[];
  archived?: boolean;
}
export interface CreativeReleaseEvent {
  id: string;
  createdAt: string;
  action: string;
  stage?: string;
  platform?: string;
  status?: string;
  target?: string;
  file?: string;
  detail?: string;
  error?: string;
}
export interface CreativeProjectDetail {
  dir: string;
  stage?: string;
  manifest?: Partial<CreativeProjectManifest> & { topic?: string; [key: string]: unknown };
  files?: Record<string, string>;
  truncatedFiles?: string[];
  releaseLog?: CreativeReleaseEvent[];
  reviewReport?: CreativeReviewReport | null;
}
export interface CreativeTopicsPayload { date: string; topics: CreativeTopic[]; }
export interface CreativeTopicDay {
  date: string;
  label?: string;
  topics: CreativeTopic[];
  file?: string;
  raw?: string;
}
export interface CreativeVersion {
  id: string;
  file: string;
  path: string;
  createdAt: string;
  note: string;
  size: number;
}
export const CreativeTopicSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  platform: z.string().optional(),
  section: z.string().optional(),
  score: z.number().optional(),
  body: z.string().optional(),
  ignored: z.boolean().optional(),
  projectDir: z.string().nullable().optional()
});
export const CreativeCreateInputSchema = z.object({
  date: z.string(),
  topic: CreativeTopicSchema,
  sourceTopicId: z.string().optional()
});
export type CreativeCreateInput = z.infer<typeof CreativeCreateInputSchema>;
export const AddCreativeTopicInputSchema = z.object({
  date: z.string(),
  title: z.string().min(1).max(160),
  body: z.string().default(""),
  score: z.number().min(0).max(100).optional(),
  platform: z.string().max(40).optional()
});
export type AddCreativeTopicInput = z.infer<typeof AddCreativeTopicInputSchema>;
export const BriefWatchlistInputSchema = z.object({
  date: z.string().regex(/^\d{4}-?\d{2}-?\d{2}$/),
  path: z.string().min(1).max(512),
  add: z.boolean()
});
export type BriefWatchlistInput = z.infer<typeof BriefWatchlistInputSchema>;
export const CreativeSaveInputSchema = z.object({
  projectDir: z.string(),
  file: z.string(),
  content: z.string(),
  createVersion: z.boolean().optional(),
  versionNote: z.string().optional(),
  acceptTruncated: z.boolean().optional()
});
export type CreativeSaveInput = z.infer<typeof CreativeSaveInputSchema>;
export interface CreativeAnalytics {
  total: number;
  stages: Array<{ stage: string; count: number }>;
  platforms: Array<{ platform: string; count: number }>;
  averageCompletion: number;
  averageCycleHours?: number | null;
  stageDurations?: Array<{ stage: string; averageHours: number | null }>;
}

export const CreativeManifestPatchSchema = z.object({
  status: z.string().optional(),
  tags: z.array(z.string()).optional(),
  owner: z.string().max(120).optional(),
  notes: z.string().max(20000).optional(),
  platforms: z.record(z.string(), z.string()).optional(),
  asset_collection: z.string().nullable().optional(),
  publish: CreativePublishPatchSchema.optional()
});
export type CreativeManifestPatch = z.infer<typeof CreativeManifestPatchSchema>;

export const CreativeTopicStatePatchSchema = z.object({
  ignored: z.boolean().optional()
});
export type CreativeTopicStatePatch = z.infer<typeof CreativeTopicStatePatchSchema>;

export const UserPreferencesSchema = z.object({
  schemaVersion: z.number().default(1),
  repoRoot: z.string().default(""),
  themeMode: z.enum(["dark", "light"]).default("light"),
  accentColor: z.string().default("#2563eb"),
  density: z.enum(["compact", "default", "comfortable"]).default("default"),
  fontSize: z.enum(["small", "default", "large"]).default("default"),
  autoSaveIntervalMs: z.number().int().min(5000).max(600000).default(30000),
  maxVersions: z.number().int().min(3).max(200).default(50),
  archiveAfterDays: z.number().int().min(7).max(365).default(90),
  defaultReadFilter: z.enum(["all", "unread", "read"]).default("all"),
  contentPreviewMode: z.enum(["inline", "sidebar"]).default("sidebar"),
  markReadOnOpen: z.boolean().default(true),
  defaultProvider: z.string().default(""),
  /**
   * 每个 provider kind 的模型覆盖。"auto" = 跟随 CLI 配置（默认，不向 provider 传模型）；
   * 其它值为透传给 provider 的模型 id（codex 走 --config model=，Claude 走 SDK model）。
   */
  providerModels: z.object({
    codex: z.string().default("auto"),
    claude: z.string().default("auto")
  }).default({ codex: "auto", claude: "auto" }),
  defaultPermissionProfile: z.enum(["read-only", "edit", "auto"]).default("edit"),
  defaultWorkDir: z.string().default(""),
  notesDir: z.string().default("mymind"),
  /** AI 写作时允许通过 Playwright MCP 从已登录的 Chrome 获取原文证据截图。 */
  browserAutomationEnabled: z.boolean().default(false),
  /** URL 已在扩展授权的 Chrome 标签页中打开时，优先复用并在完成后恢复原标签。 */
  browserReuseExistingTabs: z.boolean().default(true),
  /** 浏览器证据截图在工作区内的持久化目录。 */
  browserEvidenceDir: z.string().min(1).max(4096).default(".cctools/browser-evidence"),
  destructiveOpsRequireApproval: z.boolean().default(true),
  riskScanEnabled: z.boolean().default(true),
  defaultPlatform: z.string().default("公众号"),
  defaultLanguage: z.enum(["zh-CN", "en"]).default("zh-CN"),
  defaultContentLength: z.enum(["short", "medium", "long"]).default("medium"),
  defaultTemplate: z.string().default(""),
  userTags: z.array(z.string().min(1).max(40)).max(60).default([]),
  notificationsEnabled: z.boolean().default(true),
  dndStartHour: z.number().int().min(0).max(23).default(22),
  dndEndHour: z.number().int().min(0).max(23).default(8),
  maxNotificationHistory: z.number().int().min(10).max(500).default(100),
  cacheMaxSizeMB: z.number().int().min(50).max(5000).default(500),
  logRetentionDays: z.number().int().min(1).max(90).default(30),
  // ── SET-WF-002~005: 创作工作流规则 ──
  /** 自动保存草稿（true 时按 autoSaveIntervalMs 间隔自动写入版本）。 */
  workflowAutoSaveDraft: z.boolean().default(true),
  /** 重要阶段切换时自动创建版本快照。 */
  workflowAutoVersionOnStageChange: z.boolean().default(true),
  /** 进入 Ready 前必须审核通过（review → ready 门禁）。 */
  workflowReviewRequiredForReady: z.boolean().default(true),
  /** 发布前检查清单（平台、标题、摘要、标签、封面）。 */
  workflowPublishChecklistEnabled: z.boolean().default(true),
  /** 自动归档已发布项目（true 时按 archiveAfterDays 自动归档）。 */
  workflowAutoArchiveEnabled: z.boolean().default(false),
  /** 来源运行完成后自动触发每日简报生成。 */
  workflowAutoBriefOnSourceComplete: z.boolean().default(false)
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const BrowserAutomationStatusSchema = z.object({
  backend: z.literal("playwright-mcp"),
  enabled: z.boolean(),
  reuseExistingTabs: z.boolean(),
  evidenceDir: z.string(),
  extensionTokenConfigured: z.boolean(),
  secureStorageAvailable: z.boolean(),
  packageAvailable: z.boolean(),
  ready: z.boolean(),
  diagnostic: z.string()
});
export type BrowserAutomationStatus = z.infer<typeof BrowserAutomationStatusSchema>;

export const BrowserExtensionTokenSchema = z.string().trim().min(1).max(4096);

export const EnvironmentDiagnosticSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ok", "warning", "error"]),
  value: z.string(),
  detail: z.string().nullable().default(null),
  path: z.string().nullable().default(null)
});
export type EnvironmentDiagnostic = z.infer<typeof EnvironmentDiagnosticSchema>;

export const ContentIndexMaintenanceSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  indexedDates: z.array(z.string()),
  itemCount: z.number().int().min(0),
  indexPath: z.string(),
  statePath: z.string(),
  rebuiltAt: z.string()
});
export type ContentIndexMaintenance = z.infer<typeof ContentIndexMaintenanceSchema>;

export const PreferencesImportResultSchema = z.object({
  imported: z.boolean(),
  preferences: UserPreferencesSchema
});
export type PreferencesImportResult = z.infer<typeof PreferencesImportResultSchema>;

/**
 * Product environment is a machine-readable contract. `runtime` remains a
 * human-facing diagnostic label and must not be parsed for product behavior.
 */
export const AppEnvironmentSchema = z.object({
  mode: z.enum(["desktop", "preview"])
});
export type AppEnvironment = z.infer<typeof AppEnvironmentSchema>;

export type AppBootstrap = {
  repoRoot: string;
  validRepo: boolean;
  runtime: string;
  environment: AppEnvironment;
  overview: AppOverview;
  skills: SkillDefinition[];
  ai: AiSnapshot;
};

export interface DesktopApi {
  getBootstrap(): Promise<AppBootstrap>;
  listContent(kind: string, date: string): Promise<ContentEntry[]>;
  readContent(path: string): Promise<ContentRecord>;
  writeContent(path: string, content: string): Promise<ContentRecord>;
  listInbox(query: ContentQuery): Promise<ContentPage>;
  getInboxFacets(query: ContentFacetsQuery): Promise<ContentFacets>;
  updateContentState(id: string, path: string, patch: ContentStatePatch): Promise<ContentItem>;
  listSources(): Promise<SourceDefinition[]>;
  updateSource(id: string, patch: SourcePatch): Promise<SourceDefinition>;
  deleteSource(id: string): Promise<boolean>;
  addRssSource(input: AddRssSourceInput): Promise<SourceDefinition>;
  importOpml(): Promise<number>;
  listSourceRuns(sourceId?: string): Promise<SourceRun[]>;
  runSource(sourceId: string, date?: string): Promise<boolean>;
  stopSource(sourceId: string): Promise<boolean>;
  getDailyBrief(date: string): Promise<DailyBrief>;
  updateBriefWatchlist(input: BriefWatchlistInput): Promise<DailyBrief>;
  getDashboard(date: string): Promise<DashboardData>;
  searchWorkspace(query: string): Promise<GlobalSearchResult[]>;
  getCreativeTopics(date: string): Promise<CreativeTopicsPayload>;
  getAllCreativeTopics(): Promise<CreativeTopicDay[]>;
  addCreativeTopic(input: AddCreativeTopicInput): Promise<CreativeTopicsPayload>;
  getCreativeProjects(): Promise<CreativeProjectSummary[]>;
  getCreativeProject(path: string): Promise<CreativeProjectDetail>;
  createCreativeProject(input: CreativeCreateInput): Promise<CreativeProjectDetail>;
  saveCreativeFile(input: CreativeSaveInput): Promise<CreativeProjectDetail>;
  advanceCreativeProject(path: string, stage: string): Promise<CreativeProjectDetail>;
  updateCreativeManifest(path: string, patch: CreativeManifestPatch): Promise<CreativeProjectDetail>;
  updateCreativeTopicState(date: string, topicId: string, patch: CreativeTopicStatePatch): Promise<CreativeTopicsPayload>;
  reviewCreativeProject(path: string): Promise<CreativeProjectDetail>;
  setCreativeReviewStatus(path: string, status: "pending" | "changes-requested" | "approved"): Promise<CreativeProjectDetail>;
  listCreativeVersions(path: string, file: string): Promise<CreativeVersion[]>;
  readCreativeVersion(path: string): Promise<{ path: string; content: string }>;
  restoreCreativeVersion(projectPath: string, file: string, versionPath: string): Promise<CreativeProjectDetail>;
  getCreativeReleaseLog(path: string): Promise<CreativeReleaseEvent[]>;
  copyCreativeProject(path: string): Promise<CreativeProjectDetail>;
  archiveCreativeProject(path: string): Promise<CreativeProjectDetail>;
  restoreCreativeProject(path: string): Promise<CreativeProjectDetail>;
  deleteCreativeProject(path: string): Promise<boolean>;
  getCreativeAnalytics(): Promise<CreativeAnalytics>;
  bindCreativeSession(path: string, sessionId: string): Promise<CreativeProjectDetail>;
  selectFiles(): Promise<string[]>;
  selectMymindFiles(): Promise<string[]>;
  searchMymindFiles(query: string, limit?: number): Promise<ProjectFileSearchResult>;
  openPath(path: string): Promise<string>;
  revealPath(path: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  exportText(defaultName: string, content: string): Promise<string | null>;
  setRepo(path: string): Promise<string>;
  detectRepo(): Promise<string>;
  selectRepo(): Promise<string | null>;
  getPreferences(): Promise<UserPreferences>;
  updatePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences>;
  resetPreferences(section?: string): Promise<UserPreferences>;
  getBrowserAutomationStatus(): Promise<BrowserAutomationStatus>;
  getMcpServers(): Promise<McpServerDefinition[]>;
  saveBrowserExtensionToken(token: string): Promise<BrowserAutomationStatus>;
  clearBrowserExtensionToken(): Promise<BrowserAutomationStatus>;
  importPreferences(path: string): Promise<PreferencesImportResult>;
  getEnvironmentDiagnostics(): Promise<EnvironmentDiagnostic[]>;
  rebuildContentIndex(): Promise<ContentIndexMaintenance>;
  aiRefresh(): Promise<AiSnapshot>;
  /** 异步重新探测 provider（启动后/登录后/换模型后），完成后推送新 snapshot；不在 send 路径上。 */
  aiRefreshProviders(): Promise<void>;
  /** 重新扫描 .claude/skills/ 下所有 SKILL.md，返回最新 skill 列表。新对话开始时调用。 */
  aiRefreshSkills(): Promise<SkillDefinition[]>;
  aiPrewarm(sessionId?: string): Promise<boolean>;
  aiSearchSessions(query: string): Promise<AiSession[]>;
  aiStartRun(input: StartRunInput): Promise<{ session: AiSession; run: AiRun }>;
  aiCancelRun(runId: string): Promise<boolean>;
  aiUpdateSession(sessionId: string, patch: SessionPatch): Promise<AiSession>;
  aiDeleteSession(sessionId: string): Promise<boolean>;
  aiGetEvents(sessionId: string): Promise<AiEvent[]>;
  aiListTurns?(sessionId: string, params?: AiTurnListParams): Promise<AiTurnPage>;
  aiGetContextState?(sessionId: string): Promise<AiContextState>;
  aiForkSession?(sessionId: string, throughRunId?: string): Promise<AiSession>;
  aiRollbackTurns?(sessionId: string, numTurns: number): Promise<boolean>;
  aiResolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean>;
  aiGetChangeSet(runId: string): Promise<ChangeSet | null>;
  aiApplyChange(runId: string, patch?: string): Promise<{ applied: boolean; conflict?: string }>;
  aiRevertChange(runId: string, patch: string): Promise<{ applied: boolean; conflict?: string }>;
  aiDiscardChange(runId: string, patch: string): Promise<ChangeSet | null>;
  aiDiscardRun(runId: string): Promise<boolean>;
  runSkill(skillId: string, date?: string): Promise<boolean>;
  stopSkill(skillId: string): Promise<boolean>;
  onAiEvent(callback: (event: AiEvent | { kind: "snapshot"; snapshot: AiSnapshot }) => void): () => void;
  onSkillEvent(callback: (event: Record<string, unknown>) => void): () => void;
}
