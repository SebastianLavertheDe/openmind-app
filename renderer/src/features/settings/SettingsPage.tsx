import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Archive, Bot, Database, Globe, Package, Route, Settings as SettingsIcon, ShieldCheck, type LucideIcon } from "lucide-react";
import type { BrowserAutomationStatus, McpServerDefinition, ProviderCapabilities, UserPreferences } from "@shared/contracts";
import { messages } from "@shared/messages";
import { useAi } from "../../ai-context";
import { applyTheme } from "../../theme";
import {
  ArchivedSessionsSettingsSection,
  AppearanceSettingsSection,
  BrowserSettingsSection,
  DataRetentionSettingsSection,
  PathSettingsSection,
  PermissionSettingsSection,
  ProviderSettingsSection,
  SkillSettingsSection,
  WorkflowSettingsSection
} from "./settings-sections";

const m = messages;
const BLUE_ACCENT = "#2563eb";

type SettingsSectionId = "general" | "providers" | "skills" | "browser" | "permissions" | "workflow" | "storage" | "sessions";
type SettingsGroupId = "personal" | "ai" | "creation" | "data";

type SettingsSectionDefinition = {
  id: SettingsSectionId;
  group: SettingsGroupId;
  icon: LucideIcon;
  title: string;
  description: string;
};

const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  { id: "general", group: "personal", icon: SettingsIcon, ...m.settings.navigation.sections.general },
  { id: "providers", group: "ai", icon: Bot, ...m.settings.navigation.sections.providers },
  { id: "skills", group: "ai", icon: Package, ...m.settings.navigation.sections.skills },
  { id: "browser", group: "ai", icon: Globe, ...m.settings.navigation.sections.browser },
  { id: "permissions", group: "ai", icon: ShieldCheck, ...m.settings.navigation.sections.permissions },
  { id: "workflow", group: "creation", icon: Route, ...m.settings.navigation.sections.workflow },
  { id: "storage", group: "data", icon: Database, ...m.settings.navigation.sections.storage },
  { id: "sessions", group: "data", icon: Archive, ...m.settings.navigation.sections.sessions }
];

const SETTINGS_GROUPS: readonly SettingsGroupId[] = ["personal", "ai", "creation", "data"];

export function SettingsPage({ repoRoot: initialRepo, runtime, providers, onRepo, onBack, onOpenSession }: { repoRoot: string; runtime: string; providers: ProviderCapabilities[]; onRepo(root: string): void; onBack(): void; onOpenSession?(): void }) {
  const ai = useAi();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [browserStatus, setBrowserStatus] = useState<BrowserAutomationStatus | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>([]);
  const [savingBrowserToken, setSavingBrowserToken] = useState(false);
  const [refreshingSkills, setRefreshingSkills] = useState(false);
  const [sessionBusyId, setSessionBusyId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const detailRef = useRef<HTMLElement>(null);

  const loadMcpServers = useCallback(async (): Promise<McpServerDefinition[]> => {
    try {
      const servers = await window.cctools.getMcpServers();
      setMcpServers(servers);
      return servers;
    } catch {
      setMcpServers([]);
      return [];
    }
  }, []);

  const loadPrefs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await window.cctools.getPreferences();
      setPrefs(next);
      applyTheme(next);
      try { setBrowserStatus(await window.cctools.getBrowserAutomationStatus()); }
      catch { setBrowserStatus(null); }
      await loadMcpServers();
    } catch {
      setPrefs(null);
      setLoadError(m.settings.loadError);
    } finally {
      setLoading(false);
    }
  }, [loadMcpServers]);

  useEffect(() => { void loadPrefs(); }, [loadPrefs]);

  const save = useCallback((patch: Partial<UserPreferences>): Promise<void> => {
    pendingSaves.current += 1;
    setSaving(true);
    const operation = saveQueue.current.then(async () => {
      const next = await window.cctools.updatePreferences({ ...patch, accentColor: BLUE_ACCENT });
      setPrefs(next);
      applyTheme(next);
      if ("browserAutomationEnabled" in patch || "browserReuseExistingTabs" in patch || "browserEvidenceDir" in patch) {
        try { setBrowserStatus(await window.cctools.getBrowserAutomationStatus()); }
        catch { setBrowserStatus(null); }
        await loadMcpServers();
      }
    });
    saveQueue.current = operation.catch(() => undefined);
    return operation.catch(() => {
      ai.notify(m.settings.notify.saveFailed, "error");
      return loadPrefs();
    }).finally(() => {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) setSaving(false);
    });
  }, [ai, loadMcpServers, loadPrefs]);

  const defaultProviderId = useMemo(() => prefs?.defaultProvider || providers.find((provider) => provider.available)?.id || "", [prefs?.defaultProvider, providers]);

  const archivedSessions = useMemo(() => ai.snapshot.sessions
    .filter((session) => session.archived)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [ai.snapshot.sessions]);

  const activeDefinition = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];

  const selectSection = useCallback((section: SettingsSectionId) => {
    setActiveSection(section);
    if (detailRef.current) detailRef.current.scrollTop = 0;
  }, []);

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

  const refreshSkills = async () => {
    if (refreshingSkills) return;
    setRefreshingSkills(true);
    try {
      const [next, servers] = await Promise.all([ai.refreshSkills(), loadMcpServers()]);
      if (next) ai.notify(m.settings.skills.scanComplete(next.length, servers.length), "success");
      else ai.notify(m.settings.skills.scanFailed, "error");
    } finally {
      setRefreshingSkills(false);
    }
  };

  const copySkillInvocation = async (skillId: string) => {
    try {
      await navigator.clipboard.writeText(`/${skillId}`);
      ai.notify(m.settings.skills.copySuccess(skillId), "success");
    } catch {
      ai.notify(m.settings.skills.copyFailed, "error");
    }
  };

  const openSkillDirectory = async (path: string) => {
    try { await window.cctools.openPath(path); }
    catch { ai.notify(m.settings.skills.openFailed, "error"); }
  };

  const saveBrowserToken = async (token: string) => {
    if (savingBrowserToken) return;
    setSavingBrowserToken(true);
    try {
      setBrowserStatus(await window.cctools.saveBrowserExtensionToken(token));
      await loadMcpServers();
      ai.notify(m.settings.browser.tokenSaved, "success");
    } catch {
      ai.notify(m.settings.browser.tokenFailed, "error");
      throw new Error(m.settings.browser.tokenFailed);
    } finally {
      setSavingBrowserToken(false);
    }
  };

  const clearBrowserToken = async () => {
    if (savingBrowserToken) return;
    setSavingBrowserToken(true);
    try {
      setBrowserStatus(await window.cctools.clearBrowserExtensionToken());
      await loadMcpServers();
      ai.notify(m.settings.browser.tokenCleared, "success");
    } catch {
      ai.notify(m.settings.browser.tokenFailed, "error");
    } finally {
      setSavingBrowserToken(false);
    }
  };

  const openBrowserExtensionDocs = async () => {
    try { await window.cctools.openExternal("https://github.com/microsoft/playwright-mcp#browser-extension"); }
    catch { ai.notify(m.settings.browser.loadFailed, "error"); }
  };

  const restoreArchivedSession = async (sessionId: string) => {
    if (sessionBusyId) return;
    setSessionBusyId(sessionId);
    try {
      await ai.updateSession(sessionId, { archived: false });
      ai.notify(m.ai.session.unarchived, "success");
    } catch {
      ai.notify(m.settings.notify.sessionRestoreFailed, "error");
    } finally {
      setSessionBusyId(null);
    }
  };

  const openArchivedSession = async (sessionId: string) => {
    if (sessionBusyId) return;
    setSessionBusyId(sessionId);
    try {
      await ai.setActiveSession(sessionId);
      onOpenSession?.();
    } catch {
      ai.notify(m.settings.notify.sessionOpenFailed, "error");
    } finally {
      setSessionBusyId(null);
    }
  };

  return (
    <div className="settings-page">
      <SettingsNavigation
        activeSection={activeSection}
        runtime={runtime}
        repoRoot={prefs?.repoRoot || initialRepo}
        onBack={onBack}
        onSelect={selectSection}
      />
      <section className="settings-detail" id="settings-detail-panel" ref={detailRef} aria-labelledby="settings-detail-title">
        <div className="settings-detail-inner">
          <header className="settings-detail-header">
            <div>
              <span>{m.settings.page.title}</span>
              <h1 id="settings-detail-title">{activeDefinition.title}</h1>
              <p>{activeDefinition.description}</p>
            </div>
            {activeSection !== "skills" && !loading && !loadError ? <small role="status" aria-live="polite">{saving ? m.settings.saveStatus.saving : m.settings.saveStatus.saved}</small> : null}
          </header>

          {loading ? (
            <section className="settings-load-state settings-card" role="status">{m.settings.loading}</section>
          ) : loadError || !prefs ? (
            <section className="settings-load-state settings-card ui-error-state" role="alert">
              <strong>{loadError || m.settings.loadError}</strong>
              <button type="button" className="settings-subtle-action" onClick={() => void loadPrefs()}>{m.settings.retry}</button>
            </section>
          ) : (
            <div className="settings-stack entrance-stagger" aria-busy={saving || undefined}>
              {activeSection === "general" ? (
                <>
                  <AppearanceSettingsSection prefs={prefs} save={save} />
                  <PathSettingsSection workspace={prefs.repoRoot || initialRepo} notes={prefs.notesDir || "mymind"} onSelectWorkspace={() => void selectWorkspace()} onOpenNotes={() => void openNotesDir()} />
                </>
              ) : null}
              {activeSection === "providers" ? <ProviderSettingsSection providers={providers} defaultProviderId={defaultProviderId} save={save} /> : null}
              {activeSection === "skills" ? <SkillSettingsSection skills={ai.skills} mcpServers={mcpServers} refreshing={refreshingSkills} onRefresh={() => void refreshSkills()} onCopy={(skillId) => void copySkillInvocation(skillId)} onOpenDirectory={(path) => void openSkillDirectory(path)} onOpenMcpSettings={() => selectSection("browser")} /> : null}
              {activeSection === "browser" ? <BrowserSettingsSection prefs={prefs} status={browserStatus} savingToken={savingBrowserToken} save={save} onSaveToken={saveBrowserToken} onClearToken={clearBrowserToken} onOpenExtensionDocs={() => void openBrowserExtensionDocs()} /> : null}
              {activeSection === "permissions" ? <PermissionSettingsSection prefs={prefs} save={save} /> : null}
              {activeSection === "workflow" ? <WorkflowSettingsSection prefs={prefs} save={save} onReset={() => void resetWorkflow()} /> : null}
              {activeSection === "storage" ? <DataRetentionSettingsSection prefs={prefs} save={save} /> : null}
              {activeSection === "sessions" ? <ArchivedSessionsSettingsSection sessions={archivedSessions} busyId={sessionBusyId} onOpen={(sessionId) => void openArchivedSession(sessionId)} onRestore={(sessionId) => void restoreArchivedSession(sessionId)} /> : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SettingsNavigation({ activeSection, runtime, repoRoot, onBack, onSelect }: {
  activeSection: SettingsSectionId;
  runtime: string;
  repoRoot: string;
  onBack(): void;
  onSelect(section: SettingsSectionId): void;
}) {
  const backButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backButtonRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <aside className="settings-navigation" aria-label={m.settings.navigation.label}>
      <button ref={backButtonRef} type="button" className="settings-back-button" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden />
        <span>{m.settings.navigation.back}</span>
      </button>
      <div className="settings-navigation-title">
        <SettingsIcon size={16} aria-hidden />
        <strong>{m.settings.navigation.all}</strong>
      </div>
      <nav className="settings-navigation-scroll" aria-label={m.settings.navigation.label}>
        {SETTINGS_GROUPS.map((group) => {
          const sections = SETTINGS_SECTIONS.filter((section) => section.group === group);
          return (
            <section className="settings-nav-group" key={group}>
              <span>{m.settings.navigation.groups[group]}</span>
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    type="button"
                    className="settings-nav-button"
                    key={section.id}
                    aria-current={activeSection === section.id ? "page" : undefined}
                    aria-controls="settings-detail-panel"
                    onClick={() => onSelect(section.id)}
                  >
                    <Icon size={15} aria-hidden />
                    <span>{section.title}</span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </nav>
      <footer className="settings-navigation-footer">
        <strong>{runtime}</strong>
        <code title={repoRoot}>{repoRoot}</code>
      </footer>
    </aside>
  );
}
