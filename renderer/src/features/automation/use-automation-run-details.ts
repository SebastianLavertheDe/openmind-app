import { useEffect, useRef, useState } from "react";
import type { BrokerRunEvent, BrokerRunRecord, WorkflowRunRecord } from "@shared/execution-contracts";

export type WorkflowStepDetails = { step: WorkflowRunRecord["stepRuns"][number]; child: BrokerRunRecord | null; events: BrokerRunEvent[] };
type Details = { childRun: BrokerRunRecord | null; childEvents: BrokerRunEvent[]; workflowRun: WorkflowRunRecord | null; workflowSteps: WorkflowStepDetails[] };
type CachedRun = { child: BrokerRunRecord | null; events: BrokerRunEvent[]; after: number; more: boolean; complete: boolean };
const emptyDetails = (): Details => ({ childRun: null, childEvents: [], workflowRun: null, workflowSteps: [] });
const active = (state: string | undefined) => ["queued", "inspecting", "waiting_execution_consent", "preparing_runtime", "running", "cancelling"].includes(state || "");
const visible = () => document.visibilityState !== "hidden";

/** One in-flight refresh, visible windows only, and immutable completed steps. */
export function useAutomationRunDetails(runId: string | null | undefined, targetType: "skill" | "workflow" | undefined, onTerminal: () => Promise<void>, activity?: BrokerRunEvent | null): Details {
  const [details, setDetails] = useState<Details>(emptyDetails);
  const resume = useRef<((event: BrokerRunEvent) => void) | null>(null);
  useEffect(() => {
    setDetails(emptyDetails());
    if (!runId) return;
    let disposed = false, pending = false, finished = false, notifiedTerminal = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cache = new Map<string, CachedRun>();
    const readSkill = async (id: string): Promise<CachedRun> => {
      const previous = cache.get(id);
      if (previous?.complete) return previous;
      const child = await window.openmind.getSkillRun(id);
      // The console retains a bounded recent window; do not replay a large
      // finished run from its beginning just to discard most of its history.
      const after = previous?.after ?? Math.max(-1, (child.sequence ?? 0) - 800);
      const page = window.openmind.getSkillRunEventsPage
        ? await window.openmind.getSkillRunEventsPage(id, { after, limit: 200 })
        : previous ? { events: [], nextAfter: null } : { events: await window.openmind.getSkillRunEvents(id), nextAfter: null };
      const bySequence = new Map((previous?.events || []).map(event => [event.sequence, event]));
      for (const event of page.events) bySequence.set(event.sequence, event);
      const next: CachedRun = { child, events: [...bySequence.values()].slice(-800), after: page.events.at(-1)?.sequence ?? after, more: page.nextAfter !== null, complete: !active(child.state) && page.nextAfter === null };
      cache.set(id, next);
      return next;
    };
    const refresh = async () => {
      if (disposed || pending || finished || !visible()) return;
      clearTimeout(timer);
      pending = true;
      let more = false;
      let retryChildren = false;
      try {
        if (targetType === "skill") {
          const run = await readSkill(runId);
          if (disposed) return;
          setDetails({ ...emptyDetails(), childRun: run.child, childEvents: run.events });
          more = run.more;
          finished = run.complete;
        } else {
          const workflow = await window.openmind.getWorkflowRun(runId);
          if (disposed) return;
          const steps: WorkflowStepDetails[] = [];
          let existingRuns: Promise<Set<string> | null> | undefined;
          for (const step of workflow.stepRuns) {
            if (disposed) return;
            let run: CachedRun | null = null;
            if (step.runId) {
              try { run = await readSkill(step.runId); }
              catch {
                // A completed child can be deleted independently of its
                // workflow. Confirm absence without parsing IPC error text;
                // share one exceptional-path lookup across all failed steps.
                existingRuns ||= Promise.resolve().then(() => window.openmind.listSkillRuns()).then(
                  records => new Set(records.map(record => record.id)), () => null
                );
                const existing = await existingRuns;
                if (disposed) return;
                const previous = cache.get(step.runId);
                if (existing && !existing.has(step.runId)) {
                  run = { child: null, events: previous?.events || [], after: previous?.after ?? -1, more: false, complete: true };
                  cache.set(step.runId, run);
                } else {
                  // Keep successful steps visible while a transient failure
                  // retries, including after the workflow itself has ended.
                  run = previous || null;
                  retryChildren = true;
                }
              }
            }
            more ||= Boolean(run?.more);
            steps.push({ step, child: run?.child || null, events: run?.events || [] });
          }
          if (disposed) return;
          setDetails({ ...emptyDetails(), workflowRun: workflow, workflowSteps: steps });
          finished = !active(workflow.state) && !more && !retryChildren;
        }
        if (!finished) notifiedTerminal = false;
        if (finished && !notifiedTerminal) { notifiedTerminal = true; void onTerminal(); }
      } catch {
        // Keep the last successful details; retry a transient IPC failure.
      } finally {
        pending = false;
        if (!disposed && !finished && visible()) timer = setTimeout(() => void refresh(), more && !retryChildren ? 100 : 1000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (visible()) void refresh();
    };
    resume.current = event => {
      if (!active(event.state) || event.stream === "stdout" || event.stream === "stderr") return;
      const cached = cache.get(event.runId);
      if (cached?.complete) cached.complete = false;
      // Workflow resume can create a new child ID. A state transition only
      // probes its metadata once; ordinary output events never restart polling.
      if (event.runId === runId || cached || finished && targetType === "workflow") {
        finished = false;
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    void refresh();
    return () => { disposed = true; resume.current = null; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [runId, targetType, onTerminal]);
  useEffect(() => { if (activity) resume.current?.(activity); }, [activity]);
  return details;
}
