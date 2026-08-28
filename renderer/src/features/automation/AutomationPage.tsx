import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarClock, Check, Clock3, Play, Save, Square, Target } from "lucide-react";
import type { AutomationRule, AutomationRuleInput, AutomationRunRecord, AutomationScheduleSnapshot, BrokerRunRecord, InstalledRunnableSkillView, WorkflowRunRecord } from "@shared/contracts";
import type { BrokerRunEvent, RunArtifact } from "@shared/execution-contracts";
import { matchesSemverRange } from "@shared/skill-manifest-schema";
import { messages } from "@shared/messages";
import { LogViewer, Select, ToggleSwitch } from "../../design-system/components";
import { INSTALLED_SKILL_CATALOG_CHANGED_EVENT } from "../../installed-skill-events";
import type { ConfirmAction } from "../../ai-context";

const m = messages;

type RuntimeState = { running: boolean; state: string };
type TriggerType = "daily" | "weekly" | "hourly" | "interval";
type WorkflowStepDetails = { step: WorkflowRunRecord["stepRuns"][number]; child: BrokerRunRecord | null; events: BrokerRunEvent[] };

export function AutomationPage({ initialSkillId, confirmAction = rejectConfirmation }: { initialSkillId?: string; confirmAction?: ConfirmAction }) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [skillCatalog, setSkillCatalog] = useState<InstalledRunnableSkillView[]>([]);
  const [schedules, setSchedules] = useState<AutomationScheduleSnapshot[]>([]);
  const [runs, setRuns] = useState<AutomationRunRecord[]>([]);
  const [selectedId, setSelectedId] = useState(() => initialSkillId || "");
  const [runtime, setRuntime] = useState<Record<string, RuntimeState>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [childRun, setChildRun] = useState<BrokerRunRecord | null>(null);
  const [childEvents, setChildEvents] = useState<BrokerRunEvent[]>([]);
  const [workflowRun, setWorkflowRun] = useState<WorkflowRunRecord | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStepDetails[]>([]);
  const [liveEvents, setLiveEvents] = useState<Record<string, BrokerRunEvent[]>>({});
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const copyTimer = useRef<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRules, nextSchedules, nextRuns, nextSkillCatalog] = await Promise.all([
        window.openmind.listAutomationRules(),
        window.openmind.listAutomationSchedules(),
        window.openmind.listAutomationRuns(),
        window.openmind.listInstalledRunnableSkills()
      ]);
      setRules(nextRules);
      setSchedules(nextSchedules);
      setRuns(nextRuns);
      setSkillCatalog(nextSkillCatalog);
      setSelectedId((current) => nextRules.some((rule) => rule.id === current)
        ? current
        : initialRuleId(initialSkillId, nextRules));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [initialSkillId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refreshCatalog = () => { void load(); };
    window.addEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, refreshCatalog);
    return () => window.removeEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, refreshCatalog);
  }, [load]);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  useEffect(() => window.openmind.onSkillEvent((event) => {
    const skillId = String(event.skillId || "");
    if (!skillId) return;
    const message = typeof event.text === "string" ? event.text : typeof event.error === "string" ? event.error : typeof event.reason === "string" ? event.reason : "";
    if (message) setLogs((current) => ({ ...current, [skillId]: [...(current[skillId] || []).slice(-800), message] }));
    if (event.state) {
      const state = String(event.state);
      setRuntime((current) => ({ ...current, [skillId]: { running: state === "running", state } }));
      if (state !== "running") void load();
    }
  }), [load]);
  useEffect(() => {
    if (typeof window.openmind.onSkillRunEvent !== "function") return;
    return window.openmind.onSkillRunEvent((event) => {
      setLiveEvents((current) => ({ ...current, [event.runId]: appendRunEvent(current[event.runId] || [], event) }));
      if (!isActiveRunState(event.state)) void load();
    });
  }, [load]);

  const selected = rules.find((rule) => rule.id === selectedId) || rules[0];
  const selectedRuns = useMemo(() => selected ? prioritizeAutomationRuns(runs.filter((run) => run.ruleId === selected.id)) : [], [runs, selected]);
  const latestRun = selectedRuns[0];
  const selectedSkill = selected ? findTargetSkill(skillCatalog, selected) : undefined;
  const selectedRuntime = selected ? runtime[selected.target.id] : undefined;
  const selectedLogs = selected ? logs[selected.target.id] || [] : [];
  const selectedSchedule = selected ? schedules.find((schedule) => schedule.ruleId === selected.id) : undefined;

  useEffect(() => {
    let cancelled = false;
    let pollTimer = 0;
    setChildRun(null);
    setChildEvents([]);
    setWorkflowRun(null);
    setWorkflowSteps([]);
    const runId = latestRun?.childRunId;
    const targetType = latestRun?.target.type;
    if (!runId) return () => { cancelled = true; };
    const readSkill = async (id: string): Promise<{ child: BrokerRunRecord | null; events: BrokerRunEvent[] }> => {
      if (typeof window.openmind.getSkillRun !== "function") return { child: null, events: [] };
      const [child, events] = await Promise.all([
        window.openmind.getSkillRun(id).catch(() => null),
        typeof window.openmind.getSkillRunEvents === "function" ? window.openmind.getSkillRunEvents(id).catch(() => []) : Promise.resolve([])
      ]);
      return { child, events };
    };
    const refresh = async () => {
      try {
        if (targetType === "skill") {
          const details = await readSkill(runId);
          if (!cancelled) { setChildRun(details.child); setChildEvents(details.events); }
          return;
        }
        if (typeof window.openmind.getWorkflowRun !== "function") return;
        const workflow = await window.openmind.getWorkflowRun(runId);
        const steps = await Promise.all(workflow.stepRuns.map(async (step) => {
          const details = step.runId ? await readSkill(step.runId) : { child: null, events: [] };
          return { step, ...details };
        }));
        if (!cancelled) { setWorkflowRun(workflow); setWorkflowSteps(steps); }
        if (!isActiveRunState(workflow.state) && pollTimer) {
          window.clearInterval(pollTimer);
          void load();
        }
      } catch {
        if (!cancelled) { setChildRun(null); setChildEvents([]); setWorkflowRun(null); setWorkflowSteps([]); }
      }
    };
    void refresh();
    if (targetType === "workflow") pollTimer = window.setInterval(() => { void refresh(); }, 1_000);
    return () => { cancelled = true; if (pollTimer) window.clearInterval(pollTimer); };
  }, [latestRun?.childRunId, latestRun?.target.type, load]);

  const visibleChildEvents = useMemo(() => mergeRunEvents(childEvents, childRun ? liveEvents[childRun.id] || [] : []), [childEvents, childRun, liveEvents]);
  const visibleWorkflowSteps = useMemo(() => workflowSteps.map((details) => ({ ...details, events: mergeRunEvents(details.events, details.step.runId ? liveEvents[details.step.runId] || [] : []) })), [liveEvents, workflowSteps]);

  if (loading && !selected) return <div className="feature-page automation-page"><section className="workspace-card"><p>{m.automation.loading}</p></section></div>;
  if (!rules.length) return (
    <div className="feature-page automation-page">
      <section className="workspace-card automation-empty-state">
        <h2>{m.automation.title}</h2>
        <p>{error || m.automation.empty}</p>
      </section>
    </div>
  );
  if (!selected) return null;

  const selectedEnabled = selected.enabled && Boolean(selectedSkill?.enabled);
  const hasRunDetails = Boolean(childRun || childEvents.length || workflowRun || workflowSteps.length || latestRun?.error);
  const consoleText = hasRunDetails || !selectedLogs.length ? runLogText(selected, latestRun, childRun, visibleChildEvents, workflowRun, visibleWorkflowSteps) : selectedLogs.join("");
  const observedState = selected.target.type === "workflow" ? workflowRun?.state : childRun?.state;
  const runState = observedState || latestRun?.state || (selectedRuntime?.running ? "running" : "ready");
  const isActive = isActiveAutomationRunState(latestRun?.state);
  const isRunning = isActive && Boolean(latestRun?.childRunId);

  const run = async () => {
    if (!isActive && !selectedEnabled) return;
    try {
      if (isActive) {
        if (!latestRun?.childRunId) return;
        if (latestRun.target.type === "skill") await window.openmind.cancelSkillRun(latestRun.childRunId);
        else await window.openmind.cancelWorkflowRun(latestRun.childRunId);
      } else {
        await window.openmind.runAutomationNow(selected.id);
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const copyLogs = async () => {
    if (!consoleText.trim()) return;
    try {
      await navigator.clipboard.writeText(consoleText);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="feature-page automation-page automation-rules-page">
      <section className="automation-layout automation-rules-layout automation-page-transition">
        <aside className="workspace-card automation-rule-list" aria-label={m.automation.title}>
          <header className="pane-head">
            <div><h2>{m.automation.title}</h2><span className="eyebrow">{m.automation.ruleCount(rules.length)}</span></div>
          </header>
          <div className="rule-list">
            {rules.map((rule) => {
              const active = selected.id === rule.id;
              const latest = prioritizeAutomationRuns(runs.filter((runItem) => runItem.ruleId === rule.id))[0];
              return (
                <article key={rule.id} className={`rule-item-shell ${active ? "active" : ""}`}>
                  <div className="rule-item" role="button" tabIndex={0} aria-pressed={active} data-motion="selection" onClick={() => setSelectedId(rule.id)} onKeyDown={(event) => selectRuleWithKeyboard(event, () => setSelectedId(rule.id))}>
                    <span className={`automation-dot ${runTone(latest?.state)}`} aria-hidden="true" />
                    <div className="rule-copy"><strong>{rule.name}</strong><small>{triggerLabel(rule)} · {runListStatus(latest)}</small></div>
                  </div>
                  <ToggleSwitch checked={rule.enabled} label={m.automation.enableRule(rule.name)} onChange={(enabled) => { setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled } : item)); void toggleRuleFor(rule, enabled, load, setError); }} />
                </article>
              );
            })}
          </div>
        </aside>

        <main key={selected.id} className="automation-main automation-detail-pane automation-detail-transition">
          <section className="workspace-card rule-detail">
            <header>
              <div><span className="eyebrow">{selected.target.type}:{selected.target.id}</span><h1>{selected.name}</h1><p>{selected.description || m.automation.noDescription}</p></div>
              <div className="settings-inline-controls">
                <button type="button" className={isRunning ? "danger-button" : "primary-button"} data-motion="action" aria-busy={isActive || undefined} disabled={isActive ? !latestRun?.childRunId : !selectedEnabled} onClick={() => void run()}>
                  {isRunning ? <><Square size={14} />{m.automation.actions.stop}</> : isActive ? <>{m.automation.running}</> : <><Play size={14} />{m.automation.actions.run}</>}
                </button>
                <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void deleteRule(selected, load, setError, confirmAction)}>{m.automation.delete}</button>
              </div>
            </header>

            {error ? <p role="alert" className="automation-config-note">{error}</p> : null}
            <div className="rule-status-strip">
              <span className={`rule-pill ${runtimeTone(runState)}`}>{detailStatus(runState)}</span>
              <span>{automationAvailabilityLabel(selected, selectedSkill)}</span>
              <span>{latestRun ? m.automation.recentRun(formatRunTime(latestRun.createdAt)) : m.automation.neverRun}</span>
              <span>{selectedSchedule?.nextRunAt ? m.automation.nextRun(formatRunTime(selectedSchedule.nextRunAt)) : m.automation.noNextRun}</span>
              {selectedSkill ? <span>{skillKindLabel(selectedSkill.kind)} · v{selectedSkill.version}</span> : <span>{m.automation.manifestMissing}</span>}
            </div>

            <ScheduleEditor rule={selected} skillCatalog={skillCatalog} onSaved={load} onError={setError} />

            <div className="rule-section">
              <h2>{m.automation.recentRunsAndArtifacts}</h2>
              <RunHistory runs={selectedRuns} artifacts={childRun?.artifacts || []} />
            </div>
          </section>

          <section className="workspace-card console-box automation-console-box">
            <LogViewer text={consoleText} label={m.automation.console.title} status={<span className={`rule-pill ${runtimeTone(runState)}`}>{detailStatus(runState)}</span>} actions={<button type="button" data-motion="action" onClick={() => void copyLogs()} aria-label={m.common.copy}>{copied ? <Check size={13} /> : m.automation.console.copy}{copied ? m.automation.console.copied : m.common.copy}</button>} />
          </section>
        </main>
      </section>
    </div>
  );
}

function ScheduleEditor({ rule, skillCatalog, onSaved, onError }: { rule: AutomationRule; skillCatalog: InstalledRunnableSkillView[]; onSaved: () => Promise<void>; onError: (message: string | null) => void }) {
  const [triggerType, setTriggerType] = useState<TriggerType>(normalizeTriggerType(rule.trigger.type));
  const [dailyAt, setDailyAt] = useState(rule.trigger.type === "daily" ? rule.trigger.at : "08:00");
  const [weeklyAt, setWeeklyAt] = useState(rule.trigger.type === "weekly" ? rule.trigger.at : "08:00");
  const [weeklyDays, setWeeklyDays] = useState(rule.trigger.type === "weekly" ? rule.trigger.daysOfWeek.join(",") : "1,2,3,4,5");
  const [interval, setInterval] = useState(String(rule.trigger.type === "interval" ? rule.trigger.everyMinutes : 15));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTriggerType(normalizeTriggerType(rule.trigger.type));
    setDailyAt(rule.trigger.type === "daily" ? rule.trigger.at : "08:00");
    setWeeklyAt(rule.trigger.type === "weekly" ? rule.trigger.at : "08:00");
    setWeeklyDays(rule.trigger.type === "weekly" ? rule.trigger.daysOfWeek.join(",") : "1,2,3,4,5");
    setInterval(String(rule.trigger.type === "interval" ? rule.trigger.everyMinutes : 15));
  }, [rule]);

  const save = async () => {
    setSaving(true); onError(null);
    try {
      const trigger = triggerForEditor(triggerType, dailyAt, weeklyAt, weeklyDays, interval);
      await window.openmind.saveAutomationRule(toRuleInput({ ...rule, trigger, inputs: rule.inputs }));
      await onSaved();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  };

  const targetSkill = findTargetSkill(skillCatalog, rule);
  const targetLabel = targetSkill
    ? `${targetSkill.title} · ${skillKindLabel(targetSkill.kind)} · ${targetSkill.id}`
    : rule.target.id;

  const triggerOptions: Array<{ value: TriggerType; label: string }> = [
    { value: "daily", label: m.automation.editor.triggerOptions.daily },
    { value: "weekly", label: m.automation.editor.triggerOptions.weekly },
    { value: "hourly", label: m.automation.editor.triggerOptions.hourly },
    { value: "interval", label: m.automation.editor.triggerOptions.interval }
  ];

  return (
    <div className="rule-section automation-rule-editor-section">
      <div className="automation-section-heading">
        <div className="automation-section-title">
          <span className="automation-section-icon" aria-hidden="true"><CalendarClock size={17} /></span>
          <div>
            <h2>{m.automation.editor.title}</h2>
            <p>{m.automation.editor.description}</p>
          </div>
        </div>
        <button type="button" className="primary-button automation-save-rule" disabled={saving} onClick={() => void save()}>
          <Save size={14} />{saving ? m.automation.editor.saving : m.automation.editor.save}
        </button>
      </div>

      <div className="automation-editor-card">
        <div className="automation-editor-grid">
          <div className="automation-field automation-target-field automation-target-readonly">
            <span>{m.automation.editor.target}</span>
            <div className="automation-target-display" aria-label={m.automation.editor.target}>
              <Target size={14} />
              <span>{targetLabel}</span>
            </div>
          </div>
          <label className="automation-field">
            <span>{m.automation.editor.triggerMethod}</span>
            <Select<TriggerType> value={triggerType} options={triggerOptions} onChange={setTriggerType} ariaLabel={m.automation.editor.triggerType} size="rect" className="automation-trigger-select" />
          </label>
        </div>

        <div className="automation-schedule-panel">
          <div className="automation-subsection-heading">
            <span className="automation-subsection-icon" aria-hidden="true"><Clock3 size={16} /></span>
            <div><strong>{m.automation.editor.schedule}</strong><span>{scheduleDescription(triggerType, rule.timezone)}</span></div>
          </div>
          <div className="automation-schedule-fields">
            {triggerType === "daily" ? <label className="automation-field"><span>{m.automation.editor.executionTime}</span><input aria-label={m.automation.editor.dailyTime} type="time" value={dailyAt} onChange={(event) => setDailyAt(event.target.value)} /></label> : null}
            {triggerType === "weekly" ? <><label className="automation-field"><span>{m.automation.editor.executionTime}</span><input aria-label={m.automation.editor.weeklyTime} type="time" value={weeklyAt} onChange={(event) => setWeeklyAt(event.target.value)} /></label><label className="automation-field"><span>{m.automation.editor.weekDay}</span><input aria-label={m.automation.editor.weeklyDays} value={weeklyDays} onChange={(event) => setWeeklyDays(event.target.value)} placeholder="1,2,3,4,5" /></label></> : null}
            {triggerType === "interval" ? <label className="automation-field"><span>{m.automation.editor.intervalMinutes}</span><div className="automation-input-suffix"><input aria-label={m.automation.editor.intervalMinutes} type="number" min={1} value={interval} onChange={(event) => setInterval(event.target.value)} /><span>{m.automation.editor.minutes}</span></div></label> : null}
            {triggerType === "hourly" ? <p className="automation-schedule-empty">{m.automation.editor.hourlyHint}</p> : null}
          </div>
        </div>

        <dl className="automation-editor-meta" aria-label={m.automation.editor.policyAria}>
          <div><dt>{m.automation.editor.concurrency}</dt><dd>{policyLabel(rule.concurrencyPolicy)}</dd></div>
          <div><dt>{m.automation.editor.missedRun}</dt><dd>{missedRunLabel(rule.missedRunPolicy)}</dd></div>
          <div><dt>{m.automation.editor.timezone}</dt><dd>{rule.timezone}</dd></div>
          <div><dt>{m.automation.editor.targetVersion}</dt><dd>{rule.target.versionPolicy}</dd></div>
        </dl>
      </div>
    </div>
  );
}

function findTargetSkill(catalog: InstalledRunnableSkillView[], rule: AutomationRule): InstalledRunnableSkillView | undefined {
  const expectedKind = rule.target.type === "workflow" ? "workflow" : "process";
  return catalog.find((skill) => skill.id === rule.target.id
    && skill.kind === expectedKind
    && (rule.target.versionPolicy === "*" || matchesSemverRange(skill.version, rule.target.versionPolicy)));
}

function automationAvailabilityLabel(rule: AutomationRule, skill: InstalledRunnableSkillView | undefined): string {
  if (!rule.enabled) return m.automation.availability.ruleDisabled;
  if (!skill) return m.automation.availability.targetUnavailable;
  if (!skill.enabled) return m.automation.availability.skillDisabled;
  return m.automation.enabled;
}

function skillKindLabel(kind: InstalledRunnableSkillView["kind"]): string {
  return kind === "workflow" ? "Workflow" : "Process";
}

const RECENT_RUN_DAYS = 3;

function RunHistory({ runs, artifacts }: { runs: AutomationRunRecord[]; artifacts: RunArtifact[] }) {
  if (!runs.length) return <p className="automation-params-hint">{m.automation.history.empty}</p>;
  const recentRuns = runs.filter((run) => isWithinRecentDays(run.createdAt, RECENT_RUN_DAYS));
  if (!recentRuns.length) return <p className="automation-params-hint">{m.automation.history.recentEmpty(RECENT_RUN_DAYS)}</p>;
  return <div className="automation-history-list">
    {recentRuns.map((run) => <div className="automation-history-row" key={run.id}><span className={`rule-pill ${runtimeTone(run.state)}`}>{run.state}</span><span>{formatRunTime(run.createdAt)}</span><span>{m.automation.history.attempt(run.attempt)}</span><code>{run.childRunId || m.automation.history.notSubmitted}</code>{run.error ? <small>{run.state === "queued" ? m.automation.history.queuedRetry(run.error) : run.error}</small> : null}</div>)}
    {artifacts.length ? <div className="automation-artifacts"><strong>Artifacts</strong>{artifacts.map((artifact) => <div className="automation-artifact" key={artifact.id}><span className="automation-artifact-name"><span>{artifact.logicalPath || artifact.externalPathRef || artifact.id}</span></span><small>{artifact.type} · {artifact.size ?? 0} bytes · {artifact.declared ? "declared" : "undeclared"}</small></div>)}</div> : <small className="automation-artifacts-note">{m.automation.history.noArtifact}</small>}
  </div>;
}

async function toggleRuleFor(rule: AutomationRule, enabled: boolean, load: () => Promise<void>, setError: (message: string | null) => void): Promise<void> {
  try { await window.openmind.saveAutomationRule(toRuleInput({ ...rule, enabled })); await load(); }
  catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); await load(); }
}

async function deleteRule(rule: AutomationRule, load: () => Promise<void>, setError: (message: string | null) => void, confirmAction: ConfirmAction): Promise<void> {
  if (!await confirmAction({ title: m.automation.deleteRule.title, body: m.automation.deleteRule.body(rule.name), confirmText: m.automation.deleteRule.confirm, danger: true })) return;
  try { await window.openmind.deleteAutomationRule(rule.id); await load(); }
  catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
}

function rejectConfirmation(): Promise<boolean> {
  return Promise.resolve(false);
}

function toRuleInput(rule: AutomationRule): AutomationRuleInput {
  return { id: rule.id, name: rule.name, description: rule.description, enabled: rule.enabled, target: rule.target, trigger: rule.trigger, inputs: rule.inputs, providerBindings: rule.providerBindings, externalExportBindingIds: rule.externalExportBindingIds, concurrencyPolicy: rule.concurrencyPolicy, missedRunPolicy: rule.missedRunPolicy, retryPolicy: rule.retryPolicy, timezone: rule.timezone };
}

function triggerForEditor(type: TriggerType, dailyAt: string, weeklyAt: string, weeklyDays: string, interval: string): AutomationRule["trigger"] {
  if (type === "daily") return { type, at: dailyAt };
  if (type === "weekly") {
    const daysOfWeek = [...new Set(weeklyDays.split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))];
    return { type, at: weeklyAt, daysOfWeek: daysOfWeek.length ? daysOfWeek : [1] };
  }
  if (type === "hourly") return { type };
  return { type, everyMinutes: Math.max(1, Number(interval) || 1) };
}

function scheduleDescription(type: TriggerType, timezone: string): string {
  if (type === "daily") return m.automation.scheduleDescription.daily(timezone);
  if (type === "weekly") return m.automation.scheduleDescription.weekly(timezone);
  if (type === "hourly") return m.automation.scheduleDescription.hourly(timezone);
  return m.automation.scheduleDescription.interval;
}

/** Map any backend trigger type to the editor's supported subset. */
function normalizeTriggerType(type: string): TriggerType {
  if (type === "daily" || type === "weekly" || type === "hourly" || type === "interval") return type;
  return "interval";
}

function policyLabel(policy: string): string {
  if (policy === "skip") return m.automation.concurrencyPolicy.skip;
  if (policy === "queue") return m.automation.concurrencyPolicy.queue;
  if (policy === "parallel") return m.automation.concurrencyPolicy.parallel;
  return policy;
}

function missedRunLabel(policy: string): string {
  if (policy === "run-once") return m.automation.missedRunPolicy.runOnce;
  if (policy === "skip") return m.automation.missedRunPolicy.skip;
  return policy;
}

function initialRuleId(initialSkillId: string | undefined, rules: AutomationRule[]): string {
  return rules.find((rule) => rule.id === initialSkillId || rule.target.id === initialSkillId)?.id || rules[0]?.id || "";
}

function selectRuleWithKeyboard(event: KeyboardEvent<HTMLDivElement>, select: () => void) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } }
function triggerLabel(rule: AutomationRule): string { const trigger = rule.trigger; if (trigger.type === "daily") return m.automation.triggerLabel.daily(trigger.at); if (trigger.type === "weekly") return m.automation.triggerLabel.weekly(trigger.daysOfWeek.join(","), trigger.at); if (trigger.type === "hourly") return m.automation.triggerLabel.hourly; if (trigger.type === "interval") return m.automation.triggerLabel.interval(trigger.everyMinutes); if (trigger.type === "cron") return `Cron ${trigger.expression}`; if (trigger.type === "app-start") return m.automation.triggerLabel.appStart; if (trigger.type === "file-change") return m.automation.triggerLabel.fileChange(trigger.paths.length); if (trigger.type === "network") return m.automation.triggerLabel.network(trigger.state); if (trigger.type === "power") return m.automation.triggerLabel.power(trigger.state); return m.automation.triggerLabel.runComplete; }
function runTone(state: AutomationRunRecord["state"] | undefined): string { if (state === "running" || state === "queued") return "running"; if (state === "succeeded") return "completed"; if (state === "failed" || state === "blocked") return "failed"; return ""; }
function runtimeTone(state: string): "ok" | "warn" | "muted" { return state === "succeeded" ? "ok" : ["failed", "blocked", "cancelled"].includes(state) ? "warn" : isActiveRunState(state) ? "warn" : "muted"; }
function runListStatus(run: AutomationRunRecord | undefined): string { return run ? automationStateLabel(run.state) : m.automation.status.ready; }
function detailStatus(state: string): string { return automationStateLabel(state); }
function automationStateLabel(state: string): string {
  if (state === "running") return m.automation.status.running;
  if (state === "queued") return m.automation.runtimeState.queued;
  if (state === "inspecting") return m.automation.runtimeState.inspecting;
  if (state === "waiting_execution_consent") return m.automation.runtimeState.preparing;
  if (state === "preparing_runtime") return m.automation.runtimeState.preparing;
  if (state === "cancelling") return m.automation.runtimeState.cancelling;
  if (state === "succeeded") return m.automation.status.lastSucceeded;
  if (["failed", "blocked"].includes(state)) return m.automation.status.lastFailed;
  if (state === "cancelled") return m.automation.runtimeState.cancelled;
  if (state === "skipped") return m.automation.runtimeState.skipped;
  return m.automation.status.ready;
}
function isActiveAutomationRunState(state: AutomationRunRecord["state"] | undefined): boolean { return state === "queued" || state === "running"; }
function prioritizeAutomationRuns(runs: AutomationRunRecord[]): AutomationRunRecord[] {
  return [...runs].sort((left, right) => {
    const priority = (run: AutomationRunRecord): number => run.state === "running" ? 0 : run.state === "queued" ? 1 : 2;
    const priorityDelta = priority(left) - priority(right);
    if (priorityDelta) return priorityDelta;
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}
function isActiveRunState(state: string | null | undefined): boolean { return ["queued", "inspecting", "waiting_execution_consent", "preparing_runtime", "running", "cancelling"].includes(state || ""); }
function appendRunEvent(events: BrokerRunEvent[], next: BrokerRunEvent): BrokerRunEvent[] {
  if (events.some((event) => event.sequence === next.sequence)) return events;
  return [...events, next].slice(-800);
}
function mergeRunEvents(...groups: BrokerRunEvent[][]): BrokerRunEvent[] {
  const merged = new Map<string, BrokerRunEvent>();
  for (const event of groups.flat()) merged.set(`${event.runId}:${event.sequence}`, event);
  return [...merged.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.sequence - right.sequence);
}
const MAX_RUNTIME_LOG_LINES = 160;
type RuntimeLogEntry = { timestamp: string; text: string };

function runtimeStateText(state: string, reason?: string): string {
  if (state === "pending") return m.automation.runtimeState.pending;
  if (state === "queued") return m.automation.runtimeState.waiting;
  if (state === "inspecting") return m.automation.runtimeState.inspectSkill;
  if (state === "waiting_execution_consent") return m.automation.runtimeState.waitingConsent;
  if (state === "preparing_runtime") return m.automation.runtimeState.preparing;
  if (state === "running") return reason === "attempt-started" ? m.automation.runtimeState.attemptStarted : m.automation.runtimeState.running;
  if (state === "succeeded") return m.automation.runtimeState.succeeded;
  if (state === "failed") return m.automation.runtimeState.failed;
  if (state === "timed_out") return m.automation.runtimeState.timedOut;
  if (state === "cancelling") return m.automation.runtimeState.cancelling;
  if (state === "cancelled") return m.automation.runtimeState.cancelled;
  return state;
}

function isRuntimeProgressLine(line: string, stream?: BrokerRunEvent["stream"]): boolean {
  if (stream === "stderr") return true;
  return /^(Loaded config:|Loaded \d+ RSS feeds|RSS Article Monitor|Restored counter state:|Feed:|Entries:|New articles:|Fetching URL to check content type|Processing nested OPML feeds|Skipping duplicate feed source|Processing:|Extracting content|Saved to:|Done!|Artifact 登记失败|缓存文件|Found existing files|📅 Date:|Scanning articles|Found |🤖 Summarizing|Summarizing \d+ articles|Successfully summarized:|✅ (Saved to|Final article count)|✅ Done!|⏰ Finished at:|Post filter:|X posts:|Primary client failed|Error:|Warning:|开始|正在|处理中|抓取|提取|总结|生成)/i.test(line)
    || /(unknown url type|AI API request failed|No topic entries parsed|Workflow Step .* failed)/i.test(line);
}

function runtimeOutputEntries(label: string, event: BrokerRunEvent): RuntimeLogEntry[] {
  const stream = event.stream;
  const raw = event.text || event.error || "";
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && isRuntimeProgressLine(line, stream))
    .map((line) => ({ timestamp: event.timestamp, text: `${label} · ${line}` }));
}

function compactRuntimeEntries(entries: RuntimeLogEntry[]): RuntimeLogEntry[] {
  const deduped = entries.filter((entry, index) => index === 0 || entries[index - 1].text !== entry.text);
  if (deduped.length <= MAX_RUNTIME_LOG_LINES) return deduped;
  const headCount = 12;
  const tailCount = MAX_RUNTIME_LOG_LINES - headCount - 1;
  return [
    ...deduped.slice(0, headCount),
    { timestamp: deduped[headCount].timestamp, text: m.automation.log.omitted },
    ...deduped.slice(-tailCount)
  ];
}

function runtimeEntriesFor(label: string, events: BrokerRunEvent[]): RuntimeLogEntry[] {
  const seenStates = new Set<string>();
  const entries = events.flatMap((event) => {
    const stateEntries = seenStates.has(event.state)
      ? []
      : [{ timestamp: event.timestamp, text: `${label} · ${runtimeStateText(event.state, event.reason)}` }];
    seenStates.add(event.state);
    if (event.stream === "stdout" || event.stream === "stderr") return [...stateEntries, ...runtimeOutputEntries(label, event)];
    const detailText = event.text || event.error || "";
    const detail = detailText
      ? runtimeOutputEntries(label, { ...event, ...(event.error && !event.text ? { stream: "stderr" as const } : {}), text: detailText })
      : [];
    return detail.length ? [...stateEntries, ...detail] : stateEntries;
  });
  const progress = label === "rss-article-saver" ? rssProgressEntry(label, events) : null;
  return compactRuntimeEntries(progress ? [...entries, progress] : entries);
}

function rssProgressEntry(label: string, events: BrokerRunEvent[]): RuntimeLogEntry | null {
  const stdout = events.filter((event) => event.stream === "stdout" && event.text).map((event) => event.text).join("");
  const feedNames = [...stdout.matchAll(/^\s*Feed:\s*(.+)$/gim)].map((match) => match[1].trim());
  if (!feedNames.length) return null;
  const loaded = stdout.match(/Loaded\s+(\d+)\s+RSS feeds/i)?.[1];
  const discovered = [...stdout.matchAll(/^\s*New articles:\s*(\d+)\s*$/gim)]
    .reduce((total, match) => total + Number(match[1]), 0);
  const saved = [...stdout.matchAll(/^\s*Saved to:\s*.+$/gim)].length;
  const completed = events.some((event) => event.state === "succeeded");
  const timestamp = events.at(-1)?.timestamp || new Date(0).toISOString();
  const initial = loaded ? m.automation.log.initialSubscriptions(loaded) : "";
  return {
    timestamp,
    text: m.automation.log.rssProgress(label, completed, feedNames.length, initial, discovered, saved, feedNames.at(-1) || "")
  };
}

function formatRuntimeEntries(entries: RuntimeLogEntry[]): string {
  return entries.map((entry) => `\n[${formatLogTime(entry.timestamp)}] ${entry.text}`).join("");
}

function runLogText(rule: AutomationRule, run: AutomationRunRecord | undefined, child: BrokerRunRecord | null, events: BrokerRunEvent[], workflow: WorkflowRunRecord | null, workflowSteps: WorkflowStepDetails[]): string {
  if (!run) return m.automation.log.waiting(rule.name);
  const start = formatLogTime(run.createdAt);
  const automationError = run.error
    ? `\n[${run.completedAt ? formatLogTime(run.completedAt) : start}] ${run.state === "queued" ? m.automation.log.queuedRetry : m.automation.log.automationFailed}：${run.error}`
    : "";
  if (workflow) {
    const progressEntries = compactRuntimeEntries(workflowSteps
      .flatMap(({ step, events: stepEvents }) => runtimeEntriesFor(step.skillId, stepEvents))
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp)));
    const stepStatus = workflow.stepRuns.map((step, index) =>
      `\n[${start}] ${m.automation.log.step(index + 1, workflow.stepRuns.length, step.skillId, runtimeStateText(step.state))}`
    ).join("");
    const workflowEnd = workflow.completedAt
      ? `\n[${formatLogTime(workflow.completedAt)}] ${m.automation.log.workflowEnd(workflow.state)}`
      : `\n[${start}] ${m.automation.log.workflowState(workflow.state)}`;
    const workflowError = workflow.error
      ? `\n[${workflow.completedAt ? formatLogTime(workflow.completedAt) : start}] ${m.automation.log.workflowFailed(workflow.error)}`
      : "";
    return `[${start}] ${m.automation.log.triggered(rule.name)}\n[${start}] ${m.automation.log.workflowRun(run.childRunId || m.automation.history.notSubmitted)}${stepStatus}${formatRuntimeEntries(progressEntries)}${workflowEnd}${workflowError}${automationError}`;
  }
  const end = run.completedAt ? `\n[${formatLogTime(run.completedAt)}] ${m.automation.log.ended(run.state)}` : "";
  const childState = child ? `\n[${start}] ${m.automation.log.childState(automationStateLabel(child.state))}` : "";
  const childError = child?.error ? `\n[${child.completedAt ? formatLogTime(child.completedAt) : start}] ${m.automation.log.childFailed(child.error)}` : "";
  const artifacts = child?.artifacts.length ? `\n${m.automation.log.artifacts(child.artifacts.map((item) => item.logicalPath || item.externalPathRef || item.id).join(", "))}` : "";
  const label = child?.request.skillId || rule.target.id;
  return `[${start}] ${m.automation.log.triggered(rule.name)}\n[${start}] ${m.automation.log.childRun(run.childRunId || m.automation.history.notSubmitted)}${formatRuntimeEntries(runtimeEntriesFor(label, events))}${childState}${childError}${automationError}${end}${artifacts}`;
}
function formatRunTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
/** 按自然日计算：包含今天在内往前 N 天。 */
function isWithinRecentDays(isoTime: string, days: number): boolean {
  const created = Date.parse(isoTime);
  if (!Number.isFinite(created)) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return created >= startOfToday.getTime() - (days - 1) * 86_400_000;
}
function formatLogTime(value: string): string { return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
