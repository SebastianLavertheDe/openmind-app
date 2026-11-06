import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, FileText, Film, Globe, Image, Layers, Package } from "lucide-react";
import { messages } from "@shared/messages";
import { SKILL_SCENES, type SkillLibraryEntry, type SkillLibrarySnapshot, type SkillScene } from "@shared/skill-library";
import { useAiActions, useAiDraft, useAiSnapshot, useAiUi } from "../../ai-context";
import { Button, Tabs } from "../../design-system/components";
import { INSTALLED_SKILL_CATALOG_CHANGED_EVENT, notifyInstalledSkillCatalogChanged } from "../../installed-skill-events";
import { useLocale } from "../../i18n";
import { SkillDetailsView } from "../skills/SkillDetailsView";
import { isRecommendedSkill, skillCardCover } from "./new-task-covers";

const m = messages.skillLibrary;
const SCENE_ICONS = { research: BookOpen, writing: FileText, image: Image, slides: Layers, video: Film, web: Globe };

export function NewTaskHome({ composer }: { composer: ReactNode }) {
  const locale = useLocale();
  const actions = useAiActions();
  const ui = useAiUi();
  const { snapshot } = useAiSnapshot();
  const { setSelectedSkill } = useAiDraft();
  const [entries, setEntries] = useState<SkillLibraryEntry[]>([]);
  const [category, setCategory] = useState<"recommended" | SkillScene>("recommended");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [remote, setRemote] = useState<SkillLibrarySnapshot["remote"] | null>(null);
  const [selected, setSelected] = useState<SkillLibraryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const request = useRef(0);
  const scopeEpoch = useRef(0);
  const hasLibrary = Boolean(window.openmind.getSkillLibrarySnapshot || window.openmind.listSkillLibrary);
  const load = useCallback(async (refresh = false) => {
    const revision = ++request.current;
    setLoading(true);
    try {
      const next = window.openmind.getSkillLibrarySnapshot ? await window.openmind.getSkillLibrarySnapshot(refresh) : null;
      const result = next?.entries ?? await window.openmind.listSkillLibrary!();
      if (request.current !== revision) return;
      setEntries(result.filter(entry => entry.origin === "preset" && entry.discoverable !== false));
      setRemote(next?.remote ?? null);
      setLoadError(false);
    } catch {
      if (request.current === revision) setLoadError(true);
    } finally {
      if (request.current === revision) setLoading(false);
    }
  }, [snapshot.projectRoot]);
  useEffect(() => {
    setEntries([]); setSelected(null); setRemote(null); setLoadError(false); setBusy(false); setActionError("");
    if (!hasLibrary) return;
    const reload = () => { void load(); };
    reload();
    window.addEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, reload);
    return () => { request.current++; scopeEpoch.current++; window.removeEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, reload); };
  }, [hasLibrary, load, locale]);

  const choose = async (entry: SkillLibraryEntry) => {
    if (busy) return;
    const epoch = scopeEpoch.current;
    setBusy(true); setActionError("");
    try {
      let skill = !entry.installed || entry.updateAvailable ? await window.openmind.installLibraryPreset!(entry.id) : entry;
      if (scopeEpoch.current !== epoch) return;
      if (!skill.key || !skill.digest || !skill.usable || skill.reason) throw new Error(skill.reason || m.errors.stale);
      if (!skill.enabled) {
        await window.openmind.setInstalledSkillEnabled(skill.key, skill.digest, true);
        skill = { ...skill, enabled: true };
      }
      if (scopeEpoch.current !== epoch) return;
      await actions.refreshSkills();
      if (scopeEpoch.current !== epoch) return;
      setSelectedSkill(skill);
      notifyInstalledSkillCatalogChanged();
      ui.focusComposer();
      setSelected(null);
    } catch (cause) {
      if (scopeEpoch.current === epoch) setActionError(cause instanceof Error ? cause.message : m.errors.stale);
    } finally { if (scopeEpoch.current === epoch) setBusy(false); }
  };
  const shown = category === "recommended" ? entries.filter(isRecommendedSkill) : entries.filter(entry => entry.category === category);

  return <section className={`chat new-task-home${selected ? " new-task-home--detail" : ""}`} aria-label={messages.ai.chat.newTaskTitle}>
    <div hidden={Boolean(selected)}>
    <header className="new-task-hero">
      <h1>{messages.ai.chat.newTaskTitle}</h1>
      <div className="new-task-composer">{composer}</div>
    </header>
    {hasLibrary ? <section className="new-task-library" aria-label={m.recommended}>
      <header className="new-task-library-header">
        <div className="new-task-categories"><Tabs<"recommended" | SkillScene> variant="pill" label={m.categories} value={category} onChange={setCategory}
          tabs={[{ value: "recommended", label: m.recommended }, ...SKILL_SCENES.map(value => ({ value, label: m.scenes[value] }))]} /></div>
        <Button variant="text" size="sm" trailingIcon={<ArrowRight size={14} />} onClick={() => ui.openSkillSettings("explore")}>{m.browseAll}</Button>
      </header>
      {loadError || remote && remote.state !== "fresh" ? <div className="new-task-library-status"><p role={loadError ? "alert" : "status"}>{loadError ? m.loadFailed : remote?.state === "cached" ? m.offlineCached : m.remoteUnavailable}</p><Button variant="ghost" disabled={loading} onClick={() => void load(true)}>{m.retry}</Button></div> : null}
      {loading && !entries.length ? <p className="new-task-library-status" role="status">{m.loading}</p>
        : !shown.length ? !loadError && remote?.state !== "unavailable" ? <p className="new-task-library-status" role="status">{m.empty}</p> : null
        : <>
          {actionError ? <p className="new-task-library-status" role="alert">{actionError}</p> : null}
          <div className="new-task-skill-grid entrance-stagger" key={category}>{shown.map(entry => {
            const Icon = entry.category ? SCENE_ICONS[entry.category] : Package;
            const cover = skillCardCover(entry, entries);
            return <article key={entry.id} className="new-task-skill-card" data-entrance-item data-motion="selection">
              <div className="new-task-skill-media">
                {cover ? <img className="new-task-skill-cover" src={cover} alt="" loading="lazy" width={432} height={256} /> : <div className="new-task-skill-cover new-task-skill-cover-fallback"><Icon size={40} strokeWidth={1.5} aria-hidden /></div>}
                <span className="new-task-skill-use"><Button size="sm" disabled={busy} aria-label={`${entry.title} · ${m.use}`} onClick={() => void choose(entry)}>{m.use}</Button></span>
              </div>
              <span className="new-task-skill-title">{entry.title}</span>
              <span className="new-task-skill-category"><Icon size={12} strokeWidth={1.5} aria-hidden />{entry.category ? m.scenes[entry.category] : m.origin[entry.origin]}</span>
              <button type="button" className="new-task-skill-open" data-motion="selection" aria-label={entry.title} aria-haspopup="dialog" aria-pressed={selected?.id === entry.id}
                onClick={() => { setActionError(""); setSelected(entry); }} />
            </article>;
          })}</div>
        </>}
    </section> : null}
    </div>
    {selected ? <SkillDetailsView key={selected.id} entry={selected} entries={entries} providers={snapshot.providers} busy={busy} error={actionError}
      onBack={() => { setSelected(null); ui.focusComposer(); }} actions={<>
        <Button variant="ghost" disabled={busy} onClick={() => ui.openSkillSettings("explore")}>{m.browseAll}</Button>
        <Button variant="primary" loading={busy} disabled={!selected.usable || Boolean(selected.reason)} onClick={() => void choose(selected)}>{selected.installed ? selected.enabled ? m.use : m.enableUse : m.installUse}</Button>
      </>} /> : null}
  </section>;
}
