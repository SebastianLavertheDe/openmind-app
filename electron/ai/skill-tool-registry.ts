import { readSkillLibraryMetadata } from "../skills/skill-library-service";
import { resolveSkillLibraryTools } from "../skills/skill-library-runtime";
import type { SkillSelectionInput } from "../../shared/skill-library";
import type { SelectedSkillSnapshot } from "../../shared/contracts";
import path from "node:path";
import type { AiSessionSkillSnapshotEntry, SkillDefinition } from "../../shared/contracts";
import type { BrokerRunEvent, BrokerRunRecord, SkillRunRequest, WorkflowRunRecord, WorkflowStartRequest } from "../../shared/execution-contracts";
import { messages } from "../../shared/messages";
import { ExecutionBroker, type ExecutionPlan } from "../execution/execution-broker";
import type { AppPaths } from "../paths/app-paths-service";
import type { InstalledSkillExecutionResolver } from "../skills/installed-skill-execution-resolver";
import type { ProviderSkillBridge } from "./providers/skill-bridge";
import type { ProviderSkillCatalogEntry } from "./skill-discovery";
import { WorkflowEngine, type WorkflowAdmission } from "../execution/workflow-engine";

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

export type BrokerSkillRegistryOptions = {
  paths: AppPaths;
  openmindRoot: string;
  rootGeneration: number;
  maxConcurrentRuns?: number;
  installedResolver?: InstalledSkillExecutionResolver;
  onRunEvent?(event: BrokerRunEvent): void;
  onWorkflowEvent?(event: WorkflowRunRecord): void;
  workflowRoot?: string;
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
  private readonly broker: ExecutionBroker | null;
  private readonly brokerInvocations = new Map<string, BrokerInvocation>();
  private readonly brokerRunIds = new Map<string, string>();
  private readonly executionOpenmindRoot: string;
  private readonly executionRootGeneration: number;
  private readonly installedResolver: InstalledSkillExecutionResolver | null;
  private readonly onRunEvent: (event: BrokerRunEvent) => void;
  private readonly onWorkflowEvent: (event: WorkflowRunRecord) => void;
  private readonly workflow: WorkflowEngine | null;
  private readonly runtimePaths: AppPaths | null;

  constructor(private projectRoot: string, brokerOptions?: BrokerSkillRegistryOptions) {
    this.runtimePaths = brokerOptions?.paths || null;
    this.executionOpenmindRoot = brokerOptions?.openmindRoot ? path.resolve(brokerOptions.openmindRoot) : "";
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
    this.workflow = brokerOptions?.workflowRoot && this.installedResolver && this.broker
      ? new WorkflowEngine(
        brokerOptions.workflowRoot,
        (request) => this.submitAdmittedWorkflowStep(request),
        (runId) => this.getRun(runId),
        (runId) => this.cancelRun(runId),
        () => new Date(),
        (event) => this.onWorkflowEvent(event)
      )
      : null;
  }

  /**
   * Kept for scheduler compatibility: installed catalogs are read on demand
   * from the SkillPackageService resolver, so there is nothing to rescan.
   */
  refresh(): void {
    // The installed store under the bound root is the only skill source.
  }

  listDefinitions(): SkillDefinition[] {
    if (!this.installedResolver) return [];
    return this.installedResolver.listDefinitions();
  }

  /** Freeze the catalog used by one conversation. */
  captureSessionSnapshot(includeDisabled = false): AiSessionSkillSnapshotEntry[] {
    if (!this.installedResolver) return [];
    return this.installedResolver.captureSessionSnapshot(includeDisabled);
  }

  /** Main-only external Provider bridge; Renderer receives logical Skill metadata only. */
  providerSkillBridge(snapshot: AiSessionSkillSnapshotEntry): ProviderSkillBridge | null {
    return this.installedResolver?.providerSkillBridge(snapshot) || null;
  }

  resolveSelection(input: SkillSelectionInput, snapshot: AiSessionSkillSnapshotEntry[], selectionSource: "picker" | "slash"): SelectedSkillSnapshot {
    const entry = snapshot.find(item => item.installed?.key === input.key && item.installed.digest === input.digest);
    if (!entry) throw new Error(messages.skillLibrary.errors.stale);
    let bridge: ProviderSkillBridge | null;
    try { bridge = this.providerSkillBridge(entry); } catch (error) {
      if (selectionSource === "picker") throw error;
      return { ...entry, selectionSource, dependencies: [], executionModel: null };
    }
    if (!bridge && selectionSource === "picker") throw new Error(messages.skillLibrary.errors.stale);
    const metadata = bridge ? readSkillLibraryMetadata(bridge.packageRoot) : null;
    const dependencies = (metadata?.dependencies || []).map(reference => {
      const dependency = snapshot.find(item => item.installed?.key === reference.key && item.installed.digest === reference.digest);
      if (!dependency || reference.key === input.key) throw new Error(messages.skillLibrary.errors.dependency);
      this.providerSkillBridge(dependency);
      return dependency;
    });
    return { ...entry, selectionSource, dependencies, executionModel: metadata?.executionModel || null };
  }

  providerSkillCatalog(snapshot: readonly AiSessionSkillSnapshotEntry[]): ProviderSkillCatalogEntry[] {
    const tools = this.runtimePaths && snapshot.some(entry => ["om-short-video", "om-slide-deck"].includes(entry.definition.id)) ? resolveSkillLibraryTools(this.runtimePaths) : undefined;
    return snapshot.flatMap((entry) => {
      const bridge = this.providerSkillBridge(entry);
      if (!bridge) return [];
      return [{
        id: bridge.id,
        version: bridge.version,
        digest: bridge.digest,
        skillPath: bridge.skillPath,
        packageRoot: bridge.packageRoot,
        description: entry.definition.description,
        ...(tools && ["om-short-video", "om-slide-deck"].includes(bridge.id) ? { tools } : {})
      }];
    });
  }

  isRunning(invocationId: string): boolean {
    return this.brokerInvocations.has(invocationId);
  }

  /** Number of broker Skill processes currently holding a child process. */
  activeCount(): number {
    return this.broker?.activeTaskCount() || 0;
  }

  submitRun(request: SkillRunRequest): BrokerRunRecord {
    if (!this.broker) throw new Error(messages.desktopErrors.skill.brokerNotReady);
    return this.broker.submit(this.admitBrokerRequest(request));
  }

  listRuns(): BrokerRunRecord[] { return this.broker?.list() || []; }

  getRun(runId: string): BrokerRunRecord {
    if (!this.broker) throw new Error(messages.desktopErrors.skill.brokerNotReady);
    return this.broker.get(runId);
  }

  getRunEvents(runId: string): BrokerRunEvent[] {
    if (!this.broker) throw new Error(messages.desktopErrors.skill.brokerNotReady);
    return this.broker.events(runId);
  }

  listRunArtifacts(runId?: string): BrokerRunRecord["artifacts"] {
    if (!this.broker) return [];
    return this.broker.listArtifacts(runId);
  }

  retryRun(runId: string): BrokerRunRecord {
    if (!this.broker) throw new Error(messages.desktopErrors.skill.brokerNotReady);
    return this.broker.retry(runId, (request) => this.admitBrokerRequest(request));
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
    if (!this.workflow) throw new Error(messages.desktopErrors.skill.workflowNotReady);
    const current = this.workflow.get(runId);
    const admission = this.resolveWorkflowAdmission(current.workflowSkillId, current.workflowVersion);
    return this.workflow.retryStep(runId, stepId, admission);
  }

  resumeWorkflowRun(runId: string, inputs: Record<string, unknown>, rootGeneration: number, providerBindings: Record<string, string> = {}): WorkflowRunRecord {
    if (!this.workflow) throw new Error(messages.desktopErrors.skill.workflowNotReady);
    const current = this.workflow.get(runId);
    if (rootGeneration !== this.executionRootGeneration) throw new Error(messages.desktopErrors.skill.staleRoot);
    const admission = this.resolveWorkflowAdmission(current.workflowSkillId, current.workflowVersion);
    return this.workflow.resume(runId, admission, inputs, rootGeneration, providerBindings);
  }

  cancelRun(runId: string): Promise<boolean> {
    if (!this.broker) throw new Error(messages.desktopErrors.skill.brokerNotReady);
    return this.broker.cancel(runId);
  }

  startWorkflowRun(request: WorkflowStartRequest): WorkflowRunRecord {
    if (!this.workflow) throw new Error(messages.desktopErrors.skill.workflowNotReady);
    const admission = this.resolveWorkflowAdmission(request.skillId, request.version);
    return this.workflow.start(admission, request.inputs, request.rootGeneration, request.providerBindings);
  }

  listWorkflowRuns(): WorkflowRunRecord[] { return this.workflow?.list() || []; }
  getWorkflowRun(runId: string): WorkflowRunRecord {
    if (!this.workflow) throw new Error(messages.desktopErrors.skill.workflowNotReady);
    return this.workflow.get(runId);
  }
  cancelWorkflowRun(runId: string): Promise<boolean> {
    if (!this.workflow) throw new Error(messages.desktopErrors.skill.workflowNotReady);
    return this.workflow.cancel(runId);
  }

  private resolveWorkflowAdmission(skillId: string, version?: string): WorkflowAdmission {
    const resolver = this.installedResolver;
    if (!resolver) throw new Error(messages.desktopErrors.skill.workflowMissing(skillId));
    return resolver.admitWorkflow(skillId, version);
  }

  private submitAdmittedWorkflowStep(request: SkillRunRequest): BrokerRunRecord {
    if (!this.broker) throw new Error(messages.desktopErrors.skill.brokerNotReady);
    const resolver = this.installedResolver;
    if (!resolver) throw new Error(messages.desktopErrors.skill.workflowStepMissing(request.skillId));
    resolver.assertAdmittedBrokerRunnable(request);
    return this.broker.submit(request);
  }

  private admitBrokerRequest(request: SkillRunRequest): SkillRunRequest {
    const record = this.installedResolver?.assertBrokerRunnable(request);
    if (!record) return request;
    return {
      ...request,
      version: record.version,
      digest: record.digest.toLowerCase()
    };
  }

  async run(
    skillId: string,
    input: Record<string, unknown> = {},
    executionRoot = this.projectRoot,
    options: SkillExecutionOptions = {}
  ): Promise<string> {
    const invocationId = options.invocationId || `ai:${skillId}:${Date.now()}`;
    if (this.isRunning(invocationId)) throw new Error(messages.errors.skill.alreadyRunning(skillId));
    if (!this.broker) throw new Error(messages.desktopErrors.skill.bindRootFirst(skillId));
    return this.runViaBroker(skillId, input, executionRoot, invocationId, options);
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
    if (!broker) throw new Error(messages.desktopErrors.skill.brokerNotReady);
    if (path.resolve(executionRoot) !== path.resolve(this.projectRoot)) {
      throw new Error(messages.desktopErrors.skill.workspaceOnly);
    }
    if (!this.executionOpenmindRoot || this.executionRootGeneration < 1) {
      throw new Error(messages.desktopErrors.skill.invalidRoot);
    }
    const installed = this.installedResolver?.installed(skillId);
    if (!installed) throw new Error(messages.desktopErrors.skill.notInstalled(skillId));
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
          version: installed.version,
          digest: installed.digest,
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
    if (!this.installedResolver) throw new Error(messages.desktopErrors.skill.notExecutable(request.skillId));
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
    return false;
  }
}

function localDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
