import { useCallback, useEffect, useMemo } from "react";
import { ExternalLink, FileText, X } from "lucide-react";
import { messages as m } from "@shared/messages";
import { ResponsiveActionBar, type ResponsiveAction } from "../design-system/components";
import { useResponsiveLayout } from "../app/responsive-layout";
import { PreviewRenderer, useFilePreviewController, workspaceFileSource } from "../features/file-preview";
import { projectConversationPreviewSource } from "../features/ai-console/project-preview-source";

export function WorkspaceFilePreview({ path, projectName, onClose, embedded = false }: { path: string; projectName?: string; onClose(): void; embedded?: boolean }) {
  const responsiveLayout = useResponsiveLayout();
  const controller = useFilePreviewController();
  const source = useMemo(() => projectName
    ? projectConversationPreviewSource(path, projectName)
    : workspaceFileSource(path, { binary: "unsupported" }), [path, projectName]);

  useEffect(() => {
    void controller.openSource(source, { force: true });
  }, [source]);

  const close = useCallback(() => {
    void controller.close().then((closed) => { if (closed) onClose(); });
  }, [controller.close, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const actions = useMemo<ResponsiveAction[]>(() => [{
    id: "open-external",
    label: m.ai.file.open,
    icon: ExternalLink,
    priority: "primary",
    onSelect: () => void source.openExternal?.()
  }, {
    id: "close",
    label: m.ai.workbench.closeFilePreview,
    icon: X,
    priority: "essential",
    labelBehavior: "icon",
    onSelect: close
  }], [close, source]);

  const resource = controller.resource;
  const error = controller.error && /enoent|not found|no such file|找不到|不存在/i.test(controller.error)
    ? m.ai.workbench.fileMissing
    : controller.error;

  return (
    <section className={`workspace-file-preview ai-file-preview${embedded ? " is-embedded" : ""}`} role="complementary" aria-label={m.ai.workbench.filePreview}>
      <header>
        <FileText size={16} />
        <div>
          <strong>{resource?.title || path.split(/[\\/]/).at(-1)}</strong>
          <span title={path}>{path}</span>
        </div>
        <ResponsiveActionBar
          className="ai-file-preview-actions"
          actions={actions}
          presentation={responsiveLayout.actions}
          overflowLabel={m.ai.workbench.viewMode}
        />
      </header>
      <div className="ai-file-preview-body">
        {controller.loading ? <div className="preview-state">{m.ai.workbench.loadingFile}</div> : null}
        {error ? <div className="preview-state error">{error}</div> : null}
        {resource?.kind === "document" && resource.record.truncated ? <div className="preview-inline-state">{m.ai.workbench.fileTruncatedWarning}</div> : null}
        {resource ? <PreviewRenderer resource={resource} /> : null}
      </div>
    </section>
  );
}
