import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, FileText, Film, Globe, Image, Layers, LayoutGrid, Package, Plus, Search } from "lucide-react";
import { messages } from "@shared/messages";
import { filterSkillLibrary, SKILL_SCENES, type AuthoredSkill, type SkillLibraryEntry, type SkillLibraryMode, type SkillLibrarySection, type SkillScene } from "@shared/skill-library";
import type { ProviderCapabilities } from "@shared/contracts";
import { useLocale } from "../../i18n";
import { useFeedback } from "../../feedback-context";
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, ImageViewer, SearchInput, SegmentedControl, Select, StatusBadge, Tabs } from "../../design-system/components";
import { INSTALLED_SKILL_CATALOG_CHANGED_EVENT, notifyInstalledSkillCatalogChanged } from "../../installed-skill-events";
import { SkillAssetImage, SkillEditor } from "./SkillEditor";

const m = messages.skillLibrary;
const ICONS = { research: BookOpen, writing: FileText, image: Image, slides: Layers, video: Film, web: Globe };
const COVER_CLASSES = { research: "skill-library-cover-research", writing: "skill-library-cover-writing", image: "skill-library-cover-image", slides: "skill-library-cover-slides", video: "skill-library-cover-video", web: "skill-library-cover-web" };
type Filters = { section: SkillLibrarySection; query: string; origin: string; sort: string };
const emptyFilters = (): Filters => ({ section: "all", query: "", origin: "all", sort: "default" });

function SkillCover({ entry }: { entry: SkillLibraryEntry }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    if (entry.cover && entry.authoringId) void window.openmind.readSkillAssetImage!(entry.authoringId, entry.cover).then(value => { if (active) setSrc(value); }).catch(() => { if (active) setSrc(""); });
    else setSrc("");
    return () => { active = false; };
  }, [entry.cover?.id, entry.authoringId]);
  const scene = entry.icon && entry.icon !== "auto" ? entry.icon : entry.category;
  const Icon = scene ? ICONS[scene] : Package;
  return <div className={`skill-library-cover ${entry.category ? COVER_CLASSES[entry.category] : "skill-library-cover-imported"}${src ? " skill-library-cover-preview" : ""}`}>{src ? <img src={src} alt={entry.title} /> : <><Icon size={32} strokeWidth={1.5} aria-hidden /><span>{entry.category ? m.scenes[entry.category] : m.origin[entry.origin]}</span></>}</div>;
}

export function SkillLibraryPage({ providers, initialMode, storageScope, initialSourcePickerOpen, initialManagementSkillId, onUseSkill, onConfigure, onCatalogChange, renderManagement, renderImport }: {
  providers: ProviderCapabilities[]; initialMode?: SkillLibraryMode; storageScope: string; initialSourcePickerOpen?: boolean;
  initialManagementSkillId?: string; onCatalogChange?(): unknown | Promise<unknown>;
  onUseSkill?(entry: SkillLibraryEntry): void | Promise<void>; onConfigure?(kind: "image" | "runtime"): void;
  renderManagement(id?: string): ReactNode; renderImport(done: () => Promise<void>, close: () => void): ReactNode;
}) {
  const locale = useLocale();
  const feedback = useFeedback();
  const storageKey = `openmind.skill-library.${storageScope}`;
  const [preferences] = useState(() => { try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; } });
  const [mode, setMode] = useState<SkillLibraryMode>(initialMode || (preferences.mode === "mine" ? "mine" : "explore"));
  const [filters, setFilters] = useState<Record<SkillLibraryMode, Filters>>({ explore: { ...emptyFilters(), ...preferences.explore }, mine: { ...emptyFilters(), ...preferences.mine } });
  const [entries, setEntries] = useState<SkillLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkillLibraryEntry | null>(null);
  const [preview, setPreview] = useState<{ id: string; src: string } | null>(null);
  const [editor, setEditor] = useState<AuthoredSkill | null>(null);
  const [management, setManagement] = useState<string | null>(initialManagementSkillId ?? null);
  const [importOpen, setImportOpen] = useState(Boolean(initialSourcePickerOpen));
  const load = useCallback(async () => {
    try { setEntries(await window.openmind.listSkillLibrary!()); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); window.addEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, load); return () => window.removeEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, load); }, [load, locale]);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify({ mode, ...filters })); }, [storageKey, mode, filters]);
  const filter = filters[mode];
  const update = (patch: Partial<Filters>) => setFilters(current => ({ ...current, [mode]: { ...current[mode], ...patch } }));
  const section: SkillLibrarySection = mode === "explore" && ["github-installed", "local-imported"].includes(filter.section) ? "all" : filter.section;
  const shown = useMemo(() => {
    const result = filterSkillLibrary(entries, mode, section, filter.query, ["github-installed", "local-imported"].includes(section) ? "all" : filter.origin);
    return filter.sort === "name" ? result.sort((a, b) => a.title.localeCompare(b.title, locale)) : filter.sort === "updated" ? result.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")) : result;
  }, [entries, mode, section, filter, locale]);
  const sections: SkillLibrarySection[] = ["all", ...SKILL_SCENES, ...(mode === "mine" ? ["github-installed", "local-imported"] as const : [])];
  const changed = async () => { await load(); await onCatalogChange?.(); notifyInstalledSkillCatalogChanged(); };
  const run = async (entry: SkillLibraryEntry) => {
    setBusy(entry.id); setError("");
    try {
      let usable = entry;
      if (!entry.installed) usable = await window.openmind.installLibraryPreset!(entry.id);
      if (!usable.key || !usable.digest) throw new Error(m.errors.stale);
      if (!usable.enabled) { await window.openmind.setInstalledSkillEnabled(usable.key, usable.digest, true); usable = { ...usable, enabled: true }; }
      await changed(); setSelected(null); await onUseSkill?.(usable);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const openEditor = async (entry?: SkillLibraryEntry, copy = false) => {
    setError("");
    try {
      const doc = copy && entry?.key && entry.digest ? await window.openmind.copyLibrarySkill!({ key: entry.key, digest: entry.digest }) : await window.openmind.getSkillEditor!(entry?.authoringId || undefined);
      setSelected(null); setEditor(doc);
    } catch (cause) { setError(String(cause)); }
  };
  const remove = async (entry: SkillLibraryEntry) => {
    if (!entry.authoringId || !await feedback.confirm({ title: m.deleteTitle, body: m.deleteBody, confirmText: m.remove, danger: true })) return;
    try { await window.openmind.deleteAuthoredSkill!(entry.authoringId); setSelected(null); await changed(); } catch (cause) { setError(String(cause)); }
  };
  if (editor) return <SkillEditor key={editor.id} initial={editor} entries={entries} providers={providers} onClose={() => { setEditor(null); setMode("mine"); void load(); }} onSaved={entry => { setEditor(null); setMode("mine"); setFilters(current => ({ ...current, mine: { ...emptyFilters(), section: entry.category || "all" } })); void changed(); }} />;
  return <div className="skill-library">
    <header className="skill-library-toolbar">
      <div className="skill-library-heading"><SegmentedControl value={mode} onChange={setMode} variant="compact" label={m.views} options={[{ value: "explore", label: m.explore }, { value: "mine", label: m.mine }]} /></div>
      <div className="skill-library-toolbar-actions">
        <div className="skill-library-search"><SearchInput aria-label={m.search} placeholder={m.search} value={filter.query} onChange={event => update({ query: event.target.value })} clearAction={filter.query ? { label: messages.skillCenter.clearSearch, onClear: () => update({ query: "" }) } : undefined} /></div>
        <Button variant="ghost" onClick={() => setImportOpen(true)}>{m.import}</Button>
        <Button variant="primary" onClick={() => void openEditor()}><Plus size={15} />{m.create}</Button>
      </div>
    </header>
    <div className="skill-library-category-scroll"><Tabs<SkillLibrarySection> value={section} onChange={value => update({ section: value })} variant="pill" label={m.categories} tabs={sections.map(value => ({ value, label: m.scenes[value], icon: value === "all" ? <LayoutGrid size={14} /> : value in ICONS ? (() => { const Icon = ICONS[value as SkillScene]; return <Icon size={14} />; })() : <Package size={14} /> }))} /></div>
    {error ? <p role="alert" className="ui-error-state">{error}</p> : null}
    <div className="skill-library-results">
      <span role="status">{loading ? m.loading : m.count(shown.length)}</span>
      <div className="skill-library-filter-actions">
        {mode === "mine" && !["github-installed", "local-imported"].includes(section) ? <Select ariaLabel={m.origin.all} value={filter.origin} onChange={origin => update({ origin })} options={["all", "preset", "authored", "imported"].map(value => ({ value, label: m.origin[value as "all" | "preset" | "authored" | "imported"] }))} /> : null}
        <Select ariaLabel={m.sort} value={filter.sort} onChange={sort => update({ sort })} options={[{ value: "default", label: m.defaultSort }, { value: "name", label: m.nameSort }, { value: "updated", label: m.updatedSort }]} />
        {mode === "mine" ? <Button variant="text" onClick={() => setManagement("")}>{m.settings}</Button> : null}
      </div>
    </div>
    {!loading && !shown.length ? <div className="skill-library-empty"><Search size={27} aria-hidden /><h3>{m.empty}</h3><p>{m.emptyHint}</p></div> : null}
    <div className="skill-library-grid">{shown.map(entry => {
      const actionable = entry.usable && !entry.reason && !(entry.origin === "authored" && !entry.installed);
      return <article key={entry.id} className="skill-library-card workspace-card"><button type="button" className="skill-library-card-select" data-motion="selection" aria-haspopup="dialog" aria-pressed={selected?.id === entry.id} aria-label={entry.title || m.draft} onClick={() => setSelected(entry)}><SkillCover entry={entry} /><strong>{entry.title || m.draft}</strong><p>{entry.subtitle || entry.description}</p></button><div className="skill-library-card-footer"><StatusBadge tone={entry.reason || !entry.enabled && entry.installed ? "warning" : "neutral"}>{entry.draft ? m.draft : entry.reason ? m.unavailable : entry.installed ? entry.enabled ? m.ready : m.disabled : m.origin.preset}</StatusBadge>{entry.origin === "authored" && !entry.installed ? <Button size="sm" variant="ghost" onClick={() => void openEditor(entry)}>{m.continueEdit}</Button> : <Button size="sm" variant="ghost" disabled={Boolean(busy) || !actionable} onClick={() => void run(entry)}>{busy === entry.id ? m.busy : !entry.installed ? m.installUse : entry.enabled ? m.use : m.enableUse}</Button>}</div>{entry.reason ? <p className="skill-library-card-reason">{entry.reason}</p> : null}</article>;
    })}</div>
    <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} size="lg" aria-label={selected?.title || m.title}><DialogHeader titleId="skill-library-detail-title" title={selected?.title || m.title} onClose={() => setSelected(null)} closeLabel={messages.skillCenter.common.close} /><DialogBody>{selected ? <div className="skill-library-detail"><p>{selected.description || selected.subtitle}</p>{selected.authoringId && selected.images?.length ? <div className="skill-editor-gallery-grid">{selected.images.map(asset => <SkillAssetImage key={asset.id} documentId={selected.authoringId!} asset={asset} onOpen={src => setPreview({ id: asset.id, src })} />)}</div> : null}<dl><dt>{m.category}</dt><dd>{selected.category ? m.scenes[selected.category] : m.origin[selected.origin]}</dd><dt>{m.origin.all}</dt><dd>{selected.source}</dd>{selected.version ? <><dt>{messages.skillCenter.sourcePicker.version}</dt><dd>{selected.version}</dd></> : null}</dl>{selected.reason ? <p role="status">{selected.reason}</p> : null}{selected.reason ? <Button onClick={() => onConfigure?.(selected.category === "image" ? "image" : "runtime")}>{m.unavailable}</Button> : null}</div> : null}</DialogBody><DialogFooter>{selected?.origin === "authored" ? <><Button variant="ghost" onClick={() => void remove(selected)}>{m.remove}</Button><Button onClick={() => void openEditor(selected)}>{m.edit}</Button></> : selected?.installed ? <Button variant="ghost" onClick={() => void openEditor(selected, true)}>{m.copy}</Button> : null}{selected?.installed ? <Button variant="ghost" onClick={() => { setManagement(selected.skillId); setSelected(null); }}>{m.settings}</Button> : null}{selected && (selected.installed || selected.origin === "preset") ? <Button variant="primary" disabled={Boolean(busy) || !selected.usable || Boolean(selected.reason)} onClick={() => void run(selected)}>{selected.installed ? m.use : m.installUse}</Button> : null}</DialogFooter></Dialog>
    <Dialog open={management !== null} onClose={() => { setManagement(null); void changed(); }} size="lg" aria-label={m.settings}><DialogHeader titleId="skill-library-management-title" title={m.settings} onClose={() => { setManagement(null); void changed(); }} closeLabel={messages.skillCenter.common.close} /><DialogBody>{management !== null ? renderManagement(management || undefined) : null}</DialogBody></Dialog>
    <ImageViewer open={Boolean(preview && selected)} images={(selected?.images || []).map(asset => ({ id: asset.id, title: asset.name }))} selectedId={preview?.id || null} src={preview?.src} onClose={() => setPreview(null)} onSelect={id => { const asset = selected?.images?.find(item => item.id === id); if (asset && selected?.authoringId) void window.openmind.readSkillAssetImage!(selected.authoringId, asset).then(src => setPreview({ id, src })); }} />
    {importOpen ? renderImport(async () => { setImportOpen(false); setMode("mine"); setFilters(current => ({ ...current, mine: { ...current.mine, section: "all" } })); await changed(); }, () => setImportOpen(false)) : null}
  </div>;
}
