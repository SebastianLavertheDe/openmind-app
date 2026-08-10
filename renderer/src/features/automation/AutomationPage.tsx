import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarClock, Check, Clock3, Play, Save, Square, Target } from "lucide-react";
import type { AutomationRule, AutomationRuleInput, AutomationRunRecord, AutomationScheduleSnapshot, BrokerRunRecord, SkillDefinition } from "@shared/contracts";
import type { BrokerRunEvent, RunArtifact } from "@shared/execution-contracts";
import type { Navigate } from "../../app/routes";
import { messages } from "@shared/messages";
import { LogViewer, Select, ToggleSwitch } from "../../design-system/components";

const m = messages;

type RuntimeState = { running: boolean; state: string };
type TriggerType = "daily" | "weekly" | "hourly" | "interval";

export function AutomationPage({ skills, initialSkillId, go }: { skills: SkillDefinition[]; initialSkillId?: string; go: Navigate }) {
  void go;
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [schedules, setSchedules] = useState<AutomationScheduleSnapshot[]>([]);
  const [runs, setRuns] = useState<AutomationRunRecord[]>([]);
  const [selectedId, setSelectedId] = useState(() => initialSkillId || "");
  const [runtime, setRuntime] = useState<Record<string, RuntimeState>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [childRun, setChildRun] = useState<BrokerRunRecord | null>(null);
  const [childEvents, setChildEvents] = useState<BrokerRunEvent[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const copyTimer = useRef<number>(0);
  const dateParam = todayCompact();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRules, nextSchedules, nextRuns] = await Promise.all([
        window.cctools.listAutomationRules(),
        window.cctools.listAutomationSchedules(),
        window.cctools.listAutomationRuns()
      ]);
      setRules(nextRules);
      setSchedules(nextSchedules);
      setRuns(nextRuns);
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
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  useEffect(() => window.cctools.onSkillEvent((event) => {
    const skillId = String(event.skillId || "");
    if (!skillId) return;
    if (event.text) setLogs((current) => ({ ...current, [skillId]: [...(current[skillId] || []).slice(-800), String(event.text)] }));
    if (event.state) {
      const state = String(event.state);
      setRuntime((current) => ({ ...current, [skillId]: { running: state === "running", state } }));
      if (state !== "running") void load();
    }
  }), [load]);

  const selected = rules.find((rule) => rule.id === selectedId) || rules[0];
  const selectedRuns = useMemo(() => selected ? runs.filter((run) => run.ruleId === selected.id) : [], [runs, selected]);
  const latestRun = selectedRuns[0];
  const selectedSkill = selected ? skills.find((skill) => skill.id === selected.target.id) : undefined;
  const selectedRuntime = selected ? runtime[selected.target.id] : undefined;
  const selectedLogs = selected ? logs[selected.target.id] || [] : [];
  const selectedSchedule = selected ? schedules.find((schedule) => schedule.ruleId === selected.id) : undefined;

  useEffect(() => {
    let cancelled = false;
    setChildRun(null);
    setChildEvents([]);
    if (!latestRun?.childRunId || latestRun.target.type !== "skill" || typeof window.cctools.getSkillRun !== "function") return () => { cancelled = true; };
    void Promise.all([
      window.cctools.getSkillRun(latestRun.childRunId),
      typeof window.cctools.getSkillRunEvents === "function" ? window.cctools.getSkillRunEvents(latestRun.childRunId) : Promise.resolve([])
    ]).then(([record, events]) => {
      if (!cancelled) { setChildRun(record); setChildEvents(events); }
    }).catch(() => {
      if (!cancelled) { setChildRun(null); setChildEvents([]); }
    });
    return () => { cancelled = true; };
  }, [latestRun]);

  if (loading && !selected) return <div className="feature-page automation-page"><section className="workspace-card"><p>正在加载 Automation Rule…</p></section></div>;
  if (!rules.length) return (
    <div className="feature-page automation-page">
      <section className="workspace-card automation-empty-state">
        <h2>{m.automation.title}</h2>
        <p>{error || "暂无 Automation Rule。请在应用数据目录中创建规则，或刷新后重试。"}</p>
      </section>
    </div>
  );
  if (!selected) return null;

  const selectedEnabled = selected.enabled;
  const consoleText = selectedLogs.length ? selectedLogs.join("") : runLogText(selected, latestRun, childRun, childEvents);
  const runState = latestRun?.state || (selectedRuntime?.running ? "running" : "ready");

  const run = async () => {
    if (!selected.enabled) return;
    try {
      if (latestRun?.state === "running" && latestRun.childRunId) {
        if (latestRun.target.type === "skill") await window.cctools.cancelSkillRun(latestRun.childRunId);
        else await window.cctools.cancelWorkflowRun(latestRun.childRunId);
      } else {
        await window.cctools.runAutomationNow(selected.id);
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
              const latest = runs.find((runItem) => runItem.ruleId === rule.id);
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
              <div><span className="eyebrow">{selected.target.type}:{selected.target.id}</span><h1>{selected.name}</h1><p>{selected.description || "未填写规则说明。"}</p></div>
              <div className="settings-inline-controls">
                <button type="button" className={latestRun?.state === "running" ? "danger-button" : "primary-button"} data-motion="action" aria-busy={latestRun?.state === "running" || undefined} disabled={!selectedEnabled} onClick={() => void run()}>
                  {latestRun?.state === "running" ? <><Square size={14} />{m.automation.actions.stop}</> : <><Play size={14} />{m.automation.actions.run}</>}
                </button>
                <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void deleteRule(selected, load, setError)}>删除规则</button>
              </div>
            </header>

            {error ? <p role="alert" className="automation-config-note">{error}</p> : null}
            <div className="rule-status-strip">
              <span className={`rule-pill ${runtimeTone(runState)}`}>{detailStatus(runState)}</span>
              <span>{selectedEnabled ? m.automation.enabled : m.automation.disabled}</span>
              <span>{latestRun ? `最近运行 ${formatRunTime(latestRun.createdAt)}` : m.automation.neverRun}</span>
              <span>{selectedSchedule?.nextRunAt ? `下次 ${formatRunTime(selectedSchedule.nextRunAt)}` : "无下一次计划"}</span>
              {selectedSkill ? <span>{selectedSkill.cwd}</span> : <span>{m.automation.manifestMissing}</span>}
            </div>

            <ScheduleEditor rule={selected} skills={skills} onSaved={load} onError={setError} />

            <div className="rule-section">
              <h2>最近运行与产物</h2>
              <RunHistory runs={selectedRuns} artifacts={childRun?.artifacts || []} onRetry={() => void retryRule(selected, load, setError)} />
            </div>
          </section>

          <section className="workspace-card console-box automation-console-box">
            <LogViewer text={consoleText} label={m.automation.console.title} status={<span className={`rule-pill ${runtimeTone(runState)}`}>{detailStatus(runState)}</span>} actions={<button type="button" data-motion="action" onClick={() => void copyLogs()} aria-label={m.common.copy}>{copied ? <Check size={13} /> : "复制"}{copied ? m.automation.console.copied : m.common.copy}</button>} />
          </section>
        </main>
      </section>
    </div>
  );
}

function ScheduleEditor({ rule, skills, onSaved, onError }: { rule: AutomationRule; skills: SkillDefinition[]; onSaved: () => Promise<void>; onError: (message: string | null) => void }) {
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
      await window.cctools.saveAutomationRule(toRuleInput({ ...rule, trigger, inputs: rule.inputs }));
      await onSaved();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  };

  const targetSkill = skills.find((skill) => skill.id === rule.target.id);
  const targetLabel = targetSkill ? `${targetSkill.title} · ${targetSkill.id}` : rule.target.id;

  const triggerOptions: Array<{ value: TriggerType; label: string }> = [
    { value: "daily", label: "每日" },
    { value: "weekly", label: "每周" },
    { value: "hourly", label: "每小时" },
    { value: "interval", label: "固定间隔" }
  ];

  return (
    <div className="rule-section automation-rule-editor-section">
      <div className="automation-section-heading">
        <div className="automation-section-title">
          <span className="automation-section-icon" aria-hidden="true"><CalendarClock size={17} /></span>
          <div>
            <h2>触发与目标</h2>
            <p>配置执行对象、触发方式和本次运行需要的输入。</p>
          </div>
        </div>
        <button type="button" className="primary-button automation-save-rule" disabled={saving} onClick={() => void save()}>
          <Save size={14} />{saving ? "保存中…" : "保存规则"}
        </button>
      </div>

      <div className="automation-editor-card">
        <div className="automation-editor-grid">
          <div className="automation-field automation-target-field automation-target-readonly">
            <span>执行目标</span>
            <div className="automation-target-display" aria-label="执行目标">
              <Target size={14} />
              <span>{targetLabel}</span>
            </div>
          </div>
          <label className="automation-field">
            <span>触发方式</span>
            <Select<TriggerType> value={triggerType} options={triggerOptions} onChange={setTriggerType} ariaLabel="触发类型" size="rect" />
          </label>
        </div>

        <div className="automation-schedule-panel">
          <div className="automation-subsection-heading">
            <span className="automation-subsection-icon" aria-hidden="true"><Clock3 size={16} /></span>
            <div><strong>调度设置</strong><span>{scheduleDescription(triggerType, rule.timezone)}</span></div>
          </div>
          <div className="automation-schedule-fields">
            {triggerType === "daily" ? <label className="automation-field"><span>执行时间</span><input aria-label="每日时间" type="time" value={dailyAt} onChange={(event) => setDailyAt(event.target.value)} /></label> : null}
            {triggerType === "weekly" ? <><label className="automation-field"><span>执行时间</span><input aria-label="每周时间" type="time" value={weeklyAt} onChange={(event) => setWeeklyAt(event.target.value)} /></label><label className="automation-field"><span>星期</span><input aria-label="每周星期" value={weeklyDays} onChange={(event) => setWeeklyDays(event.target.value)} placeholder="1,2,3,4,5" /></label></> : null}
            {triggerType === "interval" ? <label className="automation-field"><span>间隔分钟</span><div className="automation-input-suffix"><input aria-label="间隔分钟" type="number" min={1} value={interval} onChange={(event) => setInterval(event.target.value)} /><span>分钟</span></div></label> : null}
            {triggerType === "hourly" ? <p className="automation-schedule-empty">每个整点自动执行一次，无需额外参数。</p> : null}
          </div>
        </div>

        <dl className="automation-editor-meta" aria-label="规则运行策略">
          <div><dt>并发策略</dt><dd>{policyLabel(rule.concurrencyPolicy)}</dd></div>
          <div><dt>错过计划</dt><dd>{missedRunLabel(rule.missedRunPolicy)}</dd></div>
          <div><dt>时区</dt><dd>{rule.timezone}</dd></div>
          <div><dt>目标版本</dt><dd>{rule.target.versionPolicy}</dd></div>
        </dl>
      </div>
    </div>
  );
}

function RunHistory({ runs, artifacts, onRetry }: { runs: AutomationRunRecord[]; artifacts: RunArtifact[]; onRetry: () => void }) {
  if (!runs.length) return <p className="automation-params-hint">尚无运行记录。运行会持久化状态、重试次数和子 Run ID。</p>;
  return <div className="automation-history-list">
    {runs.slice(0, 8).map((run) => <div className="automation-history-row" key={run.id}><span className={`rule-pill ${runtimeTone(run.state)}`}>{run.state}</span><span>{formatRunTime(run.createdAt)}</span><span>attempt {run.attempt}</span><code>{run.childRunId || "未提交"}</code>{run.error ? <small>{run.error}</small> : null}{["failed", "blocked"].includes(run.state) ? <button type="button" data-motion="action" onClick={onRetry}>重试</button> : null}</div>)}
    {artifacts.length ? <div className="automation-artifacts"><strong>Artifacts</strong>{artifacts.map((artifact) => <div className="automation-artifact" key={artifact.id}><span className="automation-artifact-name"><span>{artifact.logicalPath || artifact.externalPathRef || artifact.id}</span></span><small>{artifact.type} · {artifact.size ?? 0} bytes · {artifact.declared ? "declared" : "undeclared"}</small></div>)}</div> : <small className="automation-artifacts-note">最近子 Run 尚未产生 Artifact。</small>}
  </div>;
}

async function toggleRuleFor(rule: AutomationRule, enabled: boolean, load: () => Promise<void>, setError: (message: string | null) => void): Promise<void> {
  try { await window.cctools.saveAutomationRule(toRuleInput({ ...rule, enabled })); await load(); }
  catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); await load(); }
}

async function retryRule(rule: AutomationRule, load: () => Promise<void>, setError: (message: string | null) => void): Promise<void> {
  try { await window.cctools.runAutomationNow(rule.id); await load(); }
  catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
}

async function deleteRule(rule: AutomationRule, load: () => Promise<void>, setError: (message: string | null) => void): Promise<void> {
  if (!window.confirm(`确定删除 Automation Rule「${rule.name}」吗？`)) return;
  try { await window.cctools.deleteAutomationRule(rule.id); await load(); }
  catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
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
  if (type === "daily") return `每天在指定时间执行 · ${timezone}`;
  if (type === "weekly") return `按星期和时间执行 · ${timezone}`;
  if (type === "hourly") return `每个整点执行一次 · ${timezone}`;
  return "按照固定分钟间隔重复执行";
}

/** Map any backend trigger type to the editor's supported subset. */
function normalizeTriggerType(type: string): TriggerType {
  if (type === "daily" || type === "weekly" || type === "hourly" || type === "interval") return type;
  return "interval";
}

function policyLabel(policy: string): string {
  if (policy === "skip") return "运行中跳过";
  if (policy === "queue") return "排队等待";
  if (policy === "parallel") return "允许并行";
  return policy;
}

function missedRunLabel(policy: string): string {
  if (policy === "run-once") return "恢复后补跑一次";
  if (policy === "skip") return "直接跳过";
  return policy;
}

function initialRuleId(initialSkillId: string | undefined, rules: AutomationRule[]): string {
  return rules.find((rule) => rule.id === initialSkillId || rule.target.id === initialSkillId)?.id || rules[0]?.id || "";
}

function selectRuleWithKeyboard(event: KeyboardEvent<HTMLDivElement>, select: () => void) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } }
function triggerLabel(rule: AutomationRule): string { const trigger = rule.trigger; if (trigger.type === "daily") return `每天 ${trigger.at}`; if (trigger.type === "weekly") return `每周 ${trigger.daysOfWeek.join(",")} ${trigger.at}`; if (trigger.type === "hourly") return "每小时"; if (trigger.type === "interval") return `每 ${trigger.everyMinutes} 分钟`; if (trigger.type === "cron") return `Cron ${trigger.expression}`; if (trigger.type === "app-start") return "应用启动"; if (trigger.type === "file-change") return `文件变化 · ${trigger.paths.length} 个路径`; if (trigger.type === "network") return `网络 ${trigger.state}`; if (trigger.type === "power") return `电源 ${trigger.state}`; return "Run 完成"; }
function runTone(state: AutomationRunRecord["state"] | undefined): string { if (state === "running") return "running"; if (state === "succeeded") return "completed"; if (state === "failed" || state === "blocked") return "failed"; return ""; }
function runtimeTone(state: string): "ok" | "warn" | "muted" { return state === "succeeded" ? "ok" : ["failed", "blocked", "cancelled"].includes(state) ? "warn" : state === "running" ? "warn" : "muted"; }
function runListStatus(run: AutomationRunRecord | undefined): string { return run ? run.state : m.automation.status.ready; }
function detailStatus(state: string): string { if (state === "running") return m.automation.status.running; if (state === "succeeded") return m.automation.status.lastSucceeded; if (["failed", "blocked"].includes(state)) return m.automation.status.lastFailed; return m.automation.status.ready; }
function runLogText(rule: AutomationRule, run: AutomationRunRecord | undefined, child: BrokerRunRecord | null, events: BrokerRunEvent[]): string { if (!run) return `[--:--:--] 等待触发：${rule.name}\n[--:--:--] 运行后 stdout、stderr、阶段和失败原因会显示在这里。`; const start = formatLogTime(run.createdAt); const end = run.completedAt ? `\n[${formatLogTime(run.completedAt)}] 结束：${run.state}` : ""; const output = events.filter((event) => event.text).map((event) => `\n[${formatLogTime(event.timestamp)}] ${event.stream || event.state || "output"}: ${event.text}`).join(""); const artifacts = child?.artifacts.length ? `\n产物：${child.artifacts.map((item) => item.logicalPath || item.externalPathRef || item.id).join(", ")}` : ""; return `[${start}] 触发：${rule.name}\n[${start}] 子 Run：${run.childRunId || "未提交"}${output}${end}${artifacts}`; }
function formatRunTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function formatLogTime(value: string): string { return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
function todayCompact(): string { return new Date().toISOString().slice(0, 10).replaceAll("-", ""); }
