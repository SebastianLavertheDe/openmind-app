import path from "node:path";
import {
  ApprovalDecisionSchema,
  SessionPatchSchema,
  StartRunInputSchema,
  type AiEvent,
  type AiContextState,
  type AiRun,
  type AiSession,
  type AiSnapshot,
  type AiTurnListParams,
  type AiTurnPage,
  type ApprovalDecision,
  type ChangeSet,
  type SessionPatch,
  type StartRunInput
} from "../../shared/contracts";
import { ApprovalBroker } from "./approval-broker";
import { ProviderRegistry } from "./provider-registry";
import { SessionStore } from "./session-store";
import { LegacyChangeManager } from "./workspace-manager";
import { SkillToolRegistry } from "./skill-tool-registry";
import { ClaudeAgentSdkAdapter } from "./providers/claude-agent-sdk";
import { CodexAppServerAdapter } from "./providers/codex-app-server";
import { ChangeApplicationService } from "./change-application";
import { ManualSkillController } from "./manual-skill-controller";
import { normalizeContextReferences, normalizeCwd } from "./scheduler-paths";
import { materializeImages, cleanupImages, cleanupStaleImages } from "./scheduler-images";
import { AUTO_MODEL, type ProviderKind } from "../../shared/model-catalog";
import { slashCommandValidationError } from "../../shared/slash-commands";
import { parseSkillSlashInvocation } from "../../shared/skill-invocations";
import type { ProviderAdapter, ProviderDefinition } from "./providers/types";
import { DEFAULT_BROWSER_EVIDENCE_DIR, type SkillDefinition } from "../../shared/contracts";
import { prewarmProviderSession, recoverInterruptedRuns } from "./scheduler-lifecycle";
import { titleFromPrompt } from "./scheduler-prompts";
import { matchesSemverRange } from "../../shared/skill-manifest-schema";
import { type BrowserAutomationConfig } from "./browser-evidence";
import { WorkflowResumeRequestSchema, WorkflowStartRequestSchema, type BrokerRunEvent, type BrokerRunRecord, type WorkflowResumeRequest, type WorkflowRunRecord, type WorkflowStartRequest } from "../../shared/execution-contracts";
import type { AutomationRule, AutomationRuleInput, AutomationRunRecord, AutomationScheduleSnapshot } from "../../shared/automation-contracts";
import { buildAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "../skills/skill-package-service";
import { InstalledSkillExecutionResolver } from "../skills/installed-skill-execution-resolver";
import type { SkillCredentialKindResolver, SkillCredentialResolver } from "../skills/installed-skill-execution-resolver";
import { RuntimeManager } from "../runtime/runtime-manager";
import { SharedPythonRuntimeService } from "../runtime/shared-python-runtime";
import { listInstalledPythonProjects } from "../runtime/installed-python-projects";
import { ExportLocationService } from "../execution/export-location-service";
import { AutomationRepository } from "../automation/automation-repository";
import { AutomationScheduler } from "../automation/automation-scheduler";
import { AutomationLeader } from "../automation/automation-leader";
import { createAutomationFileFingerprint } from "../automation/automation-file-fingerprint";
import { ProviderProfileRepository } from "../security/provider-profile-repository";
import { ManagedCredentialFileAdapter } from "../security/credential-file-adapter";
import { appendScheduledEvent, cancelScheduledRun, handleApprovalRequest, persistScheduledTurnAndPump, resolveScheduledApproval, type ActiveRun, type SchedulerExecutionHost } from "./scheduler-execution";

export class RunScheduler {
  private readonly store: SessionStore;
  private readonly registry: ProviderRegistry;
  private readonly legacyChanges: LegacyChangeManager;
  private readonly approvals: ApprovalBroker;
  private readonly skillTools: SkillToolRegistry;
  private readonly manualSkills: ManualSkillController;
  private readonly changeApplications: ChangeApplicationService;
  private readonly queue: string[] = [];
  private readonly active = new Map<string, ActiveRun>();
  // Provider 注册表（adapters map 从它派生）：新增 provider = 加一行 + 实现 ProviderAdapter。
  private readonly providers: ProviderDefinition[] = [{ kind: "codex", adapter: new CodexAppServerAdapter() }, { kind: "claude", adapter: new ClaudeAgentSdkAdapter() }];
  private readonly adapters = Object.fromEntries(this.providers.map((definition) => [definition.kind, definition.adapter])) as Record<string, ProviderAdapter>;
  private readonly maxConcurrentRuns = 3;
  private readonly resolveProviderModel: (kind: ProviderKind) => string;
  private readonly browserAutomation: BrowserAutomationConfig;
  private readonly stateRoot?: string;
  private readonly automation: AutomationScheduler | null;

  constructor(
    readonly projectRoot: string,
    private publish: (message: unknown) => void,
    resolveProviderModel?: (kind: ProviderKind) => string,
    browserAutomation?: BrowserAutomationConfig,
    stateRoot?: string,
    mymindRoot?: string,
    rootGeneration = 1,
    credentialResolver?: SkillCredentialResolver,
    credentialKindResolver?: SkillCredentialKindResolver
  ) {
    this.resolveProviderModel = resolveProviderModel ?? (() => AUTO_MODEL);
    this.browserAutomation = browserAutomation ?? { enabled: false, reuseExistingTabs: true, evidenceDir: DEFAULT_BROWSER_EVIDENCE_DIR, extensionToken: null };
    this.stateRoot = stateRoot;
    this.store = new SessionStore(projectRoot, stateRoot);
    this.registry = new ProviderRegistry(projectRoot);
    this.legacyChanges = new LegacyChangeManager(projectRoot, stateRoot);
    const appPaths = mymindRoot ? buildAppPaths(process.env.CCTOOLS_USER_DATA_DIR) : null;
    const packageService = appPaths && mymindRoot ? new SkillPackageService(appPaths) : null;
    const providerProfileRepository = appPaths && mymindRoot ? new ProviderProfileRepository(appPaths) : null;
    const credentialFiles = appPaths && mymindRoot ? new ManagedCredentialFileAdapter(appPaths) : undefined;
    const installedResolver = appPaths && mymindRoot
      ? new InstalledSkillExecutionResolver(
        packageService!,
        new RuntimeManager(appPaths, {
          sharedPython: new SharedPythonRuntimeService(appPaths, {
            projects: () => listInstalledPythonProjects(packageService!),
            ...(process.env.CCTOOLS_PYTHON_RUNTIME_ASSET_ROOT
              ? { bundledAssetRoot: process.env.CCTOOLS_PYTHON_RUNTIME_ASSET_ROOT }
              : {})
          })
        }),
        mymindRoot,
        rootGeneration,
        credentialResolver,
        (bindingId) => {
          const binding = new ExportLocationService(
            path.join(appPaths.settings, "export-bindings.json"),
            () => [appPaths.userData, mymindRoot]
          ).resolve(bindingId);
          return { bindingId: binding.id, canonicalPath: binding.canonicalPath, revoked: binding.revoked };
        },
        (profileId) => providerProfileRepository?.get(profileId) || null,
        credentialKindResolver,
        credentialFiles
      )
      : undefined;
    this.skillTools = new SkillToolRegistry(projectRoot, stateRoot, appPaths && mymindRoot ? {
      paths: appPaths,
      mymindRoot,
      rootGeneration,
      maxConcurrentRuns: this.maxConcurrentRuns,
      installedResolver,
        onRunEvent: (event) => {
          this.publish({ kind: "skill-run-event", event });
          if (this.automation) void this.automation.handleRunEvent(event).catch(() => undefined);
        },
        onWorkflowEvent: (event) => {
          if (this.automation) void this.automation.handleWorkflowRunEvent(event).catch(() => undefined);
        },
      ...(appPaths && installedResolver ? {
        workflowRoot: path.join(appPaths.runs, "workflows"),
        resolveWorkflowManifest: (skillId: string, version?: string) => installedResolver.workflowManifest(skillId, version)
      } : {})
    } : undefined);
    this.manualSkills = new ManualSkillController(this.skillTools, projectRoot, publish);
    this.automation = appPaths && mymindRoot ? new AutomationScheduler({
      repository: new AutomationRepository(appPaths),
      leader: new AutomationLeader(appPaths.automation),
      fileFingerprint: createAutomationFileFingerprint(mymindRoot),
      rootGeneration,
      submitSkill: (request) => this.skillTools.submitRun(request),
      submitWorkflow: (request) => this.skillTools.startWorkflowRun(request),
      readSkill: (runId) => this.skillTools.getRun(runId),
      readWorkflow: (runId) => this.skillTools.getWorkflowRun(runId),
      cancelSkill: (runId) => this.skillTools.cancelRun(runId),
      cancelWorkflow: (runId) => this.skillTools.cancelWorkflowRun(runId),
      resolveTargetVersion: (target) => {
        if (target.versionPolicy === "*") return undefined;
        const active = installedResolver?.active(target.id);
        if (!active || !matchesSemverRange(active.version, target.versionPolicy)) throw new Error(`当前 active Skill 不满足 version policy：${target.id}@${target.versionPolicy}`);
        return active.version;
      }
    }) : null;
    this.automation?.start();
    this.changeApplications = new ChangeApplicationService(
      this.store,
      this.legacyChanges,
      {
        append: (run, kind, payload) => appendScheduledEvent(this.executionHost(), run, kind, payload),
        publishSnapshot: () => this.publishSnapshot()
      }
    );
    this.approvals = new ApprovalBroker((request) => void handleApprovalRequest(this.executionHost(), request));
    this.store.initialize();
    recoverInterruptedRuns(this.store);
    cleanupStaleImages(this.projectRoot, this.stateRoot);
  }

  snapshot(): AiSnapshot {
    return {
      projectRoot: this.projectRoot,
      providers: this.registry.detect(),
      sessions: this.store.listSessions(),
      runs: this.store.listRuns(),
      pendingApprovals: this.approvals.list()
    };
  }

  /**
   * 异步刷新 provider 探测缓存（启动、窗口获焦、进入设置时调用），
   * 完成后推送新 snapshot。探测走 spawn、不阻塞 worker；且绝不进入 send 路径。
   */
  refreshProviders(): Promise<void> {
    return this.registry
      .refresh()
      .then(() => this.publishSnapshot())
      .catch(() => undefined);
  }

  getEvents(sessionId: string): AiEvent[] { return this.store.readEvents(sessionId); }
  getTurns(sessionId: string, params: AiTurnListParams = {}): AiTurnPage { return this.store.listTurns(sessionId, params); }
  getContextState(sessionId: string): AiContextState { return this.store.getContextState(sessionId); }
  searchSessions(query: string): AiSession[] { return this.store.search(query); }
  listSkills(): SkillDefinition[] { return this.skillTools.listDefinitions(); }

  /** Root switching must account for queued, provider and manual Skill work. */
  activeTaskCount(): number {
    return this.queue.length + this.active.size + this.skillTools.activeCount();
  }

  /** 重新扫描 skill 目录并返回最新列表(用于新对话时刷新前端缓存)。 */
  refreshSkills(): SkillDefinition[] {
    this.skillTools.refresh();
    return this.skillTools.listDefinitions();
  }

  /** prewarm Claude（兼容 worker RPC 与既有测试）；通用 prewarm 按 adapter 能力触发（新增 provider 无需改）。 */
  async prewarmClaude(sessionId?: string): Promise<boolean> { return this.prewarm("claude", sessionId); }
  async prewarm(provider: ProviderKind, sessionId?: string): Promise<boolean> {
    return prewarmProviderSession({ projectRoot: this.projectRoot, store: this.store, registry: this.registry, adapter: this.adapters[provider], provider, resolveProviderModel: this.resolveProviderModel, browserAutomation: this.browserAutomation }, sessionId);
  }

  startSkill(skillId: string, date?: string): boolean { return this.manualSkills.startSkill(skillId, date); }
  startSource(sourceId: string, skillId: string, date?: string, sourceUrl?: string, sourceName?: string): boolean {
    return this.manualSkills.startSource(sourceId, skillId, date, sourceUrl, sourceName);
  }
  stopSkill(skillId: string): Promise<boolean> { return this.manualSkills.stopSkill(skillId); }
  stopSource(sourceId: string): Promise<boolean> { return this.manualSkills.stopSource(sourceId); }

  listSkillRuns(): BrokerRunRecord[] { return this.skillTools.listRuns(); }
  getSkillRun(runId: string): BrokerRunRecord { return this.skillTools.getRun(runId); }
  getSkillRunEvents(runId: string): BrokerRunEvent[] { return this.skillTools.getRunEvents(runId); }
  listRunArtifacts(runId?: string): BrokerRunRecord["artifacts"] { return this.skillTools.listRunArtifacts(runId); }
  retrySkillRun(runId: string): BrokerRunRecord { return this.skillTools.retryRun(runId); }
  revokeCredential(credentialId: string): Promise<number> { return this.skillTools.revokeCredential(credentialId); }
  restoreCredential(credentialId: string): number { return this.skillTools.restoreCredential(credentialId); }
  rotateCredential(credentialId: string): Promise<number> { return this.skillTools.rotateCredential(credentialId); }
  deleteRunHistory(runId: string): boolean { return this.skillTools.deleteRunHistory(runId); }
  async cancelSkillRun(runId: string): Promise<boolean> {
    const cancelled = await this.skillTools.cancelRun(runId);
    this.publishSnapshot();
    return cancelled;
  }
  approveSkillRun(runId: string): boolean { return this.skillTools.approveRun(runId); }

  startWorkflowRun(rawRequest: WorkflowStartRequest): WorkflowRunRecord {
    return this.skillTools.startWorkflowRun(WorkflowStartRequestSchema.parse(rawRequest));
  }
  listWorkflowRuns(): WorkflowRunRecord[] { return this.skillTools.listWorkflowRuns(); }
  getWorkflowRun(runId: string): WorkflowRunRecord { return this.skillTools.getWorkflowRun(runId); }
  retryWorkflowStep(runId: string, stepId: string): WorkflowRunRecord { return this.skillTools.retryWorkflowStep(runId, stepId); }
  resumeWorkflowRun(rawRequest: WorkflowResumeRequest): WorkflowRunRecord { const request = WorkflowResumeRequestSchema.parse(rawRequest); return this.skillTools.resumeWorkflowRun(request.runId, request.inputs, request.rootGeneration, request.providerBindings); }
  cancelWorkflowRun(runId: string): Promise<boolean> { return this.skillTools.cancelWorkflowRun(runId); }

  listAutomationRules(): AutomationRule[] { return this.automation?.listRules() || []; }
  saveAutomationRule(input: AutomationRuleInput): AutomationRule {
    if (!this.automation) throw new Error("AutomationScheduler 未初始化。 ");
    return this.automation.saveRule(input);
  }
  deleteAutomationRule(id: string): boolean {
    if (!this.automation) throw new Error("AutomationScheduler 未初始化。 ");
    return this.automation.removeRule(id);
  }
  runAutomationNow(id: string): Promise<AutomationRunRecord> {
    if (!this.automation) throw new Error("AutomationScheduler 未初始化。 ");
    return this.automation.runNow(id);
  }
  listAutomationRuns(ruleId?: string): AutomationRunRecord[] { return this.automation?.listRuns(ruleId) || []; }
  listAutomationSchedules(): AutomationScheduleSnapshot[] { return this.automation?.listSchedules() || []; }

  updateSession(id: string, patch: SessionPatch): AiSession {
    const result = this.store.updateSession(id, SessionPatchSchema.parse(patch));
    this.publishSnapshot();
    return result;
  }

  deleteSession(id: string): boolean {
    const unfinished = this.store.listRuns(id).some((run) => ["queued", "running", "waiting-approval", "applying"].includes(run.status));
    if (unfinished) throw new Error("会话仍有运行中或排队任务，请先停止后再删除。");
    for (const adapter of Object.values(this.adapters)) adapter.disposeSession?.(id);
    for (const run of this.store.listRuns(id)) cleanupImages(this.projectRoot, run.id, this.stateRoot);
    const result = this.store.deleteSession(id);
    this.publishSnapshot();
    return result;
  }

  async forkSession(sessionId: string, throughRunId?: string): Promise<AiSession> {
    const source = this.store.getSession(sessionId);
    if (this.store.listRuns(sessionId).some((run) => ["queued", "running", "waiting-approval", "applying"].includes(run.status))) {
      throw new Error("Cannot fork a session while a turn is active.");
    }
    const fork = await this.store.forkSession(sessionId, throughRunId);
    if (this.adapters[source.provider]?.prewarm) void this.prewarm(source.provider, fork.id).catch(() => undefined);
    this.publishSnapshot();
    return fork;
  }

  async rollbackTurns(sessionId: string, numTurns: number): Promise<boolean> {
    const session = this.store.getSession(sessionId);
    if (this.store.listRuns(sessionId).some((run) => ["queued", "running", "waiting-approval", "applying"].includes(run.status))) {
      throw new Error("Cannot roll back a session while a turn is active.");
    }
    const removed = await this.store.rollbackTurns(sessionId, numTurns);
    for (const runId of removed) cleanupImages(this.projectRoot, runId, this.stateRoot);
    if (!removed.length) return false;
    this.adapters[session.provider].disposeSession?.(session.id);
    const latest = this.store.listRuns(sessionId)[0] || null;
    this.store.updateSession(sessionId, {
      providerSessionId: null,
      lastRunId: latest?.id || null,
      status: "idle"
    });
    this.publishSnapshot();
    return true;
  }

  startRun(raw: StartRunInput): { session: AiSession; run: AiRun } {
    const input = StartRunInputSchema.parse(raw);
    // 新对话:重新扫描 skill 目录,确保 /skill 解析用的是最新列表
    if (!input.sessionId) this.skillTools.refresh();
    const cwd = normalizeCwd(this.projectRoot, input.cwd);
    const contexts = normalizeContextReferences(this.projectRoot, input.contexts);
    const skillInvocation = parseSkillSlashInvocation(input.prompt, this.skillTools.listDefinitions());
    const commandError = skillInvocation ? null : slashCommandValidationError(input.prompt, contexts);
    if (commandError) throw new Error(commandError);
    const provider = this.registry.detect().find((item) => item.id === input.providerId);
    if (!provider?.available) throw new Error(provider?.diagnostic || "所选 AI Provider 当前不可用。");
    let session = input.sessionId ? this.store.getSession(input.sessionId) : null;
    if (session && session.providerId !== provider.id) throw new Error("会话 Provider 已锁定，不能中途切换。");
    if (!session) {
      session = this.store.createSession({
        provider: provider.provider,
        providerId: provider.id,
        cwd,
        title: titleFromPrompt(input.prompt),
        permissionProfile: input.permissionProfile,
        interactionMode: input.interactionMode
      });
    } else if (
      session.permissionProfile !== input.permissionProfile
      || session.interactionMode !== input.interactionMode
    ) {
      session = this.store.updateSession(session.id, {
        permissionProfile: input.permissionProfile,
        interactionMode: input.interactionMode
      });
    }
    const runId = crypto.randomUUID();
    const materializedContexts = materializeImages(this.projectRoot, runId, contexts, this.stateRoot);
    const run = this.store.createRun(session, input.prompt, materializedContexts, runId);
    this.queue.push(run.id);
    this.publishSnapshot();
    void persistScheduledTurnAndPump(this.executionHost(), run);
    return { session, run };
  }

  async cancelRun(runId: string): Promise<boolean> { return cancelScheduledRun(this.executionHost(), runId); }

  async resolveApproval(id: string, rawDecision: ApprovalDecision): Promise<boolean> {
    const decision = ApprovalDecisionSchema.parse(rawDecision);
    return resolveScheduledApproval(this.executionHost(), id, decision);
  }

  getChangeSet(runId: string): ChangeSet | null { return this.store.getRun(runId).changeSet; }

  async applyChange(runId: string, patch?: string): Promise<{ applied: boolean; conflict?: string }> { return this.changeApplications.applyChange(runId, patch); }
  async revertChange(runId: string, patch: string): Promise<{ applied: boolean; conflict?: string }> { return this.changeApplications.revertChange(runId, patch); }
  async discardChange(runId: string, patch: string): Promise<ChangeSet | null> { return this.changeApplications.discardChange(runId, patch); }
  async discardRun(runId: string): Promise<boolean> { return this.changeApplications.discardRun(runId); }

  private async append(run: AiRun, kind: AiEvent["kind"], payload: Record<string, unknown>): Promise<void> {
    return appendScheduledEvent(this.executionHost(), run, kind, payload);
  }

  private executionHost(): SchedulerExecutionHost {
    return {
      projectRoot: this.projectRoot,
      stateRoot: this.stateRoot,
      store: this.store,
      registry: this.registry,
      skillTools: this.skillTools,
      approvals: this.approvals,
      adapters: this.adapters,
      browserAutomation: this.browserAutomation,
      resolveProviderModel: this.resolveProviderModel,
      queue: this.queue,
      active: this.active,
      maxConcurrentRuns: this.maxConcurrentRuns,
      publish: this.publish,
      publishSnapshot: () => this.publishSnapshot(),
      prewarm: (provider, sessionId) => this.prewarm(provider, sessionId)
    };
  }

  private publishSnapshot(): void { this.publish({ kind: "snapshot", snapshot: this.snapshot() }); }
}
