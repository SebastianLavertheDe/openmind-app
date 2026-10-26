import { useEffect, useRef, useState } from "react";
import { Package, X } from "lucide-react";
import type { SkillLibraryEntry } from "@shared/skill-library";
import { messages } from "@shared/messages";
import { useLocale } from "../../i18n";
import { Button, IconButton, MenuItem, Popover, SearchInput } from "../../design-system/components";
import { INSTALLED_SKILL_CATALOG_CHANGED_EVENT } from "../../installed-skill-events";

const m = messages.skillLibrary;
export function ComposerSkillPicker({ selected, onSelect, onManage }: { selected: SkillLibraryEntry | null; onSelect(entry: SkillLibraryEntry | null): void; onManage(): void }) {
  const locale = useLocale();
  const anchor = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<SkillLibraryEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!window.openmind.listSkillLibrary) return;
    let active = true;
    const refresh = () => void window.openmind.listSkillLibrary!().then(result => { if (active) { setEntries(result.filter(entry => entry.installed && entry.enabled)); setError(""); } }).catch(cause => { if (active) setError(String(cause)); });
    refresh(); window.addEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, refresh); };
  }, [open, locale]);
  useEffect(() => { if (open) requestAnimationFrame(() => surface.current?.querySelector<HTMLInputElement>("input")?.focus()); }, [open]);
  if (!window.openmind.listSkillLibrary) return null;
  const results = entries.filter(entry => `${entry.title} ${entry.description} ${entry.skillId}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="composer-skill-picker">
    {selected ? <><Button variant="ghost" size="sm" onClick={() => setOpen(value => !value)} aria-label={m.change}><Package size={15} aria-hidden /><span>{selected.title}</span></Button><IconButton size="sm" label={m.clearSelection} onClick={() => onSelect(null)}><X size={13} /></IconButton></> : null}
    <IconButton ref={anchor} label={selected ? m.change : m.use} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}><Package size={18} /></IconButton>
    <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} side="top" align="start" role="dialog" aria-label={m.use} className="composer-skill-popover">
      <div ref={surface} className="composer-skill-menu" onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = [...(surface.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") || [])];
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
        <SearchInput aria-label={m.search} placeholder={m.search} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.nativeEvent.isComposing) event.stopPropagation(); }} />
        {error ? <p role="alert">{error}</p> : null}
        <div className="composer-skill-options">{!results.length ? <p>{m.empty}</p> : results.map(entry => <MenuItem key={entry.id} disabled={!entry.usable || Boolean(entry.reason)} onClick={() => { onSelect(entry); setOpen(false); anchor.current?.focus(); }}><span className="composer-skill-option-copy"><strong>{entry.title}</strong><small>{entry.reason || (entry.category ? m.scenes[entry.category] : m.origin[entry.origin])}</small></span></MenuItem>)}</div>
        <MenuItem onClick={() => { setOpen(false); onManage(); }}><Package size={15} />{m.manage}</MenuItem>
      </div>
    </Popover>
  </div>;
}
