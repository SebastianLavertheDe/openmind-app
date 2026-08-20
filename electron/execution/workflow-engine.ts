import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { matchesSemverRange, type WorkflowManifest } from "../../shared/skill-manifest-schema";
import {
  EXECUTION_SCHEMA_VERSION,
  SkillRunRequestSchema,
  WorkflowRunRecordSchema,
  type BrokerRunRecord,
  type SkillRunRequest,
  type WorkflowRunRecord
} from "../../shared/execution-contracts";
import { writeJsonAtomic } from "../lib/fs-utils";

export type WorkflowRunSubmitter = (request: SkillRunRequest) => BrokerRunRecord;
export type WorkflowRunReader = (runId: string) => BrokerRunRecord;
export type WorkflowRunEventHandler = (event: WorkflowRunRecord) => void;

export type WorkflowStepAdmission = {
  stepId: string;
  skillId: string;
  version: string;
  digest: string;
};

/** Immutable package identities approved together at one Workflow admission. */
export type WorkflowAdmission = {
  manifest: WorkflowManifest;
  steps: WorkflowStepAdmission[];
};

export class WorkflowDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowDefinitionError";
  }
}

export const WORKFLOW_INTERRUPTED_ERROR = "Workflow 在应用重启时中断，未恢复执行。";

/** Validates and runs Manifest workflow steps exclusively through the Broker. */
export class WorkflowEngine {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly records = new Map<string, WorkflowRunRecord>();
  private readonly definitions = new Map<string, WorkflowManifest>();
  private readonly inputs = new Map<string, Record<string, unknown>>();
  private readonly providerBindings = new Map<string, Record<string, string>>();
  private readonly stepAdmissions = new Map<string, Map<string, WorkflowStepAdmission>>();

  constructor(
    private readonly root: string,
    private readonly submit: WorkflowRunSubmitter,
    private readonly readRun: WorkflowRunReader,
    private readonly cancelChild: (runId: string) => Promise<boolean> = async () => false,
    private readonly now: () => Date = () => new Date(),
    private readonly onEvent: WorkflowRunEventHandler = () => undefined
  ) {
    fs.mkdirSync(root, { recursive: true });
    this.load();
  }

  validate(manifest: WorkflowManifest): string[] {
    return topologicalOrder(manifest).map((step) => step.id);
  }

  start(admission: WorkflowAdmission, inputs: Record<string, unknown>, rootGeneration: number, providerBindings: Record<string, string> = {}): WorkflowRunRecord {
    const manifest = admission.manifest;
    const order = topologicalOrder(manifest);
    const admittedSteps = validateWorkflowAdmission(manifest, admission.steps, order);
    assertSafeWorkflowInputs(inputs);
    const id = crypto.randomUUID();
    const record = WorkflowRunRecordSchema.parse({
      schemaVersion: EXECUTION_SCHEMA_VERSION,
      id,
      workflowSkillId: manifest.id,
      workflowVersion: manifest.version,
      workflowFingerprint: workflowManifestFingerprint(manifest),
      state: "queued",
      rootGeneration,
      createdAt: this.now().toISOString(),
      completedAt: null,
      error: null,
      stepRuns: order.map((step) => ({ stepId: step.id, skillId: step.skill, state: "pending", attempt: 0, retryAt: null, runId: null, error: null, artifacts: [] }))
    });
    this.records.set(id, record);
    this.definitions.set(id, manifest);
    this.inputs.set(id, cloneInputs(inputs));
    this.providerBindings.set(id, { ...providerBindings });
    this.stepAdmissions.set(id, admittedSteps);
    this.persist(record);
    void this.advance(id, manifest, inputs, providerBindings);
    return clone(record);
  }

  get(id: string): WorkflowRunRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Workflow Run 不存在：${id}`);
    return clone(record);
  }

  list(): WorkflowRunRecord[] { return Array.from(this.records.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(clone); }

  retryStep(id: string, stepId: string, admission: WorkflowAdmission): WorkflowRunRecord {
    const current = this.get(id);
    const manifest = admission.manifest;
    const inputs = this.inputs.get(id);
    if (!this.definitions.has(id) || !inputs) throw new Error("该 Workflow 已在应用重启后恢复，缺少原始输入，无法直接重试 Step。");
    assertSameWorkflowDefinition(current, manifest);
    const admittedSteps = validateWorkflowAdmission(manifest, admission.steps);
    const step = current.stepRuns.find((candidate) => candidate.stepId === stepId);
    if (!step) throw new Error(`Workflow Step 不存在：${stepId}`);
    if (step.state !== "failed") throw new Error("只有失败的 Workflow Step 可以重试。");
    const next = WorkflowRunRecordSchema.parse({
      ...current,
      state: "running",
      completedAt: null,
      error: null,
      stepRuns: current.stepRuns.map((candidate) => candidate.stepId === stepId
        ? { ...candidate, state: "pending", retryAt: null, error: null }
        : candidate)
    });
    this.records.set(id, next);
    this.definitions.set(id, manifest);
    this.stepAdmissions.set(id, admittedSteps);
    this.persist(next);
    void this.advance(id, manifest, inputs, this.providerBindings.get(id) || {});
    return clone(next);
  }

  resume(id: string, admission: WorkflowAdmission, inputs: Record<string, unknown>, rootGeneration: number, providerBindings: Record<string, string> = {}): WorkflowRunRecord {
    const current = this.get(id);
    const manifest = admission.manifest;
    if (current.state !== "failed" || current.error !== WORKFLOW_INTERRUPTED_ERROR) {
      throw new Error("只有因应用重启而中断的 Workflow 才能恢复。");
    }
    if (current.rootGeneration !== rootGeneration) throw new Error("Workflow 的 root snapshot 已过期，请从当前根目录重新开始。");
    const order = topologicalOrder(manifest);
    assertSameWorkflowDefinition(current, manifest, order);
    const admittedSteps = validateWorkflowAdmission(manifest, admission.steps, order);
    assertSafeWorkflowInputs(inputs);
    const next = WorkflowRunRecordSchema.parse({
      ...current,
      state: "running",
      completedAt: null,
      error: null,
      stepRuns: current.stepRuns.map((step) => step.state === "running"
        ? { ...step, state: "pending", runId: null, retryAt: null, error: null, artifacts: [] }
        : step)
    });
    this.records.set(id, next);
    this.definitions.set(id, manifest);
    this.inputs.set(id, cloneInputs(inputs));
    this.providerBindings.set(id, { ...providerBindings });
    this.stepAdmissions.set(id, admittedSteps);
    this.persist(next);
    void this.advance(id, manifest, inputs, providerBindings);
    return clone(next);
  }

  deleteHistory(id: string): boolean {
    const current = this.records.get(id);
    if (!current) return false;
    if (!["succeeded", "failed", "cancelled"].includes(current.state)) throw new Error("只能删除已经结束的 Workflow 历史。");
    const target = path.resolve(this.root, `${id}.json`);
    if (path.dirname(target) !== path.resolve(this.root)) throw new Error("Workflow 历史路径无效。");
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.records.delete(id);
    this.definitions.delete(id);
    this.inputs.delete(id);
    this.providerBindings.delete(id);
    this.stepAdmissions.delete(id);
    fs.rmSync(target, { force: true });
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    const current = this.get(id);
    if (["succeeded", "failed", "cancelled"].includes(current.state)) return false;
    await Promise.all(current.stepRuns
      .filter((step) => step.state === "running" && step.runId)
      .map(async (step) => {
        try { await this.cancelChild(step.runId!); }
        catch { /* Workflow cancellation remains durable if a child is already gone. */ }
      }));
    const next = WorkflowRunRecordSchema.parse({ ...current, state: "cancelled", completedAt: this.now().toISOString() });
    this.records.set(id, next);
    this.persist(next);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.stepAdmissions.delete(id);
    return true;
  }

  private async advance(id: string, manifest: WorkflowManifest, inputs: Record<string, unknown>, providerBindings: Record<string, string>): Promise<void> {
    const current = this.records.get(id);
    if (!current || ["succeeded", "failed", "cancelled"].includes(current.state)) return;
    let next = current.state === "queued" ? WorkflowRunRecordSchema.parse({ ...current, state: "running" }) : current;
    const stepById = new Map(manifest.workflow.steps.map((step) => [step.id, step]));
    const updates = next.stepRuns.map((stepRun) => ({ ...stepRun }));

    for (const stepRun of updates.filter((step) => step.state === "running" && step.runId)) {
      let child: BrokerRunRecord;
      try {
        child = this.readRun(stepRun.runId!);
      } catch (error) {
        stepRun.state = "failed";
        stepRun.retryAt = null;
        stepRun.error = error instanceof Error ? error.message : String(error);
        continue;
      }
      if (child.state === "succeeded") {
        stepRun.state = "succeeded";
        stepRun.retryAt = null;
        stepRun.artifacts = child.artifacts;
      }
      else if (["failed", "timed_out", "cancelled"].includes(child.state)) {
        const definition = stepById.get(stepRun.stepId)!;
        if (child.state !== "cancelled" && stepRun.attempt <= definition.retry.maxAttempts) {
          stepRun.state = "pending";
          stepRun.retryAt = new Date(this.now().getTime() + definition.retry.backoffMs).toISOString();
          stepRun.runId = null;
          stepRun.error = null;
        } else {
          stepRun.state = "failed";
          stepRun.retryAt = null;
          stepRun.error = child.error || `Workflow Step ${stepRun.stepId} failed.`;
        }
      }
    }

    if (updates.some((step) => step.state === "failed")) {
      const failedStep = updates.find((step) => step.state === "failed")!;
      next = WorkflowRunRecordSchema.parse({
        ...next,
        state: "failed",
        completedAt: this.now().toISOString(),
        error: `Workflow Step ${failedStep.stepId} failed.`,
        stepRuns: updates
      });
      this.saveAndStop(next);
      return;
    }

    for (const stepRun of updates.filter((step) => step.state === "pending")) {
      const definition = stepById.get(stepRun.stepId)!;
      const admitted = this.stepAdmissions.get(id)?.get(stepRun.stepId);
      if (!admitted) {
        stepRun.state = "failed";
        stepRun.error = `Workflow Step 缺少已准入的 package identity：${stepRun.stepId}`;
        continue;
      }
      if (stepRun.retryAt && new Date(stepRun.retryAt).getTime() > this.now().getTime()) continue;
      const dependencies = definition.needs.map((need) => updates.find((candidate) => candidate.stepId === need));
      if (dependencies.some((dependency) => dependency?.state !== "succeeded")) continue;
      try {
        for (const dependency of dependencies) {
          if (!dependency || dependency.artifacts.length || !dependency.runId) continue;
          dependency.artifacts = this.readRun(dependency.runId).artifacts;
        }
        const request = SkillRunRequestSchema.parse({
          skillId: definition.skill,
          version: admitted.version,
          digest: admitted.digest,
          providerBindings,
          inputs: resolveStepInputs(definition.with, inputs, updates, new Set(definition.needs)),
          trigger: { type: "workflow", parentRunId: id, stepId: definition.id },
          rootGeneration: next.rootGeneration
        });
        const child = this.submit(request);
        stepRun.state = "running";
        stepRun.attempt += 1;
        stepRun.retryAt = null;
        stepRun.runId = child.id;
      } catch (error) {
        stepRun.state = "failed";
        stepRun.error = error instanceof Error ? error.message : String(error);
      }
    }

    const failedStep = updates.find((step) => step.state === "failed");
    if (failedStep) {
      next = WorkflowRunRecordSchema.parse({
        ...next,
        state: "failed",
        completedAt: this.now().toISOString(),
        error: `Workflow Step ${failedStep.stepId} failed.`,
        stepRuns: updates
      });
      this.saveAndStop(next);
      return;
    }

    if (updates.every((step) => step.state === "succeeded")) {
      next = WorkflowRunRecordSchema.parse({ ...next, state: "succeeded", completedAt: this.now().toISOString(), error: null, stepRuns: updates });
      this.saveAndStop(next);
      return;
    }
    next = WorkflowRunRecordSchema.parse({ ...next, state: "running", error: null, stepRuns: updates });
    this.records.set(id, next);
    this.persist(next);
    this.timers.set(id, setTimeout(() => void this.advance(id, manifest, inputs, providerBindings), 100));
  }

  private saveAndStop(record: WorkflowRunRecord): void {
    this.records.set(record.id, record);
    this.persist(record);
    const timer = this.timers.get(record.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(record.id);
    this.stepAdmissions.delete(record.id);
  }

  private persist(record: WorkflowRunRecord): void {
    writeJsonAtomic(path.join(this.root, `${record.id}.json`), record);
    try { this.onEvent(clone(record)); } catch { /* observers must not break Workflow state transitions */ }
  }

  private load(): void {
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const record = WorkflowRunRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(this.root, entry.name), "utf8")));
        if (["queued", "running"].includes(record.state)) {
          const interrupted = WorkflowRunRecordSchema.parse({
            ...record,
            state: "failed",
            completedAt: this.now().toISOString(),
            error: WORKFLOW_INTERRUPTED_ERROR
          });
          this.records.set(interrupted.id, interrupted);
          this.persist(interrupted);
        } else {
          this.records.set(record.id, record);
        }
      } catch {
        // Preserve unreadable history for diagnostics; never overwrite it.
      }
    }
  }
}

function validateWorkflowAdmission(
  manifest: WorkflowManifest,
  admissions: readonly WorkflowStepAdmission[],
  order = topologicalOrder(manifest)
): Map<string, WorkflowStepAdmission> {
  if (admissions.length !== order.length) {
    throw new WorkflowDefinitionError("Workflow admission 未覆盖全部 Step。 ");
  }
  const byStepId = new Map<string, WorkflowStepAdmission>();
  for (const admission of admissions) {
    if (byStepId.has(admission.stepId)) {
      throw new WorkflowDefinitionError(`Workflow admission Step ID 重复：${admission.stepId}`);
    }
    byStepId.set(admission.stepId, { ...admission, digest: admission.digest.toLowerCase() });
  }
  for (const definition of order) {
    const admitted = byStepId.get(definition.id);
    if (!admitted || admitted.skillId !== definition.skill) {
      throw new WorkflowDefinitionError(`Workflow admission 与 Step identity 不匹配：${definition.id}`);
    }
    if (!matchesSemverRange(admitted.version, definition.version)) {
      throw new WorkflowDefinitionError(`Workflow admission 与 Step version 不匹配：${definition.id}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(admitted.digest)) {
      throw new WorkflowDefinitionError(`Workflow admission 缺少有效 digest：${definition.id}`);
    }
  }
  return byStepId;
}

function assertSameWorkflowDefinition(
  current: WorkflowRunRecord,
  manifest: WorkflowManifest,
  order = topologicalOrder(manifest)
): void {
  if (manifest.id !== current.workflowSkillId || manifest.version !== current.workflowVersion) {
    throw new Error("Workflow 的 active version 已变化，拒绝恢复旧运行。");
  }
  if (!current.workflowFingerprint || current.workflowFingerprint !== workflowManifestFingerprint(manifest)) {
    throw new Error("Workflow 定义已变化或缺少 fingerprint，拒绝恢复旧运行。");
  }
  if (order.length !== current.stepRuns.length || order.some((step, index) => step.id !== current.stepRuns[index].stepId || step.skill !== current.stepRuns[index].skillId)) {
    throw new Error("Workflow 定义已变化，拒绝恢复旧运行。");
  }
}

function topologicalOrder(manifest: WorkflowManifest): WorkflowManifest["workflow"]["steps"] {
  const steps = manifest.workflow.steps;
  const byId = new Map<string, (typeof steps)[number]>();
  for (const step of steps) {
    if (byId.has(step.id)) throw new WorkflowDefinitionError(`Workflow Step ID 重复：${step.id}`);
    byId.set(step.id, step);
  }
  for (const step of steps) for (const need of step.needs) if (!byId.has(need)) throw new WorkflowDefinitionError(`Workflow Step 依赖不存在：${step.id} → ${need}`);
  const result: (typeof steps)[number][] = [];
  const state = new Map<string, "visiting" | "visited">();
  const visit = (id: string) => {
    if (state.get(id) === "visiting") throw new WorkflowDefinitionError(`Workflow 存在循环依赖：${id}`);
    if (state.get(id) === "visited") return;
    state.set(id, "visiting");
    const step = byId.get(id)!;
    for (const need of step.needs) visit(need);
    state.set(id, "visited");
    result.push(step);
  };
  for (const step of steps) visit(step.id);
  return result;
}

function resolveStepInputs(
  values: Record<string, unknown>,
  inputs: Record<string, unknown>,
  stepRuns: Array<{ stepId: string; artifacts: BrokerRunRecord["artifacts"] }>,
  allowedArtifactSteps: ReadonlySet<string>
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resolveWorkflowValue(value, inputs, stepRuns, allowedArtifactSteps)]));
}

function resolveWorkflowValue(
  value: unknown,
  inputs: Record<string, unknown>,
  stepRuns: Array<{ stepId: string; artifacts: BrokerRunRecord["artifacts"] }>,
  allowedArtifactSteps: ReadonlySet<string>
): unknown {
  if (typeof value === "string") {
    let resolved = value.replace(/\{\{\s*inputs\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, inputKey: string) => String(inputs[inputKey] ?? ""));
    resolved = resolved.replace(/\{\{\s*steps\.([A-Za-z0-9_.-]+)\.artifacts\.([A-Za-z0-9_.-]+)\.(logicalPath|externalPathRef|type|sha256|size|runId)\s*\}\}/g, (_match, stepId: string, artifactId: string, field: string) => {
      if (!allowedArtifactSteps.has(stepId)) throw new Error(`Workflow Artifact 只能引用 needs 中的步骤：${stepId}`);
      const step = stepRuns.find((candidate) => candidate.stepId === stepId);
      const artifact = step?.artifacts.find((candidate) => candidate.id === artifactId);
      if (!artifact) throw new Error(`Workflow Artifact 不存在或尚未完成：${stepId}.${artifactId}`);
      const resolvedField = artifact[field as keyof typeof artifact];
      if (resolvedField === undefined || resolvedField === null) throw new Error(`Workflow Artifact 字段为空：${stepId}.${artifactId}.${field}`);
      return String(resolvedField);
    });
    if (/\{\{\s*steps\.[^}]+\}\}/.test(resolved)) throw new Error("Workflow Artifact 模板无效，只允许引用已完成依赖步骤的声明字段。");
    return resolved;
  }
  if (Array.isArray(value)) return value.map((item) => resolveWorkflowValue(item, inputs, stepRuns, allowedArtifactSteps));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveWorkflowValue(item, inputs, stepRuns, allowedArtifactSteps)]));
  }
  return value;
}

function clone(record: WorkflowRunRecord): WorkflowRunRecord { return JSON.parse(JSON.stringify(record)) as WorkflowRunRecord; }

function cloneInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(inputs)) as Record<string, unknown>;
}

export function workflowManifestFingerprint(manifest: WorkflowManifest): string {
  return crypto.createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertSafeWorkflowInputs(inputs: Record<string, unknown>): void {
  const secretLike = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|secret)/i;
  for (const key of Object.keys(inputs)) {
    if (secretLike.test(key)) throw new Error(`Workflow 恢复输入不能携带 Secret：${key}`);
  }
}
