import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";
import type {
  AiEvent,
  AiRun,
  AiSession,
  AiSnapshot,
  AiTurnPage,
  ContextReference,
  InteractionMode,
  PermissionProfile,
  SkillDefinition,
  SessionPatch
} from "@shared/contracts";
import { messages as m } from "@shared/messages";
import {
  activeRunForSession,
  errorText,
  latestRunForSession,
  mergeEvents,
  NEW_SESSION_DRAFT,
  storageJson,
  writeStorage
} from "./ai-utils";

type PanelMode = "collapsed" | "default" | "wide" | "full";
type ToastTone = "info" | "success" | "error";
type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; text: string; tone: ToastTone; recovery: string | null; action?: ToastAction };
type FeedbackLogEntry = { timestamp: string; text: string; tone: ToastTone; recovery: string | null; sessionId: string | null };
type NotifyOptions = { action?: ToastAction; durationMs?: number };
type ConfirmOptions = { title: string; body?: string; confirmText?: string; danger?: boolean };
type SendOptions = {
  providerId?: string;
  permissionProfile?: PermissionProfile;
  interactionMode?: InteractionMode;
  sessionId?: string;
  contexts?: ContextReference[];
};

interface AiController {
  snapshot: AiSnapshot;
  activeSession: AiSession | null;
  activeRun: AiRun | null;
  sessionActiveRun: AiRun | null;
  queuedRuns: AiRun[];
  events: AiEvent[];
  hasOlderTurns: boolean;
  historyLoading: boolean;
  loadOlderTurns(): Promise<void>;
  pendingContexts: ContextReference[];
  skills: SkillDefinition[];
  draft: string;
  setDraft(value: string): void;
  isSending: boolean;
  error: string | null;
  clearError(): void;
  setActiveSession(id: string | null): Promise<void>;
  updateSession(id: string, patch: SessionPatch): Promise<AiSession>;
  setActiveRun(id: string | null): void;
  addContext(context: ContextReference): void;
  removeContext(id: string): void;
  moveContext(id: string, direction: -1 | 1): void;
  reorderContexts(fromId: string, toId: string): void;
  clearContexts(): void;
  addFiles(): Promise<void>;
  composerFocusRequest: number;
  focusComposer(): void;
  send(prompt: string, options?: SendOptions): Promise<void>;
  rerun(runId: string): Promise<void>;
  editRun(runId: string): void;
  branchRun(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  refresh(): Promise<void>;
  refreshSkills(): Promise<SkillDefinition[] | null>;
  panelMode: PanelMode;
  setPanelMode(mode: PanelMode): void;
  toasts: Toast[];
  notify(text: string, tone?: ToastTone, options?: NotifyOptions): void;
  dismissToast(id: number): void;
  confirmState: ConfirmOptions | null;
  confirm(options: ConfirmOptions): Promise<boolean>;
  resolveConfirm(value: boolean): void;
}

interface AiStreamingState {
  streaming: string;
  reasoningStreaming: string;
}

interface AiStreamingStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(runId: string | null): AiStreamingState;
  updateStreaming(chunks: ReadonlyMap<string, string>, clearedRunIds?: readonly string[]): void;
  appendReasoning(chunks: ReadonlyMap<string, string>): void;
  clearReasoning(runId: string): void;
  clearRun(runId: string): void;
  clearAll(): void;
}

const Context = createContext<AiController | null>(null);
const StreamingContext = createContext<AiStreamingStore | null>(null);
const EMPTY_STREAMING_STATE: AiStreamingState = Object.freeze({ streaming: "", reasoningStreaming: "" });
const DRAFTS_KEY = "cctools.ai.drafts.v1";
const CONTEXTS_KEY = "cctools.ai.contexts.v1";
const PANEL_KEY = "cctools.ai.panel-mode.v1";
const FEEDBACK_LOG_KEY = "cctools.feedback.log.v1";

// 流式/事件泵：onAiEvent 的推送分两类整理——结构化事件用 rAF 批量 flush，
// 流式 token 用定时器按固定字符块节流。assistant-message 的「最终消息」要在 token 抽干后落，
// 故 pendingFinalMessages 在 pumpStreams 末尾处理。抽成 factory 让 AiProvider 主体可读。
const STREAM_PUMP_INTERVAL_MS = 24;
const STREAM_CHUNK_CHARS = 512;

type EventPumpDeps = {
  streamingStore: AiStreamingStore;
  setSnapshot: (snapshot: AiSnapshot) => void;
  setEventsBySession: (updater: (current: Record<string, AiEvent[]>) => Record<string, AiEvent[]>) => void;
  setError: (error: string | null) => void;
};

function createAiEventPump(deps: EventPumpDeps): () => void {
  const { streamingStore, setSnapshot, setEventsBySession, setError } = deps;
  const eventQueue: AiEvent[] = [];
  const reasoningQueue = new Map<string, string>();
  const pendingText = new Map<string, string>();
  const activeStreams = new Set<string>();
  // One provider turn can publish several durable assistant messages while a
  // transient delta stream is still draining (for example Claude commentary,
  // then a tool call, then the terminal result; or Codex commentary followed
  // by final_answer). Keep every durable message in protocol order. A single
  // map entry used to overwrite earlier messages and could silently lose
  // process commentary when frames arrived close together.
  const pendingAssistantMessages = new Map<string, AiEvent[]>();
  let frame = 0;
  let streamTimer = 0;
  const appendEvents = (incoming: AiEvent[]) => {
    if (!incoming.length) return;
    setEventsBySession((current) => {
      const next = { ...current };
      for (const event of incoming) next[event.sessionId] = mergeEvents(next[event.sessionId] || [], [event]);
      return next;
    });
  };
  const flushEvents = () => {
    frame = 0;
    if (eventQueue.length) {
      const incoming = eventQueue.splice(0);
      appendEvents(incoming);
    }
    if (reasoningQueue.size) {
      const incoming = new Map(reasoningQueue);
      reasoningQueue.clear();
      streamingStore.appendReasoning(incoming);
    }
  };
  const scheduleEvents = () => {
    if (!frame) frame = window.requestAnimationFrame(flushEvents);
  };
  const scheduleStream = () => {
    if (!streamTimer) streamTimer = window.setTimeout(pumpStreams, STREAM_PUMP_INTERVAL_MS);
  };
  const pumpStreams = () => {
    streamTimer = 0;
    const chunks = new Map<string, string>();
    const finished: AiEvent[] = [];
    for (const runId of activeStreams) {
      const pending = pendingText.get(runId) || "";
      if (pending) {
        const size = Math.min(STREAM_CHUNK_CHARS, pending.length);
        chunks.set(runId, pending.slice(0, size));
        pendingText.set(runId, pending.slice(size));
        continue;
      }
      const messages = pendingAssistantMessages.get(runId);
      if (messages?.length) {
        finished.push(...messages);
        pendingAssistantMessages.delete(runId);
        activeStreams.delete(runId);
        pendingText.delete(runId);
      }
    }
    if (chunks.size || finished.length) {
      streamingStore.updateStreaming(chunks, [...new Set(finished.map((event) => event.runId))]);
    }
    if (finished.length) {
      appendEvents(finished);
    }
    if (activeStreams.size) scheduleStream();
  };
  const unsubscribe = window.cctools.onAiEvent((message) => {
    const payload = message as unknown as { kind: string; snapshot?: AiSnapshot; event?: AiEvent; code?: number };
    if (payload.kind === "snapshot" && payload.snapshot) setSnapshot(payload.snapshot);
    if (payload.kind === "worker-exit") {
      setError(m.ai.error.workerExit(payload.code));
      appendEvents([...pendingAssistantMessages.values()].flat());
      pendingAssistantMessages.clear();
      pendingText.clear();
      activeStreams.clear();
      streamingStore.clearAll();
    }
    if (payload.event && payload.kind === "event") {
      const event = payload.event;
      if (event.kind === "assistant-message" && activeStreams.has(event.runId)) {
        const queued = pendingAssistantMessages.get(event.runId) || [];
        queued.push(event);
        pendingAssistantMessages.set(event.runId, queued);
        scheduleStream();
        return;
      }
      const terminalFailure = event.kind === "error"
        || (event.kind === "status" && ["failed", "cancelled"].includes(String(event.payload.state)));
      if (terminalFailure) {
        // Durable full messages are more authoritative than any unfinished
        // transient buffer. Preserve them before the failure row, then discard
        // only the incomplete delta tail.
        const queued = pendingAssistantMessages.get(event.runId);
        if (queued?.length) eventQueue.push(...queued);
        pendingAssistantMessages.delete(event.runId);
      }
      eventQueue.push(event);
      if (event.kind === "reasoning-summary") {
        reasoningQueue.delete(event.runId);
        streamingStore.clearReasoning(event.runId);
      }
      if (terminalFailure) {
        activeStreams.delete(event.runId);
        pendingText.delete(event.runId);
        reasoningQueue.delete(event.runId);
        streamingStore.clearRun(event.runId);
      }
      scheduleEvents();
    }
    if (payload.event && payload.kind === "transient") {
      const event = payload.event;
      const text = String(event.payload.text || "");
      if (!text) return;
      if (event.kind === "reasoning-delta") {
        reasoningQueue.set(event.runId, `${reasoningQueue.get(event.runId) || ""}${text}`);
        scheduleEvents();
        return;
      }
      activeStreams.add(event.runId);
      pendingText.set(event.runId, `${pendingText.get(event.runId) || ""}${text}`);
      scheduleStream();
    }
  });
  return () => {
    unsubscribe();
    if (frame) window.cancelAnimationFrame(frame);
    if (streamTimer) window.clearTimeout(streamTimer);
  };
}

export function AiProvider({ initial, skills: initialSkills = [], children }: { initial: AiSnapshot; skills?: SkillDefinition[]; children: ReactNode }) {
  const firstSession = initial.sessions.find((session) => !session.archived) || null;
  const [snapshot, setSnapshot] = useState(initial);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(firstSession?.id || null);
  const [activeRunId, setActiveRunId] = useState<string | null>(latestRunForSession(initial.runs, firstSession?.id || null)?.id || null);
  const [eventsBySession, setEventsBySession] = useState<Record<string, AiEvent[]>>({});
  const [turnCursorBySession, setTurnCursorBySession] = useState<Record<string, string | null>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => storageJson(DRAFTS_KEY, {}));
  const [contextsByDraft, setContextsByDraft] = useState<Record<string, ContextReference[]>>(() => storageJson(CONTEXTS_KEY, {}));
  const [panelMode, setPanelModeState] = useState<PanelMode>(() => storageJson(PANEL_KEY, "collapsed"));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const selectionRequest = useRef(0);
  const activeSessionRef = useRef(activeSessionId);
  const snapshotRef = useRef(snapshot);
  const contextsByDraftRef = useRef(contextsByDraft);
  const streamingStoreRef = useRef<AiStreamingStore | null>(null);
  if (!streamingStoreRef.current) streamingStoreRef.current = createAiStreamingStore();
  const streamingStore = streamingStoreRef.current;

  activeSessionRef.current = activeSessionId;
  snapshotRef.current = snapshot;
  contextsByDraftRef.current = contextsByDraft;

  const activeSession = snapshot.sessions.find((session) => session.id === activeSessionId) || null;
  const selectedRun = snapshot.runs.find((run) => run.id === activeRunId && run.sessionId === activeSessionId) || null;
  const activeRun = selectedRun || latestRunForSession(snapshot.runs, activeSessionId);
  const sessionActiveRun = activeRunForSession(snapshot.runs, activeSessionId);
  const queuedRuns = snapshot.runs
    .filter((run) => run.sessionId === activeSessionId && run.status === "queued")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const events = activeSession ? eventsBySession[activeSession.id] || [] : [];
  const hasOlderTurns = Boolean(activeSession && turnCursorBySession[activeSession.id]);
  const draftKey = activeSessionId || NEW_SESSION_DRAFT;
  const draft = drafts[draftKey] || "";
  const pendingContexts = contextsByDraft[draftKey] || [];
  const providerSignature = snapshot.providers.map((provider) => `${provider.id}:${provider.available}`).join("|");

  const replaceSession = useCallback((nextSession: AiSession) => {
    setSnapshot((current) => {
      const next = {
        ...current,
        sessions: current.sessions.map((session) => session.id === nextSession.id ? nextSession : session)
      };
      snapshotRef.current = next;
      return next;
    });
  }, []);

  const commitSnapshot = useCallback((incoming: AiSnapshot) => {
    setSnapshot((current) => {
      const currentSessions = new Map(current.sessions.map((session) => [session.id, session]));
      const next = {
        ...incoming,
        // Worker 推送和显式 refresh 可能晚于本地操作到达。按 updatedAt 保留更新的
        // 会话版本，避免归档成功后被旧 snapshot 短暂或永久“复活”。
        sessions: incoming.sessions.map((session) => {
          const existing = currentSessions.get(session.id);
          return existing && existing.updatedAt.localeCompare(session.updatedAt) > 0 ? existing : session;
        })
      };
      snapshotRef.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const next = await window.cctools.aiRefresh();
    commitSnapshot(next);
  }, [commitSnapshot]);

  const updateSession = useCallback(async (sessionId: string, patch: SessionPatch) => {
    const previous = snapshotRef.current.sessions.find((session) => session.id === sessionId);
    if (!previous) throw new Error(m.ai.error.sessionNotFound);
    replaceSession({ ...previous, ...patch, updatedAt: new Date().toISOString() });
    try {
      const updated = await window.cctools.aiUpdateSession(sessionId, patch);
      replaceSession(updated);
      return updated;
    } catch (cause) {
      setSnapshot((current) => {
        const next = {
          ...current,
          sessions: current.sessions.map((session) => session.id === sessionId ? {
            ...session,
            ...(patch.title !== undefined ? { title: previous.title } : {}),
            ...(patch.pinned !== undefined ? { pinned: previous.pinned } : {}),
            ...(patch.archived !== undefined ? { archived: previous.archived } : {}),
            updatedAt: new Date().toISOString()
          } : session)
        };
        snapshotRef.current = next;
        return next;
      });
      throw cause;
    }
  }, [replaceSession]);

  const [skills, setSkills] = useState<SkillDefinition[]>(initialSkills);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const refreshSkills = useCallback(async () => {
    try {
      if (typeof window.cctools.aiRefreshSkills !== "function") return null;
      const next = await window.cctools.aiRefreshSkills();
      setSkills(next);
      return next;
    } catch {
      // Skill 目录刷新是增强能力；扫描失败不能阻断发送、重试或恢复现有会话。
      return null;
    }
  }, []);

  const loadEvents = useCallback(async (sessionId: string, requestId: number) => {
    let loaded: AiEvent[];
    let page: AiTurnPage | null = null;
    if (window.cctools.aiListTurns) {
      page = await window.cctools.aiListTurns(sessionId, { limit: 20, sortDirection: "desc" });
      loaded = page.data.slice().reverse().flatMap((turn) => turn.events);
    } else {
      loaded = await window.cctools.aiGetEvents(sessionId);
    }
    if (selectionRequest.current !== requestId || activeSessionRef.current !== sessionId) return;
    setEventsBySession((current) => ({ ...current, [sessionId]: mergeEvents(current[sessionId] || [], loaded) }));
    setTurnCursorBySession((current) => ({ ...current, [sessionId]: page?.nextCursor || null }));
  }, []);

  const loadOlderTurns = useCallback(async () => {
    const sessionId = activeSessionRef.current;
    if (!sessionId || !window.cctools.aiListTurns) return;
    const cursor = turnCursorBySession[sessionId];
    if (!cursor || historyLoading) return;
    setHistoryLoading(true);
    try {
      const page = await window.cctools.aiListTurns(sessionId, {
        cursor,
        limit: 20,
        sortDirection: "desc"
      });
      if (activeSessionRef.current !== sessionId) return;
      const loaded = page.data.slice().reverse().flatMap((turn) => turn.events);
      setEventsBySession((current) => ({
        ...current,
        [sessionId]: mergeEvents(current[sessionId] || [], loaded)
      }));
      setTurnCursorBySession((current) => ({ ...current, [sessionId]: page.nextCursor }));
    } catch (cause) {
      setError(m.ai.error.loadOlderFailed(errorText(cause)));
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoading, turnCursorBySession]);

  const setActiveSession = useCallback(async (id: string | null) => {
    const requestId = ++selectionRequest.current;
    setError(null);
    setActiveSessionId(id);
    activeSessionRef.current = id;
    const latest = latestRunForSession(snapshotRef.current.runs, id);
    setActiveRunId(latest?.id || null);
    if (!id) return;
    try {
      await loadEvents(id, requestId);
    } catch (cause) {
      if (selectionRequest.current === requestId) setError(m.ai.error.loadSessionFailed(errorText(cause)));
    }
  }, [loadEvents]);

  const selectRun = useCallback((id: string | null) => {
    if (!id) {
      setActiveRunId(null);
      return;
    }
    const run = snapshotRef.current.runs.find((candidate) => candidate.id === id);
    if (run?.sessionId === activeSessionRef.current) setActiveRunId(id);
  }, []);

  useEffect(() => {
    if (activeSessionId) void setActiveSession(activeSessionId);
  }, []);

  useEffect(() => {
    void window.cctools.aiPrewarm?.(activeSessionId || undefined)?.catch(() => undefined);
  }, [activeSessionId, providerSignature]);

  useEffect(() => {
    if (activeSessionId && !snapshot.sessions.some((session) => session.id === activeSessionId)) {
      void setActiveSession(null);
      return;
    }
    if (activeSessionId && !snapshot.runs.some((run) => run.id === activeRunId && run.sessionId === activeSessionId)) {
      setActiveRunId(latestRunForSession(snapshot.runs, activeSessionId)?.id || null);
    }
  }, [activeRunId, activeSessionId, setActiveSession, snapshot.runs, snapshot.sessions]);

  useEffect(() => createAiEventPump({ streamingStore, setSnapshot: commitSnapshot, setEventsBySession, setError }), [commitSnapshot, streamingStore]);

  useEffect(() => writeStorage(DRAFTS_KEY, drafts), [drafts]);
  useEffect(() => writeStorage(CONTEXTS_KEY, contextsByDraft), [contextsByDraft]);
  useEffect(() => writeStorage(PANEL_KEY, panelMode), [panelMode]);

  const setDraft = useCallback((value: string) => {
    const key = activeSessionRef.current || NEW_SESSION_DRAFT;
    setDrafts((current) => ({ ...current, [key]: value }));
  }, []);

  const send = useCallback(async (prompt: string, options: SendOptions = {}) => {
    if (sendingRef.current) throw new Error(m.ai.error.sendingInProgress);
    const targetSession = options.sessionId
      ? snapshotRef.current.sessions.find((session) => session.id === options.sessionId) || null
      : snapshotRef.current.sessions.find((session) => session.id === activeSessionRef.current) || null;
    const providerId = options.providerId || targetSession?.providerId || snapshotRef.current.providers.find((provider) => provider.available)?.id;
    if (!providerId) throw new Error(m.ai.error.noProvider);
    const sourceKey = targetSession?.id || NEW_SESSION_DRAFT;
    const contexts = options.contexts || contextsByDraftRef.current[sourceKey] || [];
    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    // 新对话:fire-and-forget 刷新 skill 列表,让 /skill 自动补全反映最新目录。
    // 后端 startRun 里也会 refresh(),所以即使这次还没到也不影响解析。
    if (!targetSession) void refreshSkills();
    try {
      const result = await window.cctools.aiStartRun({
        sessionId: targetSession?.id,
        providerId,
        permissionProfile: options.permissionProfile || targetSession?.permissionProfile || "edit",
        interactionMode: options.interactionMode || targetSession?.interactionMode || "default",
        cwd: targetSession?.cwd || ".",
        prompt,
        contexts
      });
      setDrafts((current) => ({ ...current, [sourceKey]: "" }));
      setContextsByDraft((current) => ({ ...current, [sourceKey]: [] }));
      activeSessionRef.current = result.session.id;
      setActiveSessionId(result.session.id);
      setActiveRunId(result.run.id);
      // 乐观插入：用户消息立刻进对话记录，不等后端 beginTurn 推送。
      // 真事件到达后 mergeEvents 按 (runId, seq) 去重，用真事件覆盖合成事件。
      const optimisticEvent: AiEvent = {
        schemaVersion: 1,
        id: `optimistic:${result.run.id}`,
        seq: 1,
        timestamp: result.run.startedAt,
        projectId: result.run.projectId,
        sessionId: result.session.id,
        runId: result.run.id,
        provider: result.run.provider,
        kind: "user-message",
        payload: { text: prompt, contexts },
        risks: []
      };
      setEventsBySession((current) => ({
        ...current,
        [result.session.id]: mergeEvents(current[result.session.id] || [], [optimisticEvent])
      }));
      // 本地直接把 session/run 合并进 snapshot，省掉一次 aiRefresh 往返；
      // worker 推送的权威 snapshot 会随后经订阅自然覆盖。
      setSnapshot((current) => ({
        ...current,
        sessions: current.sessions.some((session) => session.id === result.session.id)
          ? current.sessions.map((session) => (session.id === result.session.id ? result.session : session))
          : [result.session, ...current.sessions],
        runs: current.runs.some((run) => run.id === result.run.id)
          ? current.runs.map((run) => (run.id === result.run.id ? result.run : run))
          : [result.run, ...current.runs]
      }));
      // 历史水合放后台跑、不挡渲染；live 事件由 onAiEvent 订阅实时推送。
      const requestId = ++selectionRequest.current;
      void loadEvents(result.session.id, requestId);
    } catch (cause) {
      const message = errorText(cause);
      setError(message);
      throw cause;
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }, [loadEvents]);

  const rerun = useCallback(async (runId: string) => {
    const run = snapshotRef.current.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(m.ai.error.rerunNotFound);
    await send(run.prompt, {
      sessionId: run.sessionId,
      providerId: run.providerId,
      permissionProfile: run.permissionProfile,
      interactionMode: run.interactionMode,
      contexts: run.contexts
    });
  }, [send]);

  const editRun = useCallback((runId: string) => {
    const run = snapshotRef.current.runs.find((candidate) => candidate.id === runId);
    if (!run) return;
    setDrafts((current) => ({ ...current, [run.sessionId]: run.prompt }));
    setContextsByDraft((current) => ({ ...current, [run.sessionId]: run.contexts }));
  }, []);

  const branchRun = useCallback(async (runId: string) => {
    const run = snapshotRef.current.runs.find((candidate) => candidate.id === runId);
    if (!run) return;
    if (window.cctools.aiForkSession) {
      const fork = await window.cctools.aiForkSession(run.sessionId, run.id);
      const next = await window.cctools.aiRefresh();
      snapshotRef.current = next;
      setSnapshot(next);
      await setActiveSession(fork.id);
      return;
    }
    setDrafts((current) => ({ ...current, [NEW_SESSION_DRAFT]: run.prompt }));
    setContextsByDraft((current) => ({ ...current, [NEW_SESSION_DRAFT]: run.contexts }));
    await setActiveSession(null);
  }, [setActiveSession]);

  const notify = useCallback((text: string, tone: ToastTone = "info", options: NotifyOptions = {}) => {
    const id = ++toastSeq.current;
    const recovery = tone === "error" ? recoveryHint(text) : null;
    recordFeedback({ timestamp: new Date().toISOString(), text, tone, recovery, sessionId: activeSessionRef.current });
    setToasts((current) => [...current, { id, text, tone, recovery, action: options.action }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), options.durationMs ?? 2800);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((item) => item.id !== id)), []);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    confirmResolver.current = resolve;
    setConfirmState(options);
  }), []);
  const resolveConfirm = useCallback((value: boolean) => {
    confirmResolver.current?.(value);
    confirmResolver.current = null;
    setConfirmState(null);
  }, []);

  const value = useMemo<AiController>(() => ({
    snapshot,
    activeSession,
    activeRun,
    sessionActiveRun,
    queuedRuns,
    events,
    hasOlderTurns,
    historyLoading,
    loadOlderTurns,
    pendingContexts,
    skills,
    draft,
    setDraft,
    isSending,
    error,
    clearError: () => setError(null),
    setActiveSession,
    updateSession,
    setActiveRun: selectRun,
    addContext: (context) => {
      const key = activeSessionRef.current || NEW_SESSION_DRAFT;
      setContextsByDraft((current) => ({
        ...current,
        [key]: (current[key] || []).some((item) => item.id === context.id) ? current[key] : [...(current[key] || []), context]
      }));
    },
    removeContext: (id) => {
      const key = activeSessionRef.current || NEW_SESSION_DRAFT;
      setContextsByDraft((current) => ({ ...current, [key]: (current[key] || []).filter((item) => item.id !== id) }));
    },
    moveContext: (id, direction) => {
      const key = activeSessionRef.current || NEW_SESSION_DRAFT;
      setContextsByDraft((current) => {
        const items = [...(current[key] || [])];
        const index = items.findIndex((item) => item.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= items.length) return current;
        [items[index], items[target]] = [items[target], items[index]];
        return { ...current, [key]: items };
      });
    },
    reorderContexts: (fromId, toId) => {
      const key = activeSessionRef.current || NEW_SESSION_DRAFT;
      setContextsByDraft((current) => {
        const items = [...(current[key] || [])];
        const from = items.findIndex((item) => item.id === fromId);
        const to = items.findIndex((item) => item.id === toId);
        if (from < 0 || to < 0 || from === to) return current;
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        return { ...current, [key]: items };
      });
    },
    clearContexts: () => {
      const key = activeSessionRef.current || NEW_SESSION_DRAFT;
      setContextsByDraft((current) => ({ ...current, [key]: [] }));
    },
    addFiles: async () => {
      const files = await window.cctools.selectFiles();
      const key = activeSessionRef.current || NEW_SESSION_DRAFT;
      setContextsByDraft((current) => {
        const existing = current[key] || [];
        const additions = files
          .filter((file) => !existing.some((item) => item.path === file))
          .map((file) => ({
            id: `file:${file}`,
            kind: "file" as const,
            label: file.split(/[\\/]/).at(-1) || file,
            path: file
          }));
        return { ...current, [key]: [...existing, ...additions] };
      });
    },
    composerFocusRequest,
    focusComposer: () => {
      setPanelModeState((current) => current === "collapsed" ? "default" : current);
      setComposerFocusRequest((current) => current + 1);
    },
    send,
    rerun,
    editRun,
    branchRun,
    cancel: async (runId) => {
      setError(null);
      try {
        await window.cctools.aiCancelRun(runId);
        streamingStore.clearRun(runId);
        await refresh();
      } catch (cause) {
        setError(errorText(cause));
        throw cause;
      }
    },
    refresh,
    refreshSkills,
    panelMode,
    setPanelMode: setPanelModeState,
    toasts,
    notify,
    dismissToast,
    confirmState,
    confirm,
    resolveConfirm
  }), [
    snapshot,
    activeSession,
    activeRun,
    sessionActiveRun,
    queuedRuns,
    events,
    hasOlderTurns,
    historyLoading,
    loadOlderTurns,
    pendingContexts,
    skills,
    draft,
    setDraft,
    isSending,
    error,
    setActiveSession,
    updateSession,
    selectRun,
    send,
    rerun,
    editRun,
    branchRun,
    refresh,
    refreshSkills,
    panelMode,
    composerFocusRequest,
    notify,
    dismissToast,
    confirm,
    resolveConfirm,
    streamingStore
  ]);

  return (
    <Context.Provider value={value}>
      <StreamingContext.Provider value={streamingStore}>{children}</StreamingContext.Provider>
    </Context.Provider>
  );
}

export function useAi(): AiController {
  const value = useContext(Context);
  if (!value) throw new Error("useAi must be used within AiProvider");
  return value;
}

export function useAiStreaming(runId: string | null): AiStreamingState {
  const store = useContext(StreamingContext);
  if (!store) throw new Error("useAiStreaming must be used within AiProvider");
  const getSnapshot = useCallback(() => store.getSnapshot(runId), [runId, store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

function createAiStreamingStore(): AiStreamingStore {
  const byRun = new Map<string, AiStreamingState>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const write = (runId: string, streaming: string, reasoningStreaming: string): boolean => {
    const current = byRun.get(runId) || EMPTY_STREAMING_STATE;
    if (current.streaming === streaming && current.reasoningStreaming === reasoningStreaming) return false;
    if (!streaming && !reasoningStreaming) byRun.delete(runId);
    else byRun.set(runId, { streaming, reasoningStreaming });
    return true;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(runId) {
      return runId ? byRun.get(runId) || EMPTY_STREAMING_STATE : EMPTY_STREAMING_STATE;
    },
    updateStreaming(chunks, clearedRunIds = []) {
      let changed = false;
      for (const [runId, text] of chunks) {
        if (!text) continue;
        const current = byRun.get(runId) || EMPTY_STREAMING_STATE;
        changed = write(runId, `${current.streaming}${text}`, current.reasoningStreaming) || changed;
      }
      for (const runId of clearedRunIds) {
        const current = byRun.get(runId) || EMPTY_STREAMING_STATE;
        changed = write(runId, "", current.reasoningStreaming) || changed;
      }
      if (changed) emit();
    },
    appendReasoning(chunks) {
      let changed = false;
      for (const [runId, text] of chunks) {
        if (!text) continue;
        const current = byRun.get(runId) || EMPTY_STREAMING_STATE;
        changed = write(runId, current.streaming, `${current.reasoningStreaming}${text}`) || changed;
      }
      if (changed) emit();
    },
    clearReasoning(runId) {
      const current = byRun.get(runId) || EMPTY_STREAMING_STATE;
      if (write(runId, current.streaming, "")) emit();
    },
    clearRun(runId) {
      if (byRun.delete(runId)) emit();
    },
    clearAll() {
      if (!byRun.size) return;
      byRun.clear();
      emit();
    }
  };
}

function recordFeedback(entry: FeedbackLogEntry): void {
  const current = storageJson<FeedbackLogEntry[]>(FEEDBACK_LOG_KEY, []);
  writeStorage(FEEDBACK_LOG_KEY, [...current, entry].slice(-120));
}

function recoveryHint(text: string): string {
  const value = text.toLocaleLowerCase();
  if (/skill|自动化|流水线|采集|数据源|source/.test(value)) return m.ai.recovery.skill;
  if (/provider|claude|codex|ai|审批|权限|会话/.test(value)) return m.ai.recovery.provider;
  if (/索引|资料|内容|inbox|读取/.test(value)) return m.ai.recovery.index;
  if (/文件|路径|目录|导入|导出|权限|保存/.test(value)) return m.ai.recovery.file;
  return m.ai.recovery.default;
}
