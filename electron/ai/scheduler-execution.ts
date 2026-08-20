import crypto from "node:crypto";
import {
  ApprovalDecisionSchema,
  type AiEvent,
  type AiRun,
  type AiSession,
  type ApprovalDecision,
  type ApprovalRequest
} from "../../shared/contracts";
import { ApprovalBroker } from "./approval-broker";
import { ProviderRegistry } from "./provider-registry";
import { SessionStore } from "./session-store";
import { SkillToolRegistry } from "./skill-tool-registry";
import { resolveCwd } from "./scheduler-paths";
import { cleanupImages, extractImageContexts } from "./scheduler-images";
import { captureTurnContext, withRecoveredHistory, withTurnContext } from "./turn-context";
import { composeNativeSkillProviderPrompt, composeNativeSkillTaskPrompt, composePrompt } from "./scheduler-prompts";
import { reassembleEvents } from "./event-chunking";
import { browserEvidenceInstructions, type BrowserAutomationConfig } from "./browser-evidence";
import { parseSkillSlashInvocation } from "../../shared/skill-invocations";
import { type ProviderKind } from "../../shared/model-catalog";
import { updateSessionStatus } from "./scheduler-lifecycle";
import type { ProviderAdapter, ProviderRunContext } from "./providers/types";
import { resolveCliProvider } from "../config/providers-yaml";

export interface ActiveRun {
  run: AiRun;
  controller: AbortController;
}

export interface SchedulerExecutionHost {
  projectRoot: string;
  stateRoot?: string;
  store: SessionStore;
  registry: ProviderRegistry;
  skillTools: SkillToolRegistry;
  approvals: ApprovalBroker;
  adapters: Record<string, ProviderAdapter>;
  browserAutomation: BrowserAutomationConfig;
  resolveProviderModel: (kind: ProviderKind) => string;
  queue: string[];
  active: Map<string, ActiveRun>;
  maxConcurrentRuns: number;
  publish(message: unknown): void;
  publishSnapshot(): void;
  prewarm(provider: ProviderKind, sessionId?: string): Promise<boolean>;
}

export async function persistScheduledTurnAndPump(host: SchedulerExecutionHost, run: AiRun): Promise<void> {
  try {
    const { skillInvocation, skillBridge } = resolveSessionSkillInvocation(host, host.store.getSession(run.sessionId), run.prompt);
    const modelInput = skillInvocation
      ? skillBridge ? composeNativeSkillTaskPrompt(run, skillInvocation) : composeNativeSkillProviderPrompt(run, skillInvocation)
      : composePrompt(run);
    const events = await host.store.beginTurn(run, modelInput);
    for (const event of events) host.publish({ kind: "event", event });
    await pumpScheduledRuns(host);
  } catch (error) {
    const index = host.queue.indexOf(run.id);
    if (index >= 0) host.queue.splice(index, 1);
    host.store.updateRun(run.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    });
    host.store.updateSession(run.sessionId, { status: "failed" });
    host.publishSnapshot();
  }
}

export async function pumpScheduledRuns(host: SchedulerExecutionHost): Promise<void> {
  let deferred = 0;
  while (host.active.size < host.maxConcurrentRuns && host.queue.length) {
    const runId = host.queue.shift();
    if (!runId) break;
    const run = host.store.getRun(runId);
    if ([...host.active.values()].some((entry) => entry.run.sessionId === run.sessionId)) {
      host.queue.push(runId);
      deferred++;
      if (deferred >= host.queue.length) break;
      continue;
    }
    deferred = 0;
    void executeScheduledRun(host, run);
  }
}

export async function executeScheduledRun(host: SchedulerExecutionHost, initialRun: AiRun): Promise<void> {
  const controller = new AbortController();
  let session = host.store.getSession(initialRun.sessionId);
  const directCwd = resolveCwd(host.projectRoot, session.cwd);
  let run = host.store.updateRun(initialRun.id, {
    status: "running",
    turnContext: captureTurnContext(directCwd)
  });
  host.active.set(run.id, { run, controller });
  host.publishSnapshot();
  try {
    await host.store.appendTurnContext(run);
    await appendScheduledEvent(host, run, "status", { state: "running", cwd: directCwd, mode: "direct" });
    const provider = host.registry.detect().find((item) => item.id === session.providerId);
    const pinnedManagedProvider = session.serviceProviderId
      ? resolveCliProvider(session.provider, session.serviceProviderId, session.serviceProviderRevision ?? null)
      : null;
    if (!provider?.available && !(pinnedManagedProvider && provider?.version)) {
      throw new Error(provider?.diagnostic || "会话绑定的 Provider 当前不可用。");
    }
    const turnImages = extractImageContexts(host.projectRoot, run.contexts, host.stateRoot);
    if (turnImages.length && provider.supportsImages === false) throw new Error("当前 Provider 不支持图片附件。");
    const { skillInvocation, skillBridge } = resolveSessionSkillInvocation(host, session, run.prompt);
    const contextState = host.store.getContextState(run.sessionId);
    const baseProviderPrompt = skillInvocation
      ? skillBridge ? composeNativeSkillTaskPrompt(run, skillInvocation) : composeNativeSkillProviderPrompt(run, skillInvocation)
      : composePrompt(run);
    const evidenceInstructions = browserEvidenceInstructions(host.browserAutomation);
    const browserAwarePrompt = evidenceInstructions ? `${baseProviderPrompt}\n\n${evidenceInstructions}` : baseProviderPrompt;
    const providerPrompt = session.providerSessionId ? browserAwarePrompt : withRecoveredHistory(browserAwarePrompt, contextState, run.id);
    const prompt = host.adapters[session.provider].needsTurnContext && run.turnContext ? withTurnContext(providerPrompt, run.turnContext) : providerPrompt;
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
        await appendScheduledEvent(host, run, kind, payload);
      },
      requestApproval: async (input) => {
        host.store.updateRun(run.id, { status: "waiting-approval" });
        host.store.updateSession(run.sessionId, { status: "waiting-approval" });
        host.publishSnapshot();
        return host.approvals.request(run, { ...input, cwd: directCwd, paths: input.paths || [] });
      },
      updateProviderSession: (id) => {
        if (session.providerSessionId !== id) session = host.store.updateSession(session.id, { providerSessionId: id });
      },
      updateInteractionMode: (mode) => {
        if (session.interactionMode !== mode) {
          session = host.store.updateSession(session.id, { interactionMode: mode });
          host.publishSnapshot();
        }
      },
      skillInvocation: skillInvocation ? {
        name: skillInvocation.skill.id,
        argument: skillInvocation.argument,
        raw: skillInvocation.raw,
        prompt: composeNativeSkillTaskPrompt(run, skillInvocation)
      } : null,
      skillBridge,
      providerModel: host.resolveProviderModel(session.provider),
      browserAutomation: host.browserAutomation,
      images: turnImages
    });
    try {
      await host.adapters[session.provider].run(providerContext(prompt));
    } catch (resumeError) {
      if (!attemptedResume || providerProducedOutput || controller.signal.aborted) throw resumeError;
      host.adapters[session.provider].disposeSession?.(session.id);
      session = host.store.updateSession(session.id, { providerSessionId: null });
      await appendScheduledEvent(host, run, "system", { text: "Provider resume failed before producing output; rebuilt the turn from the local rollout.", subtype: "resume_recovered" });
      await host.adapters[session.provider].run(providerContext(withRecoveredHistory(prompt, contextState, run.id)));
    }
    if (!providerProducedFinal) throw new Error("Provider 协议异常：运行结束但未返回最终回复。");
    run = await finalizeScheduledRun(host, run, { status: "completed", error: null });
  } catch (error) {
    const cancelled = controller.signal.aborted;
    run = await finalizeScheduledRun(host, run, {
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? null : error instanceof Error ? error.message : String(error)
    });
  } finally {
    host.active.delete(run.id);
    updateSessionStatus(host.store, run.sessionId);
    host.publishSnapshot();
    if (host.adapters[run.provider]?.prewarm) void host.prewarm(run.provider, run.sessionId).catch(() => undefined);
    void pumpScheduledRuns(host);
  }
}

export async function cancelScheduledRun(host: SchedulerExecutionHost, runId: string): Promise<boolean> {
  const queuedIndex = host.queue.indexOf(runId);
  if (queuedIndex >= 0) {
    host.queue.splice(queuedIndex, 1);
    cleanupImages(host.projectRoot, runId, host.stateRoot);
    const run = host.store.updateRun(runId, { status: "cancelled", completedAt: new Date().toISOString() });
    await appendScheduledEvent(host, run, "status", { state: "cancelled" });
    await host.store.abortTurn(run, null);
    updateSessionStatus(host.store, run.sessionId);
    host.publishSnapshot();
    return true;
  }
  const active = host.active.get(runId);
  if (!active) return false;
  active.controller.abort();
  const declined = host.approvals.declineForRun(runId);
  for (const approval of declined) {
    await appendScheduledEvent(host, active.run, "approval-decision", {
      approvalId: approval.id,
      decision: "decline",
      approval,
      decidedAt: new Date().toISOString(),
      reason: "run-cancelled"
    });
  }
  return true;
}

export async function resolveScheduledApproval(host: SchedulerExecutionHost, id: string, rawDecision: ApprovalDecision): Promise<boolean> {
  const decision = ApprovalDecisionSchema.parse(rawDecision);
  const approval = host.approvals.list().find((item) => item.id === id);
  if (!approval) return false;
  const resolved = host.approvals.resolve(id, decision);
  if (!resolved) return false;
  const run = host.store.getRun(approval.runId);
  await appendScheduledEvent(host, run, "approval-decision", { approvalId: id, decision, approval, decidedAt: new Date().toISOString() });
  host.store.updateRun(run.id, { status: "running" });
  host.store.updateSession(run.sessionId, { status: "running" });
  host.publishSnapshot();
  return resolved;
}

export async function handleApprovalRequest(host: SchedulerExecutionHost, request: ApprovalRequest): Promise<void> {
  const run = host.store.getRun(request.runId);
  await appendScheduledEvent(host, run, "approval-request", { approval: request });
  host.publishSnapshot();
}

export async function appendScheduledEvent(host: SchedulerExecutionHost, run: AiRun, kind: AiEvent["kind"], payload: Record<string, unknown>): Promise<void> {
  if (kind === "assistant-delta" || kind === "reasoning-delta") {
    host.publish({ kind: "transient", event: { id: crypto.randomUUID(), seq: -1, timestamp: new Date().toISOString(), projectId: run.projectId, sessionId: run.sessionId, runId: run.id, provider: run.provider, kind, payload, risks: [], schemaVersion: 1 } });
    return;
  }
  const events = await host.store.appendEvent(run, kind, payload);
  for (const event of reassembleEvents(events)) host.publish({ kind: "event", event });
}

async function finalizeScheduledRun(host: SchedulerExecutionHost, run: AiRun, outcome: { status: "completed" | "failed" | "cancelled"; error: string | null }): Promise<AiRun> {
  cleanupImages(host.projectRoot, run.id, host.stateRoot);
  const risks = host.store.getRisks(run.id);
  host.store.writeSecurityReport(run, risks);
  const updated = host.store.updateRun(run.id, {
    status: outcome.status,
    completedAt: new Date().toISOString(),
    error: outcome.status === "cancelled" ? null : outcome.error,
    workspacePath: null,
    baseCommit: null,
    changeSet: null,
    risks
  });
  if (outcome.status === "completed") {
    await appendScheduledEvent(host, updated, "status", { state: "completed" });
    await host.store.completeTurn(updated);
  } else if (outcome.status === "cancelled") {
    await appendScheduledEvent(host, updated, "status", { state: "cancelled" });
    await host.store.abortTurn(updated, outcome.error);
  } else {
    await appendScheduledEvent(host, updated, "error", { text: outcome.error || "运行失败" });
    await host.store.abortTurn(updated, outcome.error);
  }
  return updated;
}

function isProviderFinalReply(kind: AiEvent["kind"], payload: Record<string, unknown>): boolean {
  if (kind !== "assistant-message" || payload.phase === "commentary") return false;
  return Boolean(String(payload.text || payload.message || "").trim());
}

function resolveSessionSkillInvocation(host: SchedulerExecutionHost, session: AiSession, prompt: string) {
  const snapshot = session.skillSnapshot;
  if (!snapshot) throw new Error("AI 会话缺少 Skill 快照；请重启应用完成兼容迁移。 ");
  const skillInvocation = parseSkillSlashInvocation(prompt, snapshot.map((entry) => entry.definition));
  if (!skillInvocation) return { skillInvocation: null, skillBridge: null };
  const entry = snapshot.find((candidate) => candidate.definition.id === skillInvocation.skill.id);
  if (!entry) throw new Error(`AI 会话 Skill 快照不完整：${skillInvocation.skill.id}`);
  return {
    skillInvocation,
    skillBridge: host.skillTools.providerSkillBridge(entry)
  };
}
