import type { AiEvent, AiRun } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { asRecord } from "@shared/utils";
import { selectRecentTurnEvents } from "../../ai-utils";
export { asRecord };

const eventsMsg = m.ai.events;
const statusMsg = m.ai.status;
const toolMsg = m.ai.tool;

export type TraceStep =
  | { type: "generated-images"; key: string; events: AiEvent[] }
  | { type: "commentary"; key: string; events: AiEvent[] }
  | { type: "reasoning"; key: string; events: AiEvent[] }
  | { type: "work"; key: string; planEvents: AiEvent[]; todoEvents: AiEvent[] }
  | { type: "subtask"; key: string; events: AiEvent[] }
  | { type: "technical"; key: string; event: AiEvent }
  | { type: "tool"; key: string; events: AiEvent[] }
  | { type: "approval"; key: string; events: AiEvent[] }
  | { type: "changes"; key: string; event: AiEvent }
  | { type: "error"; key: string; event: AiEvent }
  | { type: "risk"; key: string; event: AiEvent };

export type TimelineItem =
  | { type: "event"; event: AiEvent }
  | { type: "step"; key: string; run: AiRun; step: TraceStep };

export type AssistantPhase = "commentary" | "final" | "unknown";

export type ToolCategory = "command" | "search" | "read" | "write" | "network" | "skill" | "generic";

export function traceStepEvents(step: TraceStep): AiEvent[] {
  if ("events" in step) return step.events;
  if (step.type === "work") return [...step.planEvents, ...step.todoEvents].sort((a, b) => a.seq - b.seq);
  return [step.event];
}

export function technicalEventText(event: AiEvent): string {
  if (event.kind === "system") {
    const text = scalar(event.payload.text) || scalar(event.payload.message);
    if (text) return text;
    const description = scalar(event.payload.summary) || scalar(event.payload.description) || scalar(event.payload.taskType);
    const state = scalar(event.payload.status) || scalar(event.payload.state);
    return [description, state].filter(Boolean).join(" Â· ") || eventsMsg.systemEvent;
  }
  const state = String(event.payload.state || event.payload.status || eventsMsg.statusUpdate);
  return state === "completed" ? eventsMsg.completed : state === "running" ? statusMsg.running : state === "cancelled" ? eventsMsg.cancelled : state;
}

/**
 * Todo UI is provider-driven. Task/subagent lifecycle events are execution
 * details, not a user-facing Todo list, so only the providers' native Todo
 * notifications are allowed through.
 */
export function isProviderTodoEvent(event: AiEvent): boolean {
  if (event.kind !== "todo") return false;
  if (event.provider === "claude") return event.payload.sourceTool === "TodoWrite";
  return event.provider === "codex" && event.payload.sourceEvent === "turn/plan/updated";
}

/** Provider task lifecycle messages are process activity, never Todo items. */
export function isSubtaskSystemEvent(event: AiEvent): boolean {
  if (event.kind !== "system") return false;
  if (event.payload.semanticType === "subtask") return true;
  return ["task_started", "task_updated", "task_notification"].includes(String(event.payload.subtype || ""));
}

/** Hide provider plumbing while retaining milestones and warnings users can act on. */
export function isUserVisibleSystemEvent(event: AiEvent): boolean {
  if (event.kind !== "system") return false;
  if (isSubtaskSystemEvent(event)) return true;
  const subtype = String(event.payload.subtype || "");
  if (["init", "interaction_mode", "status"].includes(subtype)) return false;
  if (["compact_boundary", "context_compacted"].includes(subtype)) return true;
  const text = scalar(event.payload.text) || scalar(event.payload.message);
  if (/initialized|初始化/i.test(text)) return false;
  return Boolean(text);
}

/**
 * Resolve provider message phases without guessing that the latest live text
 * is an answer. Explicit provider finals win; an unphased message is promoted
 * only as a compatibility fallback after a successful terminal lifecycle.
 */
export function selectRenderableTimelineEvents(events: AiEvent[], runs: AiRun[]): AiEvent[] {
  const runById = new Map(runs.map((run) => [run.id, run]));
  const eventRunIds = new Set<string>();
  const latestStatusByRun = new Map<string, string>();
  const explicitFinalIdByRun = new Map<string, string>();
  const unknownMessageIdByRun = new Map<string, string>();

  for (const event of events) {
    eventRunIds.add(event.runId);
    if (event.kind === "status") {
      const status = scalar(event.payload.state) || scalar(event.payload.status);
      if (status) latestStatusByRun.set(event.runId, status);
    }
    if (event.kind === "error") latestStatusByRun.set(event.runId, "failed");
    if (event.kind !== "assistant-message") continue;
    const phase = assistantPhase(event);
    if (phase === "final") explicitFinalIdByRun.set(event.runId, event.id);
    else if (phase === "unknown") unknownMessageIdByRun.set(event.runId, event.id);
  }

  const authoritativeFinalIdByRun = new Map<string, string>();
  for (const runId of eventRunIds) {
    const status = runById.get(runId)?.status || latestStatusByRun.get(runId);
    const finalId = status === "completed"
      ? explicitFinalIdByRun.get(runId) || unknownMessageIdByRun.get(runId)
      : status === undefined && !runById.has(runId)
        ? explicitFinalIdByRun.get(runId)
        : undefined;
    if (finalId) authoritativeFinalIdByRun.set(runId, finalId);
  }

  return events.map((event) => {
    if (event.kind !== "assistant-message") return event;
    const phase = authoritativeFinalIdByRun.get(event.runId) === event.id ? "final" : "commentary";
    if (assistantPhase(event) === phase) return event;
    return { ...event, payload: { ...event.payload, phase } };
  });
}

export function groupTimeline(events: AiEvent[], runs: AiRun[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  const runById = new Map(runs.map((run) => [run.id, run]));
  const runStartedAt = new Map(runs.map((run) => [run.id, run.startedAt]));
  const firstEventAt = new Map<string, string>();
  const eventsByRun = new Map<string, AiEvent[]>();
  const unorderedRuns = new Set<string>();

  for (const event of selectRenderableTimelineEvents(events, runs)) {
    if (event.kind === "reasoning-delta") continue;
    const firstTimestamp = firstEventAt.get(event.runId);
    if (!firstTimestamp || event.timestamp < firstTimestamp) firstEventAt.set(event.runId, event.timestamp);
    const runEvents = eventsByRun.get(event.runId);
    if (runEvents) {
      if ((runEvents.at(-1)?.seq || 0) > event.seq) unorderedRuns.add(event.runId);
      runEvents.push(event);
    } else {
      eventsByRun.set(event.runId, [event]);
    }
  }

  const runOrder = [...eventsByRun.keys()].sort((a, b) => {
    const aStartedAt = runStartedAt.get(a) || firstEventAt.get(a) || "";
    const bStartedAt = runStartedAt.get(b) || firstEventAt.get(b) || "";
    return aStartedAt.localeCompare(bStartedAt) || a.localeCompare(b);
  });

  for (const runId of runOrder) {
    const bucket = eventsByRun.get(runId) || [];
    const runEvents = unorderedRuns.has(runId) ? bucket.slice().sort((a, b) => a.seq - b.seq) : bucket;
    const run = runById.get(runId);
    if (!run) {
      for (const event of runEvents) if (orphanEventVisible(event)) result.push({ type: "event", event });
      continue;
    }
    const { steps } = buildTraceSteps(runEvents);
    const anchorStepByEvent = new Map<string, TraceStep>();
    const groupedEvents = new Set<string>();
    for (const step of steps) {
      const stepEvents = traceStepEvents(step);
      // Plan/Todo notifications are snapshots that can be refreshed across
      // several reasoning cycles. Render their merged state where the latest
      // update happened, rather than pulling it back to the first stale plan.
      const anchor = step.type === "work" ? stepEvents.at(-1) : stepEvents[0];
      if (anchor) anchorStepByEvent.set(anchor.id, step);
      for (const event of stepEvents) groupedEvents.add(event.id);
    }

    for (const event of runEvents) {
      if (event.kind === "usage" || event.kind === "status") continue;
      if (event.kind === "system" && !isUserVisibleSystemEvent(event)) continue;
      if (isConversationEvent(event)) {
        result.push({ type: "event", event });
        continue;
      }
      const step = anchorStepByEvent.get(event.id);
      if (step) {
        result.push({ type: "step", key: step.key, run, step });
        continue;
      }
      if (groupedEvents.has(event.id)) continue;
    }
  }
  return result;
}

export function assistantPhase(event: AiEvent): AssistantPhase {
  const phase = String(event.payload.phase || event.payload.messagePhase || "").toLocaleLowerCase();
  if (["commentary", "progress", "intermediate", "analysis"].includes(phase)) return "commentary";
  if (["final", "final_answer", "final-answer"].includes(phase)) return "final";
  return "unknown";
}

export function buildTraceSteps(events: AiEvent[]): { steps: TraceStep[]; technicalEvents: AiEvent[] } {
  const steps: TraceStep[] = [];
  const technicalEvents: AiEvent[] = [];
  const tools = new Map<string, Extract<TraceStep, { type: "tool" }>>();
  const approvals = new Map<string, Extract<TraceStep, { type: "approval" }>>();
  const subtasks = new Map<string, Extract<TraceStep, { type: "subtask" }>>();
  let reasoningIndex = 0;
  let commentaryIndex = 0;
  let previousWasReasoning = false;
  const workEvents = events
    .filter((event) => event.kind === "plan" || isProviderTodoEvent(event))
    .sort((left, right) => left.seq - right.seq || left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
  const latestWorkEvent = workEvents.at(-1);

  for (const event of events.slice().sort((a, b) => a.seq - b.seq)) {
    if (isConversationEvent(event) || event.kind === "usage") {
      previousWasReasoning = false;
      continue;
    }
    if (isProcessCommentaryEvent(event)) {
      const previous = steps.at(-1);
      if (previous?.type === "commentary") previous.events.push(event);
      else steps.push({ type: "commentary", key: `commentary:${event.runId}:${commentaryIndex++}`, events: [event] });
      previousWasReasoning = false;
      continue;
    }
    if (event.kind === "image-artifact") {
      const previous = steps.at(-1);
      if (previous?.type === "generated-images") previous.events.push(event);
      else steps.push({ type: "generated-images", key: `generated-images:${event.id}`, events: [event] });
      previousWasReasoning = false;
      continue;
    }
    if (event.kind === "reasoning-summary") {
      const previous = steps.at(-1);
      if (previousWasReasoning && previous?.type === "reasoning") {
        const previousText = String(previous.events.at(-1)?.payload.text || "").trim();
        const nextText = String(event.payload.text || "").trim();
        // Older Claude sessions may contain both the streamed and durable copy
        // of the same thinking block. Keep one copy in the visible trace.
        if (previousText !== nextText) previous.events.push(event);
      } else {
        steps.push({ type: "reasoning", key: `reasoning:${event.runId}:${reasoningIndex++}`, events: [event] });
      }
      previousWasReasoning = true;
      continue;
    }
    previousWasReasoning = false;
    if (event.id === latestWorkEvent?.id) {
      steps.push({
        type: "work",
        key: `work:${event.runId}`,
        planEvents: workEvents.filter((candidate) => candidate.kind === "plan"),
        todoEvents: workEvents.filter((candidate) => candidate.kind === "todo")
      });
      continue;
    }
    if (event.kind === "plan" || event.kind === "todo") continue;
    if (isSubtaskSystemEvent(event)) {
      const identity = String(event.payload.taskId || event.payload.toolUseId || event.id);
      const existing = subtasks.get(identity);
      if (existing) existing.events.push(event);
      else {
        const step: Extract<TraceStep, { type: "subtask" }> = { type: "subtask", key: `subtask:${event.runId}:${identity}`, events: [event] };
        subtasks.set(identity, step);
        steps.push(step);
      }
      continue;
    }
    if (["tool-start", "tool-output", "tool-complete"].includes(event.kind)) {
      const identity = toolEventIdentity(event);
      const existing = tools.get(identity);
      if (existing) existing.events.push(event);
      else {
        const step: Extract<TraceStep, { type: "tool" }> = { type: "tool", key: `tool:${event.runId}:${identity}`, events: [event] };
        tools.set(identity, step);
        steps.push(step);
      }
      continue;
    }
    if (event.kind === "approval-request" || event.kind === "approval-decision") {
      const identity = approvalEventIdentity(event);
      const existing = approvals.get(identity);
      if (existing) existing.events.push(event);
      else {
        const step: Extract<TraceStep, { type: "approval" }> = { type: "approval", key: `approval:${event.runId}:${identity}`, events: [event] };
        approvals.set(identity, step);
        steps.push(step);
      }
      continue;
    }
    if (event.kind === "changes") {
      steps.push({ type: "changes", key: `changes:${event.id}`, event });
      continue;
    }
    if (event.kind === "error") {
      steps.push({ type: "error", key: `error:${event.id}`, event });
      continue;
    }
    if (event.kind === "risk") {
      steps.push({ type: "risk", key: `risk:${event.id}`, event });
      continue;
    }
    if (event.kind === "system" || event.kind === "status") {
      technicalEvents.push(event);
      if (isUserVisibleSystemEvent(event)) steps.push({ type: "technical", key: `technical:${event.id}`, event });
    }
  }
  return { steps, technicalEvents };
}

function isConversationEvent(event: AiEvent): boolean {
  return event.kind === "user-message" || (event.kind === "assistant-message" && assistantPhase(event) === "final");
}

function isProcessCommentaryEvent(event: AiEvent): boolean {
  return event.kind === "assistant-delta"
    || (event.kind === "assistant-message" && assistantPhase(event) !== "final");
}

function orphanEventVisible(event: AiEvent): boolean {
  if (["usage", "status", "reasoning-delta"].includes(event.kind)) return false;
  if (event.kind === "assistant-delta") return false;
  if (event.kind === "assistant-message") return assistantPhase(event) === "final";
  if (event.kind === "system") return isUserVisibleSystemEvent(event);
  if (event.kind === "todo") return isProviderTodoEvent(event);
  return event.kind !== "tool-output";
}

export function compactEvents(events: AiEvent[], activeRunId?: string, eventBudget = 80): AiEvent[] {
  const useful = events.filter((event) => {
    if (event.kind === "usage" || event.kind === "reasoning-delta") return false;
    if (event.kind === "assistant-delta") return event.runId === activeRunId;
    if (event.runId === activeRunId) return true;
    return [
      "user-message",
      "image-artifact",
      "assistant-message",
      "reasoning-summary",
      "plan",
      "todo",
      "tool-start",
      "tool-complete",
      "approval-request",
      "approval-decision",
      "changes",
      "risk",
      "error",
      "system",
      "status"
    ].includes(event.kind);
  });
  return selectRecentTurnEvents(useful, eventBudget);
}

export function firstLine(value: string): string {
  return value.split(/\r?\n/)[0].slice(0, 180);
}

export function toolValueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) || String(value ?? "");
}

export function toolCategory(tool: string): ToolCategory {
  const normalized = tool.toLocaleLowerCase();
  if (normalized.endsWith("openmind_generate_image")) return "generic";
  if (/(write|edit|patch|replace|create|delete|move|rename|filechange)/.test(normalized)) return "write";
  if (/(glob|grep|search|find|list|scan)/.test(normalized)) return "search";
  if (/(read|view|inspect|open)/.test(normalized)) return "read";
  if (/(bash|shell|command|terminal|exec|powershell)/.test(normalized)) return "command";
  if (/(web|fetch|http|browser|network)/.test(normalized)) return "network";
  if (normalized.includes("skill")) return "skill";
  return "generic";
}

export function toolCategoryLabel(category: ToolCategory): string {
  return toolMsg.category[category === "generic" ? "tool" : category];
}

export function toolOperationSummary(tool: string, value: unknown): string {
  if (typeof value === "string") return firstLine(value);
  const input = asRecord(value);
  const normalized = tool.toLocaleLowerCase();
  const command = scalar(input.command);
  const path = scalar(input.file_path || input.filePath || input.path || input.cwd);
  const pattern = scalar(input.pattern || input.glob || input.query);
  const url = scalar(input.url);

  if (normalized.includes("bash") || normalized.includes("shell") || normalized.includes("command")) {
    return firstLine(command || firstScalar(input) || toolMsg.viewCommandDetail);
  }
  if (normalized.includes("glob") || normalized.includes("grep") || normalized.includes("search")) {
    return [pattern, path].filter(Boolean).join(" · ") || firstScalar(input) || toolMsg.viewSearchDetail;
  }
  if (/(read|write|edit|file)/.test(normalized)) {
    return path || firstScalar(input) || toolMsg.viewFileDetail;
  }
  if (normalized.includes("web")) {
    return pattern || url || firstScalar(input) || toolMsg.viewNetworkDetail;
  }
  return firstLine(firstScalar(input) || toolMsg.viewCallDetail);
}

export function scalar(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function firstScalar(value: Record<string, unknown>): string {
  return Object.values(value).map(scalar).find(Boolean) || "";
}

export function toolEventIdentity(event: AiEvent): string {
  const item = asRecord(event.payload.item);
  return String(event.payload.itemId || item.id || event.payload.invocationId || event.payload.skillId || event.payload.tool || event.id);
}

function approvalEventIdentity(event: AiEvent): string {
  const approval = asRecord(event.payload.approval);
  return String(event.payload.approvalId || approval.id || event.payload.providerRequestId || event.id);
}

export function toolEventFailed(event: AiEvent): boolean {
  return event.kind === "error"
    || event.payload.state === "failed"
    || event.payload.isError === true
    || event.payload.is_error === true;
}

export function changePaths(run: AiRun, events: AiEvent[]): string[] {
  const paths = new Set(run.changeSet?.files.map((file) => file.path) || []);
  for (const event of events) {
    if (event.kind === "tool-start") {
      const tool = String(event.payload.tool || "");
      if (toolCategory(tool) !== "write") continue;
      const input = asRecord(event.payload.input || event.payload);
      const path = scalar(input.file_path || input.filePath || input.path);
      if (path) paths.add(path);
      continue;
    }
    if (event.kind !== "changes") continue;
    collectPaths(event.payload.files, paths);
    collectPaths(asRecord(event.payload.changeSet).files, paths);
    collectPaths(event.payload.changes, paths);
    collectUnifiedDiffPaths(scalar(event.payload.diff || event.payload.patch), paths);
  }
  return [...paths];
}

function collectPaths(value: unknown, paths: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") paths.add(item);
    else {
      const record = asRecord(item);
      const path = scalar(record.path || record.file_path || record.filePath);
      if (path) paths.add(path);
    }
  }
}

function collectUnifiedDiffPaths(patch: string, paths: Set<string>): void {
  if (!patch) return;
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) continue;
    const path = match[2] === "/dev/null" ? match[1] : match[2];
    if (path && path !== "/dev/null") paths.add(path.replace(/^"|"$/g, ""));
  }
}
