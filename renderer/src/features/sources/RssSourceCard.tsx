import { memo } from "react";
import { CircleAlert } from "lucide-react";
import type { RssSourceView } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { IconButton, StatusBadge } from "../../design-system/components";
import { categoryLabel, errorSummary, feedLabel, shortUrl, sourceTime } from "./rss-source-presentation";
import { useLocale } from "../../i18n";
import { RssCategoryIcon } from "./RssCategoryIcon";

export const RssSourceCard = memo(function RssSourceCard({ source, selected, onOpen, onEdit }: {
  source: RssSourceView; selected?: boolean;
  onOpen(id: string, trigger: HTMLElement, error?: boolean): void;
  onEdit(id: string, trigger: HTMLElement): void;
}) {
  useLocale();
  return <article className="workspace-card rss-source-card" aria-label={source.name} data-source-id={source.id}>
    <button type="button" className="source-card-open rss-card-open" data-motion="selection" aria-haspopup="dialog" aria-pressed={Boolean(selected)} aria-label={`${m.rss.edit}: ${source.name}`} onClick={event => onEdit(source.id, event.currentTarget)} />
    <div className="rss-card-heading">
      <div className="rss-card-subject">
        <strong className="rss-card-title" title={source.name}>{source.name}</strong>
        <span className="rss-card-category" title={categoryLabel(source.group)}><RssCategoryIcon category={source.group} /><span>{categoryLabel(source.group)}</span></span>
      </div>
      {source.localFeed.status === "ready" || source.lastError ? <div className="rss-card-indicators">
        {source.localFeed.status === "ready" && !source.lastError ? <span className="rss-card-ready-dot" role="img" aria-label={m.rss.rssReady} title={m.rss.rssReady} /> : null}
        {source.lastError ? <IconButton tone="danger" label={`${m.rss.technicalError}: ${source.name}`} tooltip={<>{m.rss.previousError}: {errorSummary(source.lastError)}<span className="rss-card-error-message">{source.lastError.message}</span></>} aria-haspopup="dialog" onClick={event => onOpen(source.id, event.currentTarget, true)}><CircleAlert size={16} aria-hidden="true" /></IconButton> : null}
      </div> : null}
    </div>
    <div className="rss-card-facts">{source.localFeed.status !== "ready" ? <StatusBadge tone="neutral">{feedLabel(source)}</StatusBadge> : null}<span className="rss-card-count">{m.rss.rssItems(source.itemCount)}</span>
      {!source.enabled ? <StatusBadge tone="neutral">{m.rss.disabled}</StatusBadge> : null}
    </div>
    <div className="rss-card-time" title={`${m.rss.syncTime}: ${sourceTime(source.lastSyncAt)}`}>{m.rss.syncTime}: {sourceTime(source.lastSyncAt, true)}</div>
    <div className="rss-source-address">{source.inputUrl ? <a href={source.inputUrl} title={source.inputUrl} aria-label={source.inputUrl} onClick={event => { event.preventDefault(); void window.openmind.openExternal(source.inputUrl); }}>{shortUrl(source.inputUrl)}</a> : <span>{m.rss.pending}</span>}</div>
  </article>;
});
