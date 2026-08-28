import { z } from "zod";

export const EXECUTION_SCHEMA_VERSION = 1 as const;
export const WORKFLOW_INTERRUPTED_ERROR = "Workflow 在应用重启时中断，未恢复执行。";

export const BrokerRunStateSchema = z.enum([
  "queued",
  "inspecting",
  "waiting_execution_consent",
  "preparing_runtime",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled"
]);
export type BrokerRunState = z.infer<typeof BrokerRunStateSchema>;

export const BrokerTerminalStateSchema = z.enum(["succeeded", "failed", "timed_out", "cancelled"]);
export type BrokerTerminalState = z.infer<typeof BrokerTerminalStateSchema>;

export const SkillRunTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }).strict(),
  z.object({ type: z.literal("workflow"), parentRunId: z.string().min(1).max(120), stepId: z.string().min(1).max(120) }).strict(),
  z.object({ type: z.literal("automation"), ruleId: z.string().min(1).max(120) }).strict()
]);

export const SkillRunRequestSchema = z.object({
  skillId: z.string().trim().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._-]*$/),
  version: z.string().trim().min(1).max(80).optional(),
  digest: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  inputs: z.record(z.string().max(120), z.unknown()).default({}),
  configRevision: z.string().trim().min(1).max(200).optional(),
  providerBindings: z.record(z.string().max(120), z.string().trim().min(1).max(120)).default({}),
  trigger: SkillRunTriggerSchema,
  externalExportBindingIds: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
  rootGeneration: z.number().int().nonnegative()
}).strict();
export type SkillRunRequest = z.infer<typeof SkillRunRequestSchema>;

/** Durable request metadata intentionally contains input keys, never input values. */
export const StoredSkillRunRequestSchema = z.object({
  skillId: SkillRunRequestSchema.shape.skillId,
  version: SkillRunRequestSchema.shape.version,
  digest: SkillRunRequestSchema.shape.digest,
  configRevision: SkillRunRequestSchema.shape.configRevision,
  providerBindingIds: z.array(z.string()),
  trigger: SkillRunTriggerSchema,
  externalExportBindingIds: z.array(z.string()),
  inputKeys: z.array(z.string())
}).strict();
export type StoredSkillRunRequest = z.infer<typeof StoredSkillRunRequestSchema>;

export const RunArtifactTypeSchema = z.enum(["markdown", "json", "image", "video", "audio", "directory", "other"]);
export type RunArtifactType = z.infer<typeof RunArtifactTypeSchema>;

export const RunArtifactSchema = z.object({
  id: z.string().min(1).max(120),
  runId: z.string().min(1).max(120),
  skillId: z.string().min(1).max(128),
  logicalPath: z.string().min(1).max(1024).optional(),
  externalPathRef: z.string().min(1).max(120).optional(),
  type: RunArtifactTypeSchema,
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  declared: z.boolean(),
  createdAt: z.string().datetime()
}).strict();
export type RunArtifact = z.infer<typeof RunArtifactSchema>;

/**
 * Process Skills write this report into their private Run directory after all
 * content writes complete. Entries reference Manifest Artifact declarations;
 * the Broker derives type and trust metadata and never accepts those fields
 * from the child process.
 */
export const SKILL_ARTIFACT_REPORT_SCHEMA_VERSION = 1 as const;
export const SkillArtifactReportEntrySchema = z.object({
  declarationId: z.string().trim().min(1).max(120),
  logicalPath: z.string().trim().min(1).max(1024)
}).strict();
export const SkillArtifactReportSchema = z.object({
  schemaVersion: z.literal(SKILL_ARTIFACT_REPORT_SCHEMA_VERSION),
  artifacts: z.array(SkillArtifactReportEntrySchema).max(2_000)
}).strict();
export type SkillArtifactReport = z.infer<typeof SkillArtifactReportSchema>;

export const RunUsageSchema = z.object({
  model: z.string().max(200).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  costSource: z.enum(["provider-reported", "catalog-estimate", "mixed"]).optional(),
  pricingCatalogVersion: z.number().int().positive().optional(),
  pricingRateId: z.string().trim().min(1).max(200).optional(),
  durationMs: z.number().int().nonnegative().optional()
}).strict();
export type RunUsage = z.infer<typeof RunUsageSchema>;

/** Legacy read-only shape retained so existing Run history remains loadable. */
const LegacyAgentCheckpointBaseSchema = z.object({
  turn: z.number().int().nonnegative().max(100),
  updatedAt: z.string().datetime()
}).strict();

const AgentToolOutputSchema = z.object({
  callId: z.string().trim().min(1).max(200),
  output: z.string().max(32 * 1024)
}).strict();

const AgentToolResultSchema = z.object({
  toolUseId: z.string().trim().min(1).max(200),
  toolName: z.string().trim().min(1).max(120),
  output: z.string().max(32 * 1024)
}).strict();

const LegacyAgentCheckpointSchema = z.discriminatedUnion("protocol", [
  LegacyAgentCheckpointBaseSchema.extend({
    protocol: z.literal("openai-responses"),
    responseId: z.string().trim().min(1).max(200),
    toolOutputs: z.array(AgentToolOutputSchema).max(32)
  }),
  LegacyAgentCheckpointBaseSchema.extend({
    protocol: z.literal("anthropic-messages"),
    messageId: z.string().trim().min(1).max(200),
    toolResults: z.array(AgentToolResultSchema).max(32)
  })
]);

export const BrokerRunRecordSchema = z.object({
  schemaVersion: z.literal(EXECUTION_SCHEMA_VERSION),
  id: z.string().min(1).max(120),
  request: StoredSkillRunRequestSchema,
  state: BrokerRunStateSchema,
  sequence: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative().default(0),
  rootGeneration: z.number().int().nonnegative(),
  skillDigest: z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
  runtime: z.object({
    target: z.string().min(1).max(80),
    packId: z.string().min(1).max(80),
    packDigest: z.string().regex(/^[a-f0-9]{64}$/i),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/i)
  }).nullable().default(null),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  terminalState: BrokerTerminalStateSchema.nullable(),
  error: z.string().max(2000).nullable(),
  processPid: z.number().int().positive().nullable().default(null),
  orphanPid: z.number().int().positive().nullable().default(null),
  usage: RunUsageSchema.nullable().default(null),
  /** Deprecated history-only fields from the removed direct-API Agent runtime. */
  agentCheckpoint: LegacyAgentCheckpointSchema.nullable().default(null),
  resumedFromRunId: z.string().min(1).max(120).nullable().default(null),
  artifacts: z.array(RunArtifactSchema)
}).strict();
export type BrokerRunRecord = z.infer<typeof BrokerRunRecordSchema>;

export const BrokerRunEventSchema = z.object({
  schemaVersion: z.literal(EXECUTION_SCHEMA_VERSION),
  runId: z.string().min(1).max(120),
  sequence: z.number().int().nonnegative(),
  attempt: z.number().int().positive().optional(),
  timestamp: z.string().datetime(),
  state: BrokerRunStateSchema,
  reason: z.string().max(500).optional(),
  error: z.string().max(2000).optional(),
  code: z.number().int().nullable().optional(),
  signal: z.string().max(40).nullable().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  stream: z.enum(["system", "stdout", "stderr"]).optional(),
  text: z.string().max(32 * 1024).optional(),
  droppedBytes: z.number().int().nonnegative().optional()
}).strict();
export type BrokerRunEvent = z.infer<typeof BrokerRunEventSchema>;

export const WorkflowRunStateSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);

export const WorkflowStepRunStateSchema = z.enum(["pending", "running", "succeeded", "failed", "skipped"]);

export const WorkflowRunRecordSchema = z.object({
  schemaVersion: z.literal(EXECUTION_SCHEMA_VERSION),
  id: z.string().min(1).max(120),
  workflowSkillId: z.string().min(1).max(128),
  workflowVersion: z.string().min(1).max(80),
  /** SHA-256 of the installed Workflow Manifest used to create this Run. Empty is legacy/non-resumable. */
  workflowFingerprint: z.string().regex(/^[a-f0-9]{64}$/i).default(""),
  state: WorkflowRunStateSchema,
  rootGeneration: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  error: z.string().max(2000).nullable().default(null),
  stepRuns: z.array(z.object({
    stepId: z.string().min(1).max(120),
    skillId: z.string().min(1).max(128),
    state: WorkflowStepRunStateSchema,
    attempt: z.number().int().nonnegative().default(0),
    retryAt: z.string().datetime().nullable().default(null),
    runId: z.string().min(1).max(120).nullable(),
    error: z.string().max(2000).nullable(),
    /** Snapshot of child Run Artifacts retained for Workflow hand-off/audit. */
    artifacts: z.array(RunArtifactSchema).default([])
  }).strict())
}).strict();
export type WorkflowRunRecord = z.infer<typeof WorkflowRunRecordSchema>;

export const ExportLocationBindingSchema = z.object({
  schemaVersion: z.literal(EXECUTION_SCHEMA_VERSION),
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  canonicalPath: z.string().min(1).max(4096),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revoked: z.boolean(),
  /** Runtime-only availability; older persisted registries omit it and are treated as available until audited. */
  availability: z.enum(["available", "needs-relink", "revoked"]).optional()
}).strict();
export type ExportLocationBinding = z.infer<typeof ExportLocationBindingSchema>;

export const WorkflowStartRequestSchema = z.object({
  skillId: z.string().trim().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._-]*$/),
  version: z.string().trim().min(1).max(80).optional(),
  inputs: z.record(z.string().max(120), z.unknown()).default({}),
  /** Provider Profile IDs are references, never credential values. */
  providerBindings: z.record(z.string().max(120), z.string().trim().min(1).max(120)).default({}),
  rootGeneration: z.number().int().nonnegative()
}).strict();
export type WorkflowStartRequest = z.infer<typeof WorkflowStartRequestSchema>;

export const WorkflowResumeRequestSchema = z.object({
  runId: z.string().trim().min(1).max(120),
  inputs: z.record(z.string().max(120), z.unknown()).default({}),
  providerBindings: z.record(z.string().max(120), z.string().trim().min(1).max(120)).default({}),
  rootGeneration: z.number().int().nonnegative()
}).strict();
export type WorkflowResumeRequest = z.infer<typeof WorkflowResumeRequestSchema>;

export function toStoredSkillRunRequest(request: SkillRunRequest): StoredSkillRunRequest {
  return StoredSkillRunRequestSchema.parse({
    skillId: request.skillId,
    ...(request.version ? { version: request.version } : {}),
    ...(request.digest ? { digest: request.digest.toLowerCase() } : {}),
    ...(request.configRevision ? { configRevision: request.configRevision } : {}),
    providerBindingIds: Object.keys(request.providerBindings).sort(),
    trigger: request.trigger,
    externalExportBindingIds: request.externalExportBindingIds,
    inputKeys: Object.keys(request.inputs).sort()
  });
}
