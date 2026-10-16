import { useLocale } from "../../i18n";
import { useState } from "react";
import { Check, ChevronRight, Circle, ListChecks, LoaderCircle, Route } from "lucide-react";
import type { AiEvent } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { asRecord, isProviderTodoEvent, scalar } from "./timeline";

type PlanItem = {
  id: string;
  text: string;
  status: "pending" | "in-progress" | "completed";
};

/** Keep only the active run's provider-native Todo history in protocol order. */
export function selectRunTodoEvents(events: AiEvent[], runId: string | null): AiEvent[] {
  if (!runId) return [];
  return events
    .filter((event) => event.runId === runId && isProviderTodoEvent(event))
    .sort((left, right) => left.seq - right.seq || left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
}

export function ActiveTodoFloat({ events, active }: { events: AiEvent[]; active: boolean }) {
  useLocale();
  const items = projectTodoItems(events);
  const incomplete = items.some((item) => item.status !== "completed");
  const presence = useExitPresence(active && items.length > 0 && incomplete, 160);
  if (!presence.visible || !items.length) return null;
  const inProgressIndex = items.findIndex((item) => item.status === "in-progress");
  const currentIndex = Math.max(0, inProgressIndex >= 0
    ? inProgressIndex
    : items.findIndex((item) => item.status === "pending"));
  return (
    <aside
      className="active-todo-float"
      data-leaving={presence.leaving || undefined}
      aria-label={m.ai.plan.liveAria}
      aria-live="polite"
    >
      <div className="active-todo-panel">
        <ol>
          {items.map((item) => (
            <li key={item.id} className={item.status} aria-label={todoAriaLabel(item)}>
              <span aria-hidden="true">{todoIcon(item.status)}</span>
              <p>{todoDisplayText(item)}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="active-todo-progress" role="status">
        <LoaderCircle className="spin" size={13} aria-hidden="true" />
        <span>{m.ai.plan.stepProgress(currentIndex + 1, items.length)}</span>
      </div>
    </aside>
  );
}

export function WorkStateCard({ planEvents, todoEvents }: { planEvents: AiEvent[]; todoEvents: AiEvent[] }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const planEvent = planEvents.at(-1);
  const planText = String(planEvent?.payload.text || "").trim();
  const items = projectTodoItems(todoEvents);
  if (!planText && !items.length) return null;
  const provider = planEvent?.provider || todoEvents.at(-1)?.provider;
  const source = provider === "claude" ? m.ai.plan.sourceClaude : m.ai.plan.sourceCodex;
  const title = planText && items.length ? m.ai.plan.historyTitle : planText ? m.ai.plan.title : m.ai.plan.todoTitle;
  const detail = planSummary(planText) || items[0]?.text || "";
  return (
    <AnimatedDisclosure
      className="work-state-card"
      open={open}
      onOpenChange={setOpen}
      triggerAriaLabel={`${title}，${open ? m.ai.plan.collapse : m.ai.plan.expand}`}
      summary={(
        <>
          <span className="work-state-icon" aria-hidden="true"><ListChecks size={15} /></span>
          <span className="work-state-title"><strong>{title}</strong>{detail ? <small title={detail}>{detail}</small> : null}</span>
          <span className="work-state-meta">
            <small>{source}</small>
            {items.length ? <em>{todoSummary(items)}</em> : null}
            <ChevronRight size={14} aria-hidden="true" />
          </span>
        </>
      )}
    >
      <section className="work-state-body" aria-label={m.ai.plan.aria}>
        {planText ? (
          <div className="work-plan-section">
            <header><Route size={15} /><strong>{m.ai.plan.title}</strong></header>
            <pre>{planText}</pre>
          </div>
        ) : null}
        {items.length ? (
          <div className="work-todo-section">
            <header><ListChecks size={15} /><strong>{m.ai.plan.todoTitle}</strong><small>{todoSummary(items)}</small></header>
            <ol>
              {items.map((item) => (
                <li key={item.id} className={item.status} aria-label={todoAriaLabel(item)}>
                  <span aria-hidden="true">{todoIcon(item.status)}</span>
                  <p>{todoDisplayText(item)}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
    </AnimatedDisclosure>
  );
}

export function PlanCard({ events }: { events: AiEvent[] }) {
  useLocale();
  const items = extractPlanItems(events);
  if (!items.length) return null;
  return (
    <ol className="plan-card" aria-label={m.ai.plan.aria}>
      {items.map((item) => (
        <li key={item.id} className={item.status}>
          <span aria-hidden="true" />
          <p>{item.text}</p>
          <em>{planStatusLabel(item.status)}</em>
        </li>
      ))}
    </ol>
  );
}

function planStatusLabel(status: PlanItem["status"]): string {
  return status === "completed" ? m.ai.plan.completed : status === "in-progress" ? m.ai.plan.inProgress : m.ai.plan.pending;
}

function extractPlanItems(events: AiEvent[]): PlanItem[] {
  const latest = events
    .map((event) => event.payload.plan || event.payload.steps)
    .filter(Array.isArray)
    .at(-1);
  if (!Array.isArray(latest)) return [];
  return latest
    .map((item, index): PlanItem | null => {
      const record = asRecord(item);
      const text = typeof item === "string" ? item : scalar(record.text || record.step || record.title || record.description);
      if (!text) return null;
      const rawStatus = scalar(record.status || record.state).toLocaleLowerCase();
      const status = rawStatus.includes("complete") || rawStatus === "done"
        ? "completed"
        : rawStatus.includes("progress") || rawStatus === "current" || rawStatus === "active"
          ? "in-progress"
          : "pending";
      return { id: scalar(record.id) || `${index}:${text}`, text, status };
    })
    .filter((item): item is PlanItem => Boolean(item));
}

export type TodoItem = PlanItem & { activeForm?: string };

export function projectTodoItems(events: AiEvent[]): TodoItem[] {
  const state = new Map<string, TodoItem>();
  for (const event of events.filter(isProviderTodoEvent)) {
    if (Array.isArray(event.payload.items)) {
      state.clear();
      for (const [index, raw] of event.payload.items.entries()) {
        const item = normalizeTodoItem(raw, index);
        if (item) state.set(item.id, item);
      }
      continue;
    }
    const rawItem = asRecord(event.payload.item);
    const item = normalizeTodoItem(event.payload.item, state.size);
    if (!item) continue;
    if (event.payload.operation === "delete") state.delete(item.id);
    else {
      const previous = state.get(item.id);
      state.set(item.id, {
        id: item.id,
        text: item.text || previous?.text || item.id,
        status: scalar(rawItem.status) ? item.status : previous?.status || "pending",
        activeForm: item.activeForm || previous?.activeForm
      });
    }
  }
  return [...state.values()];
}

function normalizeTodoItem(raw: unknown, index: number): TodoItem | null {
  const record = asRecord(raw);
  const text = scalar(record.text || record.subject || record.content || record.description);
  const id = scalar(record.id) || `${index}:${text}`;
  if (!id) return null;
  const status = normalizeStatus(scalar(record.status));
  return { id, text, status, activeForm: scalar(record.activeForm) || undefined };
}

function normalizeStatus(rawStatus: string): PlanItem["status"] {
  const status = rawStatus.toLocaleLowerCase();
  if (status.includes("complete") || status === "done") return "completed";
  if (status.includes("progress") || status === "current" || status === "active" || status === "running") return "in-progress";
  return "pending";
}

function todoIcon(status: PlanItem["status"]) {
  if (status === "completed") return <Check size={12} />;
  if (status === "in-progress") return <LoaderCircle className="spin" size={12} />;
  return <Circle size={10} />;
}

function todoSummary(items: TodoItem[]): string {
  return `${items.filter((item) => item.status === "completed").length}/${items.length}`;
}

function todoDisplayText(item: TodoItem): string {
  return item.status === "in-progress" && item.activeForm ? item.activeForm : item.text;
}

function todoAriaLabel(item: TodoItem): string {
  return `${todoDisplayText(item)}，${planStatusLabel(item.status)}`;
}

function planSummary(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/, "").trim())
    .find(Boolean) || "";
}
