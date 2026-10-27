import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyBriefPreferences } from "@shared/daily-brief-preferences";
import { messages as m } from "@shared/messages";
import { Button, FormDialog, FormField, Textarea, Input } from "../../design-system/components";
import { useFeedback } from "../../feedback-context";
import { useBeforeSessionNavigation } from "../../app/session-navigation";
import { useLocale } from "../../i18n";

export function DailyPreferences() {
  useLocale();
  const feedback = useFeedback();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<DailyBriefPreferences | null>(null), [text, setText] = useState("");
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dirty = saved !== null && text !== saved.text;
  const canLeave = useCallback(() => !dirty || feedback.confirm({ title: m.rss.discard, body: m.rss.discardBody, confirmText: m.rss.cancel, danger: true }), [dirty, feedback]);
  useBeforeSessionNavigation(canLeave);
  const show = async () => {
    setOpen(true); setBusy(true); setError(""); setMessage("");
    try { const value = await window.openmind.getDailyBriefPreferences(); if (alive.current) { setSaved(value); setText(value.text); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  const save = async () => {
    if (!saved) return; setBusy(true); setError("");
    try { const value = await window.openmind.saveDailyBriefPreferences({ revision: saved.revision, text }); if (alive.current) { setSaved(value); setText(value.text); setMessage(m.rss.saved); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  const generate = async (topics: boolean) => {
    setBusy(true); setError("");
    try { await window.openmind.generateDailyBrief({ date: date.replace(/-/g, ""), topics }); if (alive.current) setMessage(m.rss.queued); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  return <>
    <Button onClick={() => void show()}>{m.rss.preferences}</Button>
    <FormDialog open={open} title={m.rss.preferences} description={m.rss.preferencesHint} confirmLabel={m.rss.save} busy={busy} confirmDisabled={!dirty || !saved} onConfirm={save} onClose={() => void Promise.resolve(canLeave()).then(allowed => { if (allowed) { setOpen(false); if (saved) setText(saved.text); } })}>
      <FormField label={m.rss.preferences}><Textarea value={text} onChange={event => setText(event.target.value)} maxLength={12000} rows={7} placeholder={m.rss.preferencesPlaceholder} disabled={!saved || busy} /></FormField>
      <FormField label={m.rss.date}><Input type="date" value={date} onChange={event => setDate(event.target.value)} /></FormField>
      <div className="rss-actions"><Button disabled={busy || dirty || !saved || !date} onClick={() => void generate(false)}>{m.rss.generate}</Button><Button disabled={busy || dirty || !saved || !date} onClick={() => void generate(true)}>{m.rss.topics}</Button></div>
      {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    </FormDialog>
  </>;
}
