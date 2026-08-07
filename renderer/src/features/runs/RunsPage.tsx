import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FolderOpen, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import type { BrokerRunEvent, BrokerRunRecord, RunArtifact, WorkflowRunRecord } from "@shared/contracts";

type RunEntry =
  | { kind: "skill"; record: BrokerRunRecord }
  | { kind: "workflow"; record: WorkflowRunRecord };

export function RunsPage({ initialRunId }: { initialRunId?: string }) {
  const [entries, setEntries] = useState<RunEntry[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [events, setEvents] = useState<BrokerRunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumeInputs, setResumeInputs] = useState("{}");
  const [resumeBusy, setResumeBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [skillRuns, workflowRuns, nextArtifacts] = await Promise.all([
        window.cctools.listSkillRuns(),
        window.cctools.listWorkflowRuns(),
        window.cctools.listRunArtifacts()
      ]);
      const nextEntries = [
        ...skillRuns.map((record) => ({ kind: "skill" as const, record })),
        ...workflowRuns.map((record) => ({ kind: "workflow" as const, record }))
      ].sort((left, right) => right.record.createdAt.localeCompare(left.record.createdAt));
      setEntries(nextEntries);
      setArtifacts(nextArtifacts);
      setSelectedKey((current) => nextEntries.some((entry) => entryKey(entry) === current)
        ? current
        : nextEntries.find((entry) => entry.record.id === initialRunId)
          ? entryKey(nextEntries.find((entry) => entry.record.id === initialRunId)!)
          : nextEntries[0] ? entryKey(nextEntries[0]) : "");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [initialRunId]);

  useEffect(() => { void load(); }, [load]);

  const selected = entries.find((entry) => entryKey(entry) === selectedKey);
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
    void window.cctools.getSkillRunEvents(selected.record.id)
      .then((next) => { if (!cancelled) setEvents(next); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [selected]);

  const cancel = async () => {
    if (!selected || selected.kind !== "skill") return;
    await window.cctools.cancelSkillRun(selected.record.id);
    await load();
  };

  const retry = async () => {
    if (!selected || selected.kind !== "skill") return;
    try {
      await window.cctools.retrySkillRun(selected.record.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteHistory = async () => {
    if (!selected || !window.confirm("确定删除这条运行历史吗？不会删除 Skill 产生的用户资料。")) return;
    try {
      await window.cctools.deleteRunHistory(selected.record.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const retryStep = async (stepId: string) => {
    if (!selected || selected.kind !== "workflow") return;
    try {
      await window.cctools.retryWorkflowStep(selected.record.id, stepId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const resumeWorkflow = async () => {
    if (!selected || selected.kind !== "workflow" || selected.record.error !== "Workflow 在应用重启时中断，未恢复执行。") return;
    try {
      const parsed = JSON.parse(resumeInputs);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("恢复输入必须是 JSON object。");
      setResumeBusy(true);
      await window.cctools.resumeWorkflowRun({ runId: selected.record.id, inputs: parsed as Record<string, unknown>, providerBindings: {}, rootGeneration: selected.record.rootGeneration });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResumeBusy(false);
    }
  };

  const resumeAgent = async () => {
    if (!selected || selected.kind !== "skill" || !canResumeAgent(selected.record)) return;
    try {
      const parsed = JSON.parse(resumeInputs);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("恢复输入必须是 JSON object。 ");
      const providerId = selected.record.request.providerBindingIds[0];
      if (!providerId) throw new Error("恢复 Agent 需要重新提供 Provider Profile 绑定。 ");
      setResumeBusy(true);
      const next = await window.cctools.resumeAgentRun({
        runId: selected.record.id,
        inputs: parsed as Record<string, unknown>,
        providerBindings: { default: providerId },
        rootGeneration: selected.record.rootGeneration
      });
      await load();
      setSelectedKey(`skill:${next.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResumeBusy(false);
    }
  };

  return (
    <div className="feature-page runs-page">
      <header className="runs-page-header">
        <div><span className="eyebrow">EXECUTION</span><h1>运行记录</h1><p>统一查看 Skill、Workflow 的状态、事件和产物。</p></div>
        <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void load()} disabled={loading}><RefreshCw size={14} />刷新</button>
      </header>
      {error ? <p role="alert" className="runs-error">{error}</p> : null}
      <section className="runs-layout">
        <aside className="workspace-card runs-list" aria-label="运行记录列表">
          {loading && !entries.length ? <p className="runs-empty">正在加载运行记录…</p> : null}
          {!loading && !entries.length ? <p className="runs-empty">暂无运行记录。</p> : null}
          {entries.map((entry) => {
            const active = entryKey(entry) === selectedKey;
            return <button key={entryKey(entry)} type="button" className={`run-list-item${active ? " active" : ""}`} data-motion="selection" onClick={() => setSelectedKey(entryKey(entry))}>
              <span className={`run-state-dot ${stateTone(entry.record.state)}`} />
              <span className="run-list-copy"><strong>{entry.kind === "skill" ? entry.record.request.skillId : entry.record.workflowSkillId}</strong><small>{entry.kind === "skill" ? "Skill" : "Workflow"} · {stateLabel(entry.record.state)}</small></span>
              <time dateTime={entry.record.createdAt}>{formatTime(entry.record.createdAt)}</time>
            </button>;
          })}
        </aside>

        <main className="workspace-card run-detail">
          {!selected ? <p className="runs-empty">选择一条运行记录查看详情。</p> : <>
            <header className="run-detail-header">
              <div><span className="eyebrow">{selected.kind.toUpperCase()}</span><h2>{selected.kind === "skill" ? selected.record.request.skillId : selected.record.workflowSkillId}</h2><p>{selected.record.id}</p></div>
              <div className="run-actions">
                {selected.kind === "skill" && !isTerminal(selected.record.state) ? <button type="button" className="danger-button" onClick={() => void cancel()}><X size={14} />取消</button> : null}
                {selected.kind === "skill" && canRetry(selected.record.state) ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void retry()}><RotateCcw size={14} />重试</button> : null}
                {selected.kind === "skill" && canResumeAgent(selected.record) ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void resumeAgent()} disabled={resumeBusy}><RotateCcw size={14} />{resumeBusy ? "恢复中…" : "恢复 Agent"}</button> : null}
                {selected.kind === "workflow" && selected.record.error === "Workflow 在应用重启时中断，未恢复执行。" ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void resumeWorkflow()} disabled={resumeBusy}><RotateCcw size={14} />{resumeBusy ? "恢复中…" : "恢复 Workflow"}</button> : null}
                <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void deleteHistory()}><Trash2 size={14} />删除历史</button>
              </div>
            </header>
            <dl className="run-overview">
              <div><dt>状态</dt><dd><span className={`run-pill ${stateTone(selected.record.state)}`}>{stateLabel(selected.record.state)}</span></dd></div>
              <div><dt>创建时间</dt><dd>{formatTime(selected.record.createdAt)}</dd></div>
              <div><dt>完成时间</dt><dd>{selected.record.completedAt ? formatTime(selected.record.completedAt) : "—"}</dd></div>
              <div><dt>Root Generation</dt><dd>{selected.record.rootGeneration}</dd></div>
              {selected.kind === "skill" ? <div><dt>触发方式</dt><dd>{selected.record.request.trigger.type}</dd></div> : <div><dt>步骤</dt><dd>{selected.record.stepRuns.length}</dd></div>}
              {selected.kind === "skill" && selected.record.usage ? <div><dt>用量</dt><dd>{formatUsage(selected.record.usage)}</dd></div> : null}
            </dl>
            {selected.kind === "skill" && selected.record.orphanPid ? (
              <section className="run-section run-orphan-warning" role="alert">
                <h3>可能残留进程</h3>
                <p>应用重启时发现该 Run 关联的进程可能仍在运行（PID {selected.record.orphanPid}）。App 不会根据复用风险自动终止它，请在系统进程工具中人工确认后处理。</p>
              </section>
            ) : null}
            {selected.kind === "workflow" ? <>
              {selected.record.error === "Workflow 在应用重启时中断，未恢复执行。" ? <section className="run-section run-resume-section"><h3>恢复输入</h3><p className="runs-muted">应用重启后不会保存 Workflow 输入。确认 active Workflow 版本和 root snapshot 未变化后，重新提供本次恢复所需的非 Secret JSON 输入。</p><textarea className="runs-resume-input" value={resumeInputs} onChange={(event) => setResumeInputs(event.target.value)} spellCheck={false} aria-label="Workflow 恢复输入" /><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void resumeWorkflow()} disabled={resumeBusy}>{resumeBusy ? "恢复中…" : "使用这些输入恢复"}</button></section> : null}
              <WorkflowSteps record={selected.record} onRetry={retryStep} />
            </> : <>
              {canResumeAgent(selected.record) ? <section className="run-section run-resume-section"><h3>恢复 Agent</h3><p className="runs-muted">只恢复 provider 的 Responses checkpoint；原 Run 保留为审计记录。不会从历史中读取本次输入或 Credential，请重新提供非 Secret JSON 输入。</p><textarea className="runs-resume-input" value={resumeInputs} onChange={(event) => setResumeInputs(event.target.value)} spellCheck={false} aria-label="Agent 恢复输入" /><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void resumeAgent()} disabled={resumeBusy}>{resumeBusy ? "恢复中…" : "使用这些输入恢复"}</button></section> : null}
              <section className="run-section"><h3>Artifacts</h3><ArtifactList artifacts={selectedArtifacts} /></section>
              <section className="run-section"><h3>事件</h3><EventList events={events} /></section>
            </>}
          </>}
        </main>
      </section>
    </div>
  );
}

function WorkflowSteps({ record, onRetry }: { record: WorkflowRunRecord; onRetry: (stepId: string) => Promise<void> }) {
  return <section className="run-section"><h3>Workflow Steps</h3><div className="workflow-step-list">{record.stepRuns.map((step) => <div key={step.stepId} className="workflow-step-row"><span className={`run-state-dot ${stateTone(step.state)}`} /><div><strong>{step.stepId}</strong><small>{step.skillId} · {stateLabel(step.state)}{step.artifacts.length ? ` · ${step.artifacts.length} 个 Artifact` : ""}{step.error ? ` · ${step.error}` : ""}</small></div>{step.state === "failed" ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void onRetry(step.stepId)}>重试 Step</button> : null}</div>)}</div></section>;
}

function ArtifactList({ artifacts }: { artifacts: RunArtifact[] }) {
  if (!artifacts.length) return <p className="runs-muted">没有记录到产物。</p>;
  return <div className="artifact-list">{artifacts.map((artifact) => {
    const location = artifact.logicalPath || artifact.externalPathRef || artifact.id;
    const logicalPath = artifact.logicalPath;
    return <div key={artifact.id} className="artifact-row">
      <span>{artifact.type}</span>
      <code title={location}>{location}</code>
      <small>{artifact.size == null ? "" : formatBytes(artifact.size)}{artifact.declared ? " · declared" : " · undeclared"}</small>
      {logicalPath ? <div className="artifact-actions">
        <button type="button" data-motion="icon" aria-label={`打开 ${location}`} onClick={() => void window.cctools.openPath(logicalPath)}><ExternalLink size={13} aria-hidden />打开</button>
        <button type="button" data-motion="icon" aria-label={`定位 ${location}`} onClick={() => void window.cctools.revealPath(logicalPath)}><FolderOpen size={13} aria-hidden />定位</button>
      </div> : <small className="runs-muted">外部导出绑定：{artifact.externalPathRef || "不可用"}</small>}
    </div>;
  })}</div>;
}

function EventList({ events }: { events: BrokerRunEvent[] }) {
  if (!events.length) return <p className="runs-muted">没有事件。</p>;
  return <div className="run-event-list">{events.slice(-80).map((event) => <div key={`${event.runId}-${event.sequence}`} className="run-event-row"><time>{formatTime(event.timestamp)}</time><strong>{event.state}</strong><span>{event.text || event.reason || event.error || ""}</span></div>)}</div>;
}

function entryKey(entry: RunEntry): string { return `${entry.kind}:${entry.record.id}`; }
function isTerminal(state: string): boolean { return ["succeeded", "failed", "timed_out", "cancelled"].includes(state); }
function canRetry(state: string): boolean { return ["failed", "timed_out", "cancelled"].includes(state); }
function canResumeAgent(record: BrokerRunRecord): boolean {
  return canRetry(record.state) && record.agentCheckpoint?.protocol === "openai-responses";
}
function stateTone(state: string): string { return state === "succeeded" ? "success" : state === "failed" || state === "timed_out" ? "danger" : state === "cancelled" ? "muted" : "running"; }
function stateLabel(state: string): string { return ({ succeeded: "成功", failed: "失败", timed_out: "超时", cancelled: "已取消", queued: "排队中", inspecting: "检查中", waiting_execution_consent: "等待授权", preparing_runtime: "准备运行环境", running: "运行中", cancelling: "取消中", pending: "待运行", skipped: "已跳过" } as Record<string, string>)[state] || state; }
function formatTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${Math.round(value / 102.4) / 10} KB` : `${Math.round(value / 104857.6) / 10} MB`; }
function formatUsage(usage: NonNullable<BrokerRunRecord["usage"]>): string {
  const parts = [
    usage.model,
    usage.totalTokens == null ? undefined : `${usage.totalTokens} tokens`,
    usage.costUsd == null ? undefined : `${usage.costSource === "catalog-estimate" ? "估算 " : usage.costSource === "mixed" ? "混合 " : ""}$${usage.costUsd.toFixed(4)}`,
    usage.durationMs == null ? undefined : `${Math.round(usage.durationMs / 100) / 10}s`
  ].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(" · ") : "—";
}
