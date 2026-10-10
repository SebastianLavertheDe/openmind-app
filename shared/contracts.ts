import { z } from "zod";
import { ImageSelectionSchema } from "./image-generation";

export {
  PROVIDERS_YAML_SCHEMA_VERSION,
  ProviderProtocolSchema,
  ProviderAuthModeSchema,
  CliProviderBindingsSchema,
  ProxyPolicySchema,
  TlsPolicySchema,
  ProviderYamlEntrySchema,
  ProvidersYamlSchema,
  ProviderYamlInputEntrySchema,
  ProvidersYamlInputSchema,
  ProviderYamlViewSchema,
  ProvidersYamlViewSchema,
  PROVIDER_PRESETS,
  supportsCliProvider,
  type ProviderProtocol,
  type ProviderAuthMode,
  type CliProviderBindings,
  type ProxyPolicy,
  type TlsPolicy,
  type ProviderYamlEntry,
  type ProvidersYaml,
  type ProviderYamlInputEntry,
  type ProvidersYamlInput,
  type ProviderYamlView,
  type ProvidersYamlView,
  type ProviderPreset
} from "./providers-yaml";
import type { ProvidersYamlInput, ProvidersYamlView } from "./providers-yaml";
import type { BrokerRunEvent, BrokerRunRecord, RunArtifact, WorkflowRunRecord, WorkflowResumeRequest } from "./execution-contracts";
import type { AutomationRule, AutomationRuleInput, AutomationRunRecord, AutomationScheduleSnapshot } from "./automation-contracts";
import { RuntimeTargetSchema } from "./runtime-targets";

export type { BrokerRunEvent, BrokerRunRecord, RunArtifact, WorkflowRunRecord, WorkflowResumeRequest } from "./execution-contracts";
export type { AutomationRule, AutomationRuleInput, AutomationRunRecord, AutomationScheduleSnapshot } from "./automation-contracts";

export const SCHEMA_VERSION = 1;

export const IpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  detail: z.string().nullable().default(null),
  recoverable: z.boolean().default(true)
});

export const ProviderKindSchema = z.enum(["codex", "claude"]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const AiProjectSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  root: z.string(),
  createdAt: z.string()
});

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
  "image-artifact",
  "approval-request",
  "approval-decision",
  "status",
  "usage",
  "changes",
  "risk",
  "error",
  "system"
]);

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

export const SkillDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  cwd: z.string(),
  command: z.string(),
  runner: z.string().optional(),
  args: z.array(z.string()).optional(),
  envFile: z.string().nullable().optional(),
  group: z.string().optional(),
  permission: z.enum(["read-only", "edit", "auto"]).optional(),
  outputArtifacts: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  /** Internal package kind marker; slash-command surfaces treat all kinds uniformly. */
  kind: z.enum(["agent", "process", "workflow"]).optional()
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

/**
 * Skill availability is frozen with the conversation. Installed provenance
 * prevents an existing session from silently crossing to replacement package
 * bytes, while `definition` keeps slash-command rendering deterministic.
 * Legacy workspace-only definitions have no installed provenance.
 */
export const AiSessionSkillSnapshotEntrySchema = z.object({
  definition: SkillDefinitionSchema,
  installed: z.object({
    key: z.string().min(1),
    version: z.string().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/)
  }).nullable().default(null)
});
export type AiSessionSkillSnapshotEntry = z.infer<typeof AiSessionSkillSnapshotEntrySchema>;
export const AiSessionSkillSnapshotSchema = z.array(AiSessionSkillSnapshotEntrySchema).superRefine((entries, context) => {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (ids.has(entry.definition.id)) {
      context.addIssue({ code: "custom", path: [index, "definition", "id"], message: `Skill snapshot id 重复：${entry.definition.id}` });
    }
    ids.add(entry.definition.id);
    if (!entry.installed) continue;
    if (keys.has(entry.installed.key)) {
      context.addIssue({ code: "custom", path: [index, "installed", "key"], message: `Skill snapshot key 重复：${entry.installed.key}` });
    }
    keys.add(entry.installed.key);
  }
});

/**
 * The filesystem execution boundary frozen into an AI conversation.
 *
 * `project-task` is intentionally identified by business metadata only. The
 * trusted absolute root remains `AiSession.projectRoot` and is resolved by
 * Main; renderer inputs must never be able to select it directly.
 */
export const AiSessionScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workspace") }),
  z.object({
    type: z.literal("project-task"),
    /** Stable Project identity. Names and filesystem paths are mutable labels. */
    projectId: z.string().uuid(),
    /** Frozen display/path locator for the lifetime of this Provider session. */
    projectName: z.string().min(1).max(80),
    taskId: z.string().min(1).max(128)
  })
]);
export type AiSessionScope = z.infer<typeof AiSessionScopeSchema>;

export const AiSessionSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  projectId: z.string(),
  projectRoot: z.string(),
  scope: AiSessionScopeSchema,
  title: z.string(),
  provider: ProviderKindSchema,
  providerId: z.string(),
  /** API profile from config/providers.yaml frozen when the session is created. */
  serviceProviderId: z.string().nullable().default(null),
  /** SHA-256 fingerprint used to prevent an existing conversation crossing API backends. */
  serviceProviderRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  /** Enabled Installed catalog refreshed before each conversation turn. */
  skillSnapshot: AiSessionSkillSnapshotSchema.nullable().default(null),
  providerSessionId: z.string().nullable().default(null),
  appToolsVersion: z.number().int().optional(),
  imageGeneration: ImageSelectionSchema.nullable().optional(),
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
/** Defaulted non-identity fields stay optional for existing in-memory callers. */
export type AiSession = Omit<ParsedAiSession, "interactionMode" | "serviceProviderId" | "serviceProviderRevision" | "skillSnapshot"> & {
  interactionMode?: InteractionMode;
  serviceProviderId?: string | null;
  serviceProviderRevision?: string | null;
  skillSnapshot?: AiSessionSkillSnapshotEntry[] | null;
};

export const AiRunSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: z.string(),
  sessionId: z.string(),
  projectId: z.string(),
  scope: AiSessionScopeSchema,
  provider: ProviderKindSchema,
  providerId: z.string().default("legacy"),
  permissionProfile: PermissionProfileSchema.default("edit"),
  interactionMode: InteractionModeSchema.default("default"),
  imageGeneration: ImageSelectionSchema.nullable().optional(),
  status: RunStatusSchema,
  prompt: z.string(),
  /** Project runs keep the user-message body in Project storage and persist only this reference. */
  promptMessageId: z.string().uuid().nullable().default(null),
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
export type AiRun = Omit<ParsedAiRun, "interactionMode" | "promptMessageId"> & {
  interactionMode?: InteractionMode;
  promptMessageId?: string | null;
};

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
  serviceProviderId: z.string().nullable().default(null),
  serviceProviderRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  baseInstructions: z.string().nullable().default(null),
  dynamicTools: z.array(z.string()).default([]),
  selectedCapabilityRoots: z.array(z.string()).default([]),
  historyMode: z.literal("save-all").default("save-all")
});

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
  /** 未安装时是否支持一键安装（App 私有目录，仅 native Windows/macOS/Linux）。 */
  installable: z.boolean().default(false),
  /** 探测到的 provider 当前生效模型 id（读 codex config / Claude settings），探测不到为 null。 */
  detectedModel: z.string().nullable().default(null),
  /** 该模型的上下文窗口（token），未知为 null。 */
  contextWindow: z.number().int().nullable().default(null),
  /** 该模型是否支持 1M 上下文窗口。 */
  oneMillion: z.boolean().default(false)
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const CliToolStatusSchema = z.object({
  cli: z.enum(["claude", "codex"]),
  installed: z.boolean(),
  version: z.string().nullable(),
  digest: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  installedAt: z.string().nullable(),
  executablePath: z.string()
});
export type CliToolStatusView = z.infer<typeof CliToolStatusSchema>;

export const CliToolUpdateSchema = z.object({
  cli: z.enum(["claude", "codex"]),
  installed: z.boolean(),
  currentVersion: z.string().nullable(),
  latestVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  canUpgrade: z.boolean(),
  checkedAt: z.string(),
  source: z.enum(["official", "npm", "unknown"])
});
export type CliToolUpdateView = z.infer<typeof CliToolUpdateSchema>;

export const CliInstallProgressSchema = z.object({
  cli: z.enum(["claude", "codex"]),
  phase: z.enum(["resolving", "downloading", "verifying", "extracting", "installing", "done", "cancelled"]),
  receivedBytes: z.number().int().nonnegative().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
  version: z.string().optional(),
  message: z.string().max(240).optional()
});
export type CliInstallProgress = z.infer<typeof CliInstallProgressSchema>;

export const StartRunInputSchema = z.object({
  sessionId: z.string().optional(),
  providerId: z.string(),
  permissionProfile: PermissionProfileSchema,
  interactionMode: InteractionModeSchema.default("default"),
  cwd: z.string(),
  prompt: z.string().min(1),
  contexts: z.array(ContextReferenceSchema).default([]),
  imageGeneration: ImageSelectionSchema.nullable().optional(),
  // 续跑已存在的会话时，用户在确认弹窗里同意按当前 Provider 配置继续后携带 true。
  acknowledgeProviderChange: z.boolean().optional()
});
export type StartRunInput = z.input<typeof StartRunInputSchema>;

/**
 * 会话绑定的 Provider 指纹与当前 config/providers.yaml 不一致时，start 抛错的
 * 稳定标记。错误跨 worker/main/renderer 后只剩字符串，渲染端靠该标记识别
 * “可确认继续”的情况；标记后跟 JSON 载荷 { kind, id, message }。
 */
export const PROVIDER_CHANGE_PENDING = "OPENMIND_PROVIDER_CHANGE_PENDING";

export interface ProviderChangePendingInfo {
  kind: string;
  id: string;
  message: string;
}

export function formatProviderChangePending(info: ProviderChangePendingInfo): string {
  return `${PROVIDER_CHANGE_PENDING}:${JSON.stringify(info)}`;
}

export function parseProviderChangePending(text: string): ProviderChangePendingInfo | null {
  const marker = `${PROVIDER_CHANGE_PENDING}:`;
  const at = text.indexOf(marker);
  if (at < 0) return null;
  try {
    const payload = JSON.parse(text.slice(at + marker.length)) as Partial<ProviderChangePendingInfo>;
    return typeof payload.kind === "string" && typeof payload.id === "string" && typeof payload.message === "string"
      ? { kind: payload.kind, id: payload.id, message: payload.message }
      : null;
  } catch {
    return null;
  }
}

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

export const SourceKindSchema = z.enum(["rss", "web", "x", "reddit", "manual", "api"]);

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




export const GlobalSearchResultSchema = z.object({
  id: z.string(),
  /** `project` is the independent Project domain; Creative has its own kind. */
  kind: z.enum(["content", "project", "creative-project", "session", "skill"]),
  title: z.string(),
  subtitle: z.string(),
  path: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  targetId: z.string()
});
export type GlobalSearchResult = z.infer<typeof GlobalSearchResultSchema>;

/** Static package information exposed to Skill Center; it carries no executable command. */
export interface SkillPackageInspectionView {
  sourcePath: string;
  sourceKind: "directory" | "zip" | "git";
  /** Git 多包仓库内的包路径（"." 为仓库根包）；目录/ZIP 来源固定为 "."。 */
  packageRef?: string;
  valid: boolean;
  digest: string;
  totalBytes: number;
  files: Array<{ path: string; type: "file" | "symlink"; size: number; digest: string }>;
  excludedPaths: string[];
  manifest: unknown | null;
  legacy: unknown | null;
  issues: Array<{ code: string; message: string; path?: string }>;
  warnings: string[];
}

/** 一次来源检查的结果；一个 Git 仓库可包含多个 Skill 包。 */
export interface SkillSourceInspectionView {
  source: {
    type: "directory" | "zip" | "git";
    locator: string;
    ref?: string;
  };
  packages: SkillPackageInspectionView[];
}

export interface InstalledSkillView {
  schemaVersion: number;
  key: string;
  id: string;
  publisherId: string;
  version: string;
  digest: string;
  sourcePath: string;
  sourceType?: "directory" | "zip" | "git";
  sourceLocator?: string;
  sourceRef?: string;
  sourcePackageRef?: string;
  sourceRevision?: string;
  packagePath: string;
  /** Main-side package inspection and digest verification passed. */
  usable: boolean;
  /** User default for future AI conversations; existing sessions keep a snapshot. */
  enabled: boolean;
  signatureStatus: "unsigned" | "valid" | "invalid" | "revoked";
  reviewStatus: "unreviewed" | "automated-scan" | "manually-reviewed";
  skillUpdatePolicy: "manual" | "download-only";
  installedAt: string;
}

/**
 * Installed Process/Workflow metadata for non-conversation execution surfaces.
 * Agent packages deliberately remain exclusive to the per-session AI catalog.
 */
export interface InstalledRunnableSkillView {
  key: string;
  id: string;
  publisherId: string;
  version: string;
  digest: string;
  kind: "process" | "workflow";
  title: string;
  description: string;
  group: string;
  enabled: boolean;
}

export const McpToolDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string())
});

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


/**
 * Legacy direct-provider browser evidence is a user-owned workspace output,
 * not App-private state. Formal Agent Skills use an explicit Export Location
 * Binding instead.
 */

export const SharedPythonRuntimeStatusSchema = z.object({
  enabled: z.boolean(),
  phase: z.enum(["disabled", "not-installed", "installing", "syncing", "ready", "error", "unavailable"]),
  target: RuntimeTargetSchema.nullable(),
  pythonVersion: z.string().nullable(),
  uvVersion: z.string().nullable(),
  managedSkills: z.number().int().nonnegative(),
  ready: z.boolean(),
  lastError: z.string().nullable()
});
export type SharedPythonRuntimeStatus = z.infer<typeof SharedPythonRuntimeStatusSchema>;

export const UserPreferencesSchema = z.object({
  schemaVersion: z.number().default(2),
  /**
   * ADR-001: the selected private data repository and single active flat
   * content root. Physical content is joined directly below this path.
   */
  openmindRoot: z.string().default(""),
  /**
   * Legacy optional code-workspace preference retained for settings migration.
   * It is not a Provider filesystem authority; AI is rooted at openmindRoot.
   */
  workspaceRoot: z.string().default(""),
  themeMode: z.enum(["dark", "light"]).default("light"),
  density: z.enum(["compact", "default", "comfortable"]).default("default"),
  fontSize: z.enum(["small", "default", "large"]).default("default"),
  autoSaveIntervalMs: z.number().int().min(5000).max(600000).default(30000),
  maxVersions: z.number().int().min(3).max(200).default(50),
  archiveAfterDays: z.number().int().min(7).max(365).default(90),
  defaultReadFilter: z.enum(["all", "unread", "read"]).default("all"),
  contentPreviewMode: z.enum(["inline", "sidebar"]).default("sidebar"),
  markReadOnOpen: z.boolean().default(true),
  defaultProvider: z.string().default(""),
  defaultPermissionProfile: z.enum(["read-only", "edit", "auto"]).default("auto"),
  notesDir: z.string().default("openmind"),
  destructiveOpsRequireApproval: z.boolean().default(true),
  riskScanEnabled: z.boolean().default(true),
  defaultPlatform: z.string().default("公众号"),
  defaultLanguage: z.enum(["zh-CN", "en"]).default("zh-CN"),
  defaultContentLength: z.enum(["short", "medium", "long"]).default("medium"),
  defaultTemplate: z.string().default(""),
  userTags: z.array(z.string().min(1).max(40)).max(60).default([]),
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
  workflowAutoArchiveEnabled: z.boolean().default(false)
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/**
 * Patch schema for ordinary preference updates.
 *
 * `UserPreferencesSchema.partial()` is unsafe here because every field in the
 * full read schema has a default. Zod applies those defaults while parsing a
 * partial object, turning an update such as `{ themeMode: "dark" }` into a
 * complete preferences object whose root bindings are empty strings.
 *
 * Root bindings and the schema version are deliberately excluded: only the
 * dedicated root-selection IPC endpoints may change those values.
 */
export type UserPreferencesPatch = Partial<Omit<UserPreferences, "schemaVersion" | "openmindRoot" | "workspaceRoot">>;

const userPreferencesPatchShape = Object.fromEntries(
  Object.entries(UserPreferencesSchema.shape)
    .filter(([key]) => key !== "schemaVersion" && key !== "openmindRoot" && key !== "workspaceRoot")
    .map(([key, field]) => {
      const withoutDefault = field instanceof z.ZodDefault ? field.removeDefault() : field;
      return [key, withoutDefault.optional()];
    })
);

export const UserPreferencesPatchSchema = z.object(userPreferencesPatchShape)
  .strict()
  .transform((value) => value as UserPreferencesPatch);

export const BrowserSkillStatusSchema = z.object({
  skillInstalled: z.boolean(),
  skillEnabled: z.boolean(),
  cliAvailable: z.boolean(),
  cliVersion: z.string().nullable(),
  browserConnected: z.boolean(),
  ready: z.boolean(),
  diagnostic: z.string()
});
export type BrowserSkillStatus = z.infer<typeof BrowserSkillStatusSchema>;

export const OnboardingStepStatusSchema = z.enum(["pending", "complete", "skipped"]);
export const OnboardingStateSchema = z.object({
  completed: z.boolean(),
  skill: OnboardingStepStatusSchema,
  provider: OnboardingStepStatusSchema
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

/**
 * Product environment is a machine-readable contract. `runtime` remains a
 * human-facing diagnostic label and must not be parsed for product behavior.
 */
export const AppEnvironmentSchema = z.object({
  mode: z.enum(["desktop", "preview"]),
  platform: z.enum(["win32", "darwin", "linux", "web"])
});
export type AppEnvironment = z.infer<typeof AppEnvironmentSchema>;

export type AppBootstrap = {
  repoRoot: string;
  /** Selected private data repository; this is also the flat content root. */
  openmindRoot: string;
  /** Compatibility alias for the active AI root; current Main returns openmindRoot. */
  workspaceRoot: string;
  validRepo: boolean;
  /** True when the official cctools-skills repository is installed (first-start gate, mandatory). */
  skillsInstalled: boolean;
  /** False only while the first-start checklist still needs attention. */
  onboardingCompleted?: boolean;
  runtime: string;
  environment: AppEnvironment;
  overview: AppOverview;
  skills: SkillDefinition[];
  ai: AiSnapshot;
};

export type OpenmindRootStatus = {
  openmindRoot: string;
  /** Compatibility alias for openmindRoot in the current desktop build. */
  workspaceRoot: string;
  health: {
    configured: boolean;
    rootId?: string;
    accessible: boolean;
    readable: boolean;
    writable: boolean;
    expectedStructureVersion?: string;
    missingInitializeEntries: string[];
    missingCreateIfNeededEntries: string[];
    optionalObservedEntries: string[];
    unknownPreservedEntries: string[];
    symlinkWarnings: string[];
    activeRunCount: number;
    warnings: string[];
  };
  snapshot: { rootPath: string; rootId: string; rootGeneration: number } | null;
};

/** Read-only root selection preview. A preview never persists settings or
 * creates/moves content; the caller must explicitly commit via setOpenmindRoot. */
export type OpenmindRootPreview = {
  candidate: string;
  canonicalRoot: string | null;
  health: OpenmindRootStatus["health"];
  canBind: boolean;
  blockingReasons: string[];
};

/** Read-only preview for explicit user-initiated openmind content relocation. */
export type OpenmindRelocationPreview = {
  schemaVersion: number;
  sourceDirectory: string;
  targetDirectory: string;
  sourceRootId: string | null;
  sourceFileCount: number;
  sourceDirectoryCount: number;
  sourceBytes: number;
  sourceDigest: string | null;
  targetState: "absent" | "empty" | "non-empty" | "invalid";
  targetFileCount: number;
  targetDirectoryCount: number;
  targetBytes: number;
  pendingTransaction: boolean;
  canCommit: boolean;
  blockingReasons: string[];
};

/** Result of a verified copy-only relocation. The source is never removed. */
export type OpenmindRelocationReport = {
  schemaVersion: number;
  status: "committed";
  sourceDirectory: string;
  targetDirectory: string;
  sourceRootId: string;
  targetRootId: string;
  copiedFileCount: number;
  copiedDirectoryCount: number;
  copiedBytes: number;
  treeDigest: string;
  sourcePreserved: true;
  verified: true;
  completedAt: string;
};

export interface DesktopApi {
  getWechatAccount(): Promise<import("./wechat").WechatAccountView>;
  saveWechatAccount(input: import("./wechat").WechatAccountInput): Promise<import("./wechat").WechatAccountView>;
  disconnectWechatAccount(): Promise<void>;
  chooseWechatCover(): Promise<import("./wechat").WechatCover | null>;
  copyWechatArticle(input: import("./wechat").WechatCopyInput): Promise<void>;
  pushWechatDraft(input: import("./wechat").WechatDraftInput): Promise<import("./wechat").WechatDraftResult>;
  getBootstrap(): Promise<AppBootstrap>;
  listContent(kind: string, date: string): Promise<ContentEntry[]>;
  readContent(path: string): Promise<ContentRecord>;
  readImagePreview(path: string): Promise<import("./image-preview").ImagePreviewRecord>;
  readChatImage(input: import("./image-generation").ChatImageRequest): Promise<import("./image-generation").ChatImageData>;
  getImageConfiguration(): Promise<import("./image-generation").ImageConfiguration>;
  selectImageModel(selection: import("./image-generation").ImageSelection | null): Promise<import("./image-generation").ImageConfiguration>;
  writeContent(path: string, content: string): Promise<ContentRecord>;
  getXFollowingCurls(): Promise<string[]>;
  saveXFollowingCurls(contents: string[]): Promise<void>;
  listSources(): Promise<SourceDefinition[]>;
  updateSource(id: string, patch: SourcePatch): Promise<SourceDefinition>;
  addRssSource(input: AddRssSourceInput): Promise<SourceDefinition>;
  importOpml(): Promise<number>;
  searchWorkspace(query: string): Promise<GlobalSearchResult[]>;
  getAllCreativeTopics(): Promise<CreativeTopicDay[]>;
  getCreativeProjects(): Promise<CreativeProjectSummary[]>;
  getCreativeProject(path: string): Promise<CreativeProjectDetail>;
  createCreativeProject(input: CreativeCreateInput): Promise<CreativeProjectDetail>;
  saveCreativeFile(input: CreativeSaveInput): Promise<CreativeProjectDetail>;
  advanceCreativeProject(path: string, stage: string): Promise<CreativeProjectDetail>;
  updateCreativeManifest(path: string, patch: CreativeManifestPatch): Promise<CreativeProjectDetail>;
  listCreativeVersions(path: string, file: string): Promise<CreativeVersion[]>;
  readCreativeVersion(path: string): Promise<{ path: string; content: string }>;
  restoreCreativeVersion(projectPath: string, file: string, versionPath: string): Promise<CreativeProjectDetail>;
  getCreativeReleaseLog(path: string): Promise<CreativeReleaseEvent[]>;
  copyCreativeProject(path: string): Promise<CreativeProjectDetail>;
  archiveCreativeProject(path: string): Promise<CreativeProjectDetail>;
  getCreativeAnalytics(): Promise<CreativeAnalytics>;
  selectFiles(): Promise<string[]>;
  /** Resolve the absolute path of a File dropped into the renderer; preload-only (webUtils), never IPC. */
  pathForFile(file: File): string;
  selectOpenmindFiles(): Promise<string[]>;
  searchOpenmindFiles(query: string, limit?: number): Promise<ProjectFileSearchResult>;
  openPath(path: string): Promise<string>;
  revealPath(path: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  exportText(defaultName: string, content: string): Promise<string | null>;
  /** Select/set the private data repository, which is also the content root. */
  setOpenmindRoot(path: string): Promise<string>;
  selectOpenmindRoot(): Promise<string | null>;
  previewOpenmindRoot(path: string): Promise<OpenmindRootPreview>;
  getOpenmindRoot(): Promise<OpenmindRootStatus>;
  /** ADR-001: optional AI/code workspace, independent of openmind. */
  selectWorkspaceRoot(): Promise<string | null>;
  getPreferences(): Promise<UserPreferences>;
  getOnboardingState(): Promise<OnboardingState>;
  updateOnboardingState(patch: Partial<OnboardingState>): Promise<OnboardingState>;
  updatePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences>;
  resetPreferences(section?: string): Promise<UserPreferences>;
  getBrowserSkillStatus(): Promise<BrowserSkillStatus>;
  installBrowserSkill(): Promise<BrowserSkillStatus>;
  getMcpServers(): Promise<McpServerDefinition[]>;
  getProviders(): Promise<ProvidersYamlView>;
  /** Read one existing Provider key only when its trusted local editor is opened. */
  getProviderApiKey(id: string): Promise<string>;
  saveProviders(input: ProvidersYamlInput): Promise<ProvidersYamlView>;
  getSharedPythonRuntimeStatus(): Promise<SharedPythonRuntimeStatus>;
  setSharedPythonRuntimeEnabled(enabled: boolean): Promise<SharedPythonRuntimeStatus>;
  aiRefresh(): Promise<AiSnapshot>;
  /** 异步重新探测 provider（启动后/登录后/换模型后），完成后推送新 snapshot；不在 send 路径上。 */
  aiRefreshProviders(): Promise<void>;
  /** 一键安装 CLI（Claude Code / Codex）到 App 私有 tools/bin；安装即用户信任决定。 */
  installCliTool(cli: "claude" | "codex"): Promise<CliToolStatusView>;
  /** 重新从官方来源安装 App 私有 CLI，用于升级。 */
  upgradeCliTool(cli: "claude" | "codex"): Promise<CliToolStatusView>;
  /** 检查当前 CLI 的官方版本信息，不执行升级。 */
  checkCliToolUpdate(cli: "claude" | "codex"): Promise<CliToolUpdateView>;
  cancelCliToolInstall(cli: "claude" | "codex"): Promise<boolean>;
  /** 打开系统终端并引导 CLI 登录；凭据只进入 CLI 自己的登录流程。 */
  openCliLogin(cli: "claude" | "codex"): Promise<void>;
  /** 重新扫描已安装技能商店，返回最新 skill 列表。新对话开始时调用。 */
  aiRefreshSkills(): Promise<SkillDefinition[]>;
  /** 静态检查 App 私有安装包，不执行包内代码。 */
  inspectInstalledSkill(key: string, digest?: string): Promise<SkillPackageInspectionView | null>;
  listInstalledSkills(): Promise<InstalledSkillView[]>;
  /** Process/Workflow catalog for Automation and Broker UI; never includes Agent Skills. */
  listInstalledRunnableSkills(): Promise<InstalledRunnableSkillView[]>;
  /** Change the default for future sessions without mutating existing sessions. */
  setInstalledSkillEnabled(key: string, digest: string, enabled: boolean): Promise<InstalledSkillView>;
  /** 选择本地目录或 ZIP；Git 通过 inspectSkillSource 输入地址。 */
  selectSkillPackageSource?(): Promise<import("./skill-package-sources").SkillPackageSourceInput | null>;
  /** 检查本地目录、ZIP 或 HTTPS Git 来源；不执行包代码。Git 仓库可含多个包。 */
  inspectSkillSource?(source: import("./skill-package-sources").SkillPackageSourceInput, requestId?: string): Promise<SkillSourceInspectionView>;
  cancelSkillSourceInspection?(requestId: string): Promise<boolean>;
  /** 将检查过的来源安装到 Skill store；Git 可传选中包路径列表（缺省安装全部）。 */
  installSkillSource?(source: import("./skill-package-sources").SkillPackageSourceInput, selectedPackageRefs?: string[]): Promise<InstalledSkillView[]>;
  listSkillRuns(): Promise<BrokerRunRecord[]>;
  getSkillRun(runId: string): Promise<BrokerRunRecord>;
  getSkillRunEvents(runId: string): Promise<BrokerRunEvent[]>;
  listRunArtifacts(runId?: string): Promise<RunArtifact[]>;
  retrySkillRun(runId: string): Promise<BrokerRunRecord>;
  retryWorkflowStep(runId: string, stepId: string): Promise<WorkflowRunRecord>;
  deleteRunHistory(runId: string): Promise<boolean>;
  cancelSkillRun(runId: string): Promise<boolean>;
  listWorkflowRuns(): Promise<WorkflowRunRecord[]>;
  getWorkflowRun(runId: string): Promise<WorkflowRunRecord>;
  resumeWorkflowRun(input: WorkflowResumeRequest): Promise<WorkflowRunRecord>;
  cancelWorkflowRun(runId: string): Promise<boolean>;
  listAutomationRules(): Promise<AutomationRule[]>;
  saveAutomationRule(input: AutomationRuleInput): Promise<AutomationRule>;
  deleteAutomationRule(id: string): Promise<boolean>;
  runAutomationNow(id: string): Promise<AutomationRunRecord>;
  listAutomationRuns(ruleId?: string): Promise<AutomationRunRecord[]>;
  listAutomationSchedules(): Promise<AutomationScheduleSnapshot[]>;
  /** Without bindingId creates a new binding; with bindingId opens the Main picker for create/relink of that stable Manifest ID. */
  aiPrewarm(sessionId?: string): Promise<boolean>;
  aiStartRun(input: StartRunInput): Promise<{ session: AiSession; run: AiRun }>;
  aiCancelRun(runId: string): Promise<boolean>;
  aiUpdateSession(sessionId: string, patch: SessionPatch): Promise<AiSession>;
  aiGetEvents(sessionId: string): Promise<AiEvent[]>;
  aiListTurns?(sessionId: string, params?: AiTurnListParams): Promise<AiTurnPage>;
  aiForkSession?(sessionId: string, throughRunId?: string): Promise<AiSession>;
  aiResolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean>;
  onAiEvent(callback: (event: AiEvent | { kind: "snapshot"; snapshot: AiSnapshot }) => void): () => void;
  onSkillEvent(callback: (event: Record<string, unknown>) => void): () => void;
  onSkillRunEvent(callback: (event: BrokerRunEvent) => void): () => void;
  onCliInstallProgress(callback: (progress: CliInstallProgress) => void): () => void;
}
