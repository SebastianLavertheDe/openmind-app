import { ExternalLink, Eye, Pencil, Save } from "lucide-react";
import type { ContentRecord } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { StatusBadge, Textarea } from "../../design-system/components";
import { PreviewRenderer } from "../file-preview";
import { documentPreviewResource } from "../file-preview/model";

export function TopicFileWorkspace({ file, draft, mode, dirty, saving, onMode, onDraft, onSave, onOpenExternal }: { file: ContentRecord; draft: string; mode: "preview" | "edit"; dirty: boolean; saving: boolean; onMode(mode: "preview" | "edit"): void; onDraft(value: string): void; onSave(): void; onOpenExternal(): void }) {
  const resource = documentPreviewResource(file, `topic:${file.path}`);
  return <>
    <header className="creative-document-header topic-file-header">
      <div><div className="document-status"><StatusBadge tone="info">{m.creativeUi.topicFile.badge}</StatusBadge><span>{dirty ? m.creativeUi.topicFile.dirty : m.creativeUi.topicFile.saved}</span></div><h1>{file.name || file.path.split(/[\\/]/).at(-1)}</h1><p>{file.path}</p></div>
      <div className="topic-file-actions">
        <div className="preview-mode-toggle" role="group" aria-label={m.creativeUi.topicFile.viewMode}>
          <button data-motion="selection" className={mode === "preview" ? "active" : ""} onClick={() => onMode("preview")}><Eye size={13} />{m.creativeUi.topicFile.preview}</button>
          <button data-motion="selection" className={mode === "edit" ? "active" : ""} disabled={file.truncated} onClick={() => onMode("edit")}><Pencil size={13} />{m.creativeUi.topicFile.edit}</button>
        </div>
        <button className="topic-file-action topic-file-save-action" data-motion="action" aria-busy={saving || undefined} disabled={!dirty || saving || file.truncated} onClick={onSave}><Save size={14} />{saving ? m.creativeUi.topicFile.saving : m.creativeUi.topicFile.save}</button>
        <button className="topic-file-action" data-motion="action" onClick={onOpenExternal}><ExternalLink size={14} />{m.creativeUi.topicFile.open}</button>
      </div>
    </header>
    <div className={`creative-topic-file-content ${mode}`}>
      {file.truncated ? <p className="creative-warn">{m.creativeUi.topicFile.truncated}</p> : null}
      {mode === "preview" ? <PreviewRenderer resource={resource} content={draft} layout="file" /> : <Textarea variant="inline" aria-label={m.creativeUi.topicFile.editAria} value={draft} spellCheck={false} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); onSave(); } }} />}
    </div>
  </>;
}
