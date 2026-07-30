import { useMemo, useState, type ReactNode } from "react";
import { Archive, CheckCircle2, CircleX, LoaderCircle, Redo2, ShieldAlert, Users, Wrench } from "lucide-react";
import type { AiEvent, RunStatus } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { formatDateTime } from "../../ai-utils";
import { useAi } from "../../ai-context";
import { OverflowBox } from "../../design-system/OverflowBox";
import { CopyButton } from "./message";
import { firstLine, technicalEventText } from "./timeline";
import { ConversationCell } from "./conversation-cell";

export function SystemEvent({ text, icon, danger = false }: { text: string; icon: ReactNode; danger?: boolean }) {
  return (
    <ConversationCell
      tone={danger ? "error" : "system"}
      icon={icon}
      label={danger ? "Risk" : "System"}
      title={danger ? m.ai.events.riskTitle : m.ai.events.systemTitle}
      subtitle={text}
      status={danger ? "risk" : "info"}
      statusTone={danger ? "danger" : "muted"}
      className={`system-event ${danger ? "danger" : ""}`}
    />
  );
}

/** A quiet process milestone, used only for user-relevant system events. */
export function ProcessSystemEvent({ event }: { event: AiEvent }) {
  const subtype = String(event.payload.subtype || "");
  const semanticType = String(event.payload.semanticType || "");
  const compacted = semanticType === "context_compaction" || ["compact_boundary", "context_compacted"].includes(subtype);
  const text = compacted
    ? m.ai.events.contextCompacted
    : String(event.payload.text || event.payload.message || m.ai.events.systemWarning);
  return (
    <div className={`process-system-event${compacted ? " compacted" : " warning"}`} role="status">
      <span aria-hidden="true">{compacted ? <Archive size={14} /> : <ShieldAlert size={14} />}</span>
      <p>{text}</p>
    </div>
  );
}

/**
 * Provider-neutral background task/subagent trace. Both Claude Code SDK task
 * lifecycle notifications and Codex collaboration items normalize into this
 * component; neither source is presented as a user-authored Todo.
 */
export function SubtaskTrace({ events, runStatus }: { events: AiEvent[]; runStatus?: RunStatus }) {
  if (!events.length) return null;
  const first = events[0];
  const last = events.at(-1) || first;
  const payloads = events.map((event) => event.payload);
  const title = lastNonEmpty(payloads.map((payload) => stringValue(payload.summary)))
    || payloads.map((payload) => stringValue(payload.description)).find(Boolean)
    || firstLine(stringValue(first.payload.prompt) || stringValue(first.payload.tool) || m.ai.events.subtaskFallback);
  const agentCount = codexAgentCount(last.payload.agentsStates);
  const state = subtaskState(last, agentCount, runStatus);
  const statusText = state === "completed"
    ? m.ai.events.subtaskCompleted
    : state === "failed"
      ? m.ai.events.subtaskFailed
      : state === "cancelled"
        ? m.ai.events.subtaskCancelled
        : state === "started"
          ? m.ai.events.subtaskStarted
          : m.ai.events.subtaskUpdated;
  return (
    <div className={`subtask-trace ${state}`} role="status" aria-label={`${title} ${statusText}`}>
      <span className="subtask-trace-icon" aria-hidden="true">{subtaskIcon(state)}</span>
      <span className="subtask-trace-title" title={title}>{title}</span>
      {agentCount ? <small>{m.ai.events.subtaskAgents(agentCount)}</small> : null}
      <em>{statusText}</em>
    </div>
  );
}

type SubtaskState = "started" | "updated" | "completed" | "failed" | "cancelled";

function subtaskState(event: AiEvent, agentCount: number, runStatus?: RunStatus): SubtaskState {
  const subtype = String(event.payload.subtype || "").toLocaleLowerCase();
  const status = String(event.payload.status || "").toLocaleLowerCase();
  const agentStatuses = codexAgentStatuses(event.payload.agentsStates);
  if (
    /(fail|error|notfound|not_found)/.test(status)
    || agentStatuses.some((value) => /(fail|error|notfound|not_found)/.test(value))
  ) return "failed";
  if (
    /(cancel|interrupt|shutdown)/.test(status)
    || agentStatuses.some((value) => /(cancel|interrupt|shutdown)/.test(value))
  ) return "cancelled";
  if (
    subtype.includes("completed")
    || status === "completed"
    || (agentCount > 0 && agentStatuses.length === agentCount && agentStatuses.every(isTerminalAgentStatus))
  ) return "completed";
  // Some providers stop emitting subtask lifecycle events when their parent
  // run is terminated. Treat the parent terminal state as the upper bound so
  // an orphaned "started"/"updated" row cannot keep spinning forever.
  if (runStatus === "cancelled") return "cancelled";
  if (runStatus === "failed" || runStatus === "conflicted") return "failed";
  if (runStatus === "completed") return "completed";
  if (subtype.includes("started")) return "started";
  return "updated";
}

function subtaskIcon(state: SubtaskState): ReactNode {
  if (state === "completed") return <CheckCircle2 size={14} />;
  if (state === "failed" || state === "cancelled") return <CircleX size={14} />;
  if (state === "started" || state === "updated") return <LoaderCircle className="spin" size={14} />;
  return <Users size={14} />;
}

function codexAgentCount(value: unknown): number {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;
}

function codexAgentStatuses(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "";
    return String((item as Record<string, unknown>).status || "").toLocaleLowerCase();
  }).filter(Boolean);
}

function isTerminalAgentStatus(value: string): boolean {
  return [
    "completed",
    "failed",
    "errored",
    "cancelled",
    "canceled",
    "interrupted",
    "closed",
    "shutdown",
    "notfound",
    "not_found"
  ].includes(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function lastNonEmpty(values: string[]): string {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index]) return values[index];
  }
  return "";
}

export function ErrorEvent({ event }: { event: AiEvent }) {
  const ai = useAi();
  const text = String(event.payload.text || m.ai.events.runFailed);
  const [busy, setBusy] = useState(false);
  const searchLines = useMemo(() => text.split(/\r?\n/), [text]);
  const retry = async () => {
    setBusy(true);
    try { await ai.rerun(event.runId); } catch { /* controller shows the error */ } finally { setBusy(false); }
  };
  return (
    <ConversationCell
      tone="error"
      icon={<ShieldAlert size={15} />}
      label="Error"
      title={m.ai.events.runFailed}
      subtitle={firstLine(text)}
      status="failed"
      statusTone="danger"
      className="error-event has-stripe"
      collapsible
      defaultOpen
    >
      {/* P2-EVT-1: 错误内容用 OverflowBox 限高 + 搜索;红色 stripe 由 CSS 处理 */}
      <OverflowBox className="error-event-overflow" maxHeight={300} searchable lines={searchLines}>
        <pre>{text}</pre>
      </OverflowBox>
      <footer><CopyButton text={text} /><button data-motion="action" onClick={() => void window.cctools.openPath(runRecordPath(ai.snapshot.projectRoot, event))}>{m.ai.events.openRunRecord}</button><button data-motion="action" disabled={busy} onClick={() => void retry()}><Redo2 size={13} />{m.ai.events.retry}</button></footer>
    </ConversationCell>
  );
}

export function TechnicalEventGroup({ events }: { events: AiEvent[] }) {
  return (
    <ConversationCell
      tone="system"
      icon={<Wrench size={15} />}
      label="System"
      title={m.ai.events.runDetail}
      subtitle={m.ai.events.runDetailSubtitle}
      status={events.length}
      statusTone="muted"
      className="technical-events"
      collapsible
    >
        <div>
          {events.map((event) => (
            <article key={event.id}>
              <span>{event.kind === "system" ? m.ai.events.system : m.ai.events.status}</span>
              <p>{technicalEventText(event)}</p>
              <time>{formatDateTime(event.timestamp)}</time>
            </article>
          ))}
        </div>
    </ConversationCell>
  );
}

function runRecordPath(projectRoot: string, event: AiEvent): string {
  const separator = projectRoot.includes("\\") ? "\\" : "/";
  return `${projectRoot.replace(/[\\/]$/, "")}${separator}.cctools${separator}ai${separator}sessions${separator}${event.sessionId}${separator}runs${separator}${event.runId}`;
}
