import { useFeedback } from "../../feedback-context";
import { MenuItem, Button } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileOutput, LoaderCircle, MoreHorizontal, Pencil, Plus, Send } from "lucide-react";
import { DropdownMenu, EmptyState, ErrorState, StatusBadge } from "../../design-system/components";
import { ProjectOutputEditor } from "./ProjectOutputEditor";
import { useFilePreviewController } from "../file-preview";
import type { PreviewResource } from "../file-preview/model";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { projectOutputPreviewSource } from "./project-output-preview-source";
import { projectsApi } from "./projects-api";
import type { ProjectDetail, ProjectOutput } from "./types";
import { WechatExportDialog } from "../wechat/WechatExportDialog";

type SaveState = "idle" | "saving" | "saved" | "failed";

export type ProjectOutputNavigationGuard = {
  isDirty(): boolean;
  flush(): Promise<boolean>;
  discard(): void;
};

export type ProjectOutputDetailProps = {
  project: ProjectDetail;
  outputPath?: string;
  createRequested: boolean;
  onCreateHandled(): void;
  onChanged(): void | Promise<void>;
  onOutputChange?(output: ProjectOutput): void;
  onNavigationGuardChange?(guard: ProjectOutputNavigationGuard | null): void;
  onSelectionChange?(relativePath?: string): void;
  renderDetail?: boolean;
};

/** Editor controller and detail UI; list/selection ownership stays with its host. */
export function ProjectOutputDetail({ project, outputPath, createRequested, onCreateHandled, onChanged, onOutputChange, onNavigationGuardChange, onSelectionChange, renderDetail = true }: ProjectOutputDetailProps) {
  const locale = useLocale();
  const feedback = useFeedback();

  const selectedPath = outputPath || "";
  const [focusPath, setFocusPath] = useState("");
  const [selected, setSelected] = useState<ProjectOutput | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [wechatExport, setWechatExport] = useState<{ open: boolean; path: string; title: string; content: string } | null>(null);
  const outputActionsRef = useRef<HTMLDivElement>(null);
  const selectedPathRef = useRef("");
  const previewResourceRef = useRef<PreviewResource | null>(null);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const savedTimerRef = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  const notifyRef = useRef(feedback.notify);
  const confirmRef = useRef(feedback.confirm);
  notifyRef.current = feedback.notify;
  confirmRef.current = feedback.confirm;

  const preview = useFilePreviewController({
    flushOnUnmount: true,
    onSaveError(message) {
      if (mountedRef.current) setSaveState("failed");
      notifyRef.current(message, "error");
    }
  });
  previewResourceRef.current = preview.resource;
  dirtyRef.current = preview.dirty;
  const resource = preview.resource?.kind === "document" ? preview.resource : null;

  const acceptOutput = useCallback((next: ProjectOutput) => {
    if (!mountedRef.current) return;
    onOutputChange?.(next);
    if (selectedPathRef.current === next.relativePath) setSelected(next);
  }, [onOutputChange]);

  const discardChanges = useCallback(() => {
    dirtyRef.current = false;
    preview.discard();
    if (mountedRef.current) setSaveState("idle");
  }, [preview.discard]);

  const markSaved = useCallback(() => {
    if (!mountedRef.current) return;
    setSaveState("saved");
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setSaveState((value) => value === "saved" ? "idle" : value);
    }, 1800);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    if (mountedRef.current) setSaveState("saving");
    const saved = await preview.save();
    if (saved) markSaved();
    return saved;
  }, [markSaved, preview.save]);
  saveRef.current = save;

  const confirmTransition = useCallback(async () => {
    if (!dirtyRef.current) return true;
    if (await save()) return true;
    const discard = await confirmRef.current({
      title: messages.projectUi.documentSaveFailed,
      body: messages.projectUi.discardUnsavedPrompt,
      confirmText: messages.projectUi.discardChanges,
      danger: true
    });
    if (discard) discardChanges();
    return discard;
  }, [discardChanges, save]);

  const readOutput = useCallback(async (
    relativePath: string,
    confirmDirty = true,
    initialOutput?: ProjectOutput
  ): Promise<boolean> => {
    if (relativePath === selectedPathRef.current && previewResourceRef.current) return true;
    if (confirmDirty && !await confirmTransition()) return false;
    selectedPathRef.current = relativePath;
    setSelected(initialOutput || null);
    setSaveState("idle");
    onSelectionChange?.(relativePath);
    return preview.openSource(projectOutputPreviewSource(project.name, relativePath, {
      initialOutput,
      onOutput: acceptOutput
    }), { initialMode: "edit", force: true });
  }, [acceptOutput, confirmTransition, onSelectionChange, preview.openSource, project.name]);

  useEffect(() => {
    if (outputPath && outputPath !== selectedPathRef.current) void readOutput(outputPath, false);
    else if (!outputPath && selectedPathRef.current) {
      selectedPathRef.current = "";
      setSelected(null);
      preview.discard();
      void preview.close();
    }
  }, [outputPath, readOutput, preview.close, preview.discard]);
  useEffect(() => {
    if (!createRequested) return;
    setCreateTitle("");
    setCreateOpen(true);
    onCreateHandled();
  }, [createRequested, onCreateHandled]);

  useEffect(() => {
    if (!preview.dirty || !resource) return;
    const timer = window.setTimeout(() => { void save(); }, 900);
    return () => window.clearTimeout(timer);
  }, [preview.dirty, preview.draft.content, preview.draft.title, resource?.path, save]);

  const navigationGuard = useMemo<ProjectOutputNavigationGuard>(() => ({
    isDirty: () => dirtyRef.current,
    flush: save,
    discard: discardChanges
  }), [discardChanges, save, locale]);
  useEffect(() => {
    onNavigationGuardChange?.(navigationGuard);
    return () => onNavigationGuardChange?.(null);
  }, [navigationGuard, onNavigationGuardChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // The controller cancels its pending load during StrictMode cleanup.
      // Let the replayed effect reload this selection instead of keeping it pending.
      selectedPathRef.current = "";
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      void saveRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const create = async () => {
    if (!createTitle.trim() || creating) return;
    if (!await confirmTransition()) return;
    setCreating(true);
    try {
      const next = await projectsApi.createOutput(project.name, createTitle.trim());
      setFocusPath(next.relativePath);
      await readOutput(next.relativePath, false, next);
      setCreateOpen(false);
      onChanged();
    } catch (cause) {
      feedback.notify(errorText(cause), "error");
    } finally {
      setCreating(false);
    }
  };

  const error = preview.error;
  const saving = preview.saving || saveState === "saving";
  const detail = preview.loading ? <div className="project-detail-loading"><LoaderCircle size={18} className="spin" />{messages.projectUi.readingDocument}</div> : error ? <ErrorState message={error} retry={() => { if (selectedPath) void readOutput(selectedPath, false); }} /> : selected && resource ? (
    <div className="project-output-document" onKeyDownCapture={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); void save(); } }}>
      <header className="project-output-header">
        <div ref={outputActionsRef} className="project-output-actions">
          <StatusBadge tone={saveState === "failed" ? "danger" : saving ? "info" : "neutral"}>{saveLabel(saving ? "saving" : saveState, preview.dirty)}</StatusBadge>
          <div className="project-preview-mode" role="group" aria-label={messages.projectUi.documentViewMode}><button className={preview.mode === "edit" ? "active" : ""} aria-pressed={preview.mode === "edit"} data-motion="selection" onClick={() => void preview.setMode("edit")}><Pencil size={14} />{messages.projectUi.edit}</button></div>
          <DropdownMenu className="project-output-menu" label={<MoreHorizontal size={16} />} ariaLabel={messages.projectUi.moreOutputActions} menuLabel={messages.projectUi.outputActions} restoreFocusOnSelect={false}>
            <MenuItem type="button" role="menuitem" data-motion="action" onClick={() => setWechatExport({ open: true, path: selectedPath, title: preview.draft.title, content: preview.draft.content })}><Send size={15} />{messages.projectUi.exportToWeChat}</MenuItem>
          </DropdownMenu>
        </div>
      </header>
      <div className={`project-output-editor ${preview.mode}`}>
        <ProjectOutputEditor key={`${project.name}:${selectedPath}`} autoFocus={selectedPath === focusPath} content={preview.draft.content} title={preview.draft.title} readOnly={preview.mode === "preview"}
          onContent={value => { preview.setContent(value); setSaveState("idle"); }} onTitle={value => { preview.setTitle(value); setSaveState("idle"); }} />
      </div>
    </div>
  ) : (
    <EmptyState icon={<FileOutput size={30} />} title={messages.projectUi.selectOrCreateDocument} description={messages.projectUi.documentsStorageHint} action={<Button variant="primary"  onClick={() => setCreateOpen(true)}><Plus size={15} />{messages.projectUi.newDocument}</Button>} />
  );

  const dialogs = (
    <>
    <ProjectDialog open={createOpen} title={messages.projectUi.newDocument} description={messages.projectUi.createDocumentHint} confirmLabel={messages.projectUi.createAndEdit} busy={creating} onClose={() => setCreateOpen(false)} onConfirm={create}>
      <ProjectTextField label={messages.projectUi.documentTitle} value={createTitle} placeholder={messages.projectUi.documentTitlePlaceholder} autoFocus onChange={setCreateTitle} />
    </ProjectDialog>
    {wechatExport ? <WechatExportDialog open={wechatExport.open} projectName={project.name} outputPath={wechatExport.path} title={wechatExport.title} markdown={wechatExport.content}
      onClose={() => setWechatExport(current => current ? { ...current, open: false } : null)}
      onExited={() => { setWechatExport(null); outputActionsRef.current?.querySelector<HTMLButtonElement>(".project-output-menu > button")?.focus(); }} /> : null}
    </>
  );
  return <>{renderDetail ? detail : null}{dialogs}</>;
}

function saveLabel(state: SaveState, dirty: boolean): string {
  if (state === "saving") return messages.projectUi.saving;
  if (state === "saved") return messages.projectUi.saved;
  if (state === "failed") return messages.projectUi.saveFailed;
  return dirty ? messages.projectUi.pendingSave : messages.projectUi.saved;
}


function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
