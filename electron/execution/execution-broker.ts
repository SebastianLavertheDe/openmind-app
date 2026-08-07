import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AppPaths } from "../paths/app-paths-service";
import {
  AgentResumeRequestSchema,
  SkillRunRequestSchema,
  type AgentCheckpoint,
  type AgentResumeRequest,
  type BrokerRunEvent,
  type BrokerRunRecord,
  type SkillRunRequest
} from "../../shared/execution-contracts";
import { logRedactor } from "../security/log-redactor";
import { ArtifactCollector, type ArtifactCollectionResult, type ArtifactDeclaration, type ExternalBinding } from "./artifact-collector";
import { ExecutionConsentService, type ConsentInput } from "./execution-consent-service";
import { ProcessHost, type ProcessResult, type ProcessSpec, validateProcessSpec } from "./process-host";
import { RunStore } from "./run-store";

export type ExecutionPlan = {
  skillId: string;
  version: string;
  digest: string;
  rootGeneration: number;
  skillHome: string;
  mymindRoot: string;
  capabilities: unknown;
  /** Process plans use the host ProcessHost. Agent plans use the in-process
   * tool loop below the same consent, queue, mutex and Artifact lifecycle. */
  process: ProcessSpec;
  agent?: {
    timeoutMs: number;
    run(input: {
      signal: AbortSignal;
      onOutput(stream: "system" | "stdout" | "stderr", text: string): void;
      saveCheckpoint?(checkpoint: AgentCheckpoint | null): void;
    }): Promise<ProcessResult>;
  };
  /** Number of retries after the first process attempt. */
  retry?: { maxAttempts: number };
  maxInstances?: number;
  mutexes?: string[];
  artifacts?: ArtifactDeclaration[];
  externalBindings?: Record<string, ExternalBinding>;
  requiresHostConsent?: boolean;
  /** Credential IDs used by this plan; values are never persisted. */
  credentialIds?: string[];
  knownSecrets?: string[];
  runtime?: {
    target: string;
    packId: string;
    packDigest: string;
    fingerprint: string;
  };
  /** Held only while the Broker owns a running/preparing Runtime Pack. */
  acquireRuntime?(): void | Promise<void>;
  releaseRuntime?(): void | Promise<void>;
  prepareRuntime?(): Promise<void>;
  /** Removes Run-scoped transient files before Artifact collection and on exit. */
  cleanupRuntime?(): void | Promise<void>;
};

export type ExecutionPlanResolver = (
  request: SkillRunRequest,
  runId: string,
  options?: { agentCheckpoint?: AgentCheckpoint }
) => Promise<ExecutionPlan>;
export type ExecutionSubmitOptions = {
  agentCheckpoint?: AgentCheckpoint | null;
  resumedFromRunId?: string | null;
};

type QueuedExecution = { request: SkillRunRequest; runId: string; plan: ExecutionPlan };
type ActiveExecution = { controller: AbortController; skillId: string; mutexes: string[]; credentialIds: string[] };

export class ExecutionBroker {
  private readonly store: RunStore;
  private readonly processHost: ProcessHost;
  private readonly artifacts: ArtifactCollector;
  private readonly consent: ExecutionConsentService;
  private readonly queue: QueuedExecution[] = [];
  private readonly active = new Map<string, ActiveExecution>();
  private readonly inspecting = new Map<string, SkillRunRequest>();
  private readonly pendingConsent = new Map<string, QueuedExecution>();
  private readonly revokedCredentialIds = new Set<string>();
  /** 仅保存在 worker 内存中，用于当前进程内重试；RunStore 永不落盘输入值。 */
  private readonly retryRequests = new Map<string, SkillRunRequest>();
  private pumping = false;

  constructor(
    private readonly paths: AppPaths,
    private readonly resolvePlan: ExecutionPlanResolver,
    private readonly publish: (event: BrokerRunEvent) => void = () => undefined,
    options: {
      maxConcurrentRuns?: number;
      processHost?: ProcessHost;
      artifactCollector?: ArtifactCollector;
      consentService?: ExecutionConsentService;
      now?: () => Date;
    } = {}
  ) {
    this.store = new RunStore(paths.runs, options.now);
    this.processHost = options.processHost || new ProcessHost();
    this.artifacts = options.artifactCollector || new ArtifactCollector();
    this.consent = options.consentService || new ExecutionConsentService(path.join(paths.runs, "execution-consents.json"), options.now);
    this.maxConcurrentRuns = options.maxConcurrentRuns ?? 3;
    this.store.recoverInterrupted();
  }

  private readonly maxConcurrentRuns: number;

  submit(rawRequest: SkillRunRequest, options: ExecutionSubmitOptions = {}): BrokerRunRecord {
    const request = SkillRunRequestSchema.parse(rawRequest);
    rejectSecretLikeInputKeys(request.inputs);
    const record = this.store.create(request, crypto.randomUUID(), {
      agentCheckpoint: options.agentCheckpoint,
      resumedFromRunId: options.resumedFromRunId
    });
    this.retryRequests.set(record.id, cloneRequest(request));
    this.emitLatest(record.id);
    this.inspect(request, record.id, options);
    return record;
  }

  /**
   * Starts a new auditable Run from a durable Internal Agent checkpoint. The
   * old failed/cancelled Run remains immutable history; only safe provider
   * continuation state crosses the boundary.
   */
  resumeAgentRun(rawRequest: AgentResumeRequest): BrokerRunRecord {
    const request = AgentResumeRequestSchema.parse(rawRequest);
    const current = this.store.get(request.runId);
    if (!["failed", "timed_out", "cancelled"].includes(current.state)) {
      throw new Error("只有失败、超时或取消的 Agent Run 可以恢复。 ");
    }
    if (!current.agentCheckpoint) throw new Error("该 Agent Run 没有可恢复的 Provider checkpoint。 ");
    if (request.rootGeneration !== current.rootGeneration) throw new Error("当前 root snapshot 已过期，拒绝恢复 Agent。 ");
    const providerBindings = Object.keys(request.providerBindings).length
      ? request.providerBindings
      : current.request.providerBindingIds.length === 1
        ? { default: current.request.providerBindingIds[0] }
        : {};
    if (!Object.keys(providerBindings).length) throw new Error("恢复 Agent 需要重新提供 Provider Profile 绑定。 ");
    const nextRequest = SkillRunRequestSchema.parse({
      skillId: current.request.skillId,
      ...(current.request.version ? { version: current.request.version } : {}),
      ...(current.request.digest || current.skillDigest ? { digest: current.request.digest || current.skillDigest || undefined } : {}),
      inputs: request.inputs,
      providerBindings,
      trigger: { type: "manual" },
      externalExportBindingIds: current.request.externalExportBindingIds,
      rootGeneration: request.rootGeneration
    });
    return this.submit(nextRequest, {
      agentCheckpoint: current.agentCheckpoint,
      resumedFromRunId: current.id
    });
  }

  get(runId: string): BrokerRunRecord { return this.store.get(runId); }
  list(): BrokerRunRecord[] { return this.store.list(); }
  events(runId: string): BrokerRunEvent[] { return this.store.events(runId); }
  listArtifacts(runId?: string): BrokerRunRecord["artifacts"] { return this.store.listArtifacts(runId); }
  deleteHistory(runId: string): boolean {
    if (this.active.has(runId) || this.queue.some((entry) => entry.runId === runId) || this.inspecting.has(runId) || this.pendingConsent.has(runId)) {
      throw new Error("运行中的 Run 不能删除历史。");
    }
    this.retryRequests.delete(runId);
    return this.store.deleteHistory(runId);
  }

  /**
   * Prevents later injection and stops Broker-tracked work using a revoked
   * Credential. The Broker never receives or persists the Secret value.
   */
  async revokeCredentials(ids: string[]): Promise<number> {
    const revoked = new Set(ids.map((id) => id.trim()).filter(Boolean));
    if (!revoked.size) return 0;
    for (const id of revoked) this.revokedCredentialIds.add(id);
    let affected = 0;
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const entry = this.queue[index];
      if (!entry || !usesCredential(entry.plan, revoked)) continue;
      this.queue.splice(index, 1);
      this.store.transition(entry.runId, "cancelled", { reason: "credential-revoked-before-start" });
      this.emitLatest(entry.runId);
      affected += 1;
    }
    for (const [runId, entry] of this.pendingConsent) {
      if (!usesCredential(entry.plan, revoked)) continue;
      this.pendingConsent.delete(runId);
      this.store.transition(runId, "cancelled", { reason: "credential-revoked-awaiting-consent" });
      this.emitLatest(runId);
      affected += 1;
    }
    const activeRunIds = [...this.active.entries()]
      .filter(([, active]) => active.credentialIds.some((id) => revoked.has(id)))
      .map(([runId]) => runId);
    for (const runId of activeRunIds) {
      if (await this.cancel(runId, "credential-revoked")) affected += 1;
    }
    this.pump();
    return affected;
  }

  restoreCredentials(ids: string[]): number {
    let restored = 0;
    for (const id of ids.map((value) => value.trim()).filter(Boolean)) {
      if (this.revokedCredentialIds.delete(id)) restored += 1;
    }
    return restored;
  }

  retry(runId: string): BrokerRunRecord {
    const current = this.store.get(runId);
    if (!["failed", "timed_out", "cancelled"].includes(current.state)) {
      throw new Error("只有失败、超时或取消的 Run 可以重试。");
    }
    const original = this.retryRequests.get(runId);
    if (!original && (current.request.inputKeys.length || current.request.providerBindingIds.length)) {
      throw new Error("该 Run 的输入值未保存在历史中，重试前请重新从 Skill 表单提交。");
    }
    const request = original || SkillRunRequestSchema.parse({
      skillId: current.request.skillId,
      ...(current.request.version ? { version: current.request.version } : {}),
      ...(current.request.digest ? { digest: current.request.digest } : {}),
      ...(current.request.configRevision ? { configRevision: current.request.configRevision } : {}),
      inputs: {},
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: current.request.externalExportBindingIds,
      rootGeneration: current.rootGeneration
    });
    return this.submit({ ...request, trigger: { type: "manual" } });
  }
  activeTaskCount(): number { return this.queue.length + this.active.size + this.inspecting.size + this.pendingConsent.size; }

  async cancel(runId: string, reason = "user-cancelled"): Promise<boolean> {
    const current = this.store.get(runId);
    if (["succeeded", "failed", "timed_out", "cancelled"].includes(current.state)) return false;
    const queueIndex = this.queue.findIndex((item) => item.runId === runId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
      const cancelled = this.store.transition(runId, "cancelled", { reason: `${reason}-before-start` });
      this.emitLatest(runId);
      return cancelled.state === "cancelled";
    }
    if (this.pendingConsent.delete(runId)) {
      const cancelled = this.store.transition(runId, "cancelled", { reason: `${reason}-awaiting-consent` });
      this.emitLatest(runId);
      return cancelled.state === "cancelled";
    }
    if (this.inspecting.has(runId)) {
      this.inspecting.delete(runId);
      const cancelled = this.store.transition(runId, "cancelled", { reason: `${reason}-during-inspection` });
      this.emitLatest(runId);
      return cancelled.state === "cancelled";
    }
    const active = this.active.get(runId);
    if (!active) return false;
    if (this.store.get(runId).state === "running" || this.store.get(runId).state === "preparing_runtime") {
      this.store.transition(runId, "cancelling", { reason });
      this.emitLatest(runId);
    }
    active.controller.abort();
    return true;
  }

  approveExecution(runId: string): boolean {
    const queued = this.pendingConsent.get(runId);
    if (!queued) return false;
    this.consent.approve(this.consentInput(queued.plan));
    this.pendingConsent.delete(runId);
    this.store.transition(runId, "preparing_runtime", { reason: "execution-consent-approved" });
    this.emitLatest(runId);
    this.queue.push(queued);
    this.pump();
    return true;
  }

  revokeExecutionConsent(plan: Pick<ExecutionPlan, "skillId" | "version" | "digest" | "capabilities">): boolean {
    return this.consent.revoke(this.consentInput(plan));
  }

  private inspect(request: SkillRunRequest, runId: string, options: ExecutionSubmitOptions): void {
    this.inspecting.set(runId, request);
    void (async () => {
      try {
        this.store.transition(runId, "inspecting");
        this.emitLatest(runId);
        const plan = await this.resolvePlan(request, runId, {
          ...(options.agentCheckpoint ? { agentCheckpoint: options.agentCheckpoint } : {})
        });
        validateExecutionPlan(request, plan);
        if (usesCredential(plan, this.revokedCredentialIds)) {
          throw new Error("Run 使用的 Credential 已撤销，拒绝注入。 ");
        }
        if (this.store.get(runId).state === "cancelled") return;
        this.store.bindSkill(runId, plan.digest);
        if (plan.runtime) this.store.bindRuntime(runId, plan.runtime);
        const queued = { request, runId, plan };
        if (plan.requiresHostConsent !== false && !this.consent.isApproved(this.consentInput(plan))) {
          this.pendingConsent.set(runId, queued);
          this.store.transition(runId, "waiting_execution_consent", { reason: "host-execution-consent-required" });
          this.emitLatest(runId);
          return;
        }
        this.store.transition(runId, "preparing_runtime", { reason: "execution-consent-already-approved" });
        this.emitLatest(runId);
        this.queue.push(queued);
        this.pump();
      } catch (error) {
        if (this.store.get(runId).state !== "cancelled") {
          this.store.transition(runId, "failed", { reason: "inspection-failed", error: redactError(error) });
          this.emitLatest(runId);
        }
      } finally {
        this.inspecting.delete(runId);
      }
    })();
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      let inspected = true;
      while (this.active.size < this.maxConcurrentRuns && this.queue.length && inspected) {
        inspected = false;
        const index = this.queue.findIndex((entry) => !this.hasMutexConflict(entry.plan));
        if (index < 0) break;
        const [entry] = this.queue.splice(index, 1);
        if (!entry) break;
        inspected = true;
        const mutexes = [...new Set(entry.plan.mutexes || [])];
        this.active.set(entry.runId, {
          controller: new AbortController(),
          skillId: entry.plan.skillId,
          mutexes,
          credentialIds: [...new Set(entry.plan.credentialIds || [])]
        });
        void this.start(entry);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async start(entry: QueuedExecution): Promise<void> {
    const active = this.active.get(entry.runId);
    if (!active) return;
    const runDir = path.join(this.paths.runs, entry.runId, "work");
    const skillDataDir = path.join(runDir, "skill-data");
    fs.mkdirSync(skillDataDir, { recursive: true });
    let before: ReturnType<ArtifactCollector["snapshot"]> | null = null;
    let runtimeAcquired = false;
    try {
      if (usesCredential(entry.plan, this.revokedCredentialIds)) {
        throw new Error("Run 使用的 Credential 已撤销，拒绝启动。 ");
      }
      if (entry.plan.acquireRuntime) {
        await entry.plan.acquireRuntime();
        runtimeAcquired = true;
      }
      before = mergeSnapshots(this.artifacts.snapshot(entry.plan.mymindRoot), this.artifacts.snapshot(runDir));
      if (entry.plan.prepareRuntime) await entry.plan.prepareRuntime();
      if (usesCredential(entry.plan, this.revokedCredentialIds)) {
        throw new Error("Run 准备期间 Credential 已撤销，拒绝启动。 ");
      }
      if (this.store.get(entry.runId).state === "cancelling") {
        this.store.transition(entry.runId, "cancelled", { reason: "cancelled-before-process-start" });
        this.emitLatest(entry.runId);
        return;
      }
      let process: ProcessResult | null = null;
      if (entry.plan.agent) {
        this.store.transition(entry.runId, "running", { reason: "agent-started" });
        this.store.beginAttempt(entry.runId);
        this.emitLatest(entry.runId);
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          active.controller.abort();
        }, entry.plan.agent.timeoutMs);
        try {
          process = await entry.plan.agent.run({
            signal: active.controller.signal,
            saveCheckpoint: (checkpoint) => {
              this.store.attachAgentCheckpoint(entry.runId, checkpoint);
            },
            onOutput: (stream, text) => {
              const currentState = this.store.get(entry.runId).state;
              if (currentState === "running" || currentState === "cancelling") {
                const event = this.store.appendOutput(entry.runId, stream, logRedactor.redact(text));
                this.publish(event);
              }
            }
          });
        } finally {
          clearTimeout(timeout);
        }
        if (timedOut) process = { ...process, outcome: "timed_out" };
      } else {
        while (!process) {
          this.store.transition(entry.runId, "running", { reason: "process-started" });
          this.store.beginAttempt(entry.runId);
          this.emitLatest(entry.runId);
          const result = await this.processHost.run({
            ...requireProcessPlan(entry.plan),
            cwd: entry.plan.skillHome,
            env: buildMinimalEnvironment(this.paths, entry.runId, entry.plan, runDir, skillDataDir)
          }, {
            signal: active.controller.signal,
            onSpawn: (pid) => {
              this.store.bindProcessPid(entry.runId, pid);
            },
            knownSecrets: entry.plan.knownSecrets,
            onOutput: (output) => {
              if (this.store.get(entry.runId).state === "running" || this.store.get(entry.runId).state === "cancelling") {
                const event = this.store.appendOutput(entry.runId, output.stream, output.text, output.droppedBytes);
                this.publish(event);
              }
            }
          });
          this.store.clearProcessPid(entry.runId);
          if (shouldRetry(result, entry.plan.retry, this.store.get(entry.runId).attempt, active.controller.signal)) {
            const attempt = this.store.get(entry.runId).attempt;
            this.store.transition(entry.runId, "preparing_runtime", { reason: `retry-after-${result.outcome}` });
            const event = this.store.appendOutput(entry.runId, "system", `第 ${attempt} 次执行${result.outcome === "timed_out" ? "超时" : "失败"}，按策略重试。`);
            this.publish(event);
            continue;
          }
          process = result;
        }
      }
      if (entry.plan.cleanupRuntime) {
        try { await entry.plan.cleanupRuntime(); } catch { /* transient credential cleanup is best effort */ }
      }
      await this.finish(entry, process, before);
    } catch (error) {
      const current = this.store.get(entry.runId);
      if (current.processPid) this.store.clearProcessPid(entry.runId);
      if (!["succeeded", "failed", "timed_out", "cancelled"].includes(current.state)) {
        const state = current.state === "cancelling" ? "cancelled" : "failed";
        this.store.transition(entry.runId, state, { reason: "broker-execution-error", error: redactError(error) });
        this.emitLatest(entry.runId);
      }
    } finally {
      if (runtimeAcquired && entry.plan.releaseRuntime) {
        try { await entry.plan.releaseRuntime(); } catch { /* lease cleanup is best effort after terminal state */ }
      }
      if (entry.plan.cleanupRuntime) {
        try { await entry.plan.cleanupRuntime(); } catch { /* idempotent best effort */ }
      }
      this.active.delete(entry.runId);
      this.pump();
    }
  }

  private async finish(entry: QueuedExecution, process: ProcessResult, before: ReturnType<ArtifactCollector["snapshot"]> | null): Promise<void> {
    let collection: ArtifactCollectionResult | null = null;
    try {
      collection = before ? this.artifacts.collect({
        runId: entry.runId,
        skillId: entry.plan.skillId,
        mymindRoot: entry.plan.mymindRoot,
        runDir: path.join(this.paths.runs, entry.runId, "work"),
        before,
        declarations: entry.plan.artifacts || [],
        externalBindings: entry.plan.externalBindings
      }) : null;
      if (collection?.undeclaredPaths.length) {
        const event = this.store.appendOutput(entry.runId, "system", `检测到未声明写入：${collection.undeclaredPaths.slice(0, 50).join(", ")}`);
        this.publish(event);
      }
      if (collection) this.store.attachArtifacts(entry.runId, collection.artifacts);
      if (process.usage) this.store.attachUsage(entry.runId, process.usage);
      if (process.outcome === "succeeded" && this.store.get(entry.runId).agentCheckpoint) {
        this.store.attachAgentCheckpoint(entry.runId, null);
      }
    } catch (error) {
      const current = this.store.get(entry.runId);
      const state = current.state === "cancelling" || process.outcome === "cancelled"
        ? "cancelled"
        : process.outcome === "timed_out" ? "timed_out" : "failed";
      if (state === "cancelled" && current.state !== "cancelling") {
        this.store.transition(entry.runId, "cancelling", { reason: "artifact-collection-after-cancel" });
      }
      this.store.transition(entry.runId, state, { reason: "artifact-collection-failed", error: redactError(error) });
      this.emitLatest(entry.runId);
      return;
    }
    const current = this.store.get(entry.runId);
    if (process.outcome === "cancelled") {
      if (current.state !== "cancelling") this.store.transition(entry.runId, "cancelling", { reason: "process-cancelled" });
      this.store.transition(entry.runId, "cancelled", { reason: "process-tree-cleaned", code: process.code, signal: process.signal });
    } else if (process.outcome === "timed_out") {
      this.store.transition(entry.runId, "timed_out", { reason: "process-timeout", error: "Run 超时，进程树已执行 best-effort 清理。", code: process.code, signal: process.signal });
    } else if (process.outcome === "succeeded") {
      this.store.transition(entry.runId, "succeeded", { reason: "process-exited-zero", code: process.code, signal: process.signal });
    } else {
      this.store.transition(entry.runId, "failed", { reason: "process-exited-nonzero", error: redactError(process.stderr || `进程退出码：${process.code}`), code: process.code, signal: process.signal });
    }
    this.emitLatest(entry.runId);
  }

  private hasMutexConflict(plan: ExecutionPlan): boolean {
    const mutexes = new Set(plan.mutexes || []);
    if (Array.from(this.active.values()).some((active) => active.mutexes.some((mutex) => mutexes.has(mutex)))) return true;
    const maxInstances = plan.maxInstances ?? 64;
    const activeForSkill = Array.from(this.active.values()).filter((active) => active.skillId === plan.skillId).length;
    return activeForSkill >= maxInstances;
  }

  private consentInput(plan: Pick<ExecutionPlan, "skillId" | "version" | "digest" | "capabilities">): ConsentInput {
    return { skillId: plan.skillId, version: plan.version, digest: plan.digest, capabilities: plan.capabilities };
  }

  private emitLatest(runId: string): void {
    const event = this.store.events(runId).at(-1);
    if (event) this.publish(event);
  }
}

function shouldRetry(
  result: ProcessResult,
  retry: ExecutionPlan["retry"],
  attempt: number,
  signal: AbortSignal
): boolean {
  if (signal.aborted || result.outcome === "cancelled" || result.outcome === "succeeded") return false;
  return (result.outcome === "failed" || result.outcome === "timed_out")
    && Boolean(retry && attempt <= retry.maxAttempts);
}

function validateExecutionPlan(request: SkillRunRequest, plan: ExecutionPlan): void {
  if (plan.skillId !== request.skillId) throw new Error("Runtime plan Skill ID 与请求不一致。");
  if (request.version && request.version !== plan.version) throw new Error("Runtime plan Skill version 与请求不一致。");
  if (request.digest && request.digest.toLowerCase() !== plan.digest.toLowerCase()) throw new Error("Runtime plan Skill digest 与请求不一致。");
  if (request.rootGeneration !== plan.rootGeneration) throw new Error("Run root generation 已过期。");
  if (!/^[a-f0-9]{64}$/i.test(plan.digest)) throw new Error("Runtime plan digest 无效。");
  if (plan.retry && (!Number.isInteger(plan.retry.maxAttempts) || plan.retry.maxAttempts < 0 || plan.retry.maxAttempts > 10)) {
    throw new Error("Runtime plan retry.maxAttempts 无效。");
  }
  if (!path.isAbsolute(plan.skillHome) || !path.isAbsolute(plan.mymindRoot)) throw new Error("Runtime plan 路径必须是绝对路径。");
  if (plan.agent) {
    if (!Number.isInteger(plan.agent.timeoutMs) || plan.agent.timeoutMs < 1_000) throw new Error("Agent timeoutMs 无效。");
  } else {
    if (path.resolve(plan.process.cwd) !== path.resolve(plan.skillHome)) throw new Error("Process cwd 必须绑定到已安装 Skill 目录。");
    validateProcessSpec(plan.process);
  }
}

function requireProcessPlan(plan: ExecutionPlan): ProcessSpec {
  return plan.process;
}

function buildMinimalEnvironment(paths: AppPaths, runId: string, plan: ExecutionPlan, runDir: string, skillDataDir: string): Record<string, string> {
  const standard: Record<string, string> = {
    CCTOOLS_RUN_ID: runId,
    CCTOOLS_SKILL_ID: plan.skillId,
    CCTOOLS_SKILL_VERSION: plan.version,
    CCTOOLS_SKILL_HOME: plan.skillHome,
    CCTOOLS_SKILL_DATA_DIR: skillDataDir,
    CCTOOLS_RUN_DIR: runDir,
    CCTOOLS_MYMIND_ROOT: plan.mymindRoot,
    MYMIND_ROOT: plan.mymindRoot,
    CCTOOLS_ROOT_GENERATION: String(plan.rootGeneration),
    CCTOOLS_ARTIFACT_MANIFEST: JSON.stringify(plan.artifacts || []),
    CCTOOLS_MANAGED_RUN: "1"
  };
  return { ...plan.process.env, ...standard, CCTOOLS_APP_USER_DATA: paths.userData };
}

function mergeSnapshots(
  mymind: ReturnType<ArtifactCollector["snapshot"]>,
  run: ReturnType<ArtifactCollector["snapshot"]>
): ReturnType<ArtifactCollector["snapshot"]> {
  const merged = new Map(mymind);
  for (const [relative, entry] of run) merged.set(`run/${relative}`, entry);
  return merged;
}

function rejectSecretLikeInputKeys(inputs: Record<string, unknown>): void {
  const dangerous = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|secret)/i;
  for (const key of Object.keys(inputs)) if (dangerous.test(key)) throw new Error(`Run 输入不能直接携带 Secret：${key}`);
}

function usesCredential(plan: ExecutionPlan, credentialIds: ReadonlySet<string>): boolean {
  return (plan.credentialIds || []).some((id) => credentialIds.has(id));
}

function redactError(error: unknown): string {
  return logRedactor.redact(error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function cloneRequest(request: SkillRunRequest): SkillRunRequest {
  return JSON.parse(JSON.stringify(request)) as SkillRunRequest;
}
