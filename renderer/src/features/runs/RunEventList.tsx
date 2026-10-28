import type { BrokerRunEvent } from "@shared/contracts";
import { getLocale, messages as m } from "@shared/messages";
import { useLocale } from "../../i18n";
import { LoadingState } from "../../design-system/components";

/** Shared log presentation; each caller owns its scoped query and pagination. */
export function RunEventList({ events, loading }: { events: BrokerRunEvent[]; loading: boolean }) {
  useLocale();
  if (loading && !events.length) return <div className="run-events-loading" role="status" aria-live="polite"><LoadingState label={m.runs.events.loading} /></div>;
  if (!events.length) return <p className="runs-muted">{m.runs.events.empty}</p>;
  return <div className="run-event-list run-events-ready">{events.map(event => <div key={`${event.runId}-${event.sequence}`} className="run-event-row"><time>{new Date(event.timestamp).toLocaleString(getLocale(), { hour12: false })}</time><strong>{event.state}</strong><span>{event.text || event.reason || event.error || ""}</span></div>)}</div>;
}
