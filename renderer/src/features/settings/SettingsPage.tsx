import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderCapabilities, UserPreferences } from "@shared/contracts";
import { messages } from "@shared/messages";
import { useAi } from "../../ai-context";
import { PageHeader } from "../../design-system/components";
import { applyTheme } from "../../theme";
import {
  AppearanceSettingsSection,
  DataRetentionSettingsSection,
  PathSettingsSection,
  PermissionSettingsSection,
  ProviderSettingsSection,
  WorkflowSettingsSection
} from "./settings-sections";

const m = messages;
const BLUE_ACCENT = "#2563eb";

export function SettingsPage({ repoRoot: initialRepo, runtime, providers, onRepo }: { repoRoot: string; runtime: string; providers: ProviderCapabilities[]; onRepo(root: string): void }) {
  void runtime;
  const ai = useAi();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);

  const loadPrefs = useCallback(async () => {
    try {
      const next = await window.cctools.getPreferences();
      setPrefs(next);
      applyTheme(next);
    } catch {
      setPrefs(null);
    }
  }, []);

  useEffect(() => { void loadPrefs(); }, [loadPrefs]);

  const save = useCallback((patch: Partial<UserPreferences>): Promise<void> => {
    pendingSaves.current += 1;
    setSaving(true);
    const operation = saveQueue.current.then(async () => {
      const next = await window.cctools.updatePreferences({ ...patch, accentColor: BLUE_ACCENT });
      setPrefs(next);
      applyTheme(next);
    });
    saveQueue.current = operation.catch(() => undefined);
    return operation.catch(() => {
      ai.notify(m.settings.notify.saveFailed, "error");
      return loadPrefs();
    }).finally(() => {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) setSaving(false);
    });
  }, [ai, loadPrefs]);

  const defaultProviderId = useMemo(() => prefs?.defaultProvider || providers.find((provider) => provider.available)?.id || "", [prefs?.defaultProvider, providers]);

  const selectWorkspace = async () => {
    try {
      const root = await window.cctools.selectRepo();
      if (!root) return;
      onRepo(root);
      await loadPrefs();
      ai.notify(m.settings.notify.workspaceUpdated, "success");
    } catch {
      ai.notify(m.settings.notify.workspaceSelectFailed, "error");
    }
  };

  const resetWorkflow = async () => {
    const ok = await ai.confirm({ title: m.settings.workflow.resetToDefaults, body: m.settings.workflow.resetConfirm, confirmText: m.settings.workflow.resetToDefaults, danger: true });
    if (!ok) return;
    setSaving(true);
    try {
      await saveQueue.current;
      const next = await window.cctools.resetPreferences("workflow");
      setPrefs(next);
      applyTheme(next);
      ai.notify(m.settings.notify.workflowReset, "success");
    } catch {
      ai.notify(m.settings.notify.saveFailed, "error");
    } finally {
      setSaving(false);
    }
  };

  const openNotesDir = async () => {
    try { await window.cctools.openPath(prefs?.notesDir || "mymind"); }
    catch { ai.notify(m.settings.notify.notesOpenFailed, "error"); }
  };

  if (!prefs) return <div className="feature-page settings-page"><PageHeader eyebrow="Settings" title={m.settings.page.title} description={m.settings.page.description} /><section className="settings-card" role="status">{m.settings.loading}</section></div>;

  return (
    <div className="feature-page settings-page">
      <PageHeader eyebrow={m.nav.settings} title={m.settings.page.title} description={m.settings.page.description} />
      <div className="settings-stack entrance-stagger" aria-busy={saving || undefined}>
        <AppearanceSettingsSection prefs={prefs} save={save} />
        <ProviderSettingsSection prefs={prefs} providers={providers} defaultProviderId={defaultProviderId} save={save} onAdd={() => ai.notify(m.settings.provider.addHint, "info")} />
        <PermissionSettingsSection prefs={prefs} save={save} />
        <PathSettingsSection workspace={prefs.repoRoot || initialRepo} notes={prefs.notesDir || "mymind"} onSelectWorkspace={() => void selectWorkspace()} onOpenNotes={() => void openNotesDir()} />
        <DataRetentionSettingsSection prefs={prefs} save={save} />
        <WorkflowSettingsSection prefs={prefs} save={save} onReset={() => void resetWorkflow()} />
      </div>
    </div>
  );
}
