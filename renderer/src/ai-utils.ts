import { getLocale } from "@shared/messages";
import type { AiEvent, AiRun, AiSession, RunStatus } from "@shared/contracts";
import { messages as m } from "@shared/messages";

export const NEW_SESSION_DRAFT = "__new-session__";

type EventIndex = {
  byRun: Map<string, AiEvent[]>;
  runAnchors: Map<string, string>;
  runIds: string[];
};

// mergeEvents owns the ordering invariant for renderer event arrays. Keeping a
// weak index beside each immutable result lets the frequent streaming path
// reuse all untouched run buckets instead of rebuilding a history-wide key map.
const eventIndexes = new WeakMap<AiEvent[], EventIndex>();

export function mergeEvents(current: AiEvent[], incoming: AiEvent[]): AiEvent[] {
  const base = indexedEvents(current);
  if (incoming.length === 0) return base.events;

  const incomingByRun = new Map<string, Map<number, AiEvent>>();
  for (const event of incoming) {
    let runEvents = incomingByRun.get(event.runId);
    if (!runEvents) {
      runEvents = new Map<number, AiEvent>();
      incomingByRun.set(event.runId, runEvents);
    }
    // A later durable event replaces an optimistic event with the same
    // (runId, seq), including when both appear in one flush.
    runEvents.set(event.seq, event);
  }

  let byRun = base.index.byRun;
  let runAnchors = base.index.runAnchors;
  let runOrderChanged = false;
  let changed = false;

  for (const [runId, runEventMap] of incomingByRun) {
    const existing = byRun.get(runId) || [];
    const additions = [...runEventMap.values()].sort(compareEvents);
    const merged = mergeOrderedRunEvents(existing, additions);
    if (merged === existing) continue;

    if (!changed) {
      byRun = new Map(byRun);
      runAnchors = new Map(runAnchors);
      changed = true;
    }
    byRun.set(runId, merged);
    const previousAnchor = runAnchors.get(runId);
    const nextAnchor = runAnchor(merged);
    runAnchors.set(runId, nextAnchor);
    if (previousAnchor !== nextAnchor) runOrderChanged = true;
  }

  if (!changed) return base.events;

  const runIds = runOrderChanged
    ? [...byRun.keys()].sort((a, b) => compareRunIds(a, b, runAnchors))
    : base.index.runIds;
  const events = flattenRunEvents(runIds, byRun);
  eventIndexes.set(events, { byRun, runAnchors, runIds });
  return events;
}

/**
 * 事件以 (runId, seq) 作为唯一身份——同一 run 内 seq 单调递增、user-message 恒为 seq 1。
 * 用它而非随机 id 去重，能让乐观插入的合成事件被后端真事件覆盖，避免重复气泡。
 */
function mergeOrderedRunEvents(current: AiEvent[], incoming: AiEvent[]): AiEvent[] {
  const merged: AiEvent[] = [];
  let currentIndex = 0;
  let incomingIndex = 0;

  while (currentIndex < current.length || incomingIndex < incoming.length) {
    const currentEvent = current[currentIndex];
    const incomingEvent = incoming[incomingIndex];
    if (!incomingEvent || (currentEvent && currentEvent.seq < incomingEvent.seq)) {
      merged.push(currentEvent);
      currentIndex += 1;
      continue;
    }
    if (!currentEvent || incomingEvent.seq < currentEvent.seq) {
      merged.push(incomingEvent);
      incomingIndex += 1;
      continue;
    }
    merged.push(incomingEvent);
    currentIndex += 1;
    incomingIndex += 1;
  }

  return merged.length === current.length && merged.every((event, index) => event === current[index])
    ? current
    : merged;
}

export function compareEvents(a: AiEvent, b: AiEvent): number {
  if (a.runId === b.runId) {
    return a.seq - b.seq || a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id);
  }
  return a.timestamp.localeCompare(b.timestamp) || a.runId.localeCompare(b.runId) || a.id.localeCompare(b.id);
}

/**
 * Select history by complete runs (our durable turn boundary), never by an
 * arbitrary event cut. Input is kept in mergeEvents order (filtering that
 * array is also safe), so selection can walk only the newest run suffix. One
 * large final turn may exceed the requested budget.
 */
export function selectRecentTurnEvents(events: AiEvent[], eventBudget: number): AiEvent[] {
  if (eventBudget <= 0 || events.length === 0) return [];
  let selectedStart = events.length;
  let runEnd = events.length;
  let selectedCount = 0;

  while (runEnd > 0) {
    const runId = events[runEnd - 1].runId;
    let runStart = runEnd - 1;
    while (runStart > 0 && events[runStart - 1].runId === runId) runStart -= 1;
    const runLength = runEnd - runStart;
    if (selectedCount > 0 && selectedCount + runLength > eventBudget) break;
    selectedStart = runStart;
    selectedCount += runLength;
    if (selectedCount >= eventBudget) break;
    runEnd = runStart;
  }
  return events.slice(selectedStart);
}

function indexedEvents(events: AiEvent[]): { events: AiEvent[]; index: EventIndex } {
  const cached = eventIndexes.get(events);
  if (cached) return { events, index: cached };

  // This path is paid only for an array not produced by mergeEvents. It also
  // normalizes legacy/caller-provided input and preserves last-write-wins.
  const eventsByRunAndSeq = new Map<string, Map<number, AiEvent>>();
  for (const event of events) {
    let runEvents = eventsByRunAndSeq.get(event.runId);
    if (!runEvents) {
      runEvents = new Map<number, AiEvent>();
      eventsByRunAndSeq.set(event.runId, runEvents);
    }
    runEvents.set(event.seq, event);
  }

  const byRun = new Map<string, AiEvent[]>();
  const runAnchors = new Map<string, string>();
  for (const [runId, runEventMap] of eventsByRunAndSeq) {
    const runEvents = [...runEventMap.values()].sort(compareEvents);
    byRun.set(runId, runEvents);
    runAnchors.set(runId, runAnchor(runEvents));
  }
  const runIds = [...byRun.keys()].sort((a, b) => compareRunIds(a, b, runAnchors));
  const ordered = flattenRunEvents(runIds, byRun);
  const normalized = ordered.length === events.length && ordered.every((event, index) => event === events[index])
    ? events
    : ordered;
  const index = { byRun, runAnchors, runIds };
  eventIndexes.set(normalized, index);
  return { events: normalized, index };
}

function compareRunIds(a: string, b: string, runAnchors: Map<string, string>): number {
  return (runAnchors.get(a) || "").localeCompare(runAnchors.get(b) || "") || a.localeCompare(b);
}

function flattenRunEvents(runIds: string[], byRun: Map<string, AiEvent[]>): AiEvent[] {
  const events: AiEvent[] = [];
  for (const runId of runIds) events.push(...(byRun.get(runId) || []));
  return events;
}

function runAnchor(events: AiEvent[]): string {
  const userMessage = events.find((event) => event.kind === "user-message");
  if (userMessage) return userMessage.timestamp;
  return events.reduce((earliest, event) => earliest && earliest < event.timestamp ? earliest : event.timestamp, "");
}

export function isRunActive(run: AiRun | null | undefined): boolean {
  return Boolean(run && ["queued", "running", "waiting-approval", "applying"].includes(run.status));
}

export function latestRunForSession(runs: AiRun[], sessionId: string | null): AiRun | null {
  if (!sessionId) return null;
  return runs
    .filter((run) => run.sessionId === sessionId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null;
}

export function activeRunForSession(runs: AiRun[], sessionId: string | null): AiRun | null {
  if (!sessionId) return null;
  return runs
    .filter((run) => run.sessionId === sessionId && isRunActive(run))
    .sort((a, b) => Number(a.status === "queued") - Number(b.status === "queued") || b.startedAt.localeCompare(a.startedAt))[0] || null;
}

export function runStatusLabel(status: RunStatus | string): string {
  const labels = m.ai.status.run;
  return labels[status as keyof typeof labels] || status;
}

export function sessionStatusLabel(status: AiSession["status"] | string): string {
  const labels = m.ai.status.session;
  return labels[status as keyof typeof labels] || status;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return m.ai.common.notRecorded;
  return new Date(value).toLocaleString(getLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function formatDateInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const part = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

export function formatDuration(startedAt: string, completedAt?: string | null): string {
  const started = new Date(startedAt).getTime();
  const completed = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return m.ai.time.unknown;
  const elapsed = Math.max(0, completed - started);
  if (elapsed < 1_000) return m.ai.time.milliseconds(elapsed);
  if (elapsed < 60_000) return m.ai.time.secondsDecimal((elapsed / 1_000).toFixed(1));
  return m.ai.time.minutesSeconds(Math.floor(elapsed / 60_000), Math.floor((elapsed % 60_000) / 1_000));
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { storageJson, writeStorage } from "./app/storage";
