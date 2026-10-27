import { originForSessionScope, type AiSessionOrigin } from "../../shared/ai-session-origin";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AiEventSchema,
  AiProjectSchema,
  AiRunSchema,
  AiSessionSchema,
  SCHEMA_VERSION,
  type AiEvent,
  type AiContextState,
  type AiRolloutItem,
  type AiRolloutLine,
  type AiRun,
  type AiSession,
  type AiSessionScope,
  type AiSessionSkillSnapshotEntry,
  type AiTurnListParams,
  type AiTurnPage,
  type ProviderKind,
  type RiskFinding,
  type SessionPatch
} from "../../shared/contracts";
import type { ProjectTaskMessage, ProjectTaskStatus } from "../../shared/project-contracts";
import { isProjectTaskScope, isWorkspaceScope, sameConversationScope } from "../../shared/ai-session-scope";
import { scanRisks } from "./risk-scanner";
import { writeJsonAtomic } from "../lib/fs-utils";
import {
  buildCompactionCheckpoint,
  makeRolloutLine,
  reconstructRollout,
  responseItemForEvent,
  rolloutItemsForEvent,
  sessionMetaItem,
  turnAbortedItem,
  turnCompleteItem,
  turnContextItem,
  turnStartedItem,
  worldStateItem
} from "./rollout";
import type { RolloutReconstruction } from "./rollout";
import { writeSecurityReportFile } from "./security-report";
import { SessionSearchIndex } from "./session-search-index";
import { RolloutJournal } from "./rollout-journal";
import { RolloutProjector } from "./rollout-projector";
import { chunkPayload, isContextCompaction, isProviderPrivateDelta, normalizeLoadedEvent, reassembleEvents } from "./event-chunking";
import { canonicalizeTrustedProjectRoot } from "./scheduler-paths";
import { ProjectPathResolver } from "../project/project-path-resolver";
import { ProjectTaskService } from "../project/task-service";
import { ProjectService } from "../project/project-service";
import { parseAssistantContent } from "../../shared/markdown-artifacts";

export class SessionStore {
  readonly root: string;
  readonly projectId: string;
  private locks = new Map<string, Promise<void>>();
  private sequences = new Map<string, number>();
  private sessions = new Map<string, AiSession>();
  private runs = new Map<string, AiRun>();
  private readonly searchIndex = new SessionSearchIndex({
    readJson: (file: string) => this.readJson(file),
    writeAtomic: (file: string, value: unknown) => writeJsonAtomic(file, value)
  });
  private indexed = false;
  private readonly projectTasks: ProjectTaskService | null;
  private projectArtifactService: ProjectService | null = null;
  // rollout 落盘策略（缓存/追加/flush/原子重写/增量 tail）的单一拥有者（C1 抽出到 RolloutJournal）。
  private readonly journal = new RolloutJournal();
  // rollout 投影（reconstruct 的消费者：readEvents/listTurns/getContextState/getRisks，C1 抽出到 RolloutProjector）。
  private readonly projector = new RolloutProjector(
    (sessionId: string) => this.reconstruct(sessionId),
    (runId: string) => this.getRun(runId)
  );

  constructor(
    readonly projectRoot: string,
    stateRoot?: string,
    private readonly trustedProjectsRoot?: string
  ) {
    // stateRoot is the parent of `.openmind` under userData. The optional
    // argument preserves the legacy workspace layout for isolated callers.
    this.root = path.join(stateRoot ?? projectRoot, ".openmind", "ai");
    this.projectId = projectIdForRoot(projectRoot);
    this.projectTasks = trustedProjectsRoot
      ? new ProjectTaskService(new ProjectPathResolver(path.dirname(trustedProjectsRoot)), this.root)
      : null;
  }

  initialize(): void {
    fs.mkdirSync(this.sessionsRoot(), { recursive: true });
    fs.mkdirSync(path.join(this.root, ".runtime", "locks"), { recursive: true });
    writeJsonAtomic(path.join(this.root, "schema.json"), AiProjectSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: this.projectId,
      name: "openmind-ai-project",
      root: this.projectRoot,
      createdAt: new Date().toISOString()
    }), { onlyIfMissing: true });
    writeJsonAtomic(path.join(this.root, "settings.json"), {
      schemaVersion: SCHEMA_VERSION,
      defaultPermissionProfile: "auto",
      maxConcurrentRuns: 3,
      versionEventsInGit: true,
      riskGuard: "warn"
    }, { onlyIfMissing: true });
  }

  listSessions(): AiSession[] {
    this.initialize();
    this.ensureIndex();
    return [...this.sessions.values()]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
  }

  /** Keep AI session visibility aligned with the owning Project Task archive. */
  archiveProjectTaskSessions(projectId: string, taskId: string): number {
    this.initialize();
    this.ensureIndex();
    let archived = 0;
    for (const current of this.sessions.values()) {
      if (
        current.archived
        || !isProjectTaskScope(current.scope)
        || current.scope.projectId !== projectId
        || current.scope.taskId !== taskId
      ) continue;
      const next = AiSessionSchema.parse({
        ...current,
        archived: true,
        // Archiving changes visibility, not the conversation's recency.
        updatedAt: current.updatedAt
      });
      writeJsonAtomic(this.sessionFile(current.id), next);
      this.sessions.set(current.id, next);
      archived += 1;
    }
    return archived;
  }

  /** Repairs sessions left visible by builds that archived only the Task record. */
  reconcileArchivedProjectTaskSessions(): number {
    if (!this.projectTasks) return 0;
    this.initialize();
    this.ensureIndex();
    const archivedScopes = new Map<string, { projectId: string; taskId: string }>();
    for (const session of this.sessions.values()) {
      if (session.archived || !isProjectTaskScope(session.scope)) continue;
      try {
        const task = this.projectTasks.get(session.scope.projectName, session.scope.taskId);
        if (task.status === "archived") {
          archivedScopes.set(`${task.projectId}\u0000${task.taskId}`, { projectId: task.projectId, taskId: task.taskId });
        }
      } catch {
        // Invalid or externally removed Project state remains an integrity issue;
        // do not silently rewrite its AI session here.
      }
    }
    let archived = 0;
    for (const scope of archivedScopes.values()) {
      archived += this.archiveProjectTaskSessions(scope.projectId, scope.taskId);
    }
    return archived;
  }

  getSession(id: string): AiSession {
    this.ensureIndex();
    const session = this.sessions.get(id);
    if (!session) throw new Error("AI 会话不存在。");
    return session;
  }

  createSession(input: {
    origin?: AiSessionOrigin | null;
    provider: ProviderKind;
    providerId: string;
    serviceProviderId?: string | null;
    serviceProviderRevision?: string | null;
    cwd: string;
    title: string;
    permissionProfile: AiSession["permissionProfile"];
    interactionMode?: AiSession["interactionMode"];
    forkedFromId?: string | null;
    skillSnapshot?: AiSessionSkillSnapshotEntry[];
    projectRoot?: string;
    scope: AiSessionScope;
  }): AiSession {
    this.initialize();
    const now = new Date().toISOString();
    const scope = input.scope;
    const sessionProjectRoot = this.resolveSessionRoot(scope, input.projectRoot);
    const session = AiSessionSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      projectId: isProjectTaskScope(scope) ? scope.projectId : this.projectId,
      projectRoot: sessionProjectRoot,
      scope,
      origin: originForSessionScope(input.origin, scope),
      title: input.title.slice(0, 120),
      provider: input.provider,
      providerId: input.providerId,
      serviceProviderId: input.serviceProviderId || null,
      serviceProviderRevision: input.serviceProviderRevision || null,
      forkedFromId: input.forkedFromId || null,
      cwd: isProjectTaskScope(scope) ? "." : input.cwd,
      permissionProfile: input.permissionProfile,
      interactionMode: input.interactionMode || "default",
      // Every newly-created session has an explicit (possibly empty) frozen
      // Skill set. `null` is reserved for persisted sessions from before the
      // snapshot feature and is handled only by the eager backfill below.
      skillSnapshot: input.skillSnapshot ?? [],
      createdAt: now,
      updatedAt: now
    });
    fs.mkdirSync(this.runsRoot(session.id), { recursive: true });
    writeJsonAtomic(this.sessionFile(session.id), session);
    this.writeRolloutFile(session.id, [makeRolloutLine(sessionMetaItem(session), now)]);
    this.sessions.set(session.id, session);
    this.writeSearchIndex(session.id);
    return session;
  }

  /** Commit or repair the Project-side binding before the first Run is exposed. */
  bindProjectSession(session: AiSession): void {
    if (!isProjectTaskScope(session.scope) || !this.projectTasks) return;
    const task = this.projectTasks.get(session.scope.projectName, session.scope.taskId);
    if (task.projectId !== session.scope.projectId) throw new Error("Project Task 与 AI Session 的 Project ID 不一致。");
    this.projectTasks.bindSession(session.scope.projectName, session.scope.taskId, session.id, session.providerId);
  }

  discardEmptySession(sessionId: string): void {
    if (this.listRuns(sessionId).length) throw new Error("已有 Run 的 AI Session 不能作为空会话回滚。");
    fs.rmSync(this.sessionRoot(sessionId), { recursive: true, force: true });
    this.sessions.delete(sessionId);
  }

  setProjectTaskStatus(sessionId: string, status: ProjectTaskStatus): void {
    const session = this.getSession(sessionId);
    if (!isProjectTaskScope(session.scope) || !this.projectTasks) return;
    this.projectTasks.setStatus(session.scope.projectName, session.scope.taskId, status);
  }

  async forkSession(sourceSessionId: string, throughRunId?: string): Promise<AiSession> {
    const source = this.getSession(sourceSessionId);
    const sourceReconstruction = this.reconstruct(sourceSessionId);
    const throughIndex = throughRunId
      ? sourceReconstruction.turns.findIndex((turn) => turn.id === throughRunId)
      : sourceReconstruction.turns.length - 1;
    if (throughRunId && throughIndex < 0) throw new Error("Cannot fork: the selected turn is not present in surviving rollout history.");
    const sourceTurns = sourceReconstruction.turns.slice(0, throughIndex + 1);
    let target = this.createSession({
      provider: source.provider,
      providerId: source.providerId,
      serviceProviderId: source.serviceProviderId || null,
      serviceProviderRevision: source.serviceProviderRevision || null,
      cwd: source.cwd,
      title: `${source.title} (branch)`.slice(0, 120),
      permissionProfile: source.permissionProfile,
      interactionMode: source.interactionMode,
      forkedFromId: source.id,
      skillSnapshot: source.skillSnapshot ?? [],
      projectRoot: source.projectRoot,
      scope: source.scope,
      origin: source.origin
    });
    target = this.updateSession(target.id, { imageGeneration: source.imageGeneration, executionModel: source.executionModel });
    const lines: AiRolloutLine[] = [];
    for (const sourceTurn of sourceTurns) {
      const sourceRun = this.runs.get(sourceTurn.id);
      if (!sourceRun) continue;
      let targetRun = this.createRun(target, sourceRun.prompt, sourceRun.contexts);
      targetRun = this.updateRun(targetRun.id, {
        status: sourceTurn.status === "completed" ? "completed" : "failed",
        startedAt: sourceTurn.startedAt,
        completedAt: sourceTurn.completedAt,
        error: sourceTurn.error,
        turnContext: sourceRun.turnContext,
        selectedSkill: sourceRun.selectedSkill,
        executionModel: sourceRun.executionModel,
        imageGeneration: sourceRun.imageGeneration
      });
      lines.push(makeRolloutLine(turnStartedItem(targetRun), sourceTurn.startedAt));
      if (sourceTurn.context) {
        lines.push(makeRolloutLine({
          type: "turn_context",
          payload: {
            ...sourceTurn.context,
            turnId: targetRun.id
          }
        }, sourceTurn.context.capturedAt));
      }
      lines.push(makeRolloutLine(worldStateItem(targetRun), sourceTurn.context?.capturedAt || sourceTurn.startedAt));
      for (const sourceEvent of sourceTurn.events) {
        const event = AiEventSchema.parse({
          ...sourceEvent,
          id: crypto.randomUUID(),
          projectId: target.projectId,
          sessionId: target.id,
          runId: targetRun.id
        });
        for (const item of rolloutItemsForEvent(event)) {
          lines.push(makeRolloutLine(item, event.timestamp));
        }
      }
      lines.push(makeRolloutLine(
        sourceTurn.status === "completed"
          ? turnCompleteItem(targetRun)
          : turnAbortedItem(targetRun, sourceTurn.error),
        sourceTurn.completedAt || sourceTurn.startedAt
      ));
    }
    await this.withLock(this.rolloutFile(target.id), async () => {
      this.appendRolloutLines(this.rolloutFile(target.id), lines);
    });
    return this.updateSession(target.id, {
      providerSessionId: null,
      status: "idle",
      lastRunId: sourceTurns.length ? this.listRuns(target.id)[0]?.id || null : null
    });
  }

  updateSession(id: string, patch: SessionPatch | Partial<AiSession>): AiSession {
    const current = this.getSession(id);
    const next = AiSessionSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      projectId: current.projectId,
      projectRoot: current.projectRoot,
      scope: current.scope,
      origin: current.origin ?? null,
      cwd: current.cwd,
      provider: current.provider,
      providerId: current.providerId,
      // Frozen provider binding normally never moves; the explicit patch path
      // exists only for the acknowledged provider-change rebind in scheduler.
      serviceProviderId: (patch as Partial<AiSession>).serviceProviderId ?? (current.serviceProviderId || null),
      serviceProviderRevision: (patch as Partial<AiSession>).serviceProviderRevision ?? (current.serviceProviderRevision || null),
      // Skill availability is a conversation boundary. Generic UI/lifecycle
      // patches must never mutate the frozen snapshot.
      skillSnapshot: current.skillSnapshot ?? null,
      permissionProfile: (patch as Partial<AiSession>).permissionProfile ?? current.permissionProfile,
      updatedAt: new Date().toISOString()
    });
    writeJsonAtomic(this.sessionFile(id), next);
    this.sessions.set(id, next);
    if (next.title !== current.title) this.writeSearchIndex(id);
    return next;
  }

  /**
   * One-time migration for sessions persisted before Skill snapshots existed.
   * The caller supplies the pre-feature compatibility catalog (all currently
   * usable installed packages, regardless of today's enabled preference).
   * Existing snapshots are never replaced and migration does not reorder the
   * conversation by changing its timestamp.
   */
  backfillMissingSkillSnapshots(resolveSkillSnapshot: () => AiSessionSkillSnapshotEntry[]): number {
    this.initialize();
    this.ensureIndex();
    const missing = [...this.sessions.values()]
      .filter((session) => session.skillSnapshot === null || session.skillSnapshot === undefined);
    if (!missing.length) return 0;
    // Integrity inspection can hash every installed package. Resolve it only
    // when a pre-feature session actually needs migration.
    const skillSnapshot = resolveSkillSnapshot();
    let migrated = 0;
    for (const current of missing) {
      const next = AiSessionSchema.parse({
        ...current,
        skillSnapshot,
        updatedAt: current.updatedAt
      });
      writeJsonAtomic(this.sessionFile(current.id), next);
      this.sessions.set(current.id, next);
      migrated += 1;
    }
    return migrated;
  }

  /**
   * Aligns conversations of every scope with enabled Installed Skills without
   * reordering conversations.
   */
  refreshSkillSnapshots(resolveSkillSnapshot: () => AiSessionSkillSnapshotEntry[]): number {
    this.initialize();
    this.ensureIndex();
    const refreshable = [...this.sessions.values()];
    if (!refreshable.length) return 0;
    const skillSnapshot = resolveSkillSnapshot();
    let refreshed = 0;
    for (const current of refreshable) {
      if (JSON.stringify(current.skillSnapshot) === JSON.stringify(skillSnapshot)) continue;
      const next = AiSessionSchema.parse({
        ...current,
        skillSnapshot,
        updatedAt: current.updatedAt
      });
      writeJsonAtomic(this.sessionFile(current.id), next);
      this.sessions.set(current.id, next);
      refreshed += 1;
    }
    return refreshed;
  }

  refreshSessionSkillSnapshot(sessionId: string, skillSnapshot: AiSessionSkillSnapshotEntry[]): AiSession {
    const current = this.getSession(sessionId);
    if (JSON.stringify(current.skillSnapshot) === JSON.stringify(skillSnapshot)) return current;
    const next = AiSessionSchema.parse({ ...current, skillSnapshot });
    writeJsonAtomic(this.sessionFile(sessionId), next);
    this.sessions.set(sessionId, next);
    return next;
  }

  createRun(session: AiSession, prompt: string, contexts: AiRun["contexts"], id?: string): AiRun {
    const now = new Date().toISOString();
    const runId = id ?? crypto.randomUUID();
    const run = AiRunSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: runId,
      sessionId: session.id,
      projectId: session.projectId,
      scope: session.scope,
      provider: session.provider,
      providerId: session.providerId,
      permissionProfile: session.permissionProfile,
      interactionMode: session.interactionMode,
      imageGeneration: session.imageGeneration,
      status: "queued",
      prompt,
      promptMessageId: isProjectTaskScope(session.scope) ? runId : null,
      contexts,
      startedAt: now
    });
    fs.mkdirSync(this.runRoot(session.id, run.id), { recursive: true });
    try {
      // Stage the private reference first, then commit the canonical Project
      // prompt before exposing either object through the in-memory index.
      this.writeRunMetadata(run);
      if (isProjectTaskScope(session.scope)) {
        this.projectTasks?.appendMessage(session.scope.projectName, session.scope.taskId, {
          id: run.id,
          runId: run.id,
          role: "user",
          content: run.prompt,
          sourceMessageId: run.id,
          sessionId: session.id,
          createdAt: run.startedAt
        });
      }
    } catch (error) {
      fs.rmSync(this.runRoot(session.id, run.id), { recursive: true, force: true });
      throw error;
    }
    this.runs.set(run.id, run);
    this.updateSession(session.id, { lastRunId: run.id, status: "running" });
    return run;
  }

  listRuns(sessionId?: string): AiRun[] {
    this.ensureIndex();
    return [...this.runs.values()]
      .filter((run) => !sessionId || run.sessionId === sessionId)
      .filter((run) => !run.rolledBackAt)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  getRun(runId: string): AiRun {
    this.ensureIndex();
    const run = this.runs.get(runId);
    if (run) return run;
    throw new Error("AI 运行不存在。");
  }

  updateRun(runId: string, patch: Partial<AiRun>): AiRun {
    const current = this.getRun(runId);
    const next = AiRunSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      sessionId: current.sessionId,
      projectId: current.projectId,
      scope: current.scope,
      provider: current.provider,
      providerId: current.providerId,
      permissionProfile: current.permissionProfile
    });
    this.writeRunMetadata(next);
    this.runs.set(runId, next);
    return next;
  }

  async beginTurn(run: AiRun, modelInput = run.prompt): Promise<AiEvent[]> {
    const file = this.rolloutFile(run.sessionId);
    const events: AiEvent[] = [];
    await this.withLock(file, async () => {
      const event = AiEventSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id: isProjectTaskScope(run.scope) ? run.id : crypto.randomUUID(),
        seq: 1,
        timestamp: run.startedAt,
        projectId: run.projectId,
        sessionId: run.sessionId,
        runId: run.id,
        provider: run.provider,
        kind: "user-message",
        payload: { text: run.prompt, contexts: run.contexts, modelInput, ...(run.selectedSkill ? { selectedSkill: run.selectedSkill } : {}), ...(run.executionModel ? { executionModel: run.executionModel } : {}) },
        risks: scanRisks({ text: run.prompt, contexts: run.contexts, modelInput })
      });
      events.push(event);
      this.persistProjectMessage(event);
      const durableEvent = this.projectMessageReference(event);
      const lines = [
        makeRolloutLine(turnStartedItem(run), run.startedAt),
        ...rolloutItemsForEvent(durableEvent).map((item) => makeRolloutLine(item, event.timestamp))
      ];
      this.appendRolloutLines(file, lines);
      this.sequences.set(this.sequenceKey(run), 1);
    });
    this.writeSearchIndex(run.sessionId, events);
    return events;
  }

  async appendTurnContext(run: AiRun): Promise<void> {
    if (!run.turnContext) return;
    const previousWorldState = this.getContextState(run.sessionId).worldState;
    await this.appendRolloutItems(run.sessionId, [
      turnContextItem(run, run.turnContext),
      worldStateItem(run, previousWorldState)
    ], run.turnContext.capturedAt);
  }

  async completeTurn(run: AiRun): Promise<void> {
    await this.appendRolloutItems(run.sessionId, [turnCompleteItem(run)], run.completedAt || undefined);
    this.writeSearchIndex(run.sessionId);
  }

  saveProjectArtifacts(run: AiRun): void {
    if (run.status !== "completed" || run.permissionProfile === "read-only"
      || !isProjectTaskScope(run.scope) || !this.projectTasks || !this.trustedProjectsRoot) return;
    const message = this.projectTasks.listMessages(run.scope.projectName, run.scope.taskId)
      .filter((item) => item.runId === run.id && item.sessionId === run.sessionId && item.role === "assistant").at(-1);
    if (!message) return;
    if (!parseAssistantContent(message.content, message.id).some((block) => block.type === "artifact"
      && block.status === "complete" && block.content.trim())) return;
    this.projectArtifactService ??= new ProjectService(path.dirname(this.trustedProjectsRoot), { stateRoot: path.dirname(path.dirname(this.root)) });
    this.projectArtifactService.saveProjectMessageArtifacts(run.scope.projectName, run.scope.taskId, run.sessionId, message.id);
  }

  async abortTurn(run: AiRun, reason: string | null): Promise<void> {
    await this.appendRolloutItems(run.sessionId, [turnAbortedItem(run, reason)], run.completedAt || undefined);
    this.writeSearchIndex(run.sessionId);
  }


  async appendEvent(run: AiRun, kind: AiEvent["kind"], payload: Record<string, unknown>): Promise<AiEvent[]> {
    if (isProviderPrivateDelta(kind, payload)) return [];
    const session = this.getSession(run.sessionId);
    if (isProjectTaskScope(session.scope) && this.isProjectMessage(kind, payload)) {
      const file = this.rolloutFile(run.sessionId);
      const events: AiEvent[] = [];
      await this.withLock(file, async () => {
        const event = AiEventSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          id: crypto.randomUUID(),
          seq: this.lastSequenceForRun(run) + 1,
          timestamp: new Date().toISOString(),
          projectId: run.projectId,
          sessionId: run.sessionId,
          runId: run.id,
          provider: run.provider,
          kind,
          payload,
          risks: scanRisks(payload)
        });
        this.persistProjectMessage(event);
        const durableEvent = this.projectMessageReference(event);
        this.queueRolloutLines(file, rolloutItemsForEvent(durableEvent).map((item) => makeRolloutLine(item, event.timestamp)));
        this.sequences.set(this.sequenceKey(run), event.seq);
        events.push(event);
      });
      return events;
    }
    const compactionReplacement = isContextCompaction(kind, payload)
      ? buildCompactionCheckpoint(this.getContextState(run.sessionId).history)
      : null;
    const file = this.rolloutFile(run.sessionId);
    const chunks = chunkPayload(payload);
    const events: AiEvent[] = [];
    await this.withLock(file, async () => {
      const seq = this.lastSequenceForRun(run);
      const lines: AiRolloutLine[] = [];
      for (const [index, chunk] of chunks.entries()) {
        const id = crypto.randomUUID();
        const event = AiEventSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          id,
          seq: seq + index + 1,
          timestamp: new Date().toISOString(),
          projectId: run.projectId,
          sessionId: run.sessionId,
          runId: run.id,
          provider: run.provider,
          kind,
          payload: chunk,
          risks: kind === "tool-output" || kind === "usage" ? [] : scanRisks(chunk, id)
        });
        events.push(event);
        if (index === 0) {
          const responseItem = responseItemForEvent({ ...event, payload });
          if (responseItem) lines.push(makeRolloutLine({ type: "response_item", payload: responseItem }, event.timestamp));
        }
        for (const item of rolloutItemsForEvent(event, compactionReplacement).filter((item) => item.type !== "response_item")) {
          lines.push(makeRolloutLine(item, event.timestamp));
        }
      }
      if (compactionReplacement && run.turnContext) {
        lines.push(makeRolloutLine(turnContextItem(run, run.turnContext)));
        lines.push(makeRolloutLine(worldStateItem(run), new Date().toISOString()));
      }
      this.queueRolloutLines(file, lines);
      this.sequences.set(this.sequenceKey(run), seq + events.length);
    });
    this.writeSearchIndex(run.sessionId, events);
    return events;
  }

  readEvents(sessionId: string): AiEvent[] { return this.projector.readEvents(sessionId); }
  listTurns(sessionId: string, params: AiTurnListParams = {}): AiTurnPage { return this.projector.listTurns(sessionId, params); }
  getContextState(sessionId: string): AiContextState {
    const state = this.projector.getContextState(sessionId);
    const session = this.getSession(sessionId);
    if (!isProjectTaskScope(session.scope) || !this.projectTasks || state.windowNumber > 0) return state;
    const task = this.projectTasks.get(session.scope.projectName, session.scope.taskId);
    if (!task.previousSessionIds.length) return state;
    const previous = new Set(task.previousSessionIds);
    // A project rename changes the provider's cwd and starts a fresh Session.
    // Recover its earlier Task conversation through the same private store;
    // providers no longer have a transcript directory in their content sandbox.
    const history: AiContextState["history"] = this.projectTasks.listMessages(task.projectName, task.taskId)
      .filter((message) => message.sessionId !== null && previous.has(message.sessionId))
      .map((message) => ({
        id: message.id, turnId: message.runId, kind: "message", role: message.role,
        name: null, callId: null, content: message.content, payload: {}
      }));
    return {
      ...state,
      history: [...history, ...state.history],
      historyVersion: state.historyVersion + history.length,
      estimatedTokens: state.estimatedTokens + Math.ceil(history.reduce((sum, item) => sum + item.content.length, 0) / 4)
    };
  }
  getRisks(runId: string): RiskFinding[] { return this.projector.getRisks(runId); }

  search(query: string): AiSession[] {
    return this.searchIndex.search(query, this.listSessions());
  }

  writePatch(run: AiRun, patchText: string): void {
    fs.writeFileSync(path.join(this.runRoot(run.sessionId, run.id), "changes.patch"), patchText, "utf8");
  }

  writeSecurityReport(run: AiRun, risks: RiskFinding[]): void {
    const events = this.readEvents(run.sessionId);
    writeSecurityReportFile(run, risks, events, this.runRoot(run.sessionId, run.id));
  }

  private writeSearchIndex(sessionId: string, additions: AiEvent[] = []): void {
    const session = this.getSession(sessionId);
    // Project message bodies have one canonical home under the Project Task;
    // the workspace-wide Session search deliberately excludes this scope.
    if (isProjectTaskScope(session.scope)) return;
    this.searchIndex.write(sessionId, session.title, additions, this.searchFile(sessionId));
  }

  private ensureIndex(): void {
    if (this.indexed) return;
    this.indexed = true;
    const sessionsRoot = this.sessionsRoot();
    if (!fs.existsSync(sessionsRoot)) return;
    for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      try {
        const session = AiSessionSchema.parse(this.readJson(this.sessionFile(entry.name)));
        // The app-private state root can be shared while the user switches
        // workspaces. Keep foreign session directories untouched, but never
        // index their metadata, search body, rollout, or runs into this
        // workspace's scheduler.
        if (!this.ownsSession(session)) continue;
        if (isProjectTaskScope(session.scope)) {
          // Repairs an interrupted create after the Session file was committed
          // but before task.json received the reverse binding.
          this.bindProjectSession(session);
        } else {
          try {
            const index = this.readJson(this.searchFile(session.id)) as { body?: string; text?: string };
            this.searchIndex.load(session.id, session.title, index);
          } catch {
            this.searchIndex.load(session.id, session.title, null);
          }
        }
        this.sessions.set(session.id, session);
        const runsRoot = this.runsRoot(session.id);
        if (!fs.existsSync(runsRoot)) {
          this.ensureRollout(session);
          continue;
        }
        for (const runEntry of fs.readdirSync(runsRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
          try {
            const storedRun = AiRunSchema.parse(this.readJson(this.runFile(session.id, runEntry.name)));
            const run = this.hydrateProjectRunPrompt(session, storedRun);
            if (run.projectId !== session.projectId
              || run.sessionId !== session.id
              || !sameConversationScope(run.scope, session.scope)) continue;
            this.runs.set(run.id, run);
          } catch {
            // Corrupt run metadata is ignored and remains available for manual recovery.
          }
        }
        this.ensureRollout(session);
        this.reconcileRunsFromRollout(session.id);
      } catch {
        // Corrupt session metadata is ignored and remains available for manual recovery.
      }
    }
  }

  private lastSequenceForRun(run: AiRun): number {
    const key = this.sequenceKey(run);
    const cached = this.sequences.get(key);
    if (cached !== undefined) return cached;
    const loaded = this.readRollout(run.sessionId);
    for (let index = loaded.lines.length - 1; index >= 0; index--) {
      const line = loaded.lines[index];
      if (line.type !== "event_msg" || line.payload.event?.runId !== run.id) continue;
      const value = line.payload.event.seq;
      this.sequences.set(key, value);
      return value;
    }
    return 0;
  }

  private sequenceKey(run: Pick<AiRun, "sessionId" | "id">): string {
    return `${run.sessionId}:${run.id}`;
  }

  private reconstruct(sessionId: string) {
    this.ensureIndex();
    const session = this.getSession(sessionId);
    this.ensureRollout(session);
    // readRollout 让 lines/指纹保持最新；lines 变动（追加/重写）时会顺带把 reconstruction 置空。
    this.readRollout(sessionId);
    const entry = this.journal.getEntry(sessionId);
    if (entry?.reconstruction) return entry.reconstruction;
    const raw = reconstructRollout(sessionId, entry?.lines ?? [], entry?.parseErrors ?? 0);
    const reconstruction = isProjectTaskScope(session.scope) ? this.hydrateProjectMessages(session, raw) : raw;
    if (entry) this.journal.setReconstruction(sessionId, reconstruction);
    return reconstruction;
  }

  private isProjectMessage(kind: AiEvent["kind"], payload: Record<string, unknown>): boolean {
    if (kind === "user-message") return typeof payload.text === "string";
    return kind === "assistant-message"
      && payload.phase === "final"
      && (typeof payload.text === "string" || typeof payload.message === "string");
  }

  private persistProjectMessage(event: AiEvent): void {
    const session = this.getSession(event.sessionId);
    if (!isProjectTaskScope(session.scope) || !this.projectTasks || !this.isProjectMessage(event.kind, event.payload)) return;
    const role: ProjectTaskMessage["role"] = event.kind === "user-message" ? "user" : "assistant";
    const content = String(event.payload.text || event.payload.message || "");
    this.projectTasks.appendMessage(session.scope.projectName, session.scope.taskId, {
      id: event.id,
      runId: event.runId,
      role,
      content,
      sourceMessageId: event.id,
      sessionId: session.id,
      createdAt: event.timestamp
    });
  }

  private projectMessageReference(event: AiEvent): AiEvent {
    const session = this.getSession(event.sessionId);
    if (!isProjectTaskScope(session.scope) || !this.isProjectMessage(event.kind, event.payload)) return event;
    const { text: _text, message: _message, modelInput: _modelInput, ...metadata } = event.payload;
    return {
      ...event,
      payload: { ...metadata, projectMessageId: event.id }
    };
  }

  private hydrateProjectMessages(session: AiSession, reconstruction: RolloutReconstruction): RolloutReconstruction {
    if (!isProjectTaskScope(session.scope) || !this.projectTasks) return reconstruction;
    const messages = new Map(this.projectTasks.listMessages(session.scope.projectName, session.scope.taskId).map((message) => [message.id, message]));
    const hydratePayload = (payload: Record<string, unknown>): Record<string, unknown> => {
      const message = messages.get(String(payload.projectMessageId || ""));
      return message ? { ...payload, text: message.content } : payload;
    };
    const hydrateItem = (item: AiContextState["history"][number]) => {
      const message = messages.get(String(item.payload.projectMessageId || ""));
      return message ? { ...item, content: message.content, payload: hydratePayload(item.payload) } : item;
    };
    return {
      turns: reconstruction.turns.map((turn) => ({
        ...turn,
        events: turn.events.map((event) => ({ ...event, payload: hydratePayload(event.payload) })),
        responseItems: turn.responseItems.map(hydrateItem)
      })),
      context: {
        ...reconstruction.context,
        history: reconstruction.context.history.map(hydrateItem)
      }
    };
  }

  private hydrateProjectRunPrompt(session: AiSession, run: AiRun): AiRun {
    if (!isProjectTaskScope(session.scope) || !run.promptMessageId || !this.projectTasks) return run;
    const message = this.projectTasks.listMessages(session.scope.projectName, session.scope.taskId)
      .find((candidate) => candidate.id === run.promptMessageId && candidate.runId === run.id && candidate.role === "user");
    return message ? { ...run, prompt: message.content } : run;
  }

  private writeRunMetadata(run: AiRun): void {
    const persisted = isProjectTaskScope(run.scope) && run.promptMessageId
      ? { ...run, prompt: "" }
      : run;
    writeJsonAtomic(this.runFile(run.sessionId, run.id), persisted);
  }

  private async appendRolloutItems(
    sessionId: string,
    items: AiRolloutItem[],
    timestamp?: string
  ): Promise<void> {
    if (!items.length) return;
    const file = this.rolloutFile(sessionId);
    await this.withLock(file, async () => {
      this.appendRolloutLines(file, items.map((item) => makeRolloutLine(item, timestamp)));
    });
  }

  private appendRolloutLines(file: string, lines: AiRolloutLine[]): void {
    this.journal.append(file, lines);
  }

  private queueRolloutLines(file: string, lines: AiRolloutLine[]): void {
    this.journal.append(file, lines, false);
  }

  private writeRolloutFile(sessionId: string, lines: AiRolloutLine[]): void {
    this.journal.write(sessionId, this.rolloutFile(sessionId), lines);
  }

  private readRollout(sessionId: string): { lines: AiRolloutLine[]; parseErrors: number } {
    return this.journal.read(sessionId, this.rolloutFile(sessionId));
  }

  private ensureRollout(session: AiSession): void {
    if (fs.existsSync(this.rolloutFile(session.id))) return;
    const lines: AiRolloutLine[] = [makeRolloutLine(sessionMetaItem(session), session.createdAt)];
    const runs = [...this.runs.values()]
      .filter((run) => run.sessionId === session.id)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
    for (const run of runs) {
      lines.push(makeRolloutLine(turnStartedItem(run), run.startedAt));
      if (run.turnContext) {
        lines.push(makeRolloutLine(turnContextItem(run, run.turnContext), run.turnContext.capturedAt));
        lines.push(makeRolloutLine(worldStateItem(run), run.turnContext.capturedAt));
      }
      const legacyEvents = this.readLegacyEvents(run);
      if (!legacyEvents.some((event) => event.kind === "user-message")) {
        const userEvent = AiEventSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          id: crypto.randomUUID(),
          seq: 1,
          timestamp: run.startedAt,
          projectId: run.projectId,
          sessionId: run.sessionId,
          runId: run.id,
          provider: run.provider,
          kind: "user-message",
          payload: { text: run.prompt, contexts: run.contexts, selectedSkill: run.selectedSkill, executionModel: run.executionModel },
          risks: []
        });
        legacyEvents.unshift(userEvent);
      }
      for (const event of legacyEvents) {
        for (const item of rolloutItemsForEvent(event)) {
          lines.push(makeRolloutLine(item, event.timestamp));
        }
      }
      if (run.status === "completed") {
        lines.push(makeRolloutLine(turnCompleteItem(run), run.completedAt || run.startedAt));
      } else if (run.status === "failed" || run.status === "cancelled" || run.status === "conflicted") {
        lines.push(makeRolloutLine(turnAbortedItem(run, run.error), run.completedAt || run.startedAt));
      }
    }
    this.writeRolloutFile(session.id, lines);
  }

  private reconcileRunsFromRollout(sessionId: string): void {
    const loaded = this.readRollout(sessionId);
    const reconstruction = reconstructRollout(sessionId, loaded.lines, loaded.parseErrors);
    for (const turn of reconstruction.turns) {
      const current = this.runs.get(turn.id);
      if (!current) continue;
      let patch: Partial<AiRun> | null = null;
      if (turn.status === "completed" && current.status !== "completed") {
        patch = {
          status: "completed",
          completedAt: turn.completedAt || current.completedAt || new Date().toISOString(),
          error: null
        };
      } else if (turn.status === "aborted" && current.status !== "failed" && current.status !== "cancelled") {
        patch = {
          status: "failed",
          completedAt: turn.completedAt || current.completedAt || new Date().toISOString(),
          error: turn.error || current.error || "Turn aborted"
        };
      } else if (turn.status === "in_progress" && ["completed", "failed", "cancelled"].includes(current.status)) {
        patch = { status: "running", completedAt: null, error: null };
      }
      if (!patch) continue;
      const next = AiRunSchema.parse({ ...current, ...patch });
      this.writeRunMetadata(next);
      this.runs.set(current.id, next);
    }
  }

  private readLegacyEvents(run: AiRun): AiEvent[] {
    const file = this.eventsFile(run.sessionId, run.id);
    if (!fs.existsSync(file)) return [];
    const events: AiEvent[] = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = normalizeLoadedEvent(AiEventSchema.parse(JSON.parse(line)));
        if (event) events.push(event);
      } catch {
        // Codex rollout loading skips malformed records and continues replay.
      }
    }
    return reassembleEvents(events.sort((a, b) => a.seq - b.seq || a.timestamp.localeCompare(b.timestamp)));
  }

  private async withLock(key: string, action: () => Promise<void>): Promise<void> {
    const previous = this.locks.get(key) || Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.locks.set(key, tail);
    await previous;
    try { await action(); } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  private resolveSessionRoot(scope: AiSessionScope, requestedRoot?: string): string {
    if (isWorkspaceScope(scope)) {
      if (requestedRoot && path.resolve(requestedRoot) !== path.resolve(this.projectRoot)) {
        throw new Error("Workspace 会话不能切换执行根。");
      }
      return this.projectRoot;
    }
    if (!this.trustedProjectsRoot || !requestedRoot || !this.projectTasks) throw new Error("Project 会话缺少可信执行根。");
    const root = canonicalizeTrustedProjectRoot(this.trustedProjectsRoot, scope.projectName, requestedRoot);
    const task = this.projectTasks.get(scope.projectName, scope.taskId);
    if (task.projectId !== scope.projectId) throw new Error("Project 会话的稳定 Project ID 无效。");
    return root;
  }

  private ownsSession(session: AiSession): boolean {
    const scope = session.scope;
    if (isWorkspaceScope(scope)) {
      return session.projectId === this.projectId
        && path.resolve(session.projectRoot) === path.resolve(this.projectRoot);
    }
    if (!this.trustedProjectsRoot) return false;
    try {
      const root = canonicalizeTrustedProjectRoot(this.trustedProjectsRoot, scope.projectName, session.projectRoot);
      return path.resolve(session.projectRoot) === root
        && session.projectId === scope.projectId
        && this.projectTasks?.get(scope.projectName, scope.taskId).projectId === scope.projectId
        && session.cwd === ".";
    } catch {
      return false;
    }
  }

  private sessionsRoot(): string { return path.join(this.root, "sessions"); }
  private sessionRoot(id: string): string { return path.join(this.sessionsRoot(), id); }
  private sessionFile(id: string): string { return path.join(this.sessionRoot(id), "session.json"); }
  private searchFile(id: string): string { return path.join(this.sessionRoot(id), "search-index.json"); }
  private runsRoot(sessionId: string): string { return path.join(this.sessionRoot(sessionId), "runs"); }
  private runRoot(sessionId: string, runId: string): string { return path.join(this.runsRoot(sessionId), runId); }
  private runFile(sessionId: string, runId: string): string { return path.join(this.runRoot(sessionId, runId), "run.json"); }
  private rolloutFile(sessionId: string): string { return path.join(this.sessionRoot(sessionId), "rollout.jsonl"); }
  private eventsFile(sessionId: string, runId: string): string { return path.join(this.runRoot(sessionId, runId), "events.jsonl"); }
}

function projectIdForRoot(projectRoot: string): string {
  return crypto.createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 16);
}
