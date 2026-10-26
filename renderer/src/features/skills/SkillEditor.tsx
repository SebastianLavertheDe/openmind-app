import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ImagePlus, Plus, Sparkles, Trash2, X } from "lucide-react";
import { AuthoredSkillSchema, SKILL_SCENES, type AuthoredSkill, type SkillAsset, type SkillLibraryEntry } from "@shared/skill-library";
import { messages } from "@shared/messages";
import type { ProviderCapabilities } from "@shared/contracts";
import { useLocale } from "../../i18n";
import { useFeedback } from "../../feedback-context";
import { Button, FileDropzone, FormField, IconButton, ImageThumbnail, ImageViewer, Input, Select, Textarea } from "../../design-system/components";
import { SettingsPanel } from "../settings/SettingsPanel";

const m = messages.skillLibrary;

export function SkillAssetImage({ documentId, asset, onOpen }: { documentId: string; asset: SkillAsset; onOpen?(src: string): void }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let active = true; void window.openmind.readSkillAssetImage!(documentId, asset).then(value => { if (active) setSrc(value); }).catch(() => { if (active) setSrc(""); }); return () => { active = false; }; }, [documentId, asset.id]);
  return <ImageThumbnail label={m.preview} onClick={() => src && onOpen?.(src)}>{src ? <img src={src} alt={asset.name} /> : <ImagePlus aria-hidden />}</ImageThumbnail>;
}

export function SkillEditor({ initial, entries, providers, onClose, onSaved }: { initial: AuthoredSkill; entries: SkillLibraryEntry[]; providers: ProviderCapabilities[]; onClose(): void; onSaved(entry: SkillLibraryEntry): void }) {
  useLocale();
  const feedback = useFeedback();
  const [doc, setDoc] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<{ id: string; src: string } | null>(null);
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const [suggestionUndo, setSuggestionUndo] = useState<{ field: "name" | "subtitle" | "inputHint" | "description"; value: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const operation = useRef<{ hash: string; id: string } | null>(null);
  const applied = useRef(false);
  const latest = useRef(doc);
  latest.current = doc;
  useEffect(() => () => { if (!applied.current && JSON.stringify(latest.current) !== JSON.stringify(initial)) void window.openmind.saveSkillDraft!(latest.current).catch(() => undefined); }, []);
  const initialJson = JSON.stringify(initial);
  const changed = JSON.stringify(doc) !== initialJson;
  useEffect(() => {
    if (busy || !changed) return;
    const timeout = window.setTimeout(() => void window.openmind.saveSkillDraft!(doc).catch(cause => setError(String(cause))), 600);
    return () => clearTimeout(timeout);
  }, [doc, busy, changed]);
  const update = <K extends keyof AuthoredSkill>(key: K, value: AuthoredSkill[K]) => { setDoc(current => ({ ...current, [key]: value })); setFieldError(current => ({ ...current, [key]: "" })); };
  const updateBlock = (id: string, patch: Partial<AuthoredSkill["instructions"][number]>) => setDoc(current => ({ ...current, instructions: current.instructions.map(block => block.id === id ? { ...block, ...patch } : block) }));
  const moveBlock = (index: number, delta: number) => {
    const blocks = [...doc.instructions];
    [blocks[index], blocks[index + delta]] = [blocks[index + delta], blocks[index]];
    update("instructions", blocks);
  };
  const leave = async () => {
    if (busy) return;
    if (changed && !await feedback.confirm({ title: m.unsavedTitle, body: m.unsavedBody, confirmText: m.leave })) return;
    if (changed) { try { await window.openmind.saveSkillDraft!(doc); } catch (cause) { setError(String(cause)); return; } }
    onClose();
  };
  const save = async () => {
    const validation = AuthoredSkillSchema.safeParse(doc);
    const errors: Record<string, string> = {};
    if (!validation.success) for (const issue of validation.error.issues) errors[String(issue.path[0])] = issue.message;
    if (!doc.name.trim()) errors.name = m.errors.nameRequired;
    if (!doc.instructions.some(block => block.text.trim())) errors.instructions = m.errors.instructionRequired;
    setFieldError(errors);
    if (Object.keys(errors).length) { requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()); return; }
    setBusy(true); setError("");
    const hash = JSON.stringify(doc);
    if (operation.current?.hash !== hash) operation.current = { hash, id: crypto.randomUUID() };
    try { const entry = await window.openmind.publishSkill!({ document: doc, operationId: operation.current.id }); applied.current = true; onSaved(entry); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const importImages = async () => {
    try {
      await window.openmind.saveSkillDraft!(doc);
      const imported = await window.openmind.importSkillAssets!(doc.id, true);
      if (doc.images.length + imported.length > 4) { setError(m.errors.imageLimit); return; }
      update("images", [...doc.images, ...imported]);
    } catch (cause) { setError(String(cause)); }
  };
  const suggest = async (field: "name" | "subtitle" | "inputHint" | "description") => {
    const provider = providers.find(item => item.available);
    if (!provider) { setError(messages.ai.error.noProvider); return; }
    setSuggesting(field); setError("");
    try {
      const result = await window.openmind.suggestSkillField!({ field, document: doc, providerId: provider.id });
      if (await feedback.confirm({ title: m.suggestionTitle, body: result, confirmText: m.adopt })) { setSuggestionUndo({ field, value: doc[field] }); update(field, result); }
    } catch (cause) { setError(String(cause)); }
    finally { setSuggesting(null); }
  };
  const assisted = (field: "name" | "subtitle" | "inputHint" | "description", limit: number, multiline = false) => <div className="skill-editor-assisted-field">
    <FormField label={m[field]} hint={`${Array.from(doc[field]).length}/${limit}`} error={fieldError[field]}>
      {multiline ? <Textarea value={doc[field]} rows={field === "description" ? 8 : 3} onChange={event => update(field, event.target.value)} placeholder={field === "description" ? m.descriptionHint : m.inputHintHelp} disabled={busy} />
        : <Input value={doc[field]} onChange={event => update(field, event.target.value)} disabled={busy} />}
    </FormField>
    <div className="skill-editor-assistance-actions"><IconButton label={`${m.suggestion} · ${m[field]}`} disabled={busy || Boolean(suggesting)} onClick={() => void suggest(field)}><Sparkles size={15} aria-hidden /></IconButton>{suggestionUndo?.field === field ? <Button size="sm" variant="text" disabled={busy} onClick={() => { update(field, suggestionUndo.value); setSuggestionUndo(null); }}>{m.undoSuggestion}</Button> : null}</div>
  </div>;
  const models = [{ value: "auto", label: m.autoModel }, ...providers.filter(provider => provider.available).flatMap(provider => {
    const ids = new Set([provider.detectedModel].filter((id): id is string => Boolean(id) && id !== "auto"));
    return [...ids].map(id => ({ value: `${provider.provider}:${id}`, label: `${provider.label} · ${id}` }));
  })];
  const modelValue = doc.executionModel ? `${doc.executionModel.provider}:${doc.executionModel.model}` : "auto";
  if (!models.some(model => model.value === modelValue)) models.push({ value: modelValue, label: modelValue });

  return <form ref={formRef} className="skill-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <header className="skill-library-toolbar"><Button variant="ghost" onClick={() => void leave()} disabled={busy}><ArrowLeft size={16} />{m.back}</Button><div className="skill-library-toolbar-actions"><Button variant="ghost" onClick={() => void leave()} disabled={busy}>{m.cancel}</Button><Button type="submit" variant="primary" disabled={busy || initial.revision > 0 && !changed}>{busy ? m.saving : initial.revision ? m.save : m.create}</Button></div></header>
    {error ? <p role="alert" className="ui-error-state">{error}</p> : null}
    <SettingsPanel title={m.basicInformation}>
      <div className="skill-editor-basics">
        {assisted("name", 40)}{assisted("subtitle", 60)}
        <FormField label={m.category}><Select size="rect" value={doc.category} onChange={value => update("category", value)} options={SKILL_SCENES.map(value => ({ value, label: m.scenes[value] }))} disabled={busy} /></FormField>
        <FormField label={m.icon}><Select size="rect" value={doc.icon} options={[{ value: "auto", label: m.autoIcon }, ...SKILL_SCENES.map(value => ({ value, label: m.scenes[value] }))]} onChange={value => update("icon", value as AuthoredSkill["icon"])} disabled={busy} /></FormField>
      </div>
    </SettingsPanel>
    <SettingsPanel title={m.instructions}>
      <div className="skill-editor-instructions">
      {doc.instructions.map((block, index) => <section key={block.id} className="skill-editor-block workspace-card">
        <FormField label={`${m.instructions} ${index + 1}`} error={fieldError.instructions}><Textarea value={block.text} rows={7} placeholder={m.instructionHint} onChange={event => updateBlock(block.id, { text: event.target.value })} disabled={busy} /></FormField>
        <div className="skill-editor-block-actions"><Button variant="ghost" size="sm" disabled={busy} onClick={async () => { try { await window.openmind.saveSkillDraft!(doc); const assets = await window.openmind.importSkillAssets!(doc.id, false); updateBlock(block.id, { assets: [...block.assets, ...assets] }); } catch (cause) { setError(String(cause)); } }}><Plus size={15} />{m.attach}</Button>
          <Select size="pill" ariaLabel={m.referenceSkill} placeholder={m.referenceSkill} value="" options={entries.filter(entry => entry.installed && entry.enabled && entry.usable && entry.authoringId !== doc.id && entry.key && !block.skills.some(reference => reference.key === entry.key)).map(entry => ({ value: entry.key!, label: entry.title }))} onChange={value => { const entry = entries.find(item => item.key === value); if (entry?.key && entry.digest) updateBlock(block.id, { skills: [...block.skills, { key: entry.key, digest: entry.digest }] }); }} disabled={busy} />
          <span className="skill-editor-block-spacer" /><IconButton label={m.up} disabled={busy || index === 0} onClick={() => moveBlock(index, -1)}><ArrowUp size={15} /></IconButton><IconButton label={m.down} disabled={busy || index === doc.instructions.length - 1} onClick={() => moveBlock(index, 1)}><ArrowDown size={15} /></IconButton><IconButton label={m.removeBlock} disabled={busy || doc.instructions.length === 1} onClick={() => update("instructions", doc.instructions.filter(item => item.id !== block.id))}><Trash2 size={15} /></IconButton>
        </div>
        {block.assets.length || block.skills.length ? <div className="skill-editor-references">{block.assets.map(asset => <span key={asset.id}>{asset.name}<IconButton size="sm" label={m.removeReference} onClick={() => updateBlock(block.id, { assets: block.assets.filter(item => item.id !== asset.id) })}><X size={12} /></IconButton></span>)}{block.skills.map(reference => <span key={reference.key}>{entries.find(entry => entry.key === reference.key)?.title || reference.key}<IconButton size="sm" label={m.removeReference} onClick={() => updateBlock(block.id, { skills: block.skills.filter(item => item.key !== reference.key) })}><X size={12} /></IconButton></span>)}</div> : null}
      </section>)}
      <Button variant="ghost" disabled={busy || doc.instructions.length >= 20} onClick={() => update("instructions", [...doc.instructions, { id: crypto.randomUUID(), text: "", assets: [], skills: [] }])}><Plus size={16} />{m.addBlock}</Button>
      </div>
    </SettingsPanel>
    <SettingsPanel title={m.usageAndPresentation}>
      <div className="skill-editor-usage">
    <FormField label={m.executionModel} hint={m.modelHelp}><Select size="rect" value={modelValue} options={models} disabled={busy} onChange={value => { const split = value.indexOf(":"); update("executionModel", value === "auto" ? null : { provider: value.slice(0, split) as "codex" | "claude", model: value.slice(split + 1) }); }} /></FormField>
    {assisted("inputHint", 200, true)}
    <section className="skill-editor-gallery" aria-label={m.images}><h3>{m.images} ({doc.images.length}/4)</h3><div className="skill-editor-gallery-grid">{doc.images.map((asset, index) => <div key={asset.id} className="skill-editor-gallery-item"><SkillAssetImage documentId={doc.id} asset={asset} onOpen={src => setViewer({ id: asset.id, src })} /><div className="skill-editor-gallery-actions"><IconButton size="sm" label={m.up} disabled={busy || !index} onClick={() => { const images = [...doc.images]; [images[index - 1], images[index]] = [images[index], images[index - 1]]; update("images", images); }}><ArrowUp size={14} /></IconButton><IconButton size="sm" label={m.removeImage} disabled={busy} onClick={() => update("images", doc.images.filter(item => item.id !== asset.id))}><X size={14} /></IconButton></div></div>)}<div className="skill-editor-gallery-add"><FileDropzone variant="compact" label={m.addImage} disabled={busy || doc.images.length >= 4} onClick={() => void importImages()}><ImagePlus size={23} /><span>{m.addImage}</span></FileDropzone></div></div></section>
    {assisted("description", 5000, true)}
      </div>
    </SettingsPanel>
    <ImageViewer open={Boolean(viewer)} images={doc.images.map(asset => ({ id: asset.id, title: asset.name }))} selectedId={viewer?.id || null} src={viewer?.src} onClose={() => setViewer(null)} onSelect={id => { const asset = doc.images.find(item => item.id === id); if (asset) void window.openmind.readSkillAssetImage!(doc.id, asset).then(src => setViewer({ id, src })); }} />
  </form>;
}
