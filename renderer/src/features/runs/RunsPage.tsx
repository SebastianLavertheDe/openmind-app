import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FolderOpen, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import type { BrokerRunEvent, BrokerRunRecord, RunArtifact, WorkflowRunRecord } from "@shared/contracts";
import { WORKFLOW_INTERRUPTED_ERROR } from "@shared/execution-contracts";
import { messages as m } from "@shared/messages";
import type { ConfirmAction } from "../../ai-context";

type RunEntry =
  | { kind: "skill"; record: BrokerRunRecord }
  | { kind: "workflow"; record: WorkflowRunRecord };

export function RunsPage({ initialRunId, initialSkillId, confirmAction = rejectConfirmation }: { initialRunId?: string; initialSkillId?: string; confirmAction?: ConfirmAction }) {
  const [entries, setEntries] = useState<RunEntry[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [events, setEvents] = useState<BrokerRunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumeInputs, setResumeInputs] = useState("{}");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | "skill" | "workflow">("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [skillFilter, setSkillFilter] = useState(initialSkillId || "all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [skillRuns, workflowRuns, nextArtifacts] = await Promise.all([
        window.openmind.listSkillRuns(),
        window.openmind.listWorkflowRuns(),
        window.openmind.listRunArtifacts()
      ]);
      const nextEntries = [
        ...skillRuns.map((record) => ({ kind: "skill" as const, record })),
        ...workflowRuns.map((record) => ({ kind: "workflow" as const, record }))
      ].sort((left, right) => right.record.createdAt.localeCompare(left.record.createdAt));
      setEntries(nextEntries);
      setArtifacts(nextArtifacts);
      const initialEntries = initialSkillId ? nextEntries.filter((entry) => entry.kind === "skill" && entry.record.request.skillId === initialSkillId) : nextEntries;
      setSelectedKey((current) => initialEntries.some((entry) => entryKey(entry) === current)
        ? current
        : initialEntries.find((entry) => entry.record.id === initialRunId)
          ? entryKey(initialEntries.find((entry) => entry.record.id === initialRunId)!)
          : initialEntries[0] ? entryKey(initialEntries[0]) : "");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [initialRunId, initialSkillId]);

  useEffect(() => { void load(); }, [load]);

  const selected = entries.find((entry) => entryKey(entry) === selectedKey);
  const skillOptions = useMemo(() => Array.from(new Set([
    ...(initialSkillId ? [initialSkillId] : []),
    ...entries.flatMap((entry) => entry.kind === "skill" ? [entry.record.request.skillId] : entry.record.stepRuns.map((step) => step.skillId))
  ])).sort((left, right) => left.localeCompare(right)), [entries, initialSkillId]);
  const visibleEntries = useMemo(() => entries.filter((entry) => {
    if (kindFilter !== "all" && entry.kind !== kindFilter) return false;
    if (stateFilter !== "all" && entry.record.state !== stateFilter) return false;
    if (skillFilter !== "all") {
      if (entry.kind === "skill" && entry.record.request.skillId !== skillFilter) return false;
      if (entry.kind === "workflow" && !entry.record.stepRuns.some((step) => step.skillId === skillFilter)) return false;
    }
    return true;
  }), [entries, kindFilter, skillFilter, stateFilter]);

  useEffect(() => {
    if (visibleEntries.some((entry) => entryKey(entry) === selectedKey)) return;
    setSelectedKey(visibleEntries[0] ? entryKey(visibleEntries[0]) : "");
  }, [selectedKey, visibleEntries]);
  const selectedArtifacts = useMemo(() => {
    if (!selected || selected.kind !== "skill") return [];
    return artifacts.filter((artifact) => artifact.runId === selected.record.id);
  }, [artifacts, selected]);

  useEffect(() => {
    let cancelled = false;
    if (!selected || selected.kind !== "skill") {
      setEvents([]);
      return () => { cancelled = true; };
    }
    void window.openmind.getSkillRunEvents(selected.record.id)
      .then((next) => { if (!cancelled) setEvents(next); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [selected]);

  const cancel = async () => {
    if (!selected || selected.kind !== "skill") return;
    await window.openmind.cancelSkillRun(selected.record.id);
    await load();
  };

  const retry = async () => {
    if (!selected || selected.kind !== "skill") return;
    try {
      await window.openmind.retrySkillRun(selected.record.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteHistory = async () => {
    if (!selected || !await confirmAction({ ...m.runs.deleteHistory, confirmText: m.runs.deleteHistory.confirm, danger: true })) return;
    try {
      await window.openmind.deleteRunHistory(selected.record.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const retryStep = async (stepId: string) => {
    if (!selected || selected.kind !== "workflow") return;
    try {
      await window.openmind.retryWorkflowStep(selected.record.id, stepId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const resumeWorkflow = async () => {
    if (!selected || selected.kind !== "workflow" || selected.record.error !== WORKFLOW_INTERRUPTED_ERROR) return;
    try {
      const parsed = JSON.parse(resumeInputs);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(m.runs.resumeInputInvalid);
      setResumeBusy(true);
      await window.openmind.resumeWorkflowRun({ runId: selected.record.id, inputs: parsed as Record<string, unknown>, providerBindings: {}, rootGeneration: selected.record.rootGeneration });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResumeBusy(false);
    }
  };

  return (
    <div className="feature-page runs-page">
      <header className="runs-page-header">
        <div><span className="eyebrow">{m.runs.eyebrow}</span><h1>{m.runs.title}</h1><p>{m.runs.description}</p></div>
        <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void load()} disabled={loading}><RefreshCw size={14} />{m.runs.refresh}</button>
      </header>
      {error ? <p role="alert" className="runs-error">{error}</p> : null}
      <div className="runs-filterbar" aria-label={m.runs.filters.aria}>
        <label>{m.runs.filters.type}<select aria-label={m.runs.filters.typeAria} value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}><option value="all">{m.runs.filters.allTypes}</option><option value="skill">Skill</option><option value="workflow">Workflow</option></select></label>
        <label>{m.runs.filters.state}<select aria-label={m.runs.filters.stateAria} value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="all">{m.runs.filters.allStates}</option><option value="failed">{m.runs.state.failed}</option><option value="running">{m.runs.state.running}</option><option value="succeeded">{m.runs.state.succeeded}</option><option value="timed_out">{m.runs.state.timedOut}</option><option value="cancelled">{m.runs.state.cancelled}</option></select></label>
        <label>Skill<select aria-label={m.runs.filters.skillAria} value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)}><option value="all">{m.runs.filters.allSkills}</option>{skillOptions.map((skillId) => <option value={skillId} key={skillId}>{skillId}</option>)}</select></label>
        <span>{m.runs.filters.results(visibleEntries.length)}</span>
      </div>
      <section className="runs-layout">
        <aside className="workspace-card runs-list" aria-label={m.runs.list.aria}>
          {loading && !entries.length ? <p className="runs-empty">{m.runs.list.loading}</p> : null}
          {!loading && !visibleEntries.length ? <p className="runs-empty">{m.runs.list.empty}</p> : null}
          {visibleEntries.map((entry) => {
            const active = entryKey(entry) === selectedKey;
            return <button key={entryKey(entry)} type="button" className={`run-list-item${active ? " active" : ""}`} data-motion="selection" onClick={() => setSelectedKey(entryKey(entry))}>
              <span className={`run-state-dot ${stateTone(entry.record.state)}`} />
              <span className="run-list-copy"><strong>{entry.kind === "skill" ? entry.record.request.skillId : entry.record.workflowSkillId}</strong><small>{entry.kind === "skill" ? "Skill" : "Workflow"} · {stateLabel(entry.record.state)}</small></span>
              <time dateTime={entry.record.createdAt}>{formatTime(entry.record.createdAt)}</time>
            </button>;
          })}
        </aside>

        <section className="workspace-card run-detail">
          {!selected ? <p className="runs-empty">{m.runs.list.select}</p> : <>
            <header className="run-detail-header">
              <div><span className="eyebrow">{selected.kind.toUpperCase()}</span><h2>{selected.kind === "skill" ? selected.record.request.skillId : selected.record.workflowSkillId}</h2><p>{selected.record.id}</p></div>
              <div className="run-actions">
                {selected.kind === "skill" && !isTerminal(selected.record.state) ? <button type="button" className="danger-button" onClick={() => void cancel()}><X size={14} />{m.runs.actions.cancel}</button> : null}
                {selected.kind === "skill" && canRetry(selected.record.state) ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void retry()}><RotateCcw size={14} />{m.runs.actions.retry}</button> : null}
                {selected.kind === "workflow" && selected.record.error === WORKFLOW_INTERRUPTED_ERROR ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void resumeWorkflow()} disabled={resumeBusy}><RotateCcw size={14} />{resumeBusy ? m.runs.actions.resuming : m.runs.actions.resumeWorkflow}</button> : null}
                <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void deleteHistory()}><Trash2 size={14} />{m.runs.actions.deleteHistory}</button>
              </div>
            </header>
            <dl className="run-overview">
              <div><dt>{m.runs.fields.state}</dt><dd><span className={`run-pill ${stateTone(selected.record.state)}`}>{stateLabel(selected.record.state)}</span></dd></div>
              <div><dt>{m.runs.fields.createdAt}</dt><dd>{formatTime(selected.record.createdAt)}</dd></div>
              <div><dt>{m.runs.fields.completedAt}</dt><dd>{selected.record.completedAt ? formatTime(selected.record.completedAt) : "—"}</dd></div>
              <div><dt>{m.runs.fields.snapshot}</dt><dd>{m.runs.fields.generation(selected.record.rootGeneration)}</dd></div>
              {selected.kind === "skill" ? <div><dt>{m.runs.fields.trigger}</dt><dd>{selected.record.request.trigger.type}</dd></div> : <div><dt>{m.runs.fields.steps}</dt><dd>{selected.record.stepRuns.length}</dd></div>}
              {selected.kind === "skill" && selected.record.usage ? <div><dt>{m.runs.fields.usage}</dt><dd>{formatUsage(selected.record.usage)}</dd></div> : null}
            </dl>
            {selected.record.error ? <section className="run-failure-summary" role="status"><div><strong>{m.runs.failure.title}</strong><p>{selected.record.error}</p></div><small>{m.runs.failure.hint}</small></section> : null}
            {selected.kind === "skill" && selected.record.orphanPid ? (
              <section className="run-section run-orphan-warning" role="alert">
                <h3>{m.runs.orphan.title}</h3>
                <p>{m.runs.orphan.body(selected.record.orphanPid)}</p>
              </section>
            ) : null}
            {selected.kind === "workflow" ? <>
              {selected.record.error === WORKFLOW_INTERRUPTED_ERROR ? <section className="run-section run-resume-section"><h3>{m.runs.resume.title}</h3><p className="runs-muted">{m.runs.resume.body}</p><textarea className="runs-resume-input" value={resumeInputs} onChange={(event) => setResumeInputs(event.target.value)} spellCheck={false} aria-label={m.runs.resume.aria} /><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void resumeWorkflow()} disabled={resumeBusy}>{resumeBusy ? m.runs.actions.resuming : m.runs.resume.action}</button></section> : null}
              <WorkflowSteps record={selected.record} onRetry={retryStep} />
            </> : <>
              <section className="run-section"><h3>{m.runs.artifacts.title}</h3><ArtifactList artifacts={selectedArtifacts} /></section>
              <section className="run-section"><h3>{m.runs.events.title}</h3><EventList events={events} /></section>
            </>}
          </>}
        </section>
      </section>
    </div>
  );
}

function rejectConfirmation(): Promise<boolean> {
  return Promise.resolve(false);
}

function WorkflowSteps({ record, onRetry }: { record: WorkflowRunRecord; onRetry: (stepId: string) => Promise<void> }) {
  return <section className="run-section"><h3>Workflow Steps</h3><div className="workflow-step-list">{record.stepRuns.map((step) => <div key={step.stepId} className="workflow-step-row"><span className={`run-state-dot ${stateTone(step.state)}`} /><div><strong>{step.stepId}</strong><small>{step.skillId} · {stateLabel(step.state)}{step.artifacts.length ? ` · ${m.runs.artifacts.count(step.artifacts.length)}` : ""}{step.error ? ` · ${step.error}` : ""}</small></div>{step.state === "failed" ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void onRetry(step.stepId)}>{m.runs.retryStep}</button> : null}</div>)}</div></section>;
}

function ArtifactList({ artifacts }: { artifacts: RunArtifact[] }) {
  if (!artifacts.length) return <p className="runs-muted">{m.runs.artifacts.empty}</p>;
  return <div className="artifact-list">{artifacts.map((artifact) => {
    const location = artifact.logicalPath || artifact.externalPathRef || artifact.id;
    const logicalPath = artifact.logicalPath;
    return <div key={artifact.id} className="artifact-row">
      <span>{artifact.type}</span>
      <code title={location}>{location}</code>
      <small>{artifact.size == null ? "" : formatBytes(artifact.size)}{artifact.declared ? " · declared" : " · undeclared"}</small>
      {logicalPath ? <div className="artifact-actions">
        <button type="button" data-motion="icon" aria-label={m.runs.artifacts.openAria(location)} onClick={() => void window.openmind.openPath(logicalPath)}><ExternalLink size={13} aria-hidden />{m.runs.artifacts.open}</button>
        <button type="button" data-motion="icon" aria-label={m.runs.artifacts.revealAria(location)} onClick={() => void window.openmind.revealPath(logicalPath)}><FolderOpen size={13} aria-hidden />{m.runs.artifacts.reveal}</button>
      </div> : <small className="runs-muted">{m.runs.artifacts.external}{artifact.externalPathRef || m.runs.artifacts.unavailable}</small>}
    </div>;
  })}</div>;
}

function EventList({ events }: { events: BrokerRunEvent[] }) {
  if (!events.length) return <p className="runs-muted">{m.runs.events.empty}</p>;
  return <div className="run-event-list">{events.slice(-80).map((event) => <div key={`${event.runId}-${event.sequence}`} className="run-event-row"><time>{formatTime(event.timestamp)}</time><strong>{event.state}</strong><span>{event.text || event.reason || event.error || ""}</span></div>)}</div>;
}

function entryKey(entry: RunEntry): string { return `${entry.kind}:${entry.record.id}`; }
function isTerminal(state: string): boolean { return ["succeeded", "failed", "timed_out", "cancelled"].includes(state); }
function canRetry(state: string): boolean { return ["failed", "timed_out", "cancelled"].includes(state); }
function stateTone(state: string): string { return state === "succeeded" ? "success" : state === "failed" || state === "timed_out" ? "danger" : state === "cancelled" ? "muted" : "running"; }
function stateLabel(state: string): string { return ({ succeeded: m.runs.state.succeeded, failed: m.runs.state.failed, timed_out: m.runs.state.timedOut, cancelled: m.runs.state.cancelled, queued: m.runs.state.queued, inspecting: m.runs.state.inspecting, waiting_execution_consent: m.runs.state.preparing, preparing_runtime: m.runs.state.preparing, running: m.runs.state.running, cancelling: m.runs.state.cancelling, pending: m.runs.state.pending, skipped: m.runs.state.skipped } as Record<string, string>)[state] || state; }
function formatTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${Math.round(value / 102.4) / 10} KB` : `${Math.round(value / 104857.6) / 10} MB`; }
function formatUsage(usage: NonNullable<BrokerRunRecord["usage"]>): string {
  const parts = [
    usage.model,
    usage.totalTokens == null ? undefined : `${usage.totalTokens} tokens`,
    usage.costUsd == null ? undefined : `${usage.costSource === "catalog-estimate" ? m.runs.cost.estimate : usage.costSource === "mixed" ? m.runs.cost.mixed : ""}$${usage.costUsd.toFixed(4)}`,
    usage.durationMs == null ? undefined : `${Math.round(usage.durationMs / 100) / 10}s`
  ].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(" · ") : "—";
}
