import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DEFAULT_SUMMARY_PROMPT, DEFAULT_TOPIC_PROMPT, DEFAULT_TOPIC_PLATFORMS, TopicPlatformsSchema, resolveDailyBriefPreferences, type DailyBriefPreferences } from "@shared/daily-brief-preferences";
import { messages as m } from "@shared/messages";
import { Button, ErrorState, FormActions, FormDialog, FormField, LoadingState, Tabs, Textarea } from "../../design-system/components";
import { useFeedback } from "../../feedback-context";
import { useBeforeSessionNavigation, type SessionLeaveGuard } from "../../app/session-navigation";
import { useLocale } from "../../i18n";
import { TopicRulesEditor } from "./TopicRulesEditor";

type PreferenceTab = "summary" | "topics";
type ResolvedPreferences = ReturnType<typeof resolveDailyBriefPreferences>;

export function DailyPreferences({ presentation = "dialog", onLeaveGuardChange }: {
  presentation?: "dialog" | "settings";
  onLeaveGuardChange?(guard: SessionLeaveGuard | null): void;
}) {
  useLocale();
  const feedback = useFeedback();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ResolvedPreferences | null>(null);
  const [draft, setDraft] = useState<ResolvedPreferences | null>(null);
  const [tab, setTab] = useState<PreferenceTab>("summary");
  const id = useId();
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const canLeave = useCallback(() => busy && saved ? false : !dirty || feedback.confirm({ title: m.rss.discard, body: m.rss.discardBody, confirmText: m.projectUi.discardChanges, danger: true }), [busy, saved, dirty, feedback]);
  useBeforeSessionNavigation(canLeave);
  useEffect(() => { onLeaveGuardChange?.(canLeave); return () => onLeaveGuardChange?.(null); }, [onLeaveGuardChange, canLeave]);
  const show = useCallback(async () => {
    setSaved(null); setDraft(null); setOpen(true); setTab("summary"); setBusy(true); setError(""); setMessage("");
    try { const value = resolveDailyBriefPreferences(await window.openmind.getDailyBriefPreferences()); if (alive.current) { setSaved(value); setDraft(value); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current) setBusy(false); }
  }, []);
  useEffect(() => { if (presentation === "settings") void show(); }, [presentation, show]);
  const save = async () => {
    if (!saved || !draft) return; setBusy(true); setError("");
    try {
      const value = resolveDailyBriefPreferences(await window.openmind.saveDailyBriefPreferences({ revision: saved.revision, text: draft.text, summaryPrompt: draft.summaryPrompt, topicPrompt: draft.topicPrompt, topicPlatforms: draft.topicPlatforms }));
      if (alive.current) { setSaved(value); setDraft(value); setMessage(m.rss.saved); }
    }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  const edit = (patch: Partial<DailyBriefPreferences>) => { setDraft(current => current ? { ...current, ...patch } : current); setMessage(""); };
  const tabs = [
    { value: "summary" as const, label: m.rss.summaryPrompt },
    { value: "topics" as const, label: m.rss.topicRules }
  ];
  const confirmDisabled = !dirty || !saved || !TopicPlatformsSchema.safeParse(draft?.topicPlatforms).success;
  const editor = <div className="daily-preferences-editor">
        <Tabs value={tab} onChange={setTab} label={m.rss.preferences} tabs={tabs.map(item => ({ ...item, id: `${id}-${item.value}`, controls: `${id}-panel` }))} />
        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="daily-preferences-panel">
          {tab === "summary" ? <>
            <p className="rss-muted">{m.rss.summaryContractHint}</p>
            <FormField label={m.rss.summaryInstructions} hint={m.rss.emptyRuleHint}>
              <Textarea value={draft?.summaryPrompt.instructions || ""} onChange={event => draft && edit({ summaryPrompt: { ...draft.summaryPrompt, instructions: event.target.value } })} maxLength={12000} rows={7} disabled={!draft || busy} />
            </FormField>
            <FormField label="category" hint={m.rss.summaryFieldLabels.category}>
              <Textarea value={draft?.summaryPrompt.fields.category || ""} onChange={event => draft && edit({ summaryPrompt: { ...draft.summaryPrompt, fields: { ...draft.summaryPrompt.fields, category: event.target.value } } })} maxLength={4000} rows={3} disabled={!draft || busy} />
            </FormField>
          </> : <TopicRulesEditor value={draft || { topicPrompt: "", topicPlatforms: [], text: "" }} disabled={!draft || busy} onChange={edit} />}
        </div>
        <div className="daily-preferences-actions"><Button variant="secondary" disabled={!draft || busy} onClick={() => edit(tab === "summary" ? { summaryPrompt: structuredClone(DEFAULT_SUMMARY_PROMPT) } : { topicPrompt: DEFAULT_TOPIC_PROMPT, topicPlatforms: structuredClone(DEFAULT_TOPIC_PLATFORMS) })}>{m.rss.restoreDefaultRules}</Button></div>
      </div>;
  const feedbackMessage = <>{error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}</>;
  if (presentation === "settings") {
    if (!saved) return error ? <ErrorState message={error} retry={() => void show()} /> : <LoadingState />;
    return <form className="daily-preferences-settings" onSubmit={event => { event.preventDefault(); if (!busy && !confirmDisabled) void save(); }}>
      {editor}{feedbackMessage}
      <FormActions><Button type="submit" variant="primary" loading={busy} disabled={confirmDisabled}>{m.rss.save}</Button></FormActions>
    </form>;
  }
  return <>
    <Button data-action="daily-preferences" onClick={() => void show()}>{m.rss.preferences}</Button>
    <FormDialog open={open} size="lg" layout="fixed" initialFocusSelector={'.daily-preferences-editor [role="tab"][aria-selected="true"]'} title={m.rss.preferences} description={m.rss.preferencesHint} confirmLabel={m.rss.save} busy={busy} confirmDisabled={confirmDisabled} onConfirm={save} onClose={() => void Promise.resolve(canLeave()).then(allowed => { if (allowed) { setOpen(false); setDraft(saved); } })}>
      {editor}{feedbackMessage}
    </FormDialog>
  </>;
}
