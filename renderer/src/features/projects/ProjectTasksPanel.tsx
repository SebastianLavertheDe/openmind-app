import { useFeedback } from "../../feedback-context";
import { FormField } from "../../design-system/components";
import { MenuItem, Button } from "../../design-system/components";
import { IconButton } from "../../design-system/IconButton";
import { useLocale } from "../../i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, MoreHorizontal, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { getLocale, messages } from "@shared/messages";
import { useAiActions, useAiSnapshot, useSetAiDraft } from "../../ai-context";
import { DropdownMenu, EmptyState, ErrorState, SearchInput, Input, Textarea, Select } from "../../design-system/components";
import { AiWorkbench } from "../ai-console";
import type { ChatDraftSubmitInput } from "../ai-console/composer";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { projectsApi } from "./projects-api";
import { ProjectListDetail } from "./ProjectListDetail";
import type { ProjectDetail, ProjectTask } from "./types";

const m = messages;

export type ProjectTaskSeed = { title?: string; prompt?: string };

export function ProjectTasksPanel({
  project,
  initialTaskId,
  createRequested,
  seed,
  onCreateHandled,
  onChanged,
  onSelectionChange,
  listHost,
  detailHost
}: {
  project: ProjectDetail;
  initialTaskId?: string;
  createRequested: boolean;
  seed?: ProjectTaskSeed | null;
  onCreateHandled(): void;
  onChanged(): void;
  onSelectionChange?(taskId?: string): void;
  /** Attached mode: the page owns the visible columns and hosts the two halves. */
  listHost?: HTMLElement | null;
  detailHost?: HTMLElement | null;
}) {
  const locale = useLocale();
  const ai = useAiSnapshot();
  const feedback = useFeedback();
  const actions = useAiActions();
  const setDraft = useSetAiDraft();
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
  const [renameTarget, setRenameTarget] = useState<ProjectTask | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [taskActionBusy, setTaskActionBusy] = useState(false);
  const refreshedTerminalRunsRef = useRef(new Set<string>());
  const handledCreateRequestRef = useRef(false);

  const availableProviders = ai.snapshot.providers.filter((provider) => provider.available);
  const setActiveSession = actions.setActiveSession;
  const selected = tasks.find((item) => item.taskId === selectedId) || null;
  const activeProjectSession = matchesProjectTaskSession(ai.activeSession, project.id, selected);
  const terminalProjectRunIds = useMemo(() => ai.snapshot.runs
    .filter((run) => {
      const scope = run.scope || ai.snapshot.sessions.find((session) => session.id === run.sessionId)?.scope;
      return scope?.type === "project-task"
        && scope.projectId === project.id
        && isTerminalProjectTaskRunStatus(run.status);
    })
    .map((run) => run.id)
    .sort(), [ai.snapshot.runs, ai.snapshot.sessions, project.id, locale]);
  const terminalProjectRunSignature = terminalProjectRunIds.join("|");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return tasks.filter((item) => !needle || item.title.toLocaleLowerCase().includes(needle));
  }, [query, tasks, locale]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await projectsApi.listTasks(project.name);
      setTasks(next);
      setSelectedId((current) => next.some((item) => item.taskId === current) ? current : initialTaskId && next.some((item) => item.taskId === initialTaskId) ? initialTaskId : "");
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [initialTaskId, project.name]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onSelectionChange?.(selectedId || undefined); }, [onSelectionChange, selectedId]);
  useEffect(() => {
    if (loading || creating || selectedId) return;
    void setActiveSession(null);
  }, [creating, loading, selectedId, setActiveSession]);
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
    if (!createRequested) {
      handledCreateRequestRef.current = false;
      return;
    }
    if (handledCreateRequestRef.current) return;
    handledCreateRequestRef.current = true;
    void setActiveSession(null);
    actions.clearContexts();
    setDraft(seed?.prompt || "");
    setCreating(true);
    setSelectedId("");
    setTitle(seed?.title || "");
    setPrompt(seed?.prompt || "");
    setError(null);
    onCreateHandled();
  }, [actions.clearContexts, createRequested, onCreateHandled, seed, setActiveSession, setDraft]);
  useEffect(() => {
    if (!selected?.sessionId) return;
    let current = true;
    setActivatingSession(true);
    setError(null);
    void actions.setActiveSession(selected.sessionId)
      .catch((cause) => { if (current) setError(errorText(cause)); })
      .finally(() => { if (current) setActivatingSession(false); });
    return () => { current = false; };
  }, [activationNonce, selected?.sessionId]);
  const newTask = () => {
    void setActiveSession(null);
    actions.clearContexts();
    setDraft("");
    setCreating(true);
    setSelectedId("");
    setTitle("");
    setPrompt("");
    setError(null);
  };

  const beginRenameTask = (task: ProjectTask) => {
    setRenameTarget(task);
    setRenameTitle(task.title);
  };

  const renameTask = async () => {
    const nextTitle = renameTitle.trim();
    if (!renameTarget || !nextTitle || taskActionBusy) return;
    setTaskActionBusy(true);
    try {
      const updated = await projectsApi.renameTask(project.name, renameTarget.taskId, nextTitle);
      setTasks((current) => current.map((item) => item.taskId === updated.taskId ? updated : item));
      setRenameTarget(null);
      onChanged();
      if (updated.sessionId && ai.snapshot.sessions.some((session) => session.id === updated.sessionId)) {
        try { await actions.updateSession(updated.sessionId, { title: updated.title }); }
        catch { feedback.notify(messages.projectUi.taskSessionRenameFailed, "error"); }
      }
      feedback.notify(messages.projectUi.taskRenamed(updated.title), "success");
    } catch (cause) {
      feedback.notify(errorText(cause), "error");
    } finally {
      setTaskActionBusy(false);
    }
  };

  const removeTask = async (task: ProjectTask) => {
    const confirmed = await feedback.confirm({
      title: messages.projectUi.deleteTask,
      body: messages.projectUi.deleteTaskPrompt(task.title),
      confirmText: messages.projectUi.delete,
      danger: true
    });
    if (!confirmed) return;
    try {
      await projectsApi.removeTask(project.name, task.taskId);
      setTasks((current) => current.filter((item) => item.taskId !== task.taskId));
      if (selectedId === task.taskId) {
        setCreating(false);
        setSelectedId("");
      }
      onChanged();
      feedback.notify(messages.projectUi.taskDeleted, "success");
    } catch (cause) {
      feedback.notify(errorText(cause), "error");
    }
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
      const result = await projectsApi.startTaskRun(project.name, task.taskId, providerId, prompt.trim(), [], "auto");
      await actions.refresh();
      await actions.setActiveSession(result.session.id);
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

  const startFromWorkbench = async (input: ChatDraftSubmitInput) => {
    const nextPrompt = input.prompt.trim();
    if (!nextPrompt || !input.providerId || sending) return;
    setSending(true);
    setError(null);
    let task: ProjectTask | null = null;
    try {
      task = await projectsApi.createTask(
        project.name,
        (creating ? title.trim() : "") || firstLine(nextPrompt),
        input.providerId
      );
      setTasks((current) => [task!, ...current.filter((item) => item.taskId !== task!.taskId)]);
      onChanged();

      const result = await projectsApi.startTaskRun(
        project.name,
        task.taskId,
        input.providerId,
        nextPrompt,
        input.contexts,
        input.permissionProfile,
        undefined,
        input.imageGeneration
      );
      // Clear the Project draft before activating its newly-created Session;
      // otherwise the first prompt would remain in the new-conversation draft.
      setDraft("");
      actions.clearContexts();
      await actions.refresh();
      await actions.setActiveSession(result.session.id);
      setTasks((current) => [result.task, ...current.filter((item) => item.taskId !== result.task.taskId)]);
      setSelectedId(result.task.taskId);
      setCreating(false);
      setTitle("");
      setPrompt("");
      onChanged();
    } catch (cause) {
      const message = errorText(cause);
      if (task) {
        setPrompt(nextPrompt);
        await load();
        setSelectedId(task.taskId);
        setCreating(false);
      }
      setError(message);
      throw new Error(message);
    } finally {
      setSending(false);
    }
  };

  const continueFromWorkbench = async (input: ChatDraftSubmitInput) => {
    const nextPrompt = input.prompt.trim();
    if (!selected?.sessionId || !nextPrompt || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await projectsApi.startTaskRun(
        project.name,
        selected.taskId,
        input.providerId,
        nextPrompt,
        input.contexts,
        input.permissionProfile,
        selected.sessionId,
        input.imageGeneration
      );
      setDraft("");
      actions.clearContexts();
      await actions.refresh();
      await actions.setActiveSession(result.session.id);
      setTasks((current) => [result.task, ...current.filter((item) => item.taskId !== result.task.taskId)]);
      onChanged();
    } catch (cause) {
      const message = errorText(cause);
      setError(message);
      throw new Error(message);
    } finally {
      setSending(false);
    }
  };

  const attached = Boolean(listHost && detailHost);
  const list = (
    <>
      {!attached ? <header className="project-local-list-header"><div><span className="eyebrow">{messages.projectUi.projectTasks}</span><h2>{messages.projectUi.tasks}</h2></div><IconButton  onClick={newTask} label={messages.projectUi.newTask}><Plus size={16} /></IconButton></header> : null}
      <SearchInput className="project-pane-filter" leadingIcon={null} trailingIcon={<Search aria-hidden />} aria-label={messages.projectUi.searchTasks} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={messages.projectUi.yourTasks} />
      <div className="project-item-list">
        {loading ? Array.from({ length: 5 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !error && !filtered.length ? <EmptyState title={tasks.length ? messages.projectUi.noMatchingTasks : messages.projectUi.noTasks} description={tasks.length ? messages.projectUi.tryAnotherTitle : messages.projectUi.tasksHint} /> : null}
        {filtered.map((item, index) => {
          const active = item.taskId === selectedId && !creating;
          return (
            <div key={item.taskId} className={`project-task-row${active ? " active" : ""}`} style={{ "--project-list-index": index } as CSSProperties}>
              <button aria-pressed={Boolean(active)} className="project-task-select" data-motion="selection" onClick={() => {
                setCreating(false);
                if (selectedId === item.taskId) onSelectionChange?.(item.taskId);
                else setSelectedId(item.taskId);
              }}><span><strong>{item.title}</strong><small>{formatTime(item.updatedAt)} · {taskStatus(item.status)}</small></span></button>
              <DropdownMenu
                className="project-task-more"
                menuClassName="project-task-menu"
                ariaLabel={messages.projectUi.taskActions(item.title)}
                menuLabel={messages.projectUi.taskActionsMenu(item.title)}
                label={<MoreHorizontal size={16} aria-hidden="true" />}
              >
                <MenuItem type="button" role="menuitem" data-motion="action" onClick={() => beginRenameTask(item)}><Pencil size={15} aria-hidden="true" />{messages.projectUi.rename}</MenuItem>
                <MenuItem tone="danger" type="button" role="menuitem" data-motion="action"  onClick={() => void removeTask(item)}><Trash2 size={15} aria-hidden="true" />{messages.projectUi.delete}</MenuItem>
              </DropdownMenu>
            </div>
          );
        })}
      </div>
    </>
  );

  const renameDialog = <ProjectDialog open={Boolean(renameTarget)} title={messages.projectUi.renameTask} confirmLabel={messages.projectUi.save} busy={taskActionBusy} onClose={() => setRenameTarget(null)} onConfirm={renameTask}>
    <ProjectTextField label={messages.projectUi.taskName} value={renameTitle} autoFocus onChange={setRenameTitle} />
  </ProjectDialog>;

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
  const projectDraftWorkbench = <div className="project-task-session is-draft">
    <AiWorkbench surface={{ kind: "project-task", projectName: project.name }} onDraftSubmit={startFromWorkbench} />
  </div>;
  const detail = creating ? projectDraftWorkbench : selected && !selected.sessionId ? (
    <div className="project-task-recovered">
      {starter}
    </div>
  ) : selected?.sessionId ? (
    <div className="project-task-session">
      {activeProjectSession ? <AiWorkbench surface={{ kind: "project-task", projectName: project.name }} onDraftSubmit={continueFromWorkbench} /> : activatingSession ? <div className="project-detail-loading"><LoaderCircle className="spin" size={18} />{messages.projectUi.openingProjectTask}</div> : <ErrorState message={error || messages.projectUi.taskSessionMismatch} retry={() => setActivationNonce((value) => value + 1)} />}
    </div>
  ) : error ? <ErrorState message={error} retry={() => void load()} /> : (
    projectDraftWorkbench
  );

  if (attached) {
    return (
      <>
        {createPortal(list, listHost!)}
        {createPortal(detail, detailHost!)}
        {renameDialog}
      </>
    );
  }
  return <><ProjectListDetail storageKey={`openmind:projects:tasks-layout:${project.name}`} detailOpen={creating || Boolean(selected)} list={list} detail={detail} detailLabel={messages.projectUi.tasks} onBack={() => { setCreating(false); setSelectedId(""); }} />{renameDialog}</>;
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
  useLocale();
  return (
    <div className="project-task-starter">
      <div className="project-task-starter-copy"><span className="project-starter-icon"><Sparkles size={22} /></span><h2>{messages.projectUi.taskStarterTitle(project.name)}</h2><p>{messages.projectUi.taskContextHint("materials/")}</p></div>
      <div className="project-task-compose-card">
        <FormField label={messages.projectUi.optionalTaskTitle}><Input variant="inline" value={title} onChange={(event) => onTitle(event.target.value)} placeholder={messages.projectUi.autoTaskTitle} /></FormField>
        <FormField label={messages.projectUi.taskContent}><Textarea variant="inline" autoFocus value={prompt} onChange={(event) => onPrompt(event.target.value)} placeholder={messages.projectUi.taskPromptPlaceholder} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onStart(); }} /></FormField>
        <div className="project-task-compose-footer">
          <span className="project-material-scope">{messages.projectUi.taskMaterialsHint}</span>
          <div><Select size="rect" ariaLabel={m.ai.sidebar.providerSelect} value={providerId} disabled={providerLocked} title={providerLocked ? messages.projectUi.taskProviderLocked : undefined} onChange={onProvider} options={providers.map(provider => ({ value: provider.id, label: provider.label }))} /><Button variant="primary"  disabled={!prompt.trim() || !providerId || sending} onClick={onStart}>{sending ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{sending ? messages.projectUi.creating : messages.projectUi.startTask}</Button></div>
        </div>
        {error ? <p className="project-form-error">{error}</p> : null}
      </div>
    </div>
  );
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/)[0].slice(0, 80) || messages.projectUi.untitledTask;
}

function taskStatus(value: ProjectTask["status"]): string {
  return value === "completed" ? messages.projectUi.completed : value === "failed" ? messages.projectUi.failed : value === "archived" ? messages.projectUi.archived : messages.projectUi.inProgress;
}

export function isTerminalProjectTaskRunStatus(value: string | undefined): boolean {
  return value === "completed" || value === "failed" || value === "cancelled" || value === "conflicted";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(getLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function matchesProjectTaskSession(
  session: { id: string; scope: { type: "workspace" } | { type: "project-task"; projectId: string; projectName: string; taskId: string } } | null,
  projectId: string,
  task: ProjectTask | null
): boolean {
  return Boolean(
    task?.sessionId
    && session?.id === task.sessionId
    && session.scope.type === "project-task"
    && session.scope.projectId === projectId
    && task.projectId === projectId
    && session.scope.taskId === task.taskId
  );
}
