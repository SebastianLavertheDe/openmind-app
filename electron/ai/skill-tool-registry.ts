import fs from "node:fs";
import path from "node:path";
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import type { SkillDefinition } from "../../shared/contracts";
import type { BrokerRunEvent, BrokerRunRecord, SkillRunRequest, WorkflowRunRecord, WorkflowStartRequest } from "../../shared/execution-contracts";
import { messages } from "../../shared/messages";
import { decodeProcessOutput, killProcessTree, spawnInDirectory } from "./process-utils";
import { discoverSkills, type SkillConfig } from "./skill-discovery";
import { ExecutionBroker, type ExecutionPlan } from "../execution/execution-broker";
import type { AppPaths } from "../paths/app-paths-service";
import type { InstalledSkillExecutionResolver } from "../skills/installed-skill-execution-resolver";
import type { ProviderSkillBridge } from "./providers/skill-bridge";
import { WorkflowEngine } from "../execution/workflow-engine";
import type { WorkflowManifest } from "../../shared/skill-manifest-schema";
import { loadSkillEnvFile } from "../security/skill-env-file";

export interface SkillTool {
  id: string;
  name: string;
  description: string;
  cwd: string;
  runner: string;
  args: string[];
  inputSchema: Record<string, unknown>;
  permission: "read-only" | "edit" | "auto";
  outputArtifacts: string[];
  timeoutMs: number;
}

export interface SkillExecutionEvent {
  skillId: string;
  invocationId: string;
  sourceId?: string;
  type: "status" | "output";
  state?: "running" | "success" | "failed" | "stopped" | "timed-out";
  stream?: "system" | "stdout" | "stderr";
  text?: string;
  code?: number | null;
  durationMs?: number;
  timestamp: string;
}

interface SkillExecutionOptions {
  invocationId?: string;
  signal?: AbortSignal;
  onEvent?(event: SkillExecutionEvent): void;
}

interface ActiveSkill {
  child: ChildProcessWithoutNullStreams;
  stopped: boolean;
}

export type BrokerSkillRegistryOptions = {
  paths: AppPaths;
  mymindRoot: string;
  rootGeneration: number;
  maxConcurrentRuns?: number;
  installedResolver?: InstalledSkillExecutionResolver;
  onRunEvent?(event: BrokerRunEvent): void;
  onWorkflowEvent?(event: WorkflowRunRecord): void;
  workflowRoot?: string;
  resolveWorkflowManifest?(skillId: string, version?: string): WorkflowManifest;
};

type BrokerInvocation = {
  runId: string;
  skillId: string;
  invocationId: string;
  sourceId?: string;
  startedAt: number;
  output: string[];
  onEvent?: SkillExecutionOptions["onEvent"];
  resolve: (output: string) => void;
  reject: (error: Error) => void;
  settled: boolean;
};

export class SkillToolRegistry {
  private skills: SkillConfig[];
  private readonly active = new Map<string, ActiveSkill>();
  private readonly broker: ExecutionBroker | null;
  private readonly brokerInvocations = new Map<string, BrokerInvocation>();
  private readonly brokerRunIds = new Map<string, string>();
  private readonly executionMymindRoot: string;
  private readonly executionRootGeneration: number;
  private readonly installedResolver: InstalledSkillExecutionResolver | null;
  private readonly onRunEvent: (event: BrokerRunEvent) => void;
  private readonly onWorkflowEvent: (event: WorkflowRunRecord) => void;
  private readonly workflow: WorkflowEngine | null;

  constructor(private projectRoot: string, private stateRoot?: string, brokerOptions?: BrokerSkillRegistryOptions) {
    this.skills = discoverSkills(projectRoot);
    this.executionMymindRoot = brokerOptions?.mymindRoot ? path.resolve(brokerOptions.mymindRoot) : "";
    this.executionRootGeneration = brokerOptions?.rootGeneration ?? 0;
    this.installedResolver = brokerOptions?.installedResolver || null;
    this.onRunEvent = brokerOptions?.onRunEvent || (() => undefined);
    this.onWorkflowEvent = brokerOptions?.onWorkflowEvent || (() => undefined);
    this.broker = brokerOptions
      ? new ExecutionBroker(
        brokerOptions.paths,
        (request, runId) => this.resolveExecutionPlan(request, runId),
        (event) => {
          this.onRunEvent(event);
          this.handleBrokerEvent(event);
        },
        { maxConcurrentRuns: brokerOptions.maxConcurrentRuns }
      )
      : null;
    this.workflow = brokerOptions?.workflowRoot && brokerOptions.resolveWorkflowManifest && this.broker
      ? new WorkflowEngine(
        brokerOptions.workflowRoot,
        (request) => this.submitRun(request),
        (runId) => this.getRun(runId),
        (runId) => this.cancelRun(runId),
        () => new Date(),
        (event) => this.onWorkflowEvent(event)
      )
      : null;
  }

  /** 重新扫描 .claude/skills/ 下所有 SKILL.md,刷新内存里的 skill 列表。 */
  refresh(): void {
    this.skills = discoverSkills(this.projectRoot);
  }

  list(): SkillTool[] {
    return this.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      cwd: skill.cwd,
      runner: skill.runner,
      args: skill.args,
      permission: skill.permission || "edit",
      outputArtifacts: skill.outputArtifacts || [],
      timeoutMs: skill.timeoutMs || 30 * 60 * 1000,
      inputSchema: {
        type: "object",
        properties: { date: { type: "string", description: messages.skillInput.optionalDate } },
        additionalProperties: false
      }
    }));
  }

  listDefinitions(): SkillDefinition[] {
    if (this.installedResolver) return this.installedResolver.listDefinitions();
    return this.skills.map((skill) => ({
      id: skill.id,
      title: skill.name,
      description: skill.description,
      cwd: skill.cwd,
      command: skill.runner,
      runner: skill.runner,
      args: skill.args,
      envFile: skill.envFile ?? null,
      group: skill.group,
      permission: skill.permission || "edit",
      outputArtifacts: skill.outputArtifacts || [],
      timeoutMs: skill.timeoutMs || 30 * 60 * 1000
    }));
  }

  /** Main-only external Provider bridge; Renderer receives logical Skill metadata only. */
  providerSkillBridge(skillId: string): ProviderSkillBridge | null {
    return this.installedResolver?.providerSkillBridge(skillId) || null;
  }

  isRunning(invocationId: string): boolean {
    return this.active.has(invocationId) || this.brokerInvocations.has(invocationId);
  }

  /** Number of manual/source Skill processes currently holding a child process. */
  activeCount(): number {
    return this.active.size + (this.broker?.activeTaskCount() || 0);
  }

  submitRun(request: SkillRunRequest): BrokerRunRecord {
    if (!this.broker) throw new Error("ExecutionBroker 未初始化。 ");
    this.installedResolver?.assertBrokerRunnable(request.skillId);
    return this.broker.submit(request);
  }

  listRuns(): BrokerRunRecord[] { return this.broker?.list() || []; }

  getRun(runId: string): BrokerRunRecord {
    if (!this.broker) throw new Error("ExecutionBroker 未初始化。 ");
    return this.broker.get(runId);
  }

  getRunEvents(runId: string): BrokerRunEvent[] {
    if (!this.broker) throw new Error("ExecutionBroker 未初始化。 ");
    return this.broker.events(runId);
  }

  listRunArtifacts(runId?: string): BrokerRunRecord["artifacts"] {
    if (!this.broker) return [];
    return this.broker.listArtifacts(runId);
  }

  retryRun(runId: string): BrokerRunRecord {
    if (!this.broker) throw new Error("ExecutionBroker 未初始化。 ");
    this.installedResolver?.assertBrokerRunnable(this.broker.get(runId).request.skillId);
    return this.broker.retry(runId);
  }

  revokeCredential(credentialId: string): Promise<number> {
    if (!this.broker) return Promise.resolve(0);
    return this.broker.revokeCredentials([credentialId]);
  }

  restoreCredential(credentialId: string): number {
    return this.broker?.restoreCredentials([credentialId]) || 0;
  }

  async rotateCredential(credentialId: string): Promise<number> {
    if (!this.broker) return 0;
    const affected = await this.broker.revokeCredentials([credentialId]);
    this.broker.restoreCredentials([credentialId]);
    return affected;
  }

  deleteRunHistory(runId: string): boolean {
    if (this.broker) {
      try {
        this.broker.get(runId);
        return this.broker.deleteHistory(runId);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("Run 不存在")) throw error;
      }
    }
    if (this.workflow) return this.workflow.deleteHistory(runId);
    return false;
  }

  retryWorkflowStep(runId: string, stepId: string): WorkflowRunRecord {
    if (!this.workflow) throw new Error("WorkflowEngine 未初始化。 ");
    return this.workflow.retryStep(runId, stepId);
  }

  resumeWorkflowRun(runId: string, inputs: Record<string, unknown>, rootGeneration: number, providerBindings: Record<string, string> = {}): WorkflowRunRecord {
    if (!this.workflow) throw new Error("WorkflowEngine 未初始化。 ");
    const current = this.workflow.get(runId);
    if (rootGeneration !== this.executionRootGeneration) throw new Error("当前 root snapshot 已过期，拒绝恢复 Workflow。 ");
    const manifest = this.resolveWorkflowManifest(current.workflowSkillId, current.workflowVersion);
    return this.workflow.resume(runId, manifest, inputs, rootGeneration, providerBindings);
  }

  cancelRun(runId: string): Promise<boolean> {
    if (!this.broker) throw new Error("ExecutionBroker 未初始化。 ");
    return this.broker.cancel(runId);
  }

  approveRun(runId: string): boolean {
    if (!this.broker) throw new Error("ExecutionBroker 未初始化。 ");
    return this.broker.approveExecution(runId);
  }

  startWorkflowRun(request: WorkflowStartRequest): WorkflowRunRecord {
    if (!this.workflow) throw new Error("WorkflowEngine 未初始化。 ");
    const manifest = this.resolveWorkflowManifest(request.skillId, request.version);
    return this.workflow.start(manifest, request.inputs, request.rootGeneration, request.providerBindings);
  }

  listWorkflowRuns(): WorkflowRunRecord[] { return this.workflow?.list() || []; }
  getWorkflowRun(runId: string): WorkflowRunRecord {
    if (!this.workflow) throw new Error("WorkflowEngine 未初始化。 ");
    return this.workflow.get(runId);
  }
  cancelWorkflowRun(runId: string): Promise<boolean> {
    if (!this.workflow) throw new Error("WorkflowEngine 未初始化。 ");
    return this.workflow.cancel(runId);
  }

  private resolveWorkflowManifest(skillId: string, version?: string): WorkflowManifest {
    const resolver = this.installedResolver;
    if (!resolver) throw new Error(`没有 active Workflow Skill：${skillId}`);
    return resolver.workflowManifest(skillId, version);
  }

  async run(
    skillId: string,
    input: Record<string, unknown> = {},
    executionRoot = this.projectRoot,
    options: SkillExecutionOptions = {}
  ): Promise<string> {
    const skill = this.skills.find((item) => item.id === skillId);
    const installed = this.installedResolver?.active(skillId);
    if (!skill && !installed) throw new Error(messages.errors.unregisteredSkill(skillId));
    if (skill && this.isSkillDisabled(skillId) && !input.sourceId) throw new Error(messages.errors.skill.sourceDisabled(skill.name));
    const invocationId = options.invocationId || `ai:${skillId}:${Date.now()}`;
    if (this.isRunning(invocationId)) throw new Error(messages.errors.skill.alreadyRunning(skillId));
    if (this.broker) return this.runViaBroker(skillId, input, executionRoot, invocationId, options);
    if (!skill) throw new Error(`Installed Skill ${skillId} 需要 ExecutionBroker 执行。`);
    const date = typeof input.date === "string" ? input.date.replaceAll("-", "") : localDate();
    const args = skill.args.map((arg) => arg === "${date}" ? date : arg);
    const cwd = path.resolve(executionRoot, skill.cwd);
    if (!fs.existsSync(cwd)) throw new Error(messages.errors.skill.cwdMissing(skill.cwd));
    const skillEnv = loadSkillEnvFile(cwd);
    const child = spawnInDirectory(cwd, skill.runner, args, {
      env: {
        ...skillEnv.values,
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
        CCTOOLS_SKILL_ID: skill.id,
        CCTOOLS_PROJECT_ROOT: executionRoot,
        ...(typeof input.sourceId === "string" ? { CCTOOLS_SOURCE_ID: input.sourceId } : {}),
        ...(typeof input.sourceUrl === "string" ? { CCTOOLS_SOURCE_URL: input.sourceUrl } : {}),
        ...(typeof input.sourceName === "string" ? { CCTOOLS_SOURCE_NAME: input.sourceName } : {})
      }
    });
    const active = { child, stopped: false };
    this.active.set(invocationId, active);
    const startedAt = Date.now();
    const output: string[] = [];
    const emit = (event: Omit<SkillExecutionEvent, "skillId" | "invocationId" | "timestamp">) => options.onEvent?.({
      skillId,
      invocationId,
      ...(typeof input.sourceId === "string" ? { sourceId: input.sourceId } : {}),
      timestamp: new Date().toISOString(),
      ...event
    });
    emit({ type: "status", state: "running" });
    emit({ type: "output", stream: "system", text: `$ ${skill.runner} ${args.join(" ")}\n` });

    const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = decodeProcessOutput(chunk);
      output.push(text);
      emit({ type: "output", stream, text });
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.stdin.end();

    const timeoutMs = skill.timeoutMs || 30 * 60 * 1000;
    const timeout = setTimeout(() => {
      active.stopped = true;
      void killProcessTree(child);
      emit({ type: "status", state: "timed-out", durationMs: Date.now() - startedAt });
    }, timeoutMs);
    const abort = () => {
      active.stopped = true;
      void killProcessTree(child);
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      const durationMs = Date.now() - startedAt;
      if (active.stopped || options.signal?.aborted) {
        emit({ type: "status", state: "stopped", code, durationMs });
        throw new Error(messages.errors.skill.stopped(skill.name));
      }
      if (code !== 0) {
        emit({ type: "status", state: "failed", code, durationMs });
        throw new Error(messages.errors.skill.failed(code, skill.name, output.join("")));
      }
      emit({ type: "status", state: "success", code, durationMs });
      return output.join("");
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      this.active.delete(invocationId);
    }
  }

  /**
   * Compatibility adapter for the old manual/source event shape. The actual
   * execution plan must always come from InstalledSkillExecutionResolver;
   * ExecutionBroker owns host execution and durable Run/Artifact records.
   */
  private runViaBroker(
    skillId: string,
    input: Record<string, unknown>,
    executionRoot: string,
    invocationId: string,
    options: SkillExecutionOptions
  ): Promise<string> {
    const broker = this.broker;
    if (!broker) throw new Error("ExecutionBroker 未初始化。");
    if (path.resolve(executionRoot) !== path.resolve(this.projectRoot)) {
      throw new Error("Skill 只能在当前工作区的 Broker 计划中运行。");
    }
    if (!this.executionMymindRoot || this.executionRootGeneration < 1) {
      throw new Error("尚未绑定有效的 mymind 根目录，无法创建 Skill Run。");
    }
    const active = this.installedResolver?.active(skillId);
    if (!active) throw new Error(`没有 active Installed Skill：${skillId}。请先完成安装、ready 和 host 授权。`);
    const sourceId = typeof input.sourceId === "string" ? input.sourceId : undefined;
    const requestInputs = { ...input, date: typeof input.date === "string" ? input.date.replaceAll("-", "") : localDate() };
    return new Promise<string>((resolve, reject) => {
      const invocation: BrokerInvocation = {
        runId: "",
        skillId,
        invocationId,
        ...(sourceId ? { sourceId } : {}),
        startedAt: Date.now(),
        output: [],
        onEvent: options.onEvent,
        resolve,
        reject,
        settled: false
      };
      this.brokerInvocations.set(invocationId, invocation);
      try {
        const record = this.submitRun({
          skillId,
          version: active.version,
          digest: active.digest,
          inputs: requestInputs,
          providerBindings: {},
          trigger: { type: "manual" },
          externalExportBindingIds: [],
          rootGeneration: this.executionRootGeneration
        });
        invocation.runId = record.id;
        this.brokerRunIds.set(invocationId, record.id);
        for (const event of broker.events(record.id)) this.handleBrokerEvent(event);
      } catch (error) {
        this.brokerInvocations.delete(invocationId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private resolveExecutionPlan(request: import("../../shared/execution-contracts").SkillRunRequest, runId: string): Promise<ExecutionPlan> {
    if (!this.installedResolver) throw new Error(`没有可执行的 active Installed Skill：${request.skillId}。请先完成安装、ready 和 host 授权。`);
    return this.installedResolver.resolve(request, runId);
  }

  private handleBrokerEvent(event: BrokerRunEvent): void {
    const invocation = Array.from(this.brokerInvocations.values()).find((item) => item.runId === event.runId);
    if (!invocation || invocation.settled) return;
    const emit = (payload: Omit<SkillExecutionEvent, "skillId" | "invocationId" | "timestamp">) => invocation.onEvent?.({
      skillId: invocation.skillId,
      invocationId: invocation.invocationId,
      ...(invocation.sourceId ? { sourceId: invocation.sourceId } : {}),
      timestamp: event.timestamp,
      ...payload
    });
    if (event.stream && event.text) {
      invocation.output.push(event.text);
      emit({ type: "output", stream: event.stream, text: event.text });
    }
    if (event.state === "running") emit({ type: "status", state: "running" });
    if (event.state === "succeeded" || event.state === "failed" || event.state === "timed_out" || event.state === "cancelled") {
      const durationMs = event.durationMs ?? Math.max(0, Date.parse(event.timestamp) - invocation.startedAt);
      if (event.state === "succeeded") {
        emit({ type: "status", state: "success", code: event.code ?? 0, durationMs });
        invocation.settled = true;
        invocation.resolve(invocation.output.join(""));
      } else if (event.state === "timed_out") {
        emit({ type: "status", state: "timed-out", code: event.code ?? null, durationMs });
        invocation.settled = true;
        invocation.reject(new Error(event.error || messages.errors.skill.stopped(invocation.skillId)));
      } else if (event.state === "cancelled") {
        emit({ type: "status", state: "stopped", code: event.code ?? null, durationMs });
        invocation.settled = true;
        invocation.reject(new Error(messages.errors.skill.stopped(invocation.skillId)));
      } else {
        emit({ type: "status", state: "failed", code: event.code ?? null, durationMs });
        invocation.settled = true;
        invocation.reject(new Error(event.error || messages.errors.skill.failed(event.code ?? null, invocation.skillId, invocation.output.join(""))));
      }
      this.brokerInvocations.delete(invocation.invocationId);
      this.brokerRunIds.delete(invocation.invocationId);
    }
  }

  async stop(invocationId: string): Promise<boolean> {
    const brokerRunId = this.brokerRunIds.get(invocationId);
    if (brokerRunId && this.broker) return this.broker.cancel(brokerRunId);
    const active = this.active.get(invocationId);
    if (!active) return false;
    active.stopped = true;
    await killProcessTree(active.child);
    return true;
  }

  private isSkillDisabled(skillId: string): boolean {
    const skill = this.skills.find((item) => item.id === skillId);
    const sourceId = skill?.surfacesAsSource?.sourceId;
    if (!sourceId) return false;
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(this.stateRoot ?? this.projectRoot, ".cctools", "source-settings.json"), "utf8")) as {
        sources?: Record<string, { enabled?: boolean }>;
      };
      return settings.sources?.[sourceId]?.enabled === false;
    } catch {
      return false;
    }
  }
}

function localDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
