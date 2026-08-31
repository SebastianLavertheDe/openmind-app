import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileOutput, LoaderCircle, Plus, Search, Sparkles } from "lucide-react";
import { useAi } from "../../ai-context";
import { EmptyState, ErrorState, StatusBadge } from "../../design-system/components";
import { AiWorkbench } from "../ai-console";
import { assistantPhase, selectRenderableTimelineEvents } from "../ai-console/timeline";
import { ProjectListDetail } from "./ProjectListDetail";
import { projectsApi } from "./projects-api";
import type { ProjectDetail, ProjectTask, ProjectTaskMessage } from "./types";

export type ProjectTaskSeed = { title?: string; prompt?: string };

export function ProjectTasksPanel({
  project,
  initialTaskId,
  createRequested,
  seed,
  onCreateHandled,
  onChanged
}: {
  project: ProjectDetail;
  initialTaskId?: string;
  createRequested: boolean;
  seed?: ProjectTaskSeed | null;
  onCreateHandled(): void;
  onChanged(): void;
}) {
  const ai = useAi();
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [selectedId, setSelectedId] = useState(initialTaskId || "");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activatingSession, setActivatingSession] = useState(false);
  const [activationNonce, setActivationNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedMessageId, setSavedMessageId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<ProjectTaskMessage[]>([]);
  const refreshedTerminalRunsRef = useRef(new Set<string>());

  const availableProviders = ai.snapshot.providers.filter((provider) => provider.available);
  const selected = tasks.find((item) => item.taskId === selectedId) || null;
  const activeProjectSession = matchesProjectTaskSession(ai.activeSession, project.name, selected);
  const terminalProjectRunIds = useMemo(() => ai.snapshot.runs
    .filter((run) => {
      const scope = run.scope || ai.snapshot.sessions.find((session) => session.id === run.sessionId)?.scope;
      return scope?.type === "project-task"
        && scope.projectName === project.name
        && isTerminalProjectTaskRunStatus(run.status);
    })
    .map((run) => run.id)
    .sort(), [ai.snapshot.runs, ai.snapshot.sessions, project.name]);
  const terminalProjectRunSignature = terminalProjectRunIds.join("|");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return tasks.filter((item) => !needle || item.title.toLocaleLowerCase().includes(needle));
  }, [query, tasks]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await projectsApi.listTasks(project.name);
      setTasks(next);
      setSelectedId((current) => next.some((item) => item.taskId === current) ? current : initialTaskId && next.some((item) => item.taskId === initialTaskId) ? initialTaskId : next[0]?.taskId || "");
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [initialTaskId, project.name]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const unseen = terminalProjectRunIds.filter((runId) => !refreshedTerminalRunsRef.current.has(runId));
    if (!unseen.length) return;
    unseen.forEach((runId) => refreshedTerminalRunsRef.current.add(runId));
    void load().then(onChanged);
  }, [load, onChanged, terminalProjectRunSignature]);
  useEffect(() => {
    if (!providerId && availableProviders[0]) setProviderId(availableProviders[0].id);
  }, [availableProviders, providerId]);
  useEffect(() => {
    if (selected && !selected.sessionId && selected.providerId) setProviderId(selected.providerId);
  }, [selected?.providerId, selected?.sessionId]);
  useEffect(() => {
    if (!createRequested) return;
    setCreating(true);
    setSelectedId("");
    setTitle(seed?.title || "");
    setPrompt(seed?.prompt || "");
    onCreateHandled();
  }, [createRequested, onCreateHandled, seed]);
  useEffect(() => {
    if (!selected?.sessionId) return;
    let current = true;
    setActivatingSession(true);
    setError(null);
    void ai.setActiveSession(selected.sessionId)
      .catch((cause) => { if (current) setError(errorText(cause)); })
      .finally(() => { if (current) setActivatingSession(false); });
    return () => { current = false; };
  }, [activationNonce, selected?.sessionId]);
  useEffect(() => {
    if (!selected?.taskId) {
      setLocalMessages([]);
      return;
    }
    let current = true;
    void projectsApi.listTaskMessages(project.name, selected.taskId)
      .then((messages) => { if (current) setLocalMessages(messages); })
      .catch(() => { if (current) setLocalMessages([]); });
    return () => { current = false; };
  }, [project.name, selected?.taskId, selected?.updatedAt]);

  const newTask = () => {
    setCreating(true);
    setSelectedId("");
    setTitle("");
    setPrompt("");
  };

  const start = async () => {
    if (!prompt.trim() || !providerId || sending) return;
    setSending(true);
    setError(null);
    let task = selected && !selected.sessionId ? selected : null;
    try {
      if (!task) {
        const created = await projectsApi.createTask(project.name, title.trim() || firstLine(prompt), providerId);
        task = created;
        setTasks((current) => [created, ...current.filter((item) => item.taskId !== created.taskId)]);
        setSelectedId(created.taskId);
        setCreating(false);
        onChanged();
      }
      const result = await projectsApi.startTaskRun(project.name, task.taskId, providerId, prompt.trim());
      await ai.refresh();
      await ai.setActiveSession(result.session.id);
      setTasks((current) => [result.task, ...current.filter((item) => item.taskId !== result.task.taskId)]);
      setSelectedId(result.task.taskId);
      setCreating(false);
      setPrompt("");
      onChanged();
    } catch (cause) {
      const message = errorText(cause);
      if (task) {
        await load();
        setSelectedId(task.taskId);
        setCreating(false);
      }
      setError(message);
    } finally {
      setSending(false);
    }
  };

  const finalAnswer = useMemo(() => [...selectRenderableTimelineEvents(ai.events, ai.snapshot.runs)].reverse().find((event) => event.sessionId === selected?.sessionId && event.kind === "assistant-message" && assistantPhase(event) === "final" && typeof event.payload?.text === "string"), [ai.events, ai.snapshot.runs, selected?.sessionId]);
  const saveAnswer = async () => {
    if (!selected || !finalAnswer || savedMessageId === finalAnswer.id) return;
    const selection = window.getSelection()?.toString().trim();
    const content = selection || String(finalAnswer.payload.text || "");
    if (!content) return;
    try {
      await projectsApi.createOutput(project.name, selected.title, content, {
        sourceTaskId: selected.taskId,
        sourceSessionId: selected.sessionId || undefined,
        sourceMessageId: finalAnswer.id
      });
      setSavedMessageId(finalAnswer.id);
      onChanged();
      ai.notify(selection ? "选中的回答已保存为项目成品。" : "AI 回答已保存为项目成品。", "success");
    } catch (cause) {
      ai.notify(errorText(cause), "error");
    }
  };

  const list = (
    <>
      <header className="project-local-list-header"><div><span className="eyebrow">项目任务</span><h2>任务</h2></div><button className="icon-button" aria-label="新建任务" onClick={newTask}><Plus size={16} /></button></header>
      <label className="project-local-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" /></label>
      <div className="project-local-count">全部任务 <span>{filtered.length}</span></div>
      <div className="project-item-list">
        {loading ? Array.from({ length: 5 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !error && !filtered.length ? <EmptyState title={tasks.length ? "没有匹配的任务" : "还没有任务"} description={tasks.length ? "换一个标题关键词后再试。" : "新建任务，让 AI 在当前项目资料中搜索和创作。"} /> : null}
        {filtered.map((item) => <button key={item.taskId} className={item.taskId === selectedId && !creating ? "active" : ""} onClick={() => { setCreating(false); setSelectedId(item.taskId); }}><Sparkles size={15} /><span><strong>{item.title}</strong><small>{formatTime(item.updatedAt)} · {taskStatus(item.status)}</small></span></button>)}
      </div>
    </>
  );

  const starter = <TaskStarter
      project={project}
      title={title || selected?.title || ""}
      prompt={prompt}
      providerId={providerId}
      providerLocked={Boolean(selected && !selected.sessionId)}
      providers={availableProviders}
      sending={sending}
      error={error}
      onTitle={setTitle}
      onPrompt={setPrompt}
      onProvider={setProviderId}
      onStart={() => void start()}
    />;
  const detail = creating ? starter : selected && !selected.sessionId ? (
    <div className="project-task-recovered">
      {localMessages.length ? <TaskLocalHistory messages={localMessages} expanded /> : null}
      {starter}
    </div>
  ) : selected?.sessionId ? (
    <div className={`project-task-session${localMessages.length ? " has-local-history" : ""}`}>
      <div className="project-task-session-bar"><div><StatusBadge tone="info">项目任务</StatusBadge><strong>{selected.title}</strong></div>{activeProjectSession && finalAnswer ? <button disabled={savedMessageId === finalAnswer.id} onClick={() => void saveAnswer()}><FileOutput size={14} />{savedMessageId === finalAnswer.id ? "已保存成品" : "保存回答为成品"}</button> : null}</div>
      {localMessages.length ? <TaskLocalHistory messages={localMessages} /> : null}
      {activeProjectSession ? <AiWorkbench projectMode /> : activatingSession ? <div className="project-detail-loading"><LoaderCircle className="spin" size={18} />正在打开项目任务…</div> : <ErrorState message={error || "会话不属于当前项目任务，已阻止显示。"} retry={() => setActivationNonce((value) => value + 1)} />}
    </div>
  ) : error ? <ErrorState message={error} retry={() => void load()} /> : (
    <EmptyState icon={<Sparkles size={30} />} title="选择或新建任务" description="项目任务会在当前项目目录中查找资料，并把结果返回到对话。" action={<button className="primary-button" onClick={newTask}><Plus size={15} />新建任务</button>} />
  );

  return <ProjectListDetail storageKey={`openmind:projects:tasks-layout:${project.name}`} detailOpen={creating || Boolean(selected)} list={list} detail={detail} detailLabel="任务" onBack={() => { setCreating(false); setSelectedId(""); }} />;
}

function TaskLocalHistory({ messages, expanded = false }: { messages: ProjectTaskMessage[]; expanded?: boolean }) {
  const visible = messages.slice(-100);
  return (
    <details className="project-task-local-history" open={expanded}>
      <summary>项目内任务记录 · {messages.length} 条</summary>
      <p className="project-task-history-note">记录保存在当前 Project；重建会话时 AI 可按需读取，不会一次性塞入输入。</p>
      {visible.length < messages.length ? <p className="project-task-history-note">这里只显示最近 {visible.length} 条，完整记录仍保存在任务目录。</p> : null}
      <div>{visible.map((message) => <article key={message.id} data-role={message.role}><strong>{message.role === "assistant" ? "AI" : "你"}</strong><p>{message.content}</p></article>)}</div>
    </details>
  );
}

function TaskStarter({ project, title, prompt, providerId, providerLocked, providers, sending, error, onTitle, onPrompt, onProvider, onStart }: {
  project: ProjectDetail;
  title: string;
  prompt: string;
  providerId: string;
  providerLocked: boolean;
  providers: Array<{ id: string; label: string }>;
  sending: boolean;
  error: string | null;
  onTitle(value: string): void;
  onPrompt(value: string): void;
  onProvider(value: string): void;
  onStart(): void;
}) {
  return (
    <div className="project-task-starter">
      <div className="project-task-starter-copy"><span className="project-starter-icon"><Sparkles size={22} /></span><h2>基于“{project.name}”开始创作</h2><p>AI 可以在 <code>materials/</code> 中自行搜索和按需读取资料，不会把全部资料一次性塞进输入。</p></div>
      <div className="project-task-compose-card">
        <label><span>任务标题（可选）</span><input value={title} onChange={(event) => onTitle(event.target.value)} placeholder="根据首条消息自动生成" /></label>
        <label><span className="ui-visually-hidden">任务内容</span><textarea autoFocus value={prompt} onChange={(event) => onPrompt(event.target.value)} placeholder="描述你要研究、整理或创作的内容…" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onStart(); }} /></label>
        <div className="project-task-compose-footer">
          <span className="project-material-scope">项目资料 · 可按需读取</span>
          <div><select aria-label="AI Provider" value={providerId} disabled={providerLocked} title={providerLocked ? "任务创建后 Provider 保持不变" : undefined} onChange={(event) => onProvider(event.target.value)}>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}</select><button className="primary-button" disabled={!prompt.trim() || !providerId || sending} onClick={onStart}>{sending ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{sending ? "正在创建…" : "开始任务"}</button></div>
        </div>
        {error ? <p className="project-form-error">{error}</p> : null}
      </div>
    </div>
  );
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/)[0].slice(0, 80) || "未命名任务";
}

function taskStatus(value: ProjectTask["status"]): string {
  return value === "completed" ? "已完成" : value === "failed" ? "失败" : value === "archived" ? "已归档" : "进行中";
}

export function isTerminalProjectTaskRunStatus(value: string | undefined): boolean {
  return value === "completed" || value === "failed" || value === "cancelled" || value === "conflicted";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function matchesProjectTaskSession(
  session: { id: string; scope?: { type: "workspace" } | { type: "project-task"; projectName: string; taskId: string } } | null,
  projectName: string,
  task: ProjectTask | null
): boolean {
  return Boolean(
    task?.sessionId
    && session?.id === task.sessionId
    && session.scope?.type === "project-task"
    && session.scope.projectName === projectName
    && session.scope.taskId === task.taskId
  );
}
