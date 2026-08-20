import { ExternalLink, Eye, Pencil, Save } from "lucide-react";
import type { ContentRecord } from "@shared/contracts";
import { ContentPreview } from "../../components/ContentPreview";
import { StatusBadge } from "../../design-system/components";

export function TopicFileWorkspace({ file, draft, mode, dirty, saving, onMode, onDraft, onSave }: { file: ContentRecord; draft: string; mode: "preview" | "edit"; dirty: boolean; saving: boolean; onMode(mode: "preview" | "edit"): void; onDraft(value: string): void; onSave(): void }) {
  return <>
    <header className="creative-document-header topic-file-header">
      <div><div className="document-status"><StatusBadge tone="info">选题文件</StatusBadge><span>{dirty ? "编辑中 · 未保存" : "已保存"}</span></div><h1>{file.name || file.path.split(/[\\/]/).at(-1)}</h1><p>{file.path}</p></div>
      <div>
        <div className="preview-mode-toggle" role="group" aria-label="查看模式">
          <button data-motion="selection" className={mode === "preview" ? "active" : ""} onClick={() => onMode("preview")}><Eye size={13} />预览</button>
          <button data-motion="selection" className={mode === "edit" ? "active" : ""} disabled={file.truncated} onClick={() => onMode("edit")}><Pencil size={13} />编辑</button>
        </div>
        <button data-motion="action" aria-busy={saving || undefined} disabled={!dirty || saving || file.truncated} onClick={onSave}><Save size={14} />{saving ? "保存中" : "保存"}</button>
        <button data-motion="action" onClick={() => void window.openmind.openPath(file.path)}><ExternalLink size={14} />打开文件</button>
      </div>
    </header>
    <div className={`creative-topic-file-content ${mode}`}>
      {file.truncated ? <p className="creative-warn">文件过大，仅展示前 1 MB 内容，无法在应用内保存。</p> : null}
      {mode === "preview" ? <ContentPreview content={{ ...file, content: draft }} layout="file" /> : <textarea aria-label="编辑选题管理文件" value={draft} spellCheck={false} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); onSave(); } }} />}
    </div>
  </>;
}
