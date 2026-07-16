import type { AiEvent, AiRun, AiSession, RunStatus } from "@shared/contracts";
import { messages as m } from "@shared/messages";

export const NEW_SESSION_DRAFT = "__new-session__";

export function mergeEvents(current: AiEvent[], incoming: AiEvent[]): AiEvent[] {
  const byKey = new Map(current.map((event) => [eventKey(event), event]));
  for (const event of incoming) byKey.set(eventKey(event), event);
  return orderEventsByRun([...byKey.values()]);
}

/**
 * 事件以 (runId, seq) 作为唯一身份——同一 run 内 seq 单调递增、user-message 恒为 seq 1。
 * 用它而非随机 id 去重，能让乐观插入的合成事件被后端真事件覆盖，避免重复气泡。
 */
function eventKey(event: AiEvent): string {
  return `${event.runId}:${event.seq}`;
}

export function compareEvents(a: AiEvent, b: AiEvent): number {
  if (a.runId === b.runId) {
    return a.seq - b.seq || a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id);
  }
  return a.timestamp.localeCompare(b.timestamp) || a.runId.localeCompare(b.runId) || a.id.localeCompare(b.id);
}

/**
 * Select history by complete runs (our durable turn boundary), never by an
 * arbitrary event cut. One large final turn may exceed the requested budget.
 */
export function selectRecentTurnEvents(events: AiEvent[], eventBudget: number): AiEvent[] {
  if (eventBudget <= 0 || events.length === 0) return [];
  const ordered = orderEventsByRun(events);
  const runIds: string[] = [];
  const byRun = new Map<string, AiEvent[]>();
  for (const event of ordered) {
    const runEvents = byRun.get(event.runId);
    if (runEvents) runEvents.push(event);
    else {
      runIds.push(event.runId);
      byRun.set(event.runId, [event]);
    }
  }

  const selected = new Set<string>();
  let selectedCount = 0;
  for (let index = runIds.length - 1; index >= 0; index--) {
    const runId = runIds[index];
    const runEvents = byRun.get(runId) || [];
    if (selectedCount > 0 && selectedCount + runEvents.length > eventBudget) break;
    selected.add(runId);
    selectedCount += runEvents.length;
    if (selectedCount >= eventBudget) break;
  }
  return ordered.filter((event) => selected.has(event.runId));
}

function orderEventsByRun(events: AiEvent[]): AiEvent[] {
  const byRun = new Map<string, AiEvent[]>();
  for (const event of events) {
    const runEvents = byRun.get(event.runId);
    if (runEvents) runEvents.push(event);
    else byRun.set(event.runId, [event]);
  }
  return [...byRun.entries()]
    .sort(([aId, aEvents], [bId, bEvents]) => {
      return runAnchor(aEvents).localeCompare(runAnchor(bEvents)) || aId.localeCompare(bId);
    })
    .flatMap(([, runEvents]) => runEvents.slice().sort(compareEvents));
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
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null;
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
  return new Date(value).toLocaleString("zh-CN", {
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

export function storageJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Draft persistence must never block the editor.
  }
}
