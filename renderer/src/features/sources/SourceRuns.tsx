import { useEffect, useRef, useState } from "react";
import type { BrokerRunEvent } from "@shared/contracts";
import type { RssSourceRun } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { Button, EmptyState, ErrorState, LoadingState, StatusBadge } from "../../design-system/components";
import { RunEventList } from "../runs/RunEventList";
import { errorSummary, sourceTime } from "./rss-source-presentation";

function stateLabel(run: RssSourceRun) {
  if (run.outcome) return run.outcome === "succeeded" ? m.runs.state.succeeded : run.outcome === "failed" ? m.runs.state.failed : m.runs.state.skipped;
  const terminal = ["succeeded", "failed", "timed_out", "cancelled"].includes(run.state);
  const label = ({ queued: m.runs.state.queued, inspecting: m.runs.state.inspecting, waiting_execution_consent: m.runs.state.preparing, preparing_runtime: m.runs.state.preparing, running: m.runs.state.running, cancelling: m.runs.state.cancelling, cancelled: m.runs.state.cancelled } as Record<string, string>)[run.state];
  return terminal ? m.rss.sourceResultUnavailable : `${label || run.state} · ${m.rss.sourceResultPending}`;
}

export function SourceRuns({ sourceId, rootKey, open }: { sourceId: string; rootKey?: string; open: boolean }) {
  const [rows, setRows] = useState<RssSourceRun[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const alive = useRef(false), sequence = useRef(0), loadingMore = useRef(false);
  const initialized = useRef(false);
  const load = async (next?: string, silent = false) => {
    if (loadingMore.current) return;
    if (next) loadingMore.current = true;
    const ticket = ++sequence.current;
    if (!silent) setLoading(true);
    try {
      const result = await window.openmind.getRssSourceRuns({ sourceId, rootKey, cursor: next, limit: 20 });
      if (!alive.current || sequence.current !== ticket) return;
      setRows(previous => next ? [...previous, ...result.runs.filter(run => !previous.some(old => old.id === run.id))] : [...result.runs, ...previous.filter(run => !result.runs.some(fresh => fresh.id === run.id))]);
      if (next || !initialized.current) setCursor(result.nextCursor);
      initialized.current = true;
      setError("");
    } catch (cause) { if (alive.current && sequence.current === ticket) setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { loadingMore.current = false; if (alive.current && sequence.current === ticket) setLoading(false); }
  };
  useEffect(() => {
    alive.current = open;
    if (!open || selected) return;
    void load();
    const timer = setInterval(() => void load(undefined, true), 5000);
    return () => { alive.current = false; sequence.current++; clearInterval(timer); };
    // Scoped by the parent source key. Only this visible tab polls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, rootKey, open, retry, selected]);
  if (selected) return <><Button onClick={() => setSelected(null)}>{m.rss.back}</Button><h3>{m.rss.runLogs}</h3><p className="rss-muted">{selected}</p><SourceRunLogs sourceId={sourceId} rootKey={rootKey} runId={selected} open={open} /></>;
  return <><p className="rss-muted">{m.rss.runScope}</p>{error ? <ErrorState message={error} retry={() => setRetry(value => value + 1)} /> : null}
    {loading && !rows.length ? <LoadingState /> : !rows.length && !error ? <EmptyState title={m.rss.noRuns} /> : null}
    <div className="rss-run-list">{rows.map(run => <article className="rss-run" key={run.id}><div className="rss-actions"><strong>{run.mode === "sync" ? m.rss.sync : run.mode === "collect" ? m.rss.collect : m.rss.pipeline}</strong><StatusBadge tone={run.outcome === "succeeded" ? "success" : run.outcome === "failed" ? "danger" : "neutral"}>{stateLabel(run)}</StatusBadge></div><time dateTime={run.createdAt}>{sourceTime(run.createdAt)}</time><p>{m.rss.runCounts(run.updated, run.collected)}</p>{run.error ? <p className="rss-source-error">{errorSummary(run.error)} · {run.error.code}</p> : null}{run.reason ? <p>{run.reason}</p> : null}<Button size="sm" onClick={() => setSelected(run.id)}>{m.rss.runLogs}</Button></article>)}</div>
    {cursor ? <div><Button loading={loading} disabled={loading} onClick={() => void load(cursor)}>{m.rss.moreRuns}</Button></div> : null}
  </>;
}

function SourceRunLogs({ sourceId, rootKey, runId, open }: { sourceId: string; rootKey?: string; runId: string; open: boolean }) {
  const [events, setEvents] = useState<BrokerRunEvent[]>([]);
  const [nextAfter, setNextAfter] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const after = useRef(0), pending = useRef(false), sequence = useRef(0);
  const nextRef = useRef(nextAfter); nextRef.current = nextAfter;
  const active = useRef(open); active.current = open;
  const load = async () => {
    if (!active.current || pending.current) return;
    pending.current = true;
    const ticket = sequence.current;
    setLoading(true);
    try {
      const result = await window.openmind.getRssSourceRunEvents({ sourceId, rootKey, runId, after: after.current, limit: 200 });
      if (!active.current || ticket !== sequence.current) return;
      setEvents(previous => [...previous, ...result.events.filter(event => !previous.some(old => old.sequence === event.sequence))]);
      after.current = result.events.at(-1)?.sequence || after.current;
      setNextAfter(result.nextAfter); setError("");
    } catch (cause) { if (active.current && ticket === sequence.current) setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { if (ticket === sequence.current) { pending.current = false; if (active.current) setLoading(false); } }
  };
  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => { if (nextRef.current === null) void load(); }, 5000);
    return () => { sequence.current++; pending.current = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceId, rootKey, runId, retry]);
  return <>{error ? <ErrorState message={error} retry={() => setRetry(value => value + 1)} /> : null}<RunEventList events={events} loading={loading} />{nextAfter !== null ? <Button disabled={loading} onClick={() => void load()}>{m.rss.moreRuns}</Button> : null}</>;
}
