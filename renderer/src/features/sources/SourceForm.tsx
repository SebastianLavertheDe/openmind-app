import type { Dispatch, RefObject, SetStateAction } from "react";
import { Pencil, Plus, Upload, X } from "lucide-react";
import type { SourceKind } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { Select } from "../../design-system/components";

type AddKind = Extract<SourceKind, "rss" | "web" | "api">;

export function SourceForm({
  editing,
  titleId,
  inputRef,
  name,
  setName,
  kind,
  setKind,
  url,
  setUrl,
  tags,
  setTags,
  frequency,
  setFrequency,
  saving,
  importing,
  onClose,
  onImport,
  onSubmit
}: {
  editing: boolean;
  titleId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  kind: AddKind;
  setKind: Dispatch<SetStateAction<AddKind>>;
  url: string;
  setUrl: Dispatch<SetStateAction<string>>;
  tags: string;
  setTags: Dispatch<SetStateAction<string>>;
  frequency: string;
  setFrequency: (value: string) => void;
  saving: boolean;
  importing: boolean;
  onClose(): void;
  onImport(): void;
  onSubmit(): void;
}) {
  return (
    <>
      <header className="source-form-header">
        <div className="source-form-heading">
          <span className="source-form-icon" aria-hidden="true">{editing ? <Pencil size={16} /> : <Plus size={16} />}</span>
          <div>
            <strong id={titleId}>{editing ? "编辑数据源" : m.sources.add.expand}</strong>
            <span>{editing ? "更新名称、地址和归类标签" : "添加 RSS、文件夹或 API 资料来源"}</span>
          </div>
        </div>
        <button type="button" data-motion="icon" aria-label={editing ? "关闭编辑数据源弹窗" : "关闭添加源面板"} onClick={onClose}><X size={16} /></button>
      </header>
      <form className="source-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="source-add-grid">
          <label>{m.sources.add.name}<input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} placeholder={m.sources.add.placeholderName} /></label>
          <label>{m.sources.add.type}<Select
            size="rect"
            value={kind}
            disabled={editing}
            onChange={(value) => setKind(value as AddKind)}
            options={[
              { value: "rss", label: m.sources.tabs.rss },
              { value: "web", label: m.sources.tabs.web },
              { value: "api", label: m.sources.tabs.api }
            ]}
          /></label>
          <label className="wide">{m.sources.add.url}<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={kind === "web" ? "~/openmind/notes" : "https://..."} /></label>
          <label className={editing ? "wide" : undefined}>{m.sources.add.tags}<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={m.sources.add.placeholderTags} /></label>
          {!editing ? <label>{m.sources.add.frequency}<Select
            size="rect"
            value={frequency}
            onChange={setFrequency}
            options={[
              m.sources.add.frequencyOptions.m15,
              m.sources.add.frequencyOptions.hourly,
              m.sources.add.frequencyOptions.daily,
              m.sources.add.frequencyOptions.pipeline
            ].map((option) => ({ value: option, label: option }))}
          /></label> : null}
        </div>
        <footer className={`source-add-actions${editing ? " source-editor-actions" : ""}`}>
          {editing ? <button type="button" data-motion="action" onClick={onClose}>{m.feedback.cancel}</button> : (
            <button type="button" data-motion="action" aria-busy={importing || undefined} disabled={importing} onClick={onImport}><Upload size={14} className={importing ? "spin" : ""} />{m.sources.add.importOpml}</button>
          )}
          <button type="submit" className="primary-button" data-motion="action" aria-busy={saving || undefined} disabled={saving || !name.trim() || !url.trim()}>{saving ? m.sources.add.saving : editing ? "保存修改" : m.sources.add.submit}</button>
        </footer>
      </form>
    </>
  );
}
