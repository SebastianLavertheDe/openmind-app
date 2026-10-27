import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProviderCapabilities } from "@shared/contracts";
import type { AuthoredSkill, SkillLibraryEntry } from "@shared/skill-library";
import { messages } from "@shared/messages";
import { Button } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { SkillFormFields, SkillFormHeader, skillFormDocument } from "./SkillFormFields";
import { SkillContributor } from "./SkillContributor";

const m = messages.skillLibrary;
type DetailState = { phase: "loading" } | { phase: "error" } | { phase: "ready"; document: AuthoredSkill };

/** The same complete form as creation; viewing never creates or saves a draft. */
export function SkillDetailsView({ entry, entries, providers, onBack, actions, error = "", busy = false }: {
  entry: SkillLibraryEntry; entries: SkillLibraryEntry[]; providers: ProviderCapabilities[]; onBack(): void;
  actions?: ReactNode; error?: string; busy?: boolean;
}) {
  const locale = useLocale();
  const surface = useRef<HTMLElement>(null);
  const [state, setState] = useState<DetailState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { const frame = requestAnimationFrame(() => surface.current?.querySelector<HTMLButtonElement>("button")?.focus()); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => {
    let active = true;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const document = entry.authoringId
          ? await window.openmind.getSkillEditor!(entry.authoringId)
          : skillFormDocument(entry, await window.openmind.readSkillLibraryPrompt!(entry.id));
        if (active) setState({ phase: "ready", document });
      } catch { if (active) setState({ phase: "error" }); }
    })();
    return () => { active = false; };
  }, [entry.id, entry.authoringId, entry.digest, entry.revision, attempt, locale]);

  return <section ref={surface} className="skill-editor skill-details-view" aria-label={entry.title || m.draft} aria-busy={state.phase === "loading"}>
    <SkillFormHeader onBack={onBack} busy={busy}>{actions}</SkillFormHeader>
    {entry.contributor ? <SkillContributor contributor={entry.contributor} size="md" /> : null}
    {error ? <p role="alert" className="ui-error-state">{error}</p> : null}
    {entry.reason ? <p role="status">{entry.reason}</p> : null}
    {state.phase === "loading" ? <p role="status">{m.promptLoading}</p>
      : state.phase === "error" ? <div><p role="alert">{m.promptFailed}</p><Button variant="ghost" onClick={() => setAttempt(value => value + 1)}>{m.retry}</Button></div>
      : <SkillFormFields value={state.document} entries={entries} providers={providers} editMode="none" categoryLabel={entry.category ? m.scenes[entry.category] : m.uncategorized} />}
  </section>;
}
