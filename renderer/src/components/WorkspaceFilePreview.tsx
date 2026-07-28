import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, X } from "lucide-react";
import type { ContentRecord } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { errorText } from "../ai-utils";
import { ContentPreview } from "./ContentPreview";
import { ResponsiveActionBar, type ResponsiveAction } from "../design-system/components";
import { useResponsiveLayout } from "../app/responsive-layout";

export function WorkspaceFilePreview({ path, onClose }: { path: string; onClose(): void }) {
  const responsiveLayout = useResponsiveLayout();
  const [content, setContent] = useState<ContentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setContent(null);
    setLoading(true);
    setError(null);
    void window.cctools.readContent(path).then((record) => {
      if (!current) return;
      setContent(record);
      setLoading(false);
    }).catch((cause) => {
      if (!current) return;
      const message = errorText(cause);
      setError(/enoent|not found|no such file|找不到|不存在/i.test(message) ? m.ai.workbench.fileMissing : message);
      setLoading(false);
    });
    return () => { current = false; };
  }, [path]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const actions = useMemo<ResponsiveAction[]>(() => [{
    id: "open-external",
    label: m.ai.file.open,
    icon: ExternalLink,
    priority: "primary",
    onSelect: () => void window.cctools.openPath(path)
  }, {
    id: "close",
    label: m.ai.workbench.closeFilePreview,
    icon: X,
    priority: "essential",
    labelBehavior: "icon",
    onSelect: onClose
  }], [onClose, path]);

  return (
    <section className="workspace-file-preview ai-file-preview" role="complementary" aria-label={m.ai.workbench.filePreview}>
      <header>
        <FileText size={16} />
        <div>
          <strong>{content?.name || path.split(/[\\/]/).at(-1)}</strong>
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
        {loading ? <div className="preview-state">{m.ai.workbench.loadingFile}</div> : null}
        {error ? <div className="preview-state error">{error}</div> : null}
        {content?.truncated ? <div className="preview-inline-state">{m.ai.workbench.fileTruncatedWarning}</div> : null}
        {content ? <ContentPreview content={content} layout="file" /> : null}
      </div>
    </section>
  );
}
