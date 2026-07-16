import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, Play, Square } from "lucide-react";
import type { Navigate } from "../../app/routes";
import type { SkillDefinition, SourceRun } from "@shared/contracts";
import { messages } from "@shared/messages";
import { LogViewer, ToggleSwitch } from "../../design-system/components";

const m = messages;

type SkillRuntime = { running: boolean; state: string; startedAt?: string; endedAt?: string };
type StepState = "ready" | "running" | "approval";

type AutomationRule = {
  id: string;
  skillId: string;
  title: string;
  description: string;
  scheduleLabel: string;
  triggerKind: string;
  cron: string;
  triggerDetail: string;
  steps: Array<{ title: string; detail: string; state: StepState }>;
};

const RULES: AutomationRule[] = [
  {
    id: "daily-brief",
    skillId: "daily-article-summarizer",
    title: m.automation.rules.dailyBrief.title,
    description: m.automation.rules.dailyBrief.description,
    scheduleLabel: m.automation.schedule.daily0800,
    triggerKind: m.automation.trigger.scheduled,
    cron: "0 8 * * *",
    triggerDetail: m.automation.schedule.daily0800,
    steps: [
      { ...m.automation.rules.dailyBrief.steps[0], state: "ready" },
      { ...m.automation.rules.dailyBrief.steps[1], state: "ready" },
      { ...m.automation.rules.dailyBrief.steps[2], state: "approval" },
      { ...m.automation.rules.dailyBrief.steps[3], state: "ready" }
    ]
  },
  {
    id: "classify-new-content",
    skillId: "daily-topic-selector",
    title: m.automation.rules.classify.title,
    description: m.automation.rules.classify.description,
    scheduleLabel: m.automation.schedule.afterCapture,
    triggerKind: m.automation.trigger.event,
    cron: "after:capture.success",
    triggerDetail: m.automation.trigger.afterCaptureDetail,
    steps: [
      { ...m.automation.rules.classify.steps[0], state: "ready" },
      { ...m.automation.rules.classify.steps[1], state: "running" },
      { ...m.automation.rules.classify.steps[2], state: "ready" }
    ]
  },
  {
    id: "rss-capture",
    skillId: "rss-article-saver",
    title: m.automation.rules.rss.title,
    description: m.automation.rules.rss.description,
    scheduleLabel: m.automation.schedule.every15min,
    triggerKind: m.automation.trigger.scheduled,
    cron: "*/15 * * * *",
    triggerDetail: m.automation.trigger.every15minDetail,
    steps: [
      { ...m.automation.rules.rss.steps[0], state: "ready" },
      { ...m.automation.rules.rss.steps[1], state: "ready" },
      { ...m.automation.rules.rss.steps[2], state: "ready" }
    ]
  }
];

export function AutomationPage({ skills, initialSkillId, go }: { skills: SkillDefinition[]; initialSkillId?: string; go: Navigate }) {
  void go;
  const [selectedId, setSelectedId] = useState(() => initialRuleId(initialSkillId));
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(RULES.map((rule) => [rule.id, true])));
  const [runtime, setRuntime] = useState<Record<string, SkillRuntime>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [history, setHistory] = useState<SourceRun[]>([]);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number>(0);
  const dateParam = todayCompact();

  const skillById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  const selected = RULES.find((rule) => rule.id === selectedId) || RULES[0];
  const selectedSkill = skillById.get(selected.skillId);
  const currentRuntime = runtime[selected.skillId];
  const latestRun = useMemo(() => history
    .filter((run) => run.skillId === selected.skillId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0], [history, selected.skillId]);
  const selectedLogs = logs[selected.skillId] || [];
  const consoleText = selectedLogs.length ? selectedLogs.join("") : historyLogText(selected, latestRun);
  const selectedEnabled = enabled[selected.id] ?? true;

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await window.cctools.listSourceRuns());
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => window.cctools.onSkillEvent((event) => {
    const skillId = String(event.skillId || "");
    if (!skillId) return;
    if (event.text) setLogs((current) => ({ ...current, [skillId]: [...(current[skillId] || []).slice(-800), String(event.text)] }));
    if (event.state) {
      const state = String(event.state);
      setRuntime((current) => ({
        ...current,
        [skillId]: {
          ...current[skillId],
          running: state === "running",
          state,
          startedAt: state === "running" ? current[skillId]?.startedAt || new Date().toISOString() : current[skillId]?.startedAt,
          endedAt: state === "running" ? undefined : new Date().toISOString()
        }
      }));
      if (state !== "running") void loadHistory();
    }
  }), [loadHistory]);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const run = () => {
    if (!selectedEnabled) return;
    if (currentRuntime?.running) void window.cctools.stopSkill(selected.skillId);
    else void window.cctools.runSkill(selected.skillId, dateParam);
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
            <div>
              <h2>{m.automation.title}</h2>
              <span className="eyebrow">{m.automation.ruleCount(RULES.length)}</span>
            </div>
          </header>
          <div className="rule-list">
            {RULES.map((rule) => {
              const ruleRuntime = runtime[rule.skillId];
              const ruleLatest = history.filter((runItem) => runItem.skillId === rule.skillId).sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
              const active = selected.id === rule.id;
              return (
                <article key={rule.id} className={`rule-item-shell ${active ? "active" : ""}`}>
                  <div
                    className="rule-item"
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    data-motion="selection"
                    onClick={() => setSelectedId(rule.id)}
                    onKeyDown={(event) => selectRuleWithKeyboard(event, () => setSelectedId(rule.id))}
                  >
                    <div className="rule-copy">
                      <strong>{rule.title}</strong>
                      <small>{rule.scheduleLabel} · {ruleListStatus(ruleRuntime, ruleLatest)}</small>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={enabled[rule.id] ?? true}
                    label={m.automation.enableRule(rule.title)}
                    onChange={(checked) => setEnabled((current) => ({ ...current, [rule.id]: checked }))}
                  />
                </article>
              );
            })}
          </div>
        </aside>

        <main key={selected.id} className="automation-main automation-detail-pane automation-detail-transition">
          <section className="workspace-card rule-detail">
            <header>
              <div>
                <span className="eyebrow">{selected.skillId}</span>
                <h1>{selected.title}</h1>
                <p>{selected.description}</p>
              </div>
              <button type="button" className={currentRuntime?.running ? "danger-button" : "primary-button"} data-motion="action" aria-busy={currentRuntime?.running || undefined} disabled={!selectedEnabled} onClick={run}>
                {currentRuntime?.running ? <><Square size={14} />{m.automation.actions.stop}</> : <><Play size={14} />{m.automation.actions.run}</>}
              </button>
            </header>

            <div className="rule-status-strip">
              <span className={`rule-pill ${runtimeTone(currentRuntime, latestRun)}`}>{detailStatus(currentRuntime, latestRun)}</span>
              <span>{selectedEnabled ? m.automation.enabled : m.automation.disabled}</span>
              <span>{latestRun ? m.automation.lastRun(formatRunTime(latestRun.startedAt)) : m.automation.neverRun}</span>
              {selectedSkill ? <span>{selectedSkill.cwd}</span> : <span>{m.automation.manifestMissing}</span>}
            </div>

            <div className="rule-section">
              <h2>{m.automation.sections.trigger}</h2>
              <div className="cron-row">
                <span className="rule-pill muted">{selected.triggerKind}</span>
                <code>{selected.cron}</code>
                <span>{selected.triggerDetail}</span>
                <span className="rule-readonly-note">{m.automation.readonlyRule}</span>
              </div>
            </div>

            <div className="rule-section">
              <h2>{m.automation.sections.steps}</h2>
              <div className="step-list">
                {selected.steps.map((step, index) => (
                  <div className="step" key={step.title}>
                    <span className="num">{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <small>{step.detail.replace("${date}", dateParam)}</small>
                    </div>
                    <span className={`rule-pill ${step.state}`}>{stepStateLabel(step.state)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="workspace-card console-box automation-console-box">
            <LogViewer
              text={consoleText}
              label={m.automation.console.title}
              status={<span className={`rule-pill ${runtimeTone(currentRuntime, latestRun)}`}>{detailStatus(currentRuntime, latestRun)}</span>}
              actions={<button type="button" data-motion="action" onClick={() => void copyLogs()} aria-label={m.common.copy}>{copied ? <Check size={13} className="copy-check-pop" /> : <Copy size={13} />}{copied ? m.automation.console.copied : m.common.copy}</button>}
            />
          </section>
        </main>
      </section>
    </div>
  );
}

function initialRuleId(initialSkillId: string | undefined): string {
  return RULES.find((rule) => rule.id === initialSkillId || rule.skillId === initialSkillId)?.id || RULES[0].id;
}

function selectRuleWithKeyboard(event: KeyboardEvent<HTMLDivElement>, select: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  select();
}

function ruleListStatus(runtime: SkillRuntime | undefined, latestRun: SourceRun | undefined): string {
  if (runtime?.running) return m.automation.status.running;
  if (runtime?.state === "failed" || latestRun?.status === "failed") return m.automation.status.needsAttention;
  if (latestRun?.status === "success") return m.automation.status.lastSuccess;
  return m.automation.status.ready;
}

function detailStatus(runtime: SkillRuntime | undefined, latestRun: SourceRun | undefined): string {
  if (runtime?.running) return m.automation.status.running;
  if (runtime?.state === "failed" || latestRun?.status === "failed") return m.automation.status.lastFailed;
  if (latestRun?.status === "success") return m.automation.status.lastSucceeded;
  return m.automation.status.ready;
}

function runtimeTone(runtime: SkillRuntime | undefined, latestRun: SourceRun | undefined): "ok" | "warn" | "muted" {
  if (runtime?.running) return "warn";
  if (runtime?.state === "failed" || latestRun?.status === "failed") return "warn";
  if (latestRun?.status === "success") return "ok";
  return "muted";
}

function stepStateLabel(value: StepState): string {
  return m.automation.stepState[value];
}

function historyLogText(rule: AutomationRule, latestRun: SourceRun | undefined): string {
  if (latestRun?.logs.length) return latestRun.logs.map((entry) => entry.text).join("\n");
  if (latestRun) {
    const end = latestRun.completedAt ? `\n${m.automation.log.ended(formatLogTime(latestRun.completedAt), latestRun.status)}` : "";
    const start = formatLogTime(latestRun.startedAt);
    return `${m.automation.log.triggered(start, rule.title)}\n${m.automation.log.processing(start, latestRun.itemCount)}${end}`;
  }
  return `${m.automation.log.waiting(rule.title)}\n${m.automation.log.placeholder}`;
}

function formatRunTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatLogTime(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function todayCompact(): string {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}
