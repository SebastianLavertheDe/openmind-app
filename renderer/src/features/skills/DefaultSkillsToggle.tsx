import { useCallback, useEffect, useRef, useState } from "react";
import { messages } from "@shared/messages";
import { ToggleSwitch } from "../../design-system/controls";
import { useLocale } from "../../i18n";

export function DefaultSkillsToggle({ onChange }: { onChange(): Promise<void> }) {
  useLocale();
  const m = messages.skillCenter.defaults;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changing = useRef(false);

  const load = useCallback(async () => {
    try {
      setEnabled(await window.openmind.getDefaultSkillsEnabled());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.skillCenter.defaults.loadFailed);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (next: boolean) => {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    setError(null);
    try {
      setEnabled(await window.openmind.setDefaultSkillsEnabled(next));
      await onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.changeFailed);
      // Reflect the durable state after a partial install/removal failure.
      try { setEnabled(await window.openmind.getDefaultSkillsEnabled()); } catch { /* Keep the last known state. */ }
      try { await onChange(); } catch { /* Preserve the original operation error. */ }
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="workspace-card skills-defaults" aria-label={m.title} aria-busy={busy}>
      <div className="skills-defaults-row">
        <div><h2>{m.title}</h2><p>{m.description}</p></div>
        <ToggleSwitch checked={enabled ?? false} disabled={busy || enabled === null} label={m.title} onChange={(value) => void toggle(value)} />
      </div>
      {busy ? <p role="status">{enabled ? m.disabling : m.installing}</p> : null}
      {error ? <p className="skills-error" role="alert">{error}</p> : null}
      {enabled === null && error ? <button type="button" className="ghost-button" data-motion="action" onClick={() => void load()}>{m.retry}</button> : null}
    </section>
  );
}
