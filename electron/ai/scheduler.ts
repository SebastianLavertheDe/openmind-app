import path from "node:path";
import {
  ApprovalDecisionSchema,
  SessionPatchSchema,
  StartRunInputSchema,
  type AiEvent,
  type AiRun,
  type AiSession,
  type AiSessionScope,
  type AiSnapshot,
  type AiTurnListParams,
  type AiTurnPage,
  type ApprovalDecision,
  type SessionPatch,
  type StartRunInput
} from "../../shared/contracts";
import { isProjectTaskScope } from "../../shared/ai-session-scope";
import { ApprovalBroker } from "./approval-broker";
import { ProviderRegistry } from "./provider-registry";
import { SessionStore } from "./session-store";
import { SkillToolRegistry } from "./skill-tool-registry";
import { ClaudeAgentSdkAdapter } from "./providers/claude-agent-sdk";
import { CodexAppServerAdapter } from "./providers/codex-app-server";
import { canonicalizeTrustedProjectRoot, normalizeContextReferences, normalizeCwd } from "./scheduler-paths";
import { materializeImages, cleanupStaleImages } from "./scheduler-images";
import { AUTO_MODEL, type ProviderKind } from "../../shared/model-catalog";
import { slashCommandValidationError } from "../../shared/slash-commands";
import { parseSkillSlashInvocation } from "../../shared/skill-invocations";
import type { ProviderAdapter, ProviderDefinition } from "./providers/types";
import { DEFAULT_BROWSER_EVIDENCE_DIR, type SkillDefinition } from "../../shared/contracts";
import { prewarmProviderSession, recoverInterruptedRuns } from "./scheduler-lifecycle";
import { titleFromPrompt } from "./scheduler-prompts";
import { matchesSemverRange } from "../../shared/skill-manifest-schema";
import { type BrowserAutomationConfig } from "./browser-evidence";
import { WorkflowResumeRequestSchema, type BrokerRunEvent, type BrokerRunRecord, type WorkflowResumeRequest, type WorkflowRunRecord } from "../../shared/execution-contracts";
import type { AutomationRule, AutomationRuleInput, AutomationRunRecord, AutomationScheduleSnapshot } from "../../shared/automation-contracts";
import { buildAppPaths, resolveSkillStoreRoot } from "../paths/app-paths-service";
import { SkillPackageService } from "../skills/skill-package-service";
import { InstalledSkillExecutionResolver } from "../skills/installed-skill-execution-resolver";
import { RuntimeManager } from "../runtime/runtime-manager";
import { SharedPythonRuntimeService } from "../runtime/shared-python-runtime";
import { listInstalledPythonProjects } from "../runtime/installed-python-projects";
import { ExportLocationService } from "../execution/export-location-service";
import { AutomationRepository } from "../automation/automation-repository";
import { AutomationScheduler } from "../automation/automation-scheduler";
import { AutomationLeader } from "../automation/automation-leader";
import { createAutomationFileFingerprint } from "../automation/automation-file-fingerprint";
import { cancelScheduledRun, handleApprovalRequest, persistScheduledTurnAndPump, resolveScheduledApproval, type ActiveRun, type SchedulerExecutionHost } from "./scheduler-execution";
import { providerConfigurationRevision, ProviderRevisionMismatchError, resolveCliProvider } from "../config/providers-yaml";
import { formatProviderChangePending, type ProviderYamlEntry } from "../../shared/contracts";
import { TrustedProjectRunInputSchema, type TrustedProjectRunInput } from "./project-run";

export class RunScheduler {
  private readonly store: SessionStore;
  private readonly registry: ProviderRegistry;
  private readonly approvals: ApprovalBroker;
  private readonly skillTools: SkillToolRegistry;
  private readonly queue: string[] = [];
  private readonly active = new Map<string, ActiveRun>();
  // Provider 注册表（adapters map 从它派生）：新增 provider = 加一行 + 实现 ProviderAdapter。
  private readonly providers: ProviderDefinition[] = [{ kind: "codex", adapter: new CodexAppServerAdapter() }, { kind: "claude", adapter: new ClaudeAgentSdkAdapter() }];
  private readonly adapters = Object.fromEntries(this.providers.map((definition) => [definition.kind, definition.adapter])) as Record<string, ProviderAdapter>;
  private readonly maxConcurrentRuns = 3;
  private readonly resolveProviderModel: (kind: ProviderKind) => string;
  private readonly browserAutomation: BrowserAutomationConfig;
  private readonly stateRoot?: string;
  private readonly openmindRoot: string;
  private readonly projectsRoot?: string;
  private readonly automation: AutomationScheduler | null;

  constructor(
    readonly projectRoot: string,
    private publish: (message: unknown) => void,
    resolveProviderModel?: (kind: ProviderKind) => string,
    browserAutomation?: BrowserAutomationConfig,
    stateRoot?: string,
    openmindRoot?: string,
    rootGeneration = 1,
    trustedProjectsRoot?: string
  ) {
    this.resolveProviderModel = resolveProviderModel ?? (() => AUTO_MODEL);
    this.browserAutomation = browserAutomation ?? { enabled: false, reuseExistingTabs: true, evidenceDir: DEFAULT_BROWSER_EVIDENCE_DIR, extensionToken: null };
    this.stateRoot = stateRoot;
    this.openmindRoot = openmindRoot || projectRoot;
    this.projectsRoot = trustedProjectsRoot ?? (openmindRoot ? path.join(openmindRoot, "projects") : undefined);
    this.store = new SessionStore(projectRoot, stateRoot, this.projectsRoot);
    this.registry = new ProviderRegistry(projectRoot);
    const appPaths = openmindRoot
      ? buildAppPaths(process.env.OPENMIND_USER_DATA_DIR, resolveSkillStoreRoot(openmindRoot))
      : null;
    const packageService = appPaths && openmindRoot ? new SkillPackageService(appPaths) : null;
    const installedResolver = appPaths && openmindRoot
      ? new InstalledSkillExecutionResolver(
        packageService!,
        new RuntimeManager(appPaths, {
          sharedPython: new SharedPythonRuntimeService(appPaths, {
            projects: () => listInstalledPythonProjects(packageService!),
            ...(process.env.OPENMIND_PYTHON_RUNTIME_ASSET_ROOT
              ? { bundledAssetRoot: process.env.OPENMIND_PYTHON_RUNTIME_ASSET_ROOT }
              : {})
          })
        }),
        openmindRoot,
        rootGeneration,
        (bindingId) => {
          const binding = new ExportLocationService(
            path.join(appPaths.settings, "export-bindings.json"),
            () => [appPaths.userData, openmindRoot]
          ).resolve(bindingId);
          return { bindingId: binding.id, canonicalPath: binding.canonicalPath, revoked: binding.revoked };
        }
      )
      : undefined;
    this.skillTools = new SkillToolRegistry(projectRoot, appPaths && openmindRoot ? {
      paths: appPaths,
      openmindRoot,
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
        workflowRoot: path.join(appPaths.runs, "workflows")
      } : {})
    } : undefined);
    this.automation = appPaths && openmindRoot ? new AutomationScheduler({
      repository: new AutomationRepository(appPaths),
      leader: new AutomationLeader(appPaths.automation),
      fileFingerprint: createAutomationFileFingerprint(openmindRoot),
      rootGeneration,
      submitSkill: (request) => this.skillTools.submitRun(request),
      submitWorkflow: (request) => this.skillTools.startWorkflowRun(request),
      readSkill: (runId) => this.skillTools.getRun(runId),
      readWorkflow: (runId) => this.skillTools.getWorkflowRun(runId),
      cancelSkill: (runId) => this.skillTools.cancelRun(runId),
      cancelWorkflow: (runId) => this.skillTools.cancelWorkflowRun(runId),
      resolveTargetVersion: (target) => {
        const installed = installedResolver?.enabledInstalled(target.id);
        if (target.versionPolicy === "*") {
          if (!installed) throw new Error(`当前没有启用的 Skill：${target.id}`);
          return undefined;
        }
        if (!installed || !matchesSemverRange(installed.version, target.versionPolicy)) throw new Error(`当前已安装 Skill 不满足 version policy：${target.id}@${target.versionPolicy}`);
        return installed.version;
      }
    }) : null;
    this.approvals = new ApprovalBroker((request) => void handleApprovalRequest(this.executionHost(), request));
    this.store.initialize();
    this.store.reconcileArchivedProjectTaskSessions();
    // Old sessions predate the enabled preference and therefore behaved as if
    // every usable installed Skill was on. Freeze that compatibility catalog
    // synchronously before the worker accepts any request. This path never
    // reads skill-preferences.json, so a corrupt preference cannot brick
    // bootstrap or an existing conversation.
    this.store.backfillMissingSkillSnapshots(() => this.skillTools.captureSessionSnapshot(true));
    // Keep existing conversations aligned with the current installed catalog
    // so slash commands list every Skill, not only the kinds frozen earlier.
    this.store.refreshWorkspaceSkillSnapshots(() => this.skillTools.captureSessionSnapshot(true));
    recoverInterruptedRuns(this.store);
    cleanupStaleImages(this.projectRoot, this.stateRoot);
    this.automation?.start();
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
    // Config saves may replace URL/key/model. Idle warm processes already hold
    // the previous environment, so close them before refreshing capabilities.
    for (const adapter of Object.values(this.adapters)) adapter.disposeWarmSlots?.();
    return this.registry
      .refresh(true)
      .then(() => this.publishSnapshot())
      .catch(() => undefined);
  }

  getEvents(sessionId: string): AiEvent[] { return this.store.readEvents(sessionId); }
  getTurns(sessionId: string, params: AiTurnListParams = {}): AiTurnPage { return this.store.listTurns(sessionId, params); }
  searchSessions(query: string): AiSession[] { return this.store.search(query); }
  listSkills(): SkillDefinition[] { return this.skillTools.listDefinitions(); }

  /** Root switching must account for queued, provider and manual Skill work. */
  activeTaskCount(): number {
    return this.queue.length + this.active.size + this.skillTools.activeCount();
  }

  /** Project Task archive only needs to wait for work owned by that Task. */
  activeProjectTaskRunCount(projectId: string, taskId: string): number {
    const runIds = new Set([...this.queue, ...this.active.keys()]);
    let count = 0;
    for (const runId of runIds) {
      const run = this.active.get(runId)?.run ?? this.store.getRun(runId);
      if (
        isProjectTaskScope(run.scope)
        && run.scope.projectId === projectId
        && run.scope.taskId === taskId
      ) count += 1;
    }
    return count;
  }

  archiveProjectTaskSessions(projectId: string, taskId: string): number {
    const archived = this.store.archiveProjectTaskSessions(projectId, taskId);
    if (archived) this.publishSnapshot();
    return archived;
  }

  revokeCredential(credentialId: string): Promise<number> {
    return this.skillTools.revokeCredential(credentialId);
  }

  restoreCredential(credentialId: string): number {
    return this.skillTools.restoreCredential(credentialId);
  }

  rotateCredential(credentialId: string): Promise<number> {
    return this.skillTools.rotateCredential(credentialId);
  }

  /** 重新扫描 skill 目录并返回最新列表(用于新对话时刷新前端缓存)。 */
  refreshSkills(): SkillDefinition[] {
    this.skillTools.refresh();
    return this.skillTools.listDefinitions();
  }

  /** prewarm Claude（兼容 worker RPC 与既有测试）；通用 prewarm 按 adapter 能力触发（新增 provider 无需改）。 */
  async prewarmClaude(sessionId?: string): Promise<boolean> { return this.prewarm("claude", sessionId); }
  async prewarm(provider: ProviderKind, sessionId?: string): Promise<boolean> {
    if (sessionId) this.validatedSessionRoot(this.store.getSession(sessionId));
    return prewarmProviderSession({
      projectRoot: this.projectRoot,
      openmindRoot: this.openmindRoot,
      protectedPaths: this.projectsRoot ? [this.projectsRoot] : [],
      store: this.store,
      registry: this.registry,
      adapter: this.adapters[provider],
      provider,
      resolveProviderModel: this.resolveProviderModel,
      browserAutomation: this.browserAutomation
    }, sessionId);
  }

  listSkillRuns(): BrokerRunRecord[] { return this.skillTools.listRuns(); }
  getSkillRun(runId: string): BrokerRunRecord { return this.skillTools.getRun(runId); }
  getSkillRunEvents(runId: string): BrokerRunEvent[] { return this.skillTools.getRunEvents(runId); }
  listRunArtifacts(runId?: string): BrokerRunRecord["artifacts"] { return this.skillTools.listRunArtifacts(runId); }
  retrySkillRun(runId: string): BrokerRunRecord { return this.skillTools.retryRun(runId); }
  deleteRunHistory(runId: string): boolean { return this.skillTools.deleteRunHistory(runId); }
  async cancelSkillRun(runId: string): Promise<boolean> {
    const cancelled = await this.skillTools.cancelRun(runId);
    this.publishSnapshot();
    return cancelled;
  }
  listWorkflowRuns(): WorkflowRunRecord[] { return this.skillTools.listWorkflowRuns(); }  getWorkflowRun(runId: string): WorkflowRunRecord { return this.skillTools.getWorkflowRun(runId); }
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

  async forkSession(sessionId: string, throughRunId?: string): Promise<AiSession> {
    const source = this.store.getSession(sessionId);
    if (isProjectTaskScope(source.scope)) {
      throw new Error("Project Task 会话不能通过全局 AI fork；请在 Project 中创建新 Task。");
    }
    if (this.store.listRuns(sessionId).some((run) => ["queued", "running", "waiting-approval", "applying"].includes(run.status))) {
      throw new Error("Cannot fork a session while a turn is active.");
    }
    const fork = await this.store.forkSession(sessionId, throughRunId);
    if (this.adapters[source.provider]?.prewarm) void this.prewarm(source.provider, fork.id).catch(() => undefined);
    this.publishSnapshot();
    return fork;
  }

  startRun(raw: StartRunInput): { session: AiSession; run: AiRun } {
    const input = StartRunInputSchema.parse(raw);
    const session = input.sessionId ? this.store.getSession(input.sessionId) : null;
    if (session && isProjectTaskScope(session.scope)) {
      throw new Error("Project Task 会话必须通过专用入口继续。");
    }
    const sessionRoot = session?.projectRoot ?? this.projectRoot;
    const cwd = session ? normalizeCwd(sessionRoot, session.cwd) : normalizeCwd(sessionRoot, input.cwd);
    if (session && normalizeCwd(sessionRoot, input.cwd) !== session.cwd) {
      throw new Error("会话工作目录已锁定，不能中途切换。");
    }
    return this.scheduleRun({
      session,
      sessionRoot,
      scope: session?.scope ?? { type: "workspace" },
      providerId: input.providerId,
      permissionProfile: input.permissionProfile,
      interactionMode: input.interactionMode,
      cwd,
      prompt: input.prompt,
      contexts: input.contexts,
      acknowledgeProviderChange: input.acknowledgeProviderChange === true
    });
  }

  /**
   * Main-only Project entry point. New sessions receive an already-resolved
   * trusted root; continuation requests carry only the frozen session id.
   */
  startProjectRun(raw: TrustedProjectRunInput): { session: AiSession; run: AiRun } {
    const input = TrustedProjectRunInputSchema.parse(raw);
    if ("sessionId" in input) {
      const session = this.store.getSession(input.sessionId);
      this.assertProjectSession(session);
      return this.scheduleRun({
        session,
        sessionRoot: session.projectRoot,
        scope: session.scope!,
        providerId: session.providerId,
        permissionProfile: "read-only",
        interactionMode: session.interactionMode ?? "default",
        cwd: session.cwd,
        prompt: input.prompt,
        contexts: input.contexts
      });
    }
    if (!this.projectsRoot) throw new Error("Project 内容根尚未初始化。");
    const sessionRoot = canonicalizeTrustedProjectRoot(this.projectsRoot, input.projectName, input.projectRoot);
    return this.scheduleRun({
      session: null,
      sessionRoot,
      scope: { type: "project-task", projectId: input.projectId, projectName: input.projectName, taskId: input.taskId },
      providerId: input.providerId,
      permissionProfile: "read-only",
      interactionMode: "default",
      cwd: ".",
      prompt: input.prompt,
      contexts: input.contexts
    });
  }

  private scheduleRun(input: {
    session: AiSession | null;
    sessionRoot: string;
    scope: AiSessionScope;
    providerId: string;
    permissionProfile: AiSession["permissionProfile"];
    interactionMode: NonNullable<AiSession["interactionMode"]>;
    cwd: string;
    prompt: string;
    contexts: AiRun["contexts"];
    acknowledgeProviderChange?: boolean;
  }): { session: AiSession; run: AiRun } {
    // New conversations refresh only the active catalog. Installed packages
    // are read on demand; legacy workspace discovery rescans when applicable.
    const projectScoped = isProjectTaskScope(input.scope);
    if (!input.session && !projectScoped) this.skillTools.refresh();
    const contexts = normalizeContextReferences(input.sessionRoot, input.contexts);
    let session = input.session;
    const skillSnapshot = session
      ? requireSessionSkillSnapshot(session)
      : projectScoped ? [] : this.skillTools.captureSessionSnapshot();
    const skillInvocation = projectScoped
      ? null
      : parseSkillSlashInvocation(input.prompt, skillSnapshot.map((entry) => entry.definition));
    const commandError = skillInvocation ? null : slashCommandValidationError(input.prompt, contexts);
    if (commandError) throw new Error(commandError);
    const provider = this.registry.detect().find((item) => item.id === input.providerId);
    let pinnedManagedProvider: ProviderYamlEntry | null = null;
    if (session?.serviceProviderId) {
      try {
        pinnedManagedProvider = resolveCliProvider(session.provider, session.serviceProviderId, session.serviceProviderRevision ?? null);
      } catch (cause) {
        if (!(cause instanceof ProviderRevisionMismatchError)) throw cause;
        if (!input.acknowledgeProviderChange) {
          // Renderer turns this tagged error into a confirm dialog; confirming
          // retries the start with acknowledgeProviderChange and rebinds below.
          throw new Error(formatProviderChangePending({
            kind: cause.kind,
            id: cause.providerId,
            message: cause.message
          }));
        }
        pinnedManagedProvider = resolveCliProvider(session.provider, session.serviceProviderId, session.serviceProviderRevision ?? null, { ignoreRevisionCheck: true });
        if (!pinnedManagedProvider) throw cause;
        // 冻结指纹刷新为当前配置：确认一次后，本次配置下的后续对话不再询问。
        session = this.store.updateSession(session.id, {
          serviceProviderRevision: providerConfigurationRevision(pinnedManagedProvider)
        });
      }
    }
    if (!provider?.available && !(pinnedManagedProvider && provider?.version)) {
      throw new Error(provider?.diagnostic || "所选 AI Provider 当前不可用。");
    }
    if (session && session.providerId !== provider.id) throw new Error("会话 Provider 已锁定，不能中途切换。");
    if (!session) {
      const selectedServiceProvider = resolveCliProvider(provider.provider);
      session = this.store.createSession({
        provider: provider.provider,
        providerId: provider.id,
        // Freeze the selected API service into the session. Changing the
        // top-level binding affects new sessions without sending an existing
        // native provider thread to a different backend mid-conversation.
        serviceProviderId: selectedServiceProvider?.id || null,
        serviceProviderRevision: selectedServiceProvider ? providerConfigurationRevision(selectedServiceProvider) : null,
        cwd: input.cwd,
        title: titleFromPrompt(input.prompt),
        permissionProfile: input.permissionProfile,
        interactionMode: input.interactionMode,
        skillSnapshot,
        projectRoot: input.sessionRoot,
        scope: input.scope
      });
      if (projectScoped) {
        try {
          this.store.bindProjectSession(session);
        } catch (error) {
          this.store.discardEmptySession(session.id);
          throw error;
        }
      }
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
    const materializedContexts = materializeImages(session.projectRoot, runId, contexts, this.stateRoot);
    const run = this.store.createRun(session, input.prompt, materializedContexts, runId);
    if (projectScoped) this.store.setProjectTaskStatus(session.id, "active");
    this.queue.push(run.id);
    this.publishSnapshot();
    void persistScheduledTurnAndPump(this.executionHost(), run);
    return { session, run };
  }

  private assertProjectSession(session: AiSession): void {
    const scope = session.scope;
    if (!isProjectTaskScope(scope)) throw new Error("指定会话不是 Project Task 会话。");
    if (!this.projectsRoot) throw new Error("Project 内容根尚未初始化。");
    const root = canonicalizeTrustedProjectRoot(this.projectsRoot, scope.projectName, session.projectRoot);
    if (root !== session.projectRoot || session.cwd !== "." || session.permissionProfile !== "read-only") {
      throw new Error("Project Task 会话执行边界无效。");
    }
  }

  private validatedSessionRoot(session: AiSession): string {
    if (isProjectTaskScope(session.scope)) this.assertProjectSession(session);
    return session.projectRoot;
  }

  async cancelRun(runId: string): Promise<boolean> { return cancelScheduledRun(this.executionHost(), runId); }

  async resolveApproval(id: string, rawDecision: ApprovalDecision): Promise<boolean> {
    const decision = ApprovalDecisionSchema.parse(rawDecision);
    return resolveScheduledApproval(this.executionHost(), id, decision);
  }

  private executionHost(): SchedulerExecutionHost {
    return {
      projectRoot: this.projectRoot,
      openmindRoot: this.openmindRoot,
      protectedPaths: this.projectsRoot ? [this.projectsRoot] : [],
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
      prewarm: (provider, sessionId) => this.prewarm(provider, sessionId),
      validateSessionRoot: (session) => this.validatedSessionRoot(session)
    };
  }

  private publishSnapshot(): void { this.publish({ kind: "snapshot", snapshot: this.snapshot() }); }
}

function requireSessionSkillSnapshot(session: AiSession) {
  if (!session.skillSnapshot) {
    throw new Error("AI 会话缺少 Skill 快照；请重启应用完成兼容迁移。 ");
  }
  return session.skillSnapshot;
}
