import { useRef, useState } from "react";
import { CircleAlert, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react";
import type { RssSourceView } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { Button, CopyButton, IconButton, MenuItem, Popover, StatusBadge, ToggleSwitch } from "../../design-system/components";
import { categoryLabel, errorSummary, feedLabel, shortUrl, sourceTime } from "./rss-source-presentation";
import { RssCategoryIcon } from "./RssCategoryIcon";

export function SourceMenu({ source, disabled, onRemove }: { source: RssSourceView; disabled?: boolean; onRemove(): void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return <><IconButton ref={anchor} label={`${m.rss.more}: ${source.name}`} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={16} /></IconButton>
    <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} role="menu" modal aria-label={`${m.rss.more}: ${source.name}`}>
      <MenuItem tone="danger" onClick={() => { setOpen(false); onRemove(); }}><Trash2 size={16} />{m.rss.remove}</MenuItem>
    </Popover></>;
}

export function RssSourceCard({ source, busy, selected, onOpen, onEdit, onToggle, onRun, onRemove }: {
  source: RssSourceView; busy?: string; selected?: boolean;
  onOpen(trigger: HTMLElement, error?: boolean): void; onEdit(trigger: HTMLElement): void; onToggle(): void; onRun(): void; onRemove(): void;
}) {
  return <article className="workspace-card rss-source-card" aria-label={source.name} data-source-id={source.id}>
    <div className="rss-card-heading">
      <span className="rss-card-category" title={categoryLabel(source.group)}>{categoryLabel(source.group)}</span>
      <div className="rss-card-heading-actions">
        {source.lastError ? <IconButton tone="danger" label={`${m.rss.technicalError}: ${source.name}`} tooltip={<>{m.rss.previousError}: {errorSummary(source.lastError)}<span className="rss-card-error-message">{source.lastError.message}</span></>} aria-haspopup="dialog" onClick={event => onOpen(event.currentTarget, true)}><CircleAlert size={16} aria-hidden="true" /></IconButton> : null}
        <ToggleSwitch checked={source.enabled} disabled={Boolean(busy) || !source.inputUrl} label={`${source.name} — ${source.enabled ? m.rss.enabled : m.rss.disabled}`} onChange={onToggle} />
      </div>
    </div>
    <button type="button" className="rss-card-subject" data-motion="selection" aria-haspopup="dialog" aria-pressed={Boolean(selected)} aria-label={`${m.rss.details}: ${source.name}`} onClick={event => onOpen(event.currentTarget)}>
      <span className="rss-card-cover"><RssCategoryIcon category={source.group} size={32} /></span>
      <strong className="rss-card-title" title={source.name}>{source.name}</strong>
    </button>
    <div className="rss-card-facts"><StatusBadge tone={source.localFeed.status === "ready" ? "success" : "neutral"}>{feedLabel(source)}</StatusBadge><span>{m.rss.rssItems(source.itemCount)}</span></div>
    <div className="rss-card-time">{m.rss.syncTime}: {sourceTime(source.lastSyncAt)}</div>
    <div className="rss-source-address">{source.inputUrl ? <><a href={source.inputUrl} title={source.inputUrl} aria-label={source.inputUrl} onClick={event => { event.preventDefault(); void window.openmind.openExternal(source.inputUrl); }}>{shortUrl(source.inputUrl)}</a><CopyButton text={source.inputUrl} label={`${m.rss.copy}: ${source.name}`} /></> : <span>{m.rss.pending}</span>}</div>
    <footer className="rss-card-footer"><Button size="sm" variant="ghost" loading={busy === "pipeline"} disabled={Boolean(busy) || !source.enabled || !source.inputUrl} aria-label={`${m.rss.pipeline}: ${source.name}`} onClick={onRun}><RefreshCw size={14} />{m.rss.pipeline}</Button>
      <IconButton label={`${m.rss.edit}: ${source.name}`} disabled={Boolean(busy)} onClick={event => onEdit(event.currentTarget)}><Pencil size={16} /></IconButton>
      <SourceMenu source={source} disabled={Boolean(busy)} onRemove={onRemove} />
    </footer>
  </article>;
}
