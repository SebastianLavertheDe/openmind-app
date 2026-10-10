import crypto from "node:crypto";
import {
  AiTurnListParamsSchema,
  type AiContextState,
  type AiEvent,
  type AiRolloutCompacted,
  type AiRolloutEventMessage,
  type AiRolloutItem,
  type AiRolloutLine,
  type AiRolloutResponseItem,
  type AiRolloutTurnContext,
  type AiRolloutWorldState,
  type AiRun,
  type AiSession,
  type AiTurn,
  type AiTurnListParams,
  type AiTurnPage
} from "../../shared/contracts";
import { PROVIDER_BASE_INSTRUCTIONS } from "../../shared/provider-base-instructions";

export type RolloutReconstruction = {
  turns: AiTurn[];
  context: AiContextState;
};

const serializedPayloadCache = new WeakMap<object, string>();

export function sessionMetaItem(session: AiSession): AiRolloutItem {
  return {
    type: "session_meta",
    payload: {
      sessionId: session.id,
      threadId: session.id,
      forkedFromId: session.forkedFromId || null,
      timestamp: session.createdAt,
      cwd: session.cwd,
      originator: "openmind-desktop",
      appVersion: "1.0.17",
      provider: session.provider,
      providerId: session.providerId,
      serviceProviderId: session.serviceProviderId || null,
      serviceProviderRevision: session.serviceProviderRevision || null,
      baseInstructions: PROVIDER_BASE_INSTRUCTIONS[session.provider],
      dynamicTools: [],
      selectedCapabilityRoots: [session.cwd],
      historyMode: "save-all"
    }
  };
}

export function turnStartedItem(run: AiRun): AiRolloutItem {
  return {
    type: "event_msg",
    payload: {
      type: "turn_started",
      turnId: run.id,
      data: {
        startedAt: run.startedAt,
        provider: run.provider,
        providerId: run.providerId
      }
    }
  };
}

export function turnContextItem(run: AiRun, context: NonNullable<AiRun["turnContext"]>): AiRolloutItem {
  return {
    type: "turn_context",
    payload: {
      ...context,
      turnId: run.id,
      workspaceRoots: [context.cwd],
      approvalPolicy: "on-request",
      sandboxPolicy: run.permissionProfile === "read-only" ? "read-only" : "workspace-write",
      permissionProfile: run.permissionProfile,
      provider: run.provider,
      providerId: run.providerId,
      model: run.providerId,
      contextHash: contextDigest(run, context)
    }
  };
}

export function worldStateItem(
  run: AiRun,
  previous: Record<string, unknown> | null = null
): AiRolloutItem {
  const state = {
    contexts: run.contexts,
    workspacePath: run.workspacePath
  };
  return {
    type: "world_state",
    payload: {
      turnId: run.id,
      full: previous === null,
      state: previous === null ? state : createMergePatch(previous, state)
    }
  };
}

export function turnCompleteItem(run: AiRun): AiRolloutItem {
  return {
    type: "event_msg",
    payload: {
      type: "turn_complete",
      turnId: run.id,
      data: {
        completedAt: run.completedAt || new Date().toISOString(),
        status: run.status
      }
    }
  };
}

export function turnAbortedItem(run: AiRun, reason: string | null): AiRolloutItem {
  return {
    type: "event_msg",
    payload: {
      type: "turn_aborted",
      turnId: run.id,
      data: {
        completedAt: run.completedAt || new Date().toISOString(),
        reason,
        status: run.status
      }
    }
  };
}

export function rollbackItem(numTurns: number): AiRolloutItem {
  return {
    type: "event_msg",
    payload: {
      type: "thread_rolled_back",
      turnId: null,
      data: { numTurns }
    }
  };
}

export function rolloutItemsForEvent(
  event: AiEvent,
  compactionReplacement: AiRolloutResponseItem[] | null = null
): AiRolloutItem[] {
  const items: AiRolloutItem[] = [];
  const responseItem = responseItemForEvent(event);
  if (responseItem) items.push({ type: "response_item", payload: responseItem });
  items.push({
    type: "event_msg",
    payload: {
      type: eventMessageType(event),
      turnId: event.runId,
      event,
      data: {}
    }
  });
  if (isCompactionEvent(event)) {
    items.push({
      type: "compacted",
      payload: {
        turnId: event.runId,
        message: String(event.payload.text || "Provider compacted the conversation context."),
        replacementHistory: compactionReplacement,
        windowNumber: Number(event.payload.windowNumber || 1),
        previousWindowId: typeof event.payload.previousWindowId === "string" ? event.payload.previousWindowId : null,
        windowId: typeof event.payload.windowId === "string" ? event.payload.windowId : crypto.randomUUID()
      }
    });
  }
  return items;
}

export function buildCompactionCheckpoint(
  history: AiRolloutResponseItem[],
  maxChars = 48_000
): AiRolloutResponseItem[] {
  const turns = new Map<string, AiRolloutResponseItem[]>();
  const turnIds: string[] = [];
  for (const item of normalizeHistory(history)) {
    const current = turns.get(item.turnId);
    if (current) current.push(item);
    else {
      turns.set(item.turnId, [item]);
      turnIds.push(item.turnId);
    }
  }
  const selected = new Set<string>();
  let chars = 0;
  for (let index = turnIds.length - 1; index >= 0; index--) {
    const turnId = turnIds[index];
    const items = turns.get(turnId) || [];
    const turnChars = items.reduce((total, item) => total + item.content.length + safeJson(item.payload).length, 0);
    if (selected.size && chars + turnChars > maxChars) break;
    selected.add(turnId);
    chars += turnChars;
    if (chars >= maxChars) break;
  }
  return normalizeHistory(history.filter((item) => selected.has(item.turnId)));
}

export function reconstructRollout(
  sessionId: string,
  lines: AiRolloutLine[],
  parseErrors = 0
): RolloutReconstruction {
  const turns: AiTurn[] = [];
  const byId = new Map<string, AiTurn>();
  const rolledBackTurnIds = new Set<string>();

  for (const line of lines) {
    if (line.type === "event_msg" && line.payload.type === "turn_started") {
      const turnId = line.payload.turnId;
      if (!turnId) continue;
      const turn = ensureTurn(turns, byId, sessionId, turnId, String(line.payload.data.startedAt || line.timestamp));
      turn.status = "in_progress";
      continue;
    }
    if (line.type === "event_msg" && line.payload.type === "thread_rolled_back") {
      let remaining = Math.max(0, Number(line.payload.data.numTurns || 0));
      while (remaining > 0 && turns.length) {
        const removed = turns.pop();
        if (!removed) break;
        byId.delete(removed.id);
        rolledBackTurnIds.add(removed.id);
        remaining--;
      }
      continue;
    }

    const turnId = itemTurnId(line);
    if (!turnId || rolledBackTurnIds.has(turnId)) continue;
    const turn = ensureTurn(turns, byId, sessionId, turnId, line.timestamp);
    if (line.type === "turn_context") {
      turn.context = line.payload;
    } else if (line.type === "response_item") {
      turn.responseItems.push(line.payload);
    } else if (line.type === "event_msg") {
      if (line.payload.event) turn.events.push(line.payload.event);
      if (line.payload.type === "turn_complete") {
        turn.status = "completed";
        turn.completedAt = stringOrNull(line.payload.data.completedAt) || line.timestamp;
      } else if (line.payload.type === "turn_aborted") {
        turn.status = "aborted";
        turn.completedAt = stringOrNull(line.payload.data.completedAt) || line.timestamp;
        turn.error = stringOrNull(line.payload.data.reason);
      }
    }
  }

  const survivingIds = new Set(turns.map((turn) => turn.id));
  const context = reconstructContext(sessionId, lines, survivingIds, parseErrors);
  for (const turn of turns) {
    turn.events.sort((a, b) => a.seq - b.seq || a.timestamp.localeCompare(b.timestamp));
  }
  return { turns, context };
}

export function paginateTurns(
  reconstruction: RolloutReconstruction,
  rawParams: AiTurnListParams = {}
): AiTurnPage {
  const params = AiTurnListParamsSchema.parse(rawParams);
  const ordered = params.sortDirection === "desc"
    ? reconstruction.turns.slice().reverse()
    : reconstruction.turns.slice();
  const offset = decodeCursor(params.cursor);
  const data = ordered.slice(offset, offset + params.limit);
  const nextOffset = offset + data.length;
  return {
    data,
    nextCursor: nextOffset < ordered.length ? encodeCursor(nextOffset) : null,
    total: ordered.length,
    parseErrors: reconstruction.context.parseErrors
  };
}

export function makeRolloutLine(item: AiRolloutItem, timestamp = new Date().toISOString()): AiRolloutLine {
  return {
    timestamp,
    ...item
  } as AiRolloutLine;
}

// reconstructContext 的累加器：把单遍 7-let 状态机拆成「每个 line.type 一个命名方法」，
// 让 compaction-reset 等微妙语义有落点。不变量：compacted 时 history / referenceContext /
// worldState 三者同时重置——旧窗口内容已被摘要取代，不能与新窗口的增量 patch 混合。
class ContextAccumulator {
  private history: AiRolloutResponseItem[] = [];
  private historyVersion = 0;
  private referenceContext: AiRolloutTurnContext | null = null;
  private worldState: Record<string, unknown> | null = null;
  private windowNumber = 0;
  private windowId: string | null = null;
  private tokenInfo: Record<string, unknown> | null = null;

  apply(line: AiRolloutLine, survivingIds: Set<string>): void {
    if (line.type === "event_msg") {
      // thread_rolled_back / token_count 是全局事件，不绑 turn，先于 survivingIds 过滤处理。
      if (line.payload.type === "thread_rolled_back") this.historyVersion++;
      else if (line.payload.type === "token_count") this.tokenInfo = line.payload.event?.payload || line.payload.data;
      return;
    }
    const turnId = itemTurnId(line);
    if (turnId && !survivingIds.has(turnId)) return;
    if (line.type === "response_item") {
      this.history.push(line.payload);
    } else if (line.type === "turn_context") {
      this.referenceContext = line.payload;
    } else if (line.type === "world_state") {
      this.applyWorldState(line.payload);
    } else if (line.type === "compacted") {
      this.applyCompaction(line.payload, survivingIds);
    }
  }

  finalize(sessionId: string, parseErrors: number): AiContextState {
    const history = normalizeHistory(this.history);
    return {
      sessionId,
      history,
      historyVersion: this.historyVersion,
      referenceContext: this.referenceContext,
      worldState: this.worldState,
      windowNumber: this.windowNumber,
      windowId: this.windowId,
      tokenInfo: this.tokenInfo,
      estimatedTokens: estimateHistoryTokens(history),
      parseErrors
    };
  }

  private applyWorldState(payload: AiRolloutWorldState): void {
    this.worldState = payload.full
      ? { ...payload.state }
      : applyMergePatch(this.worldState || {}, payload.state);
  }

  private applyCompaction(payload: AiRolloutCompacted, survivingIds: Set<string>): void {
    const replacement = payload.replacementHistory?.filter((item) => survivingIds.has(item.turnId));
    this.history = replacement?.length
      ? replacement
      : [{
        id: `compaction:${payload.windowId}`,
        turnId: payload.turnId || "compaction",
        kind: "message",
        role: "assistant",
        name: null,
        callId: null,
        content: payload.message,
        payload: { compacted: true }
      }];
    this.historyVersion++;
    // 不变量：新窗口从零开始，旧 referenceContext / worldState 作废，切到新窗口坐标。
    this.referenceContext = null;
    this.worldState = null;
    this.windowNumber = payload.windowNumber;
    this.windowId = payload.windowId;
  }
}

function reconstructContext(
  sessionId: string,
  lines: AiRolloutLine[],
  survivingIds: Set<string>,
  parseErrors: number
): AiContextState {
  const acc = new ContextAccumulator();
  for (const line of lines) acc.apply(line, survivingIds);
  return acc.finalize(sessionId, parseErrors);
}

function ensureTurn(
  turns: AiTurn[],
  byId: Map<string, AiTurn>,
  sessionId: string,
  turnId: string,
  startedAt: string
): AiTurn {
  const existing = byId.get(turnId);
  if (existing) return existing;
  const turn: AiTurn = {
    id: turnId,
    sessionId,
    status: "in_progress",
    startedAt,
    completedAt: null,
    context: null,
    events: [],
    responseItems: [],
    error: null
  };
  turns.push(turn);
  byId.set(turnId, turn);
  return turn;
}

export function responseItemForEvent(event: AiEvent): AiRolloutResponseItem | null {
  const common = {
    id: event.id,
    turnId: event.runId,
    name: null,
    callId: null,
    payload: event.payload
  };
  if (event.kind === "user-message") {
    return {
      ...common,
      kind: "message",
      role: "user",
      content: String(event.payload.modelInput || event.payload.text || "")
    };
  }
  if (event.kind === "assistant-message") {
    return { ...common, kind: "message", role: "assistant", content: String(event.payload.text || "") };
  }
  if (event.kind === "reasoning-summary") {
    return { ...common, kind: "reasoning", role: "assistant", content: String(event.payload.text || "") };
  }
  if (event.kind === "tool-start") {
    return {
      ...common,
      kind: "function_call",
      role: "assistant",
      name: String(event.payload.tool || "tool"),
      callId: String(event.payload.itemId || event.id),
      content: safeJson(event.payload.input || event.payload.arguments || {})
    };
  }
  if (event.kind === "tool-complete") {
    return {
      ...common,
      kind: "function_call_output",
      role: "tool",
      name: String(event.payload.tool || "tool"),
      callId: String(event.payload.itemId || event.id),
      content: outputText(event.payload)
    };
  }
  if (event.kind === "image-artifact") {
    return { ...common, kind: "function_call_output", role: "tool", name: "openmind_generate_image", callId: String(event.payload.itemId || event.id), content: safeJson({ image: event.payload.image, displayedInChat: true }) };
  }
  return null;
}

function eventMessageType(event: AiEvent): AiRolloutEventMessage["type"] {
  if (event.kind === "user-message") return "user_message";
  if (event.kind === "assistant-message") return "agent_message";
  if (event.kind === "reasoning-summary") return "agent_reasoning";
  if (event.kind === "usage") return "token_count";
  if (isCompactionEvent(event)) return "context_compacted";
  return "semantic_event";
}

function isCompactionEvent(event: AiEvent): boolean {
  if (event.kind !== "system") return false;
  const subtype = String(event.payload.subtype || "");
  return subtype === "compact_boundary" || subtype === "context_compacted";
}

function itemTurnId(line: AiRolloutLine): string | null {
  if (line.type === "session_meta") return null;
  if (line.type === "event_msg") return line.payload.turnId;
  if (line.type === "compacted") return line.payload.turnId;
  return line.payload.turnId;
}

function contextDigest(run: AiRun, context: NonNullable<AiRun["turnContext"]>): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    cwd: context.cwd,
    currentDate: context.currentDate,
    timezone: context.timezone,
    permissionProfile: run.permissionProfile,
    contexts: run.contexts
  })).digest("hex");
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    const offset = Number(value.offset);
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function outputText(payload: Record<string, unknown>): string {
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.aggregatedOutput === "string") return payload.aggregatedOutput;
  return safeJson(payload.output ?? payload);
}

function safeJson(value: unknown): string {
  if (value && typeof value === "object") {
    const cached = serializedPayloadCache.get(value);
    if (cached !== undefined) return cached;
  }
  try {
    const serialized = JSON.stringify(value);
    if (value && typeof value === "object") serializedPayloadCache.set(value, serialized);
    return serialized;
  } catch {
    return String(value);
  }
}

function normalizeHistory(items: AiRolloutResponseItem[]): AiRolloutResponseItem[] {
  const calls = new Map<string, AiRolloutResponseItem>();
  const outputIds = new Set<string>();
  for (const item of items) {
    if (item.kind === "function_call" && item.callId) calls.set(item.callId, item);
    if (item.kind === "function_call_output" && item.callId) outputIds.add(item.callId);
  }

  const normalized: AiRolloutResponseItem[] = [];
  for (const item of items) {
    if (item.kind === "function_call_output") {
      if (!item.callId || !calls.has(item.callId)) continue;
      normalized.push({ ...item, content: truncateToolOutput(item.content) });
      continue;
    }
    normalized.push(item);
    if (item.kind === "function_call" && item.callId && !outputIds.has(item.callId)) {
      normalized.push({
        id: `synthetic-output:${item.id}`,
        turnId: item.turnId,
        kind: "function_call_output",
        role: "tool",
        name: item.name,
        callId: item.callId,
        content: "aborted",
        payload: { synthetic: true }
      });
    }
  }
  return normalized;
}

function truncateToolOutput(value: string): string {
  const maxChars = 100_000;
  if (value.length <= maxChars) return value;
  const half = Math.floor(maxChars / 2);
  return `${value.slice(0, half)}\n…${value.length - maxChars} chars truncated…\n${value.slice(-half)}`;
}

function estimateHistoryTokens(items: AiRolloutResponseItem[]): number {
  const chars = items.reduce((total, item) => total + item.content.length + safeJson(item.payload).length, 0);
  return Math.ceil(chars / 4);
}

function applyMergePatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
    } else if (isRecord(value) && isRecord(next[key])) {
      next[key] = applyMergePatch(next[key] as Record<string, unknown>, value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function createMergePatch(
  previous: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (!(key in next)) {
      patch[key] = null;
      continue;
    }
    const before = previous[key];
    const after = next[key];
    if (isRecord(before) && isRecord(after)) {
      const nested = createMergePatch(before, after);
      if (Object.keys(nested).length) patch[key] = nested;
    } else if (safeJson(before) !== safeJson(after)) {
      patch[key] = after;
    }
  }
  return patch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
