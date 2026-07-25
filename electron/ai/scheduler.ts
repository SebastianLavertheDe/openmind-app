import crypto from "node:crypto";
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
  type ApprovalRequest,
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
import { normalizeContextReferences, normalizeCwd, resolveCwd } from "./scheduler-paths";
import { materializeImages, cleanupImages, cleanupStaleImages, extractImageContexts } from "./scheduler-images";
import { captureTurnContext, withRecoveredHistory, withTurnContext } from "./turn-context";
import { AUTO_MODEL, type ProviderKind } from "../../shared/model-catalog";
import { slashCommandValidationError } from "../../shared/slash-commands";
import { parseSkillSlashInvocation } from "../../shared/skill-invocations";
import type { ProviderAdapter, ProviderDefinition, ProviderRunContext } from "./providers/types";
import type { SkillDefinition } from "../../shared/contracts";
import { prewarmProviderSession, recoverInterruptedRuns, updateSessionStatus } from "./scheduler-lifecycle";
import { composeNativeSkillProviderPrompt, composeNativeSkillTaskPrompt, composePrompt, titleFromPrompt } from "./scheduler-prompts";
import { reassembleEvents } from "./event-chunking";
import { browserEvidenceInstructions, type BrowserAutomationConfig } from "./browser-evidence";

interface ActiveRun {
  run: AiRun;
  controller: AbortController;
}

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

  constructor(
    readonly projectRoot: string,
    private publish: (message: unknown) => void,
    resolveProviderModel?: (kind: ProviderKind) => string,
    browserAutomation?: BrowserAutomationConfig
  ) {
    this.resolveProviderModel = resolveProviderModel ?? (() => AUTO_MODEL);
    this.browserAutomation = browserAutomation ?? { enabled: false, reuseExistingTabs: true, evidenceDir: ".cctools/browser-evidence", extensionToken: null };
    this.store = new SessionStore(projectRoot);
    this.registry = new ProviderRegistry(projectRoot);
    this.legacyChanges = new LegacyChangeManager(projectRoot);
    this.skillTools = new SkillToolRegistry(projectRoot);
    this.manualSkills = new ManualSkillController(this.skillTools, projectRoot, publish);
    this.changeApplications = new ChangeApplicationService(
      this.store,
      this.legacyChanges,
      {
        append: (run, kind, payload) => this.append(run, kind, payload),
        publishSnapshot: () => this.publishSnapshot()
      }
    );
    this.approvals = new ApprovalBroker((request) => void this.onApprovalRequest(request));
    this.store.initialize();
    recoverInterruptedRuns(this.store);
    cleanupStaleImages(this.projectRoot);
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

  updateSession(id: string, patch: SessionPatch): AiSession {
    const result = this.store.updateSession(id, SessionPatchSchema.parse(patch));
    this.publishSnapshot();
    return result;
  }

  deleteSession(id: string): boolean {
    const unfinished = this.store.listRuns(id).some((run) => ["queued", "running", "waiting-approval", "applying"].includes(run.status));
    if (unfinished) throw new Error("会话仍有运行中或排队任务，请先停止后再删除。");
    for (const adapter of Object.values(this.adapters)) adapter.disposeSession?.(id);
    for (const run of this.store.listRuns(id)) cleanupImages(this.projectRoot, run.id);
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
    for (const runId of removed) cleanupImages(this.projectRoot, runId);
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
    const materializedContexts = materializeImages(this.projectRoot, runId, contexts);
    const run = this.store.createRun(session, input.prompt, materializedContexts, runId);
    this.queue.push(run.id);
    this.publishSnapshot();
    void this.persistTurnAndPump(run);
    return { session, run };
  }

  async cancelRun(runId: string): Promise<boolean> {
    const queuedIndex = this.queue.indexOf(runId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      cleanupImages(this.projectRoot, runId);
      const run = this.store.updateRun(runId, { status: "cancelled", completedAt: new Date().toISOString() });
      await this.append(run, "status", { state: "cancelled" });
      await this.store.abortTurn(run, null);
      updateSessionStatus(this.store, run.sessionId);
      this.publishSnapshot();
      return true;
    }
    const active = this.active.get(runId);
    if (!active) return false;
    active.controller.abort();
    const declined = this.approvals.declineForRun(runId);
    for (const approval of declined) {
      await this.append(active.run, "approval-decision", {
        approvalId: approval.id,
        decision: "decline",
        approval,
        decidedAt: new Date().toISOString(),
        reason: "run-cancelled"
      });
    }
    return true;
  }

  async resolveApproval(id: string, rawDecision: ApprovalDecision): Promise<boolean> {
    const decision = ApprovalDecisionSchema.parse(rawDecision);
    const approval = this.approvals.list().find((item) => item.id === id);
    if (!approval) return false;
    const resolved = this.approvals.resolve(id, decision);
    if (!resolved) return false;
    const run = this.store.getRun(approval.runId);
    await this.append(run, "approval-decision", {
      approvalId: id,
      decision,
      approval,
      decidedAt: new Date().toISOString()
    });
    this.store.updateRun(run.id, { status: "running" });
    this.store.updateSession(run.sessionId, { status: "running" });
    this.publishSnapshot();
    return resolved;
  }

  getChangeSet(runId: string): ChangeSet | null { return this.store.getRun(runId).changeSet; }

  async applyChange(runId: string, patch?: string): Promise<{ applied: boolean; conflict?: string }> { return this.changeApplications.applyChange(runId, patch); }
  async revertChange(runId: string, patch: string): Promise<{ applied: boolean; conflict?: string }> { return this.changeApplications.revertChange(runId, patch); }
  async discardChange(runId: string, patch: string): Promise<ChangeSet | null> { return this.changeApplications.discardChange(runId, patch); }
  async discardRun(runId: string): Promise<boolean> { return this.changeApplications.discardRun(runId); }

  private async pump(): Promise<void> {
    let deferred = 0;
    while (this.active.size < this.maxConcurrentRuns && this.queue.length) {
      const runId = this.queue.shift();
      if (!runId) break;
      const run = this.store.getRun(runId);
      if ([...this.active.values()].some((entry) => entry.run.sessionId === run.sessionId)) {
        this.queue.push(runId);
        deferred++;
        if (deferred >= this.queue.length) break;
        continue;
      }
      deferred = 0;
      void this.execute(run);
    }
  }

  private async execute(initialRun: AiRun): Promise<void> {
    const controller = new AbortController();
    let session = this.store.getSession(initialRun.sessionId);
    const directCwd = resolveCwd(this.projectRoot, session.cwd);
    let run = this.store.updateRun(initialRun.id, {
      status: "running",
      turnContext: captureTurnContext(directCwd)
    });
    this.active.set(run.id, { run, controller });
    this.publishSnapshot();
    try {
      await this.store.appendTurnContext(run);
      await this.append(run, "status", { state: "running", cwd: directCwd, mode: "direct" });
      const provider = this.registry.detect().find((item) => item.id === session.providerId);
      if (!provider?.available) throw new Error(provider?.diagnostic || "会话绑定的 Provider 当前不可用。");
      const turnImages = extractImageContexts(this.projectRoot, run.contexts);
      if (turnImages.length && provider.supportsImages === false) {
        throw new Error("当前 Provider 不支持图片附件。");
      }
      const skillInvocation = parseSkillSlashInvocation(run.prompt, this.skillTools.listDefinitions());
      const contextState = this.store.getContextState(run.sessionId);
      const baseProviderPrompt = skillInvocation ? composeNativeSkillProviderPrompt(run, skillInvocation) : composePrompt(run);
      const evidenceInstructions = browserEvidenceInstructions(this.browserAutomation);
      const browserAwarePrompt = evidenceInstructions ? `${baseProviderPrompt}\n\n${evidenceInstructions}` : baseProviderPrompt;
      const providerPrompt = session.providerSessionId
        ? browserAwarePrompt
        : withRecoveredHistory(browserAwarePrompt, contextState, run.id);
      const prompt = this.adapters[session.provider].needsTurnContext && run.turnContext
        ? withTurnContext(providerPrompt, run.turnContext)
        : providerPrompt;
      let providerProducedOutput = false;
      let providerProducedFinal = false;
      const attemptedResume = Boolean(session.providerSessionId);
      const providerContext = (value: string): ProviderRunContext => ({
        session,
        run,
        provider,
        cwd: directCwd,
        prompt: value,
        contextState,
        signal: controller.signal,
        emit: async (kind, payload) => {
          if (kind !== "system") providerProducedOutput = true;
          if (isProviderFinalReply(kind, payload)) providerProducedFinal = true;
          await this.append(run, kind, payload);
        },
        requestApproval: async (input) => {
          this.store.updateRun(run.id, { status: "waiting-approval" });
          this.store.updateSession(run.sessionId, { status: "waiting-approval" });
          this.publishSnapshot();
          return this.approvals.request(run, { ...input, cwd: directCwd, paths: input.paths || [] });
        },
        updateProviderSession: (id) => {
          if (session.providerSessionId !== id) session = this.store.updateSession(session.id, { providerSessionId: id });
        },
        updateInteractionMode: (mode) => {
          if (session.interactionMode !== mode) {
            session = this.store.updateSession(session.id, { interactionMode: mode });
            this.publishSnapshot();
          }
        },
        skillInvocation: skillInvocation
          ? {
            name: skillInvocation.skill.id,
            argument: skillInvocation.argument,
            raw: skillInvocation.raw,
            prompt: composeNativeSkillTaskPrompt(run, skillInvocation)
          }
          : null,
        providerModel: this.resolveProviderModel(session.provider),
        browserAutomation: this.browserAutomation,
        images: turnImages
      });
      try {
        await this.adapters[session.provider].run(providerContext(prompt));
      } catch (resumeError) {
        if (!attemptedResume || providerProducedOutput || controller.signal.aborted) throw resumeError;
        this.adapters[session.provider].disposeSession?.(session.id);
        session = this.store.updateSession(session.id, { providerSessionId: null });
        await this.append(run, "system", {
          text: "Provider resume failed before producing output; rebuilt the turn from the local rollout.",
          subtype: "resume_recovered"
        });
        const recoveredPrompt = withRecoveredHistory(prompt, contextState, run.id);
        await this.adapters[session.provider].run(providerContext(recoveredPrompt));
      }
      if (!providerProducedFinal) {
        throw new Error("Provider 协议异常：运行结束但未返回最终回复。");
      }
      run = await this.finalizeRun(run, { status: "completed", error: null });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      run = await this.finalizeRun(run, {
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? null : error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.active.delete(run.id);
      updateSessionStatus(this.store, run.sessionId);
      this.publishSnapshot();
      if (this.adapters[run.provider]?.prewarm) void this.prewarm(run.provider, run.sessionId).catch(() => undefined);
      void this.pump();
    }
  }

  // 收尾：成功/失败/取消三路共享 getRisks + writeSecurityReport + updateRun + 事件 + turn 终结，去掉 execute 内两处近重复。
  private async finalizeRun(run: AiRun, outcome: { status: "completed" | "failed" | "cancelled"; error: string | null }): Promise<AiRun> {
    cleanupImages(this.projectRoot, run.id);
    const risks = this.store.getRisks(run.id);
    this.store.writeSecurityReport(run, risks);
    const updated = this.store.updateRun(run.id, {
      status: outcome.status,
      completedAt: new Date().toISOString(),
      error: outcome.status === "cancelled" ? null : outcome.error,
      workspacePath: null,
      baseCommit: null,
      changeSet: null,
      risks
    });
    if (outcome.status === "completed") {
      await this.append(updated, "status", { state: "completed" });
      await this.store.completeTurn(updated);
    } else if (outcome.status === "cancelled") {
      await this.append(updated, "status", { state: "cancelled" });
      await this.store.abortTurn(updated, outcome.error);
    } else {
      await this.append(updated, "error", { text: outcome.error || "运行失败" });
      await this.store.abortTurn(updated, outcome.error);
    }
    return updated;
  }

  private async append(run: AiRun, kind: AiEvent["kind"], payload: Record<string, unknown>): Promise<void> {
    if (kind === "assistant-delta" || kind === "reasoning-delta") {
      this.publish({ kind: "transient", event: { id: crypto.randomUUID(), seq: -1, timestamp: new Date().toISOString(), projectId: run.projectId, sessionId: run.sessionId, runId: run.id, provider: run.provider, kind, payload, risks: [], schemaVersion: 1 } });
      return;
    }
    const events = await this.store.appendEvent(run, kind, payload);
    // Persistence may split very large payloads into several rollout records.
    // The renderer must receive one canonical event or it can mistake the last
    // chunk for the whole final answer.
    for (const event of reassembleEvents(events)) this.publish({ kind: "event", event });
  }

  private async beginTurn(run: AiRun): Promise<void> {
    const skillInvocation = parseSkillSlashInvocation(run.prompt, this.skillTools.listDefinitions());
    const modelInput = skillInvocation ? composeNativeSkillProviderPrompt(run, skillInvocation) : composePrompt(run);
    const events = await this.store.beginTurn(run, modelInput);
    for (const event of events) this.publish({ kind: "event", event });
  }

  private async persistTurnAndPump(run: AiRun): Promise<void> {
    try {
      await this.beginTurn(run);
      await this.pump();
    } catch (error) {
      const index = this.queue.indexOf(run.id);
      if (index >= 0) this.queue.splice(index, 1);
      this.store.updateRun(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
      this.store.updateSession(run.sessionId, { status: "failed" });
      this.publishSnapshot();
    }
  }

  private async onApprovalRequest(request: ApprovalRequest): Promise<void> {
    const run = this.store.getRun(request.runId);
    await this.append(run, "approval-request", { approval: request });
    this.publishSnapshot();
  }

  private publishSnapshot(): void { this.publish({ kind: "snapshot", snapshot: this.snapshot() }); }
}

function isProviderFinalReply(kind: AiEvent["kind"], payload: Record<string, unknown>): boolean {
  if (kind !== "assistant-message" || payload.phase === "commentary") return false;
  return Boolean(String(payload.text || payload.message || "").trim());
}
