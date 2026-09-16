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
import { workspaceSessions } from "@shared/ai-session-scope";
import { parseProviderChangePending } from "@shared/contracts";
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
import {
  ArtifactFenceParser,
  type AssistantContentBlock
} from "./features/ai-console/artifact-fence";

type PanelMode = "collapsed" | "default" | "wide" | "full";
type ToastTone = "info" | "success" | "error";
type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; text: string; tone: ToastTone; recovery: string | null; action?: ToastAction };
type FeedbackLogEntry = { timestamp: string; text: string; tone: ToastTone; recovery: string | null; sessionId: string | null };
type NotifyOptions = { action?: ToastAction; durationMs?: number };
export type ConfirmOptions = { title: string; body?: string; confirmText?: string; danger?: boolean };
export type ConfirmAction = (options: ConfirmOptions) => Promise<boolean>;
type SendOptions = {
  providerId?: string;
  permissionProfile?: PermissionProfile;
  interactionMode?: InteractionMode;
  sessionId?: string;
  contexts?: ContextReference[];
};

/**
 * Context slices, split by churn frequency. A single 40-field context
 * broadcast every value change (event flush, toast, snapshot push) to every
 * `useAi()` consumer, re-rendering the whole workspace per streamed chunk.
 * Each slice changes on its own cadence; hot surfaces subscribe to slices:
 *
 * - AiSnapshotValue: worker-pushed session/run/provider data (per snapshot push).
 * - AiEventsValue: live transcript events (per rAF flush while streaming).
 * - AiUiValue: local interaction state (toasts, confirm dialog, panel mode…).
 * - AiActionsValue: stable callbacks (never change identity).
 */
export interface AiSnapshotValue {
  snapshot: AiSnapshot;
  activeSession: AiSession | null;
  activeRun: AiRun | null;
  sessionActiveRun: AiRun | null;
  queuedRuns: AiRun[];
  pendingContexts: ContextReference[];
  skills: SkillDefinition[];
}

export interface AiEventsValue {
  events: AiEvent[];
  loadingSessionId: string | null;
  hasOlderTurns: boolean;
  historyLoading: boolean;
  loadOlderTurns(): Promise<void>;
}

export interface AiUiValue {
  toasts: Toast[];
  notify(text: string, tone?: ToastTone, options?: NotifyOptions): void;
  dismissToast(id: number): void;
  confirmState: ConfirmOptions | null;
  confirm: ConfirmAction;
  resolveConfirm(value: boolean): void;
  error: string | null;
  clearError(): void;
  isSending: boolean;
  cancellingRunIds: ReadonlySet<string>;
  panelMode: PanelMode;
  setPanelMode(mode: PanelMode): void;
  composerFocusRequest: number;
  focusComposer(): void;
  /** 项目详情页打开时选定的「新对话归属项目」；null = 常规工作区会话。 */
  projectComposeTarget: { projectId: string; projectName: string } | null;
  setProjectComposeTarget(target: { projectId: string; projectName: string } | null): void;
}

export interface AiActionsValue {
  setActiveSession(id: string | null): Promise<void>;
  updateSession(id: string, patch: SessionPatch): Promise<AiSession>;
  setActiveRun(id: string | null): void;
  addContext(context: ContextReference): void;
  removeContext(id: string): void;
  moveContext(id: string, direction: -1 | 1): void;
  reorderContexts(fromId: string, toId: string): void;
  clearContexts(): void;
  addFiles(): Promise<void>;
  send(prompt: string, options?: SendOptions): Promise<void>;
  rerun(runId: string): Promise<void>;
  editRun(runId: string): void;
  branchRun(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  refresh(): Promise<void>;
  refreshSkills(): Promise<SkillDefinition[] | null>;
}

export type AiController = AiSnapshotValue & AiEventsValue & AiUiValue & AiActionsValue;

export interface AiStreamingState {
  streaming: string;
  reasoningStreaming: string;
  assistantBlocks: readonly AssistantContentBlock[];
}

interface AiStreamingStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(runId: string | null): AiStreamingState;
  updateStreaming(chunks: ReadonlyMap<string, string>, clearedRunIds?: readonly string[]): void;
  appendReasoning(chunks: ReadonlyMap<string, string>): void;
  clearReasoning(runId: string): void;
  interruptRun(runId: string): void;
  clearRun(runId: string): void;
  clearAll(): void;
}

interface AiDraftStore {
  subscribe(key: string, listener: () => void): () => void;
  getSnapshot(key: string): string;
  set(key: string, value: string): void;
  flush(): void;
  dispose(): void;
}

export type AiDraftController = {
  draft: string;
  setDraft(value: string): void;
};

const SnapshotContext = createContext<AiSnapshotValue | null>(null);
const EventsContext = createContext<AiEventsValue | null>(null);
const UiContext = createContext<AiUiValue | null>(null);
const ActionsContext = createContext<AiActionsValue | null>(null);
const StreamingContext = createContext<AiStreamingStore | null>(null);
const DraftStoreContext = createContext<AiDraftStore | null>(null);
const DraftKeyContext = createContext(NEW_SESSION_DRAFT);
const EMPTY_STREAMING_STATE: AiStreamingState = Object.freeze({ streaming: "", reasoningStreaming: "", assistantBlocks: Object.freeze([]) });
const EMPTY_STREAMING_SUBSCRIBE = () => () => undefined;
const EMPTY_EVENTS: AiEvent[] = [];
const EMPTY_CONTEXTS: ContextReference[] = [];
const DRAFTS_KEY = "openmind.ai.drafts.v1";
const CONTEXTS_KEY = "openmind.ai.contexts.v1";
const PANEL_KEY = "openmind.ai.panel-mode.v1";
const FEEDBACK_LOG_KEY = "openmind.feedback.log.v1";
const DRAFT_PERSIST_DELAY_MS = 120;

function scopedStorageKey(base: string, scope: string): string {
  return scope ? `${base}:${encodeURIComponent(scope)}` : base;
}

/** Shallow per-element comparison; keeps the previous array identity when the
 * provider list content is unchanged across snapshot pushes. */
function sameProviderList(current: AiSnapshot["providers"], incoming: AiSnapshot["providers"]): boolean {
  return current.length === incoming.length && current.every((provider, index) => {
    const next = incoming[index];
    if (!next) return false;
    const currentKeys = Object.keys(provider) as (keyof typeof provider)[];
    return currentKeys.every((key) => provider[key] === next[key]);
  });
}

function scopedStorageJson<T>(base: string, scope: string, fallback: T): T {
  const scopedKey = scopedStorageKey(base, scope);
  if (!scope) return storageJson(scopedKey, fallback);
  // Upgrade the one legacy global draft slot into the first active scope. The
  // move is write-before-delete, so a later workspace can never import the
  // same file contexts and reinterpret their relative paths.
  try {
    if (window.localStorage.getItem(scopedKey) !== null) {
      // Crash recovery: the previous launch may have written the scoped value
      // but exited before deleting the global slot. Its data is already safe
      // here, so consume the legacy copy before any other scope can import it.
      window.localStorage.removeItem(base);
      return storageJson(scopedKey, fallback);
    }
    const legacy = window.localStorage.getItem(base);
    if (legacy === null) return fallback;
    const parsed = JSON.parse(legacy) as T;
    window.localStorage.setItem(scopedKey, legacy);
    window.localStorage.removeItem(base);
    return parsed;
  } catch {
    return fallback;
  }
}

function createAiDraftStore(storageKey: string, initial: Record<string, string>): AiDraftStore {
  let drafts = initial;
  let persistTimer = 0;
  const listeners = new Map<string, Set<() => void>>();
  const flush = () => {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = 0;
    writeStorage(storageKey, drafts);
  };
  const schedulePersistence = () => {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(flush, DRAFT_PERSIST_DELAY_MS);
  };
  return {
    subscribe(key, listener) {
      const subscribers = listeners.get(key) || new Set<() => void>();
      subscribers.add(listener);
      listeners.set(key, subscribers);
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) listeners.delete(key);
      };
    },
    getSnapshot: key => drafts[key] || "",
    set(key, value) {
      if ((drafts[key] || "") === value) return;
      drafts = { ...drafts, [key]: value };
      for (const listener of listeners.get(key) || []) listener();
      schedulePersistence();
    },
    flush,
    dispose() {
      if (persistTimer) flush();
      listeners.clear();
    }
  };
}

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
      const incomingBySession = new Map<string, AiEvent[]>();
      for (const event of incoming) {
        const sessionEvents = incomingBySession.get(event.sessionId);
        if (sessionEvents) sessionEvents.push(event);
        else incomingBySession.set(event.sessionId, [event]);
      }
      for (const [sessionId, sessionEvents] of incomingBySession) {
        next[sessionId] = mergeEvents(next[sessionId] || [], sessionEvents);
      }
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
  const unsubscribe = window.openmind.onAiEvent((message) => {
    const payload = message as unknown as { kind: string; snapshot?: AiSnapshot; event?: AiEvent; code?: number };
    if (payload.kind === "snapshot" && payload.snapshot) setSnapshot(payload.snapshot);
    if (payload.kind === "worker-exit") {
      setError(m.ai.error.workerExit(payload.code));
      const durableMessages = [...pendingAssistantMessages.values()].flat();
      appendEvents(durableMessages);
      const durableRunIds = new Set(durableMessages.map((event) => event.runId));
      const remainingChunks = new Map([...pendingText].filter(([, value]) => Boolean(value)));
      if (remainingChunks.size) streamingStore.updateStreaming(remainingChunks);
      for (const runId of activeStreams) {
        if (durableRunIds.has(runId)) streamingStore.clearRun(runId);
        else streamingStore.interruptRun(runId);
      }
      pendingAssistantMessages.clear();
      pendingText.clear();
      activeStreams.clear();
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
      if (event.kind === "assistant-message") streamingStore.clearRun(event.runId);
      const terminalFailure = event.kind === "error"
        || (event.kind === "status" && ["failed", "cancelled"].includes(String(event.payload.state)));
      const queued = terminalFailure ? pendingAssistantMessages.get(event.runId) : undefined;
      if (terminalFailure) {
        // Durable full messages are more authoritative than any unfinished
        // transient buffer. Preserve them before the failure row, then discard
        // only the incomplete delta tail.
        if (queued?.length) eventQueue.push(...queued);
        pendingAssistantMessages.delete(event.runId);
      }
      eventQueue.push(event);
      if (event.kind === "reasoning-summary") {
        reasoningQueue.delete(event.runId);
        streamingStore.clearReasoning(event.runId);
      }
      if (terminalFailure) {
        const unpumped = pendingText.get(event.runId);
        if (!queued?.length && unpumped) streamingStore.updateStreaming(new Map([[event.runId, unpumped]]));
        activeStreams.delete(event.runId);
        pendingText.delete(event.runId);
        reasoningQueue.delete(event.runId);
        if (queued?.length) streamingStore.clearRun(event.runId);
        else streamingStore.interruptRun(event.runId);
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

export function AiProvider({ initial, skills: initialSkills = [], storageScope = "", children }: { initial: AiSnapshot; skills?: SkillDefinition[]; storageScope?: string; children: ReactNode }) {
  // Project conversations are opened explicitly by their Project task page;
  // the global workbench must never adopt one merely because it was the most
  // recently persisted session.
  const firstSession = workspaceSessions(initial.sessions)[0] || null;
  // App remounts AiProvider when this scope changes. Draft text and file
  // contexts must follow that same openmind/workspace boundary; otherwise a
  // relative attachment selected in workspace A could be submitted in B.
  const draftsStorageKey = scopedStorageKey(DRAFTS_KEY, storageScope);
  const contextsStorageKey = scopedStorageKey(CONTEXTS_KEY, storageScope);
  const [snapshot, setSnapshot] = useState(initial);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(firstSession?.id || null);
  const [activeRunId, setActiveRunId] = useState<string | null>(latestRunForSession(initial.runs, firstSession?.id || null)?.id || null);
  const [eventsBySession, setEventsBySession] = useState<Record<string, AiEvent[]>>({});
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [turnCursorBySession, setTurnCursorBySession] = useState<Record<string, string | null>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [draftStore] = useState<AiDraftStore>(() => createAiDraftStore(
    draftsStorageKey,
    scopedStorageJson(DRAFTS_KEY, storageScope, {})
  ));
  const [contextsByDraft, setContextsByDraft] = useState<Record<string, ContextReference[]>>(() => scopedStorageJson(CONTEXTS_KEY, storageScope, {}));
  const [panelMode, setPanelModeState] = useState<PanelMode>(() => storageJson(PANEL_KEY, "collapsed"));
  const [projectComposeTarget, setProjectComposeTarget] = useState<{ projectId: string; projectName: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Map<number, number>());
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const cancellingRunsRef = useRef(new Set<string>());
  const [cancellingRunIds, setCancellingRunIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectionRequest = useRef(0);
  const activeSessionRef = useRef(activeSessionId);
  const snapshotRef = useRef(snapshot);
  const eventsBySessionRef = useRef(eventsBySession);
  const contextsByDraftRef = useRef(contextsByDraft);
  const streamingStoreRef = useRef<AiStreamingStore | null>(null);
  if (!streamingStoreRef.current) streamingStoreRef.current = createAiStreamingStore();
  const streamingStore = streamingStoreRef.current;

  activeSessionRef.current = activeSessionId;
  snapshotRef.current = snapshot;
  eventsBySessionRef.current = eventsBySession;
  contextsByDraftRef.current = contextsByDraft;

  const activeSession = snapshot.sessions.find((session) => session.id === activeSessionId) || null;
  const selectedRun = snapshot.runs.find((run) => run.id === activeRunId && run.sessionId === activeSessionId) || null;
  const activeRun = selectedRun || latestRunForSession(snapshot.runs, activeSessionId);
  const sessionActiveRun = activeRunForSession(snapshot.runs, activeSessionId);
  const queuedRuns = useMemo(() => snapshot.runs
    .filter((run) => run.sessionId === activeSessionId && run.status === "queued")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt)), [activeSessionId, snapshot.runs]);
  const events = activeSession ? eventsBySession[activeSession.id] || EMPTY_EVENTS : EMPTY_EVENTS;
  const hasOlderTurns = Boolean(activeSession && turnCursorBySession[activeSession.id]);
  const draftKey = activeSessionId || NEW_SESSION_DRAFT;
  const pendingContexts = contextsByDraft[draftKey] || EMPTY_CONTEXTS;
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
        }),
        // Worker 每次推送都反序列化出新的 providers 数组；内容未变时保留原
        // 引用，否则下游依赖 providers 的 useMemo（路由渲染属性等）会随每次
        // 推送整体失效。
        providers: sameProviderList(current.providers, incoming.providers) ? current.providers : incoming.providers
      };
      snapshotRef.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const next = await window.openmind.aiRefresh();
    commitSnapshot(next);
  }, [commitSnapshot]);

  const updateSession = useCallback(async (sessionId: string, patch: SessionPatch) => {
    const previous = snapshotRef.current.sessions.find((session) => session.id === sessionId);
    if (!previous) throw new Error(m.ai.error.sessionNotFound);
    replaceSession({ ...previous, ...patch, updatedAt: new Date().toISOString() });
    try {
      const updated = await window.openmind.aiUpdateSession(sessionId, patch);
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

  const [defaultSkills, setDefaultSkills] = useState<SkillDefinition[]>(initialSkills);
  const skills = useMemo(
    () => activeSession?.skillSnapshot
      ? activeSession.skillSnapshot.map((entry) => entry.definition)
      : defaultSkills,
    [activeSession, defaultSkills]
  );
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const refreshSkills = useCallback(async () => {
    try {
      if (typeof window.openmind.aiRefreshSkills !== "function") return null;
      const next = await window.openmind.aiRefreshSkills();
      setDefaultSkills(next);
      return next;
    } catch {
      // Skill 目录刷新是增强能力；扫描失败不能阻断发送、重试或恢复现有会话。
      return null;
    }
  }, []);

  const loadEvents = useCallback(async (sessionId: string, requestId: number) => {
    let loaded: AiEvent[];
    let page: AiTurnPage | null = null;
    if (window.openmind.aiListTurns) {
      page = await window.openmind.aiListTurns(sessionId, { limit: 20, sortDirection: "desc" });
      loaded = page.data.slice().reverse().flatMap((turn) => turn.events);
    } else {
      loaded = await window.openmind.aiGetEvents(sessionId);
    }
    if (selectionRequest.current !== requestId || activeSessionRef.current !== sessionId) return;
    setEventsBySession((current) => ({ ...current, [sessionId]: mergeEvents(current[sessionId] || [], loaded) }));
    setTurnCursorBySession((current) => ({ ...current, [sessionId]: page?.nextCursor || null }));
  }, []);

  const loadOlderTurns = useCallback(async () => {
    const sessionId = activeSessionRef.current;
    if (!sessionId || !window.openmind.aiListTurns) return;
    const cursor = turnCursorBySession[sessionId];
    if (!cursor || historyLoading) return;
    setHistoryLoading(true);
    try {
      const page = await window.openmind.aiListTurns(sessionId, {
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
    if (!id) {
      setLoadingSessionId(null);
      // A blank draft is the only surface that follows the current global
      // Skill defaults. Existing sessions render their persisted snapshot.
      await refreshSkills();
      return;
    }
    const uncached = !Object.prototype.hasOwnProperty.call(eventsBySessionRef.current, id);
    setLoadingSessionId(uncached ? id : null);
    try {
      await loadEvents(id, requestId);
    } catch (cause) {
      if (selectionRequest.current === requestId) setError(m.ai.error.loadSessionFailed(errorText(cause)));
    } finally {
      if (selectionRequest.current === requestId && activeSessionRef.current === id) {
        setLoadingSessionId((current) => current === id ? null : current);
      }
    }
  }, [loadEvents, refreshSkills]);

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
    void window.openmind.aiPrewarm?.(activeSessionId || undefined)?.catch(() => undefined);
  }, [activeSessionId, providerSignature]);

  // Cancel pending toast dismiss timers on unmount so a late timer can never
  // call setToasts after the environment is gone.
  useEffect(() => () => {
    for (const timer of toastTimers.current.values()) window.clearTimeout(timer);
    toastTimers.current.clear();
  }, []);

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

  useEffect(() => {
    const flushDrafts = () => draftStore.flush();
    window.addEventListener("pagehide", flushDrafts);
    return () => {
      window.removeEventListener("pagehide", flushDrafts);
      draftStore.dispose();
    };
  }, [draftStore]);
  useEffect(() => writeStorage(contextsStorageKey, contextsByDraft), [contextsByDraft, contextsStorageKey]);
  useEffect(() => writeStorage(PANEL_KEY, panelMode), [panelMode]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    confirmResolver.current = resolve;
    setConfirmState(options);
  }), []);
  const resolveConfirm = useCallback((value: boolean) => {
    confirmResolver.current?.(value);
    confirmResolver.current = null;
    setConfirmState(null);
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
      const startInput = (acknowledgeProviderChange?: boolean) => ({
        sessionId: targetSession?.id,
        providerId,
        permissionProfile: options.permissionProfile || targetSession?.permissionProfile || "auto",
        interactionMode: options.interactionMode || targetSession?.interactionMode || "default",
        cwd: targetSession?.cwd || ".",
        prompt,
        contexts,
        ...(acknowledgeProviderChange ? { acknowledgeProviderChange: true } : {})
      });
      let result: Awaited<ReturnType<typeof window.openmind.aiStartRun>>;
      try {
        result = await window.openmind.aiStartRun(startInput());
      } catch (cause) {
        // 会话绑定的 Provider 指纹已变更：弹确认框，同意后按当前配置重试一次，
        // worker 会把会话冻结的指纹刷新为当前值；取消则按原错误文案提示。
        const change = parseProviderChangePending(errorText(cause));
        if (!change) throw cause;
        const acknowledged = await confirm({
          title: m.ai.providerChange.title,
          body: m.ai.providerChange.body(change.id),
          confirmText: m.ai.providerChange.confirm
        });
        if (!acknowledged) throw new Error(change.message);
        result = await window.openmind.aiStartRun(startInput(true));
      }
      draftStore.set(sourceKey, "");
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
  }, [loadEvents, confirm, draftStore]);

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
    draftStore.set(run.sessionId, run.prompt);
    setContextsByDraft((current) => ({ ...current, [run.sessionId]: run.contexts }));
  }, [draftStore]);

  const branchRun = useCallback(async (runId: string) => {
    const run = snapshotRef.current.runs.find((candidate) => candidate.id === runId);
    if (!run) return;
    if (window.openmind.aiForkSession) {
      const fork = await window.openmind.aiForkSession(run.sessionId, run.id);
      const next = await window.openmind.aiRefresh();
      snapshotRef.current = next;
      setSnapshot(next);
      await setActiveSession(fork.id);
      return;
    }
    draftStore.set(NEW_SESSION_DRAFT, run.prompt);
    setContextsByDraft((current) => ({ ...current, [NEW_SESSION_DRAFT]: run.contexts }));
    await setActiveSession(null);
  }, [draftStore, setActiveSession]);

  const notify = useCallback((text: string, tone: ToastTone = "info", options: NotifyOptions = {}) => {
    const id = ++toastSeq.current;
    const recovery = tone === "error" ? recoveryHint(text) : null;
    recordFeedback({ timestamp: new Date().toISOString(), text, tone, recovery, sessionId: activeSessionRef.current });
    setToasts((current) => [...current, { id, text, tone, recovery, action: options.action }]);
    // Capture the timer handle so dismiss/unmount can cancel it; after jsdom
    // teardown `window` is gone and a late setToasts would crash the runner.
    const timer = window.setTimeout(() => {
      toastTimers.current.delete(id);
      setToasts((current) => current.filter((item) => item.id !== id));
    }, options.durationMs ?? 2800);
    toastTimers.current.set(id, timer);
  }, []);
  const dismissToast = useCallback((id: number) => {
    const timer = toastTimers.current.get(id);
    if (timer !== undefined) { window.clearTimeout(timer); toastTimers.current.delete(id); }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const addContext = useCallback((context: ContextReference) => {
    const key = activeSessionRef.current || NEW_SESSION_DRAFT;
    setContextsByDraft((current) => {
      const existing = current[key] || EMPTY_CONTEXTS;
      return existing.some((item) => item.id === context.id)
        ? current
        : { ...current, [key]: [...existing, context] };
    });
  }, []);
  const removeContext = useCallback((id: string) => {
    const key = activeSessionRef.current || NEW_SESSION_DRAFT;
    setContextsByDraft((current) => {
      const existing = current[key] || EMPTY_CONTEXTS;
      const next = existing.filter((item) => item.id !== id);
      return next.length === existing.length ? current : { ...current, [key]: next };
    });
  }, []);
  const moveContext = useCallback((id: string, direction: -1 | 1) => {
    const key = activeSessionRef.current || NEW_SESSION_DRAFT;
    setContextsByDraft((current) => {
      const items = [...(current[key] || EMPTY_CONTEXTS)];
      const index = items.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= items.length) return current;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...current, [key]: items };
    });
  }, []);
  const reorderContexts = useCallback((fromId: string, toId: string) => {
    const key = activeSessionRef.current || NEW_SESSION_DRAFT;
    setContextsByDraft((current) => {
      const items = [...(current[key] || EMPTY_CONTEXTS)];
      const from = items.findIndex((item) => item.id === fromId);
      const to = items.findIndex((item) => item.id === toId);
      if (from < 0 || to < 0 || from === to) return current;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { ...current, [key]: items };
    });
  }, []);
  const clearContexts = useCallback(() => {
    const key = activeSessionRef.current || NEW_SESSION_DRAFT;
    setContextsByDraft((current) => current[key]?.length ? { ...current, [key]: [] } : current);
  }, []);
  const addFiles = useCallback(async () => {
    const files = await window.openmind.selectFiles();
    const key = activeSessionRef.current || NEW_SESSION_DRAFT;
    setContextsByDraft((current) => {
      const existing = current[key] || EMPTY_CONTEXTS;
      const additions = files
        .filter((file) => !existing.some((item) => item.path === file))
        .map((file) => ({
          id: `file:${file}`,
          kind: "file" as const,
          label: file.split(/[\\/]/).at(-1) || file,
          path: file
        }));
      return additions.length ? { ...current, [key]: [...existing, ...additions] } : current;
    });
  }, []);
  const focusComposer = useCallback(() => {
    setPanelModeState((current) => current === "collapsed" ? "default" : current);
    setComposerFocusRequest((current) => current + 1);
  }, []);
  const cancel = useCallback(async (runId: string) => {
    if (cancellingRunsRef.current.has(runId)) return;
    cancellingRunsRef.current.add(runId);
    setCancellingRunIds(new Set(cancellingRunsRef.current));
    setError(null);
    try {
      await window.openmind.aiCancelRun(runId);
      streamingStore.interruptRun(runId);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
      throw cause;
    } finally {
      cancellingRunsRef.current.delete(runId);
      setCancellingRunIds(new Set(cancellingRunsRef.current));
    }
  }, [refresh, streamingStore]);

  const snapshotValue = useMemo<AiSnapshotValue>(() => ({
    snapshot,
    activeSession,
    activeRun,
    sessionActiveRun,
    queuedRuns,
    pendingContexts,
    skills
  }), [snapshot, activeSession, activeRun, sessionActiveRun, queuedRuns, pendingContexts, skills]);

  const eventsValue = useMemo<AiEventsValue>(() => ({
    events,
    loadingSessionId,
    hasOlderTurns,
    historyLoading,
    loadOlderTurns
  }), [events, loadingSessionId, hasOlderTurns, historyLoading, loadOlderTurns]);

  const uiValue = useMemo<AiUiValue>(() => ({
    toasts,
    notify,
    dismissToast,
    confirmState,
    confirm,
    resolveConfirm,
    error,
    clearError,
    isSending,
    cancellingRunIds,
    panelMode,
    setPanelMode: setPanelModeState,
    composerFocusRequest,
    focusComposer,
    projectComposeTarget,
    setProjectComposeTarget
  }), [
    toasts,
    notify,
    dismissToast,
    confirmState,
    confirm,
    resolveConfirm,
    error,
    clearError,
    isSending,
    cancellingRunIds,
    panelMode,
    composerFocusRequest,
    focusComposer,
    projectComposeTarget,
    setProjectComposeTarget
  ]);

  const actionsValue = useMemo<AiActionsValue>(() => ({
    setActiveSession,
    updateSession,
    setActiveRun: selectRun,
    addContext,
    removeContext,
    moveContext,
    reorderContexts,
    clearContexts,
    addFiles,
    send,
    rerun,
    editRun,
    branchRun,
    cancel,
    refresh,
    refreshSkills
  }), [
    setActiveSession,
    updateSession,
    selectRun,
    addContext,
    removeContext,
    moveContext,
    reorderContexts,
    clearContexts,
    addFiles,
    send,
    rerun,
    editRun,
    branchRun,
    cancel,
    refresh,
    refreshSkills
  ]);

  return (
    <SnapshotContext.Provider value={snapshotValue}>
      <EventsContext.Provider value={eventsValue}>
        <UiContext.Provider value={uiValue}>
          <ActionsContext.Provider value={actionsValue}>
            <DraftStoreContext.Provider value={draftStore}>
              <DraftKeyContext.Provider value={draftKey}>
                <StreamingContext.Provider value={streamingStore}>{children}</StreamingContext.Provider>
              </DraftKeyContext.Provider>
            </DraftStoreContext.Provider>
          </ActionsContext.Provider>
        </UiContext.Provider>
      </EventsContext.Provider>
    </SnapshotContext.Provider>
  );
}

export function useAiSnapshot(): AiSnapshotValue {
  const value = useContext(SnapshotContext);
  if (!value) throw new Error("useAiSnapshot must be used within AiProvider");
  return value;
}

export function useAiEvents(): AiEventsValue {
  const value = useContext(EventsContext);
  if (!value) throw new Error("useAiEvents must be used within AiProvider");
  return value;
}

export function useAiUi(): AiUiValue {
  const value = useContext(UiContext);
  if (!value) throw new Error("useAiUi must be used within AiProvider");
  return value;
}

export function useAiActions(): AiActionsValue {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("useAiActions must be used within AiProvider");
  return value;
}

/**
 * Full controller view over every slice. Subscribes to all contexts, so it
 * re-renders on any change — prefer the slice hooks (useAiSnapshot /
 * useAiEvents / useAiUi / useAiActions) in hot surfaces such as the chat
 * timeline, the composer, or the workspace shell.
 */
export function useAi(): AiController {
  const snapshotValue = useContext(SnapshotContext);
  const eventsValue = useContext(EventsContext);
  const uiValue = useContext(UiContext);
  const actionsValue = useContext(ActionsContext);
  if (!snapshotValue || !eventsValue || !uiValue || !actionsValue) {
    throw new Error("useAi must be used within AiProvider");
  }
  return { ...snapshotValue, ...eventsValue, ...uiValue, ...actionsValue };
}

function useDraftStoreAndKey(): [AiDraftStore, string] {
  const store = useContext(DraftStoreContext);
  const key = useContext(DraftKeyContext);
  if (!store) throw new Error("useAiDraft must be used within AiProvider");
  return [store, key];
}

export function useSetAiDraft(): (value: string) => void {
  const [store, key] = useDraftStoreAndKey();
  return useCallback((value: string) => store.set(key, value), [key, store]);
}

export function useAiDraft(): AiDraftController {
  const [store, key] = useDraftStoreAndKey();
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [key, store]);
  const getSnapshot = useCallback(() => store.getSnapshot(key), [key, store]);
  const draft = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setDraft = useCallback((value: string) => store.set(key, value), [key, store]);
  return useMemo(() => ({ draft, setDraft }), [draft, setDraft]);
}

export function useAiStreaming(runId: string | null): AiStreamingState {
  const store = useContext(StreamingContext);
  if (!store) throw new Error("useAiStreaming must be used within AiProvider");
  const getSnapshot = useCallback(() => store.getSnapshot(runId), [runId, store]);
  return useSyncExternalStore(runId ? store.subscribe : EMPTY_STREAMING_SUBSCRIBE, getSnapshot, getSnapshot);
}

function createAiStreamingStore(): AiStreamingStore {
  const byRun = new Map<string, AiStreamingState>();
  const parsers = new Map<string, ArtifactFenceParser>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const write = (
    runId: string,
    streaming: string,
    reasoningStreaming: string,
    assistantBlocks: readonly AssistantContentBlock[]
  ): boolean => {
    const current = byRun.get(runId) || EMPTY_STREAMING_STATE;
    if (
      current.streaming === streaming
      && current.reasoningStreaming === reasoningStreaming
      && current.assistantBlocks === assistantBlocks
    ) return false;
    if (!streaming && !reasoningStreaming) byRun.delete(runId);
    else byRun.set(runId, { streaming, reasoningStreaming, assistantBlocks });
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
        const parser = parsers.get(runId) || new ArtifactFenceParser(runId);
        if (!parsers.has(runId)) parsers.set(runId, parser);
        parser.push(text);
        changed = write(runId, `${current.streaming}${text}`, current.reasoningStreaming, parser.blocks()) || changed;
      }
      for (const runId of clearedRunIds) {
        const current = byRun.get(runId) || EMPTY_STREAMING_STATE;
        parsers.delete(runId);
        changed = write(runId, "", current.reasoningStreaming, EMPTY_STREAMING_STATE.assistantBlocks) || changed;
      }
      if (changed) emit();
    },
    appendReasoning(chunks) {
      let changed = false;
      for (const [runId, text] of chunks) {
        if (!text) continue;
        const current = byRun.get(runId) || EMPTY_STREAMING_STATE;
        changed = write(runId, current.streaming, `${current.reasoningStreaming}${text}`, current.assistantBlocks) || changed;
      }
      if (changed) emit();
    },
    clearReasoning(runId) {
      const current = byRun.get(runId) || EMPTY_STREAMING_STATE;
      if (write(runId, current.streaming, "", current.assistantBlocks)) emit();
    },
    interruptRun(runId) {
      const current = byRun.get(runId);
      const parser = parsers.get(runId);
      if (!current || !parser) return;
      if (!parser.hasArtifact()) {
        parsers.delete(runId);
        byRun.delete(runId);
        emit();
        return;
      }
      const assistantBlocks = parser.interrupt();
      if (write(runId, current.streaming, "", assistantBlocks)) emit();
    },
    clearRun(runId) {
      parsers.delete(runId);
      if (byRun.delete(runId)) emit();
    },
    clearAll() {
      parsers.clear();
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
