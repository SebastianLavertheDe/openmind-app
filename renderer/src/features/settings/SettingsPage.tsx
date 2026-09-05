import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Archive, Bot, Cpu, Globe, Package, Route, Search, Server, Settings as SettingsIcon, ShieldCheck, type LucideIcon } from "lucide-react";
import type { BrowserAutomationStatus, McpServerDefinition, ProviderCapabilities, ProvidersYamlInput, ProvidersYamlView, SharedPythonRuntimeStatus, UserPreferences } from "@shared/contracts";
import { messages } from "@shared/messages";
import { workspaceSessions } from "@shared/ai-session-scope";
import { useAi } from "../../ai-context";
import { openmindRootPreviewBody, openmindRootPreviewError } from "../../openmind-root-selection";
import { applyTheme } from "../../theme";
import { SkillsPage } from "../skills";
import {
  ArchivedSessionsSettingsSection,
  AppearanceSettingsSection,
  AiProvidersSettingsSection,
  BrowserSettingsSection,
  PathSettingsSection,
  PermissionSettingsSection,
  ProviderSettingsSection,
  SharedPythonRuntimeSection,
  SkillSettingsSection,
  WorkflowSettingsSection
} from "./settings-sections";

const m = messages;

type SettingsSectionId = "general" | "providers" | "runtime" | "skills" | "mcp" | "browser" | "permissions" | "workflow" | "sessions";
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
  { id: "runtime", group: "ai", icon: Cpu, ...m.settings.navigation.sections.runtime },
  { id: "skills", group: "ai", icon: Package, ...m.settings.navigation.sections.skills },
  { id: "mcp", group: "ai", icon: Server, ...m.settings.navigation.sections.mcp },
  { id: "browser", group: "ai", icon: Globe, ...m.settings.navigation.sections.browser },
  { id: "permissions", group: "ai", icon: ShieldCheck, ...m.settings.navigation.sections.permissions },
  { id: "workflow", group: "creation", icon: Route, ...m.settings.navigation.sections.workflow },
  { id: "sessions", group: "data", icon: Archive, ...m.settings.navigation.sections.sessions }
];

const SETTINGS_GROUPS: readonly SettingsGroupId[] = ["personal", "ai", "creation", "data"];

export function SettingsPage({ repoRoot: initialRepo, providers, onRepo, onBack, onOpenSession, initialSection, initialSkillId, initialSkillImportOpen }: { repoRoot: string; providers: ProviderCapabilities[]; onRepo(root?: string): void | Promise<unknown>; onBack(): void; onOpenSession?(): void; initialSection?: SettingsSectionId; initialSkillId?: string; initialSkillImportOpen?: boolean }) {
  const ai = useAi();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [browserStatus, setBrowserStatus] = useState<BrowserAutomationStatus | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>([]);
  const [runtimeBusy, setRuntimeBusy] = useState<string | null>(null);
  const [sharedPythonRuntime, setSharedPythonRuntime] = useState<SharedPythonRuntimeStatus | null>(null);
  const [providersYaml, setProvidersYaml] = useState<ProvidersYamlView | null>(null);
  const [providersYamlBusy, setProvidersYamlBusy] = useState(false);
  const [savingBrowserToken, setSavingBrowserToken] = useState(false);
  const [refreshingSkills, setRefreshingSkills] = useState(false);
  const [sessionBusyId, setSessionBusyId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection || "general");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (initialSection) setActiveSection(initialSection);
  }, [initialSection, initialSkillId]);

  const loadMcpServers = useCallback(async (): Promise<McpServerDefinition[]> => {
    try {
      const servers = await window.openmind.getMcpServers();
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
      const next = await window.openmind.getPreferences();
      setPrefs(next);
      applyTheme(next);
      try { setBrowserStatus(await window.openmind.getBrowserAutomationStatus()); }
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

  const loadSharedPythonRuntime = useCallback(async () => {
    try { setSharedPythonRuntime(await window.openmind.getSharedPythonRuntimeStatus()); }
    catch { setSharedPythonRuntime(null); }
  }, []);

  const loadProvidersYaml = useCallback(async () => {
    try { setProvidersYaml(await window.openmind.getProviders()); }
    catch (error) {
      setProvidersYaml({ schemaVersion: 1, default: "", cli: { claude: null, codex: null }, providers: [] });
      ai.notify(error instanceof Error ? error.message : m.settings.notify.providersLoadFailed, "error");
    }
  }, [ai]);

  useEffect(() => {
    if (activeSection === "providers" && !providersYaml && !loading && prefs) void loadProvidersYaml();
  }, [activeSection, loadProvidersYaml, loading, prefs, providersYaml]);

  const saveProvidersYaml = useCallback(async (input: ProvidersYamlInput) => {
    if (providersYamlBusy) return;
    setProvidersYamlBusy(true);
    try {
      setProvidersYaml(await window.openmind.saveProviders(input));
      ai.notify(m.settings.notify.providersSaved, "success");
    } catch (error) {
      ai.notify(error instanceof Error ? error.message : m.settings.notify.providersSaveFailed, "error");
      await loadProvidersYaml();
    } finally {
      setProvidersYamlBusy(false);
    }
  }, [ai, loadProvidersYaml, providersYamlBusy]);

  useEffect(() => {
    if (activeSection === "runtime" && !loading && prefs) void loadSharedPythonRuntime();
  }, [activeSection, loadSharedPythonRuntime, loading, prefs]);

  const toggleSharedPythonRuntime = useCallback(async (enabled: boolean) => {
    if (runtimeBusy) return;
    setRuntimeBusy(enabled ? "shared-python-enable" : "shared-python-disable");
    try {
      setSharedPythonRuntime(await window.openmind.setSharedPythonRuntimeEnabled(enabled));
      ai.notify(enabled ? m.settings.notify.pythonEnabled : m.settings.notify.pythonDisabled, "success");
    } catch {
      await loadSharedPythonRuntime();
      ai.notify(enabled ? m.settings.notify.pythonEnableFailed : m.settings.notify.pythonDisableFailed, "error");
    } finally {
      setRuntimeBusy(null);
    }
  }, [ai, loadSharedPythonRuntime, runtimeBusy]);

  const save = useCallback((patch: Partial<UserPreferences>): Promise<void> => {
    pendingSaves.current += 1;
    setSaving(true);
    const operation = saveQueue.current.then(async () => {
      const next = await window.openmind.updatePreferences(patch);
      setPrefs(next);
      applyTheme(next);
      if ("browserAutomationEnabled" in patch || "browserReuseExistingTabs" in patch || "browserEvidenceDir" in patch) {
        try { setBrowserStatus(await window.openmind.getBrowserAutomationStatus()); }
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

  const archivedSessions = useMemo(() => workspaceSessions(ai.snapshot.sessions, true)
    .filter((session) => session.archived)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [ai.snapshot.sessions]);

  const activeDefinition = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];

  const selectSection = useCallback((section: SettingsSectionId) => {
    setActiveSection(section);
    if (detailRef.current) detailRef.current.scrollTop = 0;
  }, []);

  const selectOpenmindRoot = async () => {
    try {
      const root = await window.openmind.selectOpenmindRoot();
      if (!root) return;
      const preview = await window.openmind.previewOpenmindRoot(root);
      if (!preview.canBind) throw new Error(openmindRootPreviewError(preview));
      if (!await ai.confirm({ title: m.openmindRoot.confirmTitle, body: openmindRootPreviewBody(preview), confirmText: m.openmindRoot.confirm })) return;
      await window.openmind.setOpenmindRoot(root);
      await onRepo(root);
      await loadPrefs();
      ai.notify(m.settings.notify.openmindRootUpdated, "success");
    } catch {
      ai.notify(m.settings.notify.openmindRootSelectFailed, "error");
    }
  };

  const resetWorkflow = async () => {
    const ok = await ai.confirm({ title: m.settings.workflow.resetToDefaults, body: m.settings.workflow.resetConfirm, confirmText: m.settings.workflow.resetToDefaults, danger: true });
    if (!ok) return;
    setSaving(true);
    try {
      await saveQueue.current;
      const next = await window.openmind.resetPreferences("workflow");
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
    try { await window.openmind.openPath(prefs?.notesDir || "openmind"); }
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
    try { await window.openmind.openPath(path); }
    catch { ai.notify(m.settings.skills.openFailed, "error"); }
  };

  const saveBrowserToken = async (token: string) => {
    if (savingBrowserToken) return;
    setSavingBrowserToken(true);
    try {
      setBrowserStatus(await window.openmind.saveBrowserExtensionToken(token));
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
      setBrowserStatus(await window.openmind.clearBrowserExtensionToken());
      await loadMcpServers();
      ai.notify(m.settings.browser.tokenCleared, "success");
    } catch {
      ai.notify(m.settings.browser.tokenFailed, "error");
    } finally {
      setSavingBrowserToken(false);
    }
  };

  const openBrowserExtensionDocs = async () => {
    try { await window.openmind.openExternal("https://github.com/microsoft/playwright-mcp#browser-extension"); }
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
    <div className="settings-page" data-settings-section={activeSection}>
      <SettingsNavigation
        activeSection={activeSection}
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
            {!["skills", "mcp", "runtime"].includes(activeSection) && !loading && !loadError ? <small role="status" aria-live="polite">{saving ? m.settings.saveStatus.saving : m.settings.saveStatus.saved}</small> : null}
          </header>

          {loading ? (
            <section className="settings-load-state settings-card" role="status">{m.settings.loading}</section>
          ) : loadError || !prefs ? (
            <section className="settings-load-state settings-card ui-error-state" role="alert">
              <strong>{loadError || m.settings.loadError}</strong>
              <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void loadPrefs()}>{m.settings.retry}</button>
            </section>
          ) : (
            <div className="settings-stack entrance-stagger" aria-busy={saving || undefined}>
              {activeSection === "general" ? (
                <>
                  <AppearanceSettingsSection prefs={prefs} save={save} />
                  <PathSettingsSection openmind={prefs.openmindRoot ? initialRepo : m.settings.paths.unset} notes={prefs.notesDir || "openmind"} onSelectOpenmind={() => void selectOpenmindRoot()} onOpenNotes={() => void openNotesDir()} />
                </>
              ) : null}
              {activeSection === "providers" ? <><ProviderSettingsSection providers={providers} defaultProviderId={defaultProviderId} providerConfiguration={providersYaml} providerConfigurationBusy={providersYamlBusy} save={save} onSaveProviderConfiguration={saveProvidersYaml} /><AiProvidersSettingsSection view={providersYaml} busy={providersYamlBusy} onSave={saveProvidersYaml} notify={ai.notify} /></> : null}
              {activeSection === "runtime" ? <SharedPythonRuntimeSection status={sharedPythonRuntime} busy={runtimeBusy !== null} onToggle={(enabled) => void toggleSharedPythonRuntime(enabled)} onRefresh={() => void loadSharedPythonRuntime()} /> : null}
              {activeSection === "skills" ? <SkillsPage embedded skills={ai.skills} initialSkillId={initialSkillId} initialSourcePickerOpen={initialSkillImportOpen} onInstallationChange={onRepo} onAvailabilityChange={ai.refreshSkills} /> : null}
              {activeSection === "mcp" ? <SkillSettingsSection mode="mcp" skills={ai.skills} mcpServers={mcpServers} refreshing={refreshingSkills} onRefresh={() => void refreshSkills()} onCopy={(skillId) => void copySkillInvocation(skillId)} onOpenDirectory={(path) => void openSkillDirectory(path)} onOpenMcpSettings={() => selectSection("browser")} /> : null}
              {activeSection === "browser" ? <BrowserSettingsSection prefs={prefs} status={browserStatus} savingToken={savingBrowserToken} save={save} onSaveToken={saveBrowserToken} onClearToken={clearBrowserToken} onOpenExtensionDocs={() => void openBrowserExtensionDocs()} /> : null}
              {activeSection === "permissions" ? <PermissionSettingsSection prefs={prefs} save={save} /> : null}
              {activeSection === "workflow" ? <WorkflowSettingsSection prefs={prefs} save={save} onReset={() => void resetWorkflow()} /> : null}
              {activeSection === "sessions" ? <ArchivedSessionsSettingsSection sessions={archivedSessions} busyId={sessionBusyId} onOpen={(sessionId) => void openArchivedSession(sessionId)} onRestore={(sessionId) => void restoreArchivedSession(sessionId)} /> : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SettingsNavigation({ activeSection, onBack, onSelect }: {
  activeSection: SettingsSectionId;
  onBack(): void;
  onSelect(section: SettingsSectionId): void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return (
    <aside className="settings-navigation" aria-label={m.settings.navigation.label}>
      <button type="button" className="settings-back-button" data-motion="action" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden />
        <span>{m.settings.navigation.back}</span>
      </button>
      <label className="settings-nav-search">
        <Search size={14} aria-hidden />
        <input
          type="search"
          value={query}
          aria-label={m.settings.navigation.searchPlaceholder}
          placeholder={m.settings.navigation.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <nav className="settings-navigation-scroll" aria-label={m.settings.navigation.label}>
        {SETTINGS_GROUPS.map((group) => {
          const sections = SETTINGS_SECTIONS.filter((section) => section.group === group && (!normalizedQuery || `${section.title} ${section.description}`.toLocaleLowerCase().includes(normalizedQuery)));
          if (!sections.length) return null;
          return (
            <section className="settings-nav-group" key={group}>
              <span>{m.settings.navigation.groups[group]}</span>
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    type="button"
                    className="settings-nav-button"
                    data-motion="selection"
                    key={section.id}
                    aria-current={activeSection === section.id ? "page" : undefined}
                    aria-controls="settings-detail-panel"
                    onClick={(event) => {
                      // Pointer clicks should not leave the global keyboard-focus
                      // ring on the newly selected destination. Keyboard activation
                      // reports detail === 0 and intentionally keeps focus.
                      if (event.detail > 0) event.currentTarget.blur();
                      onSelect(section.id);
                    }}
                  >
                    <Icon size={15} aria-hidden />
                    <span>{section.title}</span>
                  </button>
                );
              })}
            </section>
          );
        })}
        {normalizedQuery && !SETTINGS_SECTIONS.some((section) => `${section.title} ${section.description}`.toLocaleLowerCase().includes(normalizedQuery)) ? <p className="settings-nav-empty">{m.settings.navigation.noResults}</p> : null}
      </nav>
    </aside>
  );
}
