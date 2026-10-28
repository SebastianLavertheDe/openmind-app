import { useCallback, useEffect, useRef, useState } from "react";
import type { RssDetection, RssSourceView } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { Button, DialogBody, DialogFooter, FormField, Input, Select, Textarea } from "../../design-system/components";
import { useFeedback } from "../../feedback-context";
import { useBeforeSessionNavigation } from "../../app/session-navigation";
import { categoryLabel } from "./rss-source-presentation";

export function SourceEditor({ source, groups, onSaved, onCancel, guard, onBusy }: {
  source: RssSourceView | null; groups: string[]; onSaved(): Promise<void>; onCancel(): void;
  guard: React.MutableRefObject<() => Promise<boolean>>; onBusy(busy: boolean): void;
}) {
  const feedback = useFeedback();
  // The revision and form draft belong to this edit session, never to a poll.
  const [initial] = useState(source);
  const [name, setName] = useState(initial?.name || "");
  const [url, setUrl] = useState(initial?.inputUrl || "");
  const [group, setGroup] = useState(initial?.group || "");
  const [candidate, setCandidate] = useState("");
  const [detected, setDetected] = useState<RssDetection | null>(null);
  const [validated, setValidated] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const busy = detecting || saving;
  const dirty = name !== (initial?.name || "") || url !== (initial?.inputUrl || "") || group !== (initial?.group || "") || Boolean(candidate);
  const canLeave = useCallback(async () => !busy && (!dirty || await feedback.confirm({ title: m.rss.discard, body: m.rss.discardBody, confirmText: m.rss.cancel, danger: true })), [busy, dirty, feedback]);
  useBeforeSessionNavigation(canLeave);
  useEffect(() => { guard.current = canLeave; return () => { guard.current = async () => true; }; }, [canLeave, guard]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const detect = async () => {
    setDetecting(true); setValidated(false); setDetected(null); setError("");
    try {
      const result = await window.openmind.detectRssSource({ inputUrl: url, ...(candidate ? { selectedFeedUrl: candidate } : {}) });
      if (alive.current) { setDetected(result); setValidated(result.adapterId !== "feed" || Boolean(result.resolvedFeedUrl)); }
    } catch (cause) { if (alive.current) setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { if (alive.current) setDetecting(false); }
  };
  const needsDetection = !initial || url !== initial.inputUrl || Boolean(candidate);
  const save = async () => {
    if (busy || !name.trim() || !url.trim() || needsDetection && !validated) return;
    setSaving(true); setError("");
    try {
      const input = { name, inputUrl: url, group, ...(candidate ? { selectedFeedUrl: candidate } : {}) };
      if (initial) await window.openmind.editRssSource({ id: initial.id, revision: initial.revision, name, group, ...(needsDetection ? input : {}) });
      else await window.openmind.createRssSource({ ...input, enabled: true });
      if (alive.current) await onSaved();
    } catch (cause) { if (alive.current) setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { if (alive.current) setSaving(false); }
  };
  const feedHint = !source ? m.rss.feedAfterSave : needsDetection || source.localFeed.status === "outdated" ? m.rss.feedOutdated : source.localFeed.status === "ready" ? m.rss.feedReady : m.rss.feedMissing;
  return <form className="rss-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <DialogBody className="rss-detail-body">
      <FormField label={m.rss.name}><Input value={name} disabled={busy} maxLength={200} onChange={event => setName(event.target.value)} required autoFocus /></FormField>
      <FormField label={m.rss.url} error={error}><Input value={url} disabled={busy} type="url" maxLength={4096} onChange={event => { setUrl(event.target.value); setDetected(null); setValidated(false); setCandidate(""); setError(""); }} required /></FormField>
      <FormField label={m.rss.category}><Select value={group} disabled={busy} ariaLabel={m.rss.category} onChange={setGroup} options={[...new Set(["", ...groups, group])].map(value => ({ value, label: categoryLabel(value) }))} /></FormField>
      <FormField label={m.rss.convertedFeed} hint={feedHint}><Textarea value={source?.localFeed.path || ""} readOnly rows={2} placeholder={m.rss.feedAfterSave} /></FormField>
      <div><Button loading={detecting} disabled={saving || !url.trim()} onClick={() => void detect()}>{detecting ? m.rss.detecting : m.rss.detect}</Button></div>
      {detected && detected.candidates.length > 1 ? <FormField label={m.rss.candidate} hint={m.rss.candidateHint}><Select value={candidate} disabled={busy} onChange={value => { setCandidate(value); setValidated(false); setError(""); }} placeholder={m.rss.candidate} options={detected.candidates.map(item => ({ value: item.url, label: item.title }))} /></FormField> : null}
      {validated ? <p role="status">{m.rss.detected}</p> : null}
    </DialogBody>
    <DialogFooter><Button disabled={busy} onClick={onCancel}>{m.rss.cancel}</Button><Button type="submit" variant="primary" loading={saving} disabled={busy || !name.trim() || !url.trim() || needsDetection && !validated}>{m.rss.save}</Button></DialogFooter>
  </form>;
}
