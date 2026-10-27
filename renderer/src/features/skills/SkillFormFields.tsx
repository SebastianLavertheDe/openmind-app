import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ImagePlus, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { ProviderCapabilities } from "@shared/contracts";
import { SKILL_SCENES, type AuthoredSkill, type SkillAsset, type SkillLibraryEntry } from "@shared/skill-library";
import { messages } from "@shared/messages";
import { Button, CopyButton, FileDropzone, FormField, IconButton, ImageThumbnail, ImageViewer, Input, Select, Textarea } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { SettingsPanel } from "../settings/SettingsPanel";

const m = messages.skillLibrary;
export type SkillAssistedField = "name" | "subtitle" | "inputHint" | "description";

export function SkillFormHeader({ onBack, busy = false, children }: { onBack(): void; busy?: boolean; children?: ReactNode }) {
  useLocale();
  return <header className="skill-library-toolbar skill-form-header"><Button variant="ghost" onClick={onBack} disabled={busy}><ArrowLeft size={16} />{m.back}</Button><div className="skill-library-toolbar-actions">{children}</div></header>;
}

export function SkillAssetImage({ documentId, asset, onOpen }: { documentId: string; asset: SkillAsset; onOpen?(src: string): void }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let active = true; void window.openmind.readSkillAssetImage!(documentId, asset).then(value => { if (active) setSrc(value); }).catch(() => { if (active) setSrc(""); }); return () => { active = false; }; }, [documentId, asset.id]);
  return <ImageThumbnail label={m.preview} onClick={() => src && onOpen?.(src)}>{src ? <img src={src} alt={asset.name} /> : <ImagePlus aria-hidden />}</ImageThumbnail>;
}

/** One field layout for authoring, read-only details and installed prompt edits. */
export function SkillFormFields({ value: doc, entries, providers, editMode = "all", busy = false, fieldError = {}, categoryLabel,
  onChange, onAttach, onImportImages, onSuggest, suggesting, undoField, onUndo }: {
  value: AuthoredSkill; entries: SkillLibraryEntry[]; providers: ProviderCapabilities[];
  editMode?: "all" | "instructions" | "none"; busy?: boolean; fieldError?: Record<string, string>; categoryLabel?: string;
  onChange?<K extends keyof AuthoredSkill>(key: K, value: AuthoredSkill[K]): void;
  onAttach?(blockId: string): void; onImportImages?(): void;
  onSuggest?(field: SkillAssistedField): void; suggesting?: string | null; undoField?: SkillAssistedField; onUndo?(): void;
}) {
  useLocale();
  const [viewer, setViewer] = useState<{ id: string; src: string } | null>(null);
  const editable = editMode === "all";
  const instructionsEditable = editMode !== "none";
  const updateBlock = (id: string, patch: Partial<AuthoredSkill["instructions"][number]>) => onChange?.("instructions", doc.instructions.map(block => block.id === id ? { ...block, ...patch } : block));
  const moveBlock = (index: number, delta: number) => {
    const blocks = [...doc.instructions];
    [blocks[index], blocks[index + delta]] = [blocks[index + delta], blocks[index]];
    onChange?.("instructions", blocks);
  };
  const assisted = (field: SkillAssistedField, limit: number, multiline = false) => <div className="skill-editor-assisted-field">
    <FormField label={m[field]} hint={editable ? `${Array.from(doc[field]).length}/${limit}` : undefined} error={fieldError[field]}>
      {multiline ? <Textarea value={doc[field]} readOnly={!editable} rows={field === "description" ? 8 : 3} onChange={event => onChange?.(field, event.target.value)} placeholder={editable ? field === "description" ? m.descriptionHint : m.inputHintHelp : undefined} disabled={busy} />
        : <Input value={doc[field]} readOnly={!editable} onChange={event => onChange?.(field, event.target.value)} disabled={busy} />}
    </FormField>
    {editable && onSuggest ? <div className="skill-editor-assistance-actions"><IconButton label={`${m.suggestion} · ${m[field]}`} disabled={busy || Boolean(suggesting)} onClick={() => onSuggest(field)}><Sparkles size={15} aria-hidden /></IconButton>{undoField === field ? <Button size="sm" variant="text" disabled={busy} onClick={onUndo}>{m.undoSuggestion}</Button> : null}</div> : null}
  </div>;
  const models = [{ value: "auto", label: m.autoModel }, ...providers.filter(provider => provider.available).flatMap(provider => {
    const ids = new Set([provider.detectedModel].filter((id): id is string => Boolean(id) && id !== "auto"));
    return [...ids].map(id => ({ value: `${provider.provider}:${id}`, label: `${provider.label} · ${id}` }));
  })];
  const modelValue = doc.executionModel ? `${doc.executionModel.provider}:${doc.executionModel.model}` : "auto";
  if (!models.some(model => model.value === modelValue)) models.push({ value: modelValue, label: modelValue });
  const prompt = doc.instructions.map(block => block.text).join("\n\n");
  const uncategorized = !editable && categoryLabel === m.uncategorized;

  return <>
    <SettingsPanel title={m.basicInformation}>
      <div className="skill-editor-basics">
        {assisted("name", 40)}{assisted("subtitle", 60)}
        <FormField label={m.category}><Select size="rect" value={uncategorized ? "" : doc.category} onChange={value => onChange?.("category", value as AuthoredSkill["category"])} options={[...(uncategorized ? [{ value: "", label: m.uncategorized }] : []), ...SKILL_SCENES.map(value => ({ value, label: m.scenes[value] }))]} disabled={busy || !editable} /></FormField>
        <FormField label={m.icon}><Select size="rect" value={doc.icon} options={[{ value: "auto", label: m.autoIcon }, ...SKILL_SCENES.map(value => ({ value, label: m.scenes[value] }))]} onChange={value => onChange?.("icon", value as AuthoredSkill["icon"])} disabled={busy || !editable} /></FormField>
      </div>
    </SettingsPanel>
    <section className="skill-form-instructions" aria-label={m.prompt}>
      <SettingsPanel title={m.instructions} action={!editable && prompt.trim() ? <CopyButton text={prompt} label={m.copyPrompt} showLabel /> : undefined}>
        <div className="skill-editor-instructions">
          {doc.instructions.map((block, index) => <section key={block.id} className="skill-editor-block workspace-card">
            <FormField label={`${m.instructions} ${index + 1}`} error={fieldError.instructions}><Textarea value={block.text} readOnly={!instructionsEditable} rows={7} placeholder={instructionsEditable ? m.instructionHint : undefined} onChange={event => updateBlock(block.id, { text: event.target.value })} disabled={busy} /></FormField>
            {editable ? <div className="skill-editor-block-actions"><Button variant="ghost" size="sm" disabled={busy} onClick={() => onAttach?.(block.id)}><Plus size={15} />{m.attach}</Button>
              <Select size="pill" ariaLabel={m.referenceSkill} placeholder={m.referenceSkill} value="" options={entries.filter(entry => entry.installed && entry.enabled && entry.usable && entry.authoringId !== doc.id && entry.key && !block.skills.some(reference => reference.key === entry.key)).map(entry => ({ value: entry.key!, label: entry.title }))} onChange={value => { const entry = entries.find(item => item.key === value); if (entry?.key && entry.digest) updateBlock(block.id, { skills: [...block.skills, { key: entry.key, digest: entry.digest }] }); }} disabled={busy} />
              <span className="skill-editor-block-spacer" /><IconButton label={m.up} disabled={busy || index === 0} onClick={() => moveBlock(index, -1)}><ArrowUp size={15} /></IconButton><IconButton label={m.down} disabled={busy || index === doc.instructions.length - 1} onClick={() => moveBlock(index, 1)}><ArrowDown size={15} /></IconButton><IconButton label={m.removeBlock} disabled={busy || doc.instructions.length === 1} onClick={() => onChange?.("instructions", doc.instructions.filter(item => item.id !== block.id))}><Trash2 size={15} /></IconButton>
            </div> : null}
            {block.assets.length || block.skills.length ? <div className="skill-editor-references">{block.assets.map(asset => <span key={asset.id}>{asset.name}{editable ? <IconButton size="sm" label={m.removeReference} onClick={() => updateBlock(block.id, { assets: block.assets.filter(item => item.id !== asset.id) })}><X size={12} /></IconButton> : null}</span>)}{block.skills.map(reference => <span key={reference.key}>{entries.find(entry => entry.key === reference.key)?.title || reference.key}{editable ? <IconButton size="sm" label={m.removeReference} onClick={() => updateBlock(block.id, { skills: block.skills.filter(item => item.key !== reference.key) })}><X size={12} /></IconButton> : null}</span>)}</div> : null}
          </section>)}
          {!editable && !prompt.trim() ? <p role="status">{m.promptEmpty}</p> : null}
          {editable ? <Button variant="ghost" disabled={busy || doc.instructions.length >= 20} onClick={() => onChange?.("instructions", [...doc.instructions, { id: crypto.randomUUID(), text: "", assets: [], skills: [] }])}><Plus size={16} />{m.addBlock}</Button> : null}
        </div>
      </SettingsPanel>
    </section>
    <SettingsPanel title={m.usageAndPresentation}>
      <div className="skill-editor-usage">
        <FormField label={m.executionModel} hint={m.modelHelp}><Select size="rect" value={modelValue} options={models} disabled={busy || !editable} onChange={value => { const split = value.indexOf(":"); onChange?.("executionModel", value === "auto" ? null : { provider: value.slice(0, split) as "codex" | "claude", model: value.slice(split + 1) }); }} /></FormField>
        {assisted("inputHint", 200, true)}
        <section className="skill-editor-gallery" aria-label={m.images}><h3>{m.images} ({doc.images.length}/4)</h3><div className="skill-editor-gallery-grid">{doc.images.map((asset, index) => <div key={asset.id} className="skill-editor-gallery-item"><SkillAssetImage documentId={doc.id} asset={asset} onOpen={src => setViewer({ id: asset.id, src })} />{editable ? <div className="skill-editor-gallery-actions"><IconButton size="sm" label={m.up} disabled={busy || !index} onClick={() => { const images = [...doc.images]; [images[index - 1], images[index]] = [images[index], images[index - 1]]; onChange?.("images", images); }}><ArrowUp size={14} /></IconButton><IconButton size="sm" label={m.removeImage} disabled={busy} onClick={() => onChange?.("images", doc.images.filter(item => item.id !== asset.id))}><X size={14} /></IconButton></div> : null}</div>)}{editable ? <div className="skill-editor-gallery-add"><FileDropzone variant="compact" label={m.addImage} disabled={busy || doc.images.length >= 4} onClick={onImportImages}><ImagePlus size={23} /><span>{m.addImage}</span></FileDropzone></div> : !doc.images.length ? <div className="skill-editor-gallery-add"><FileDropzone variant="compact" label={m.noImages} disabled><ImagePlus size={23} /><span>{m.noImages}</span></FileDropzone></div> : null}</div></section>
        {assisted("description", 5000, true)}
      </div>
    </SettingsPanel>
    <ImageViewer open={Boolean(viewer)} images={doc.images.map(asset => ({ id: asset.id, title: asset.name }))} selectedId={viewer?.id || null} src={viewer?.src} onClose={() => setViewer(null)} onSelect={id => { const asset = doc.images.find(item => item.id === id); if (asset) void window.openmind.readSkillAssetImage!(doc.id, asset).then(src => setViewer({ id, src })); }} />
  </>;
}

export function skillFormDocument(entry: SkillLibraryEntry, prompt: string): AuthoredSkill {
  return { schemaVersion: 1, id: entry.authoringId || entry.id, revision: entry.revision, icon: entry.icon || "auto", name: entry.title, subtitle: entry.subtitle,
    category: entry.category || "writing", instructions: [{ id: `${entry.id}:prompt`, text: prompt, assets: [], skills: [] }], executionModel: entry.executionModel,
    inputHint: entry.inputHint, images: entry.images || [], description: entry.description, copiedFrom: null };
}
