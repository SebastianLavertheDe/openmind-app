import { SearchInput } from "../../design-system/components";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Archive, Bot, Cpu, Globe, Package, Plug, Route, Server, Settings as SettingsIcon, ShieldCheck, type LucideIcon } from "lucide-react";
import type { BrowserSkillStatus, McpServerDefinition, ProviderCapabilities, ProvidersYamlInput, ProvidersYamlView, SharedPythonRuntimeStatus, UserPreferences } from "@shared/contracts";
import { messages } from "@shared/messages";
import { workspaceSessions } from "@shared/ai-session-scope";
import { useAiActions, useAiSnapshot, useAiUi } from "../../ai-context";
import { openmindRootPreviewBody, openmindRootPreviewError } from "../../openmind-root-selection";
import { applyTheme } from "../../theme";
import { applyLocale, useLocale } from "../../i18n";
import { SkillsPage } from "../skills";
import { WechatSettingsSection } from "../wechat/WechatSettingsSection";
import { announceProviderConfiguration } from "../../provider-configuration-events";
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

type SettingsSectionId = "general" | "providers" | "runtime" | "skills" | "mcp" | "browser" | "permissions" | "workflow" | "connectors" | "sessions";
type SettingsGroupId = "personal" | "ai" | "creation" | "data";

type SettingsSectionDefinition = {
  id: SettingsSectionId;
  group: SettingsGroupId;
  icon: LucideIcon;
  title: string;
  description: string;
};

function settingsSections(): readonly SettingsSectionDefinition[] { return [
  { id: "general", group: "personal", icon: SettingsIcon, ...m.settings.navigation.sections.general },
  { id: "providers", group: "ai", icon: Bot, ...m.settings.navigation.sections.providers },
  { id: "runtime", group: "ai", icon: Cpu, ...m.settings.navigation.sections.runtime },
  { id: "skills", group: "ai", icon: Package, ...m.settings.navigation.sections.skills },
  { id: "mcp", group: "ai", icon: Server, ...m.settings.navigation.sections.mcp },
  { id: "browser", group: "ai", icon: Globe, ...m.settings.navigation.sections.browser },
  { id: "permissions", group: "ai", icon: ShieldCheck, ...m.settings.navigation.sections.permissions },
  { id: "workflow", group: "creation", icon: Route, ...m.settings.navigation.sections.workflow },
  { id: "connectors", group: "creation", icon: Plug, ...m.settings.navigation.sections.connectors },
  { id: "sessions", group: "data", icon: Archive, ...m.settings.navigation.sections.sessions }
]; }

const SETTINGS_GROUPS: readonly SettingsGroupId[] = ["personal", "ai", "creation", "data"];

export function SettingsPage({ repoRoot: initialRepo, providers, onRepo, onBack, onOpenSession, initialSection, initialSkillId, initialSkillImportOpen, initialProviderCategory }: { repoRoot: string; providers: ProviderCapabilities[]; onRepo(root?: string): void | Promise<unknown>; onBack(): void; onOpenSession?(): void; initialSection?: SettingsSectionId; initialSkillId?: string; initialSkillImportOpen?: boolean; initialProviderCategory?: "text" | "image" }) {
  const locale = useLocale();
  const ai = useAiSnapshot();
  const ui = useAiUi();
  const actions = useAiActions();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [browserStatus, setBrowserStatus] = useState<BrowserSkillStatus | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>([]);
  const [runtimeBusy, setRuntimeBusy] = useState<string | null>(null);
  const [sharedPythonRuntime, setSharedPythonRuntime] = useState<SharedPythonRuntimeStatus | null>(null);
  const [providersYaml, setProvidersYaml] = useState<ProvidersYamlView | null>(null);
  const [providersYamlBusy, setProvidersYamlBusy] = useState(false);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [refreshingSkills, setRefreshingSkills] = useState(false);
  const [sessionBusyId, setSessionBusyId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection || "general");
  const [compactDetailOpen, setCompactDetailOpen] = useState(Boolean(initialSection));
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
      setCompactDetailOpen(true);
    }
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
      applyLocale(next);
      try { setBrowserStatus(await window.openmind.getBrowserSkillStatus()); }
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
      ui.notify(error instanceof Error ? error.message : m.settings.notify.providersLoadFailed, "error");
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
      announceProviderConfiguration();
      ui.notify(m.settings.notify.providersSaved, "success");
    } catch (error) {
      ui.notify(error instanceof Error ? error.message : m.settings.notify.providersSaveFailed, "error");
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
      ui.notify(enabled ? m.settings.notify.pythonEnabled : m.settings.notify.pythonDisabled, "success");
    } catch {
      await loadSharedPythonRuntime();
      ui.notify(enabled ? m.settings.notify.pythonEnableFailed : m.settings.notify.pythonDisableFailed, "error");
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
      applyLocale(next);
    });
    saveQueue.current = operation.catch(() => undefined);
    return operation.catch(() => {
      ui.notify(m.settings.notify.saveFailed, "error");
      return loadPrefs();
    }).finally(() => {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) setSaving(false);
    });
  }, [ai, loadMcpServers, loadPrefs]);

  const defaultProviderId = useMemo(() => prefs?.defaultProvider || providers.find((provider) => provider.available)?.id || "", [prefs?.defaultProvider, providers, locale]);

  const archivedSessions = useMemo(() => workspaceSessions(ai.snapshot.sessions, true)
    .filter((session) => session.archived)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [ai.snapshot.sessions, locale]);

  const activeDefinition = settingsSections().find((section) => section.id === activeSection) ?? settingsSections()[0];

  const selectSection = useCallback((section: SettingsSectionId) => {
    setActiveSection(section);
    setCompactDetailOpen(true);
    if (detailRef.current) detailRef.current.scrollTop = 0;
    if (window.matchMedia?.("(max-width: 720px)").matches) {
      window.requestAnimationFrame(() => detailRef.current?.querySelector<HTMLElement>("#settings-detail-title")?.focus());
    }
  }, []);

  const showSettingsNavigation = useCallback(() => {
    setCompactDetailOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`.settings-nav-button[data-section-id="${activeSection}"]`)?.focus();
    });
  }, [activeSection]);

  const selectOpenmindRoot = async () => {
    try {
      const root = await window.openmind.selectOpenmindRoot();
      if (!root) return;
      const preview = await window.openmind.previewOpenmindRoot(root);
      if (!preview.canBind) throw new Error(openmindRootPreviewError(preview));
      if (!await ui.confirm({ title: m.openmindRoot.confirmTitle, body: openmindRootPreviewBody(preview), confirmText: m.openmindRoot.confirm })) return;
      await window.openmind.setOpenmindRoot(root);
      await onRepo(root);
      await loadPrefs();
      ui.notify(m.settings.notify.openmindRootUpdated, "success");
    } catch {
      ui.notify(m.settings.notify.openmindRootSelectFailed, "error");
    }
  };

  const resetWorkflow = async () => {
    const ok = await ui.confirm({ title: m.settings.workflow.resetToDefaults, body: m.settings.workflow.resetConfirm, confirmText: m.settings.workflow.resetToDefaults, danger: true });
    if (!ok) return;
    setSaving(true);
    try {
      await saveQueue.current;
      const next = await window.openmind.resetPreferences("workflow");
      setPrefs(next);
      applyTheme(next);
      ui.notify(m.settings.notify.workflowReset, "success");
    } catch {
      ui.notify(m.settings.notify.saveFailed, "error");
    } finally {
      setSaving(false);
    }
  };

  const openNotesDir = async () => {
    try { await window.openmind.openPath(prefs?.notesDir || "openmind"); }
    catch { ui.notify(m.settings.notify.notesOpenFailed, "error"); }
  };

  const refreshSkills = async () => {
    if (refreshingSkills) return;
    setRefreshingSkills(true);
    try {
      const [next, servers] = await Promise.all([actions.refreshSkills(), loadMcpServers()]);
      if (next) ui.notify(m.settings.skills.scanComplete(next.length, servers.length), "success");
      else ui.notify(m.settings.skills.scanFailed, "error");
    } finally {
      setRefreshingSkills(false);
    }
  };

  const copySkillInvocation = async (skillId: string) => {
    try {
      await navigator.clipboard.writeText(`/${skillId}`);
      ui.notify(m.settings.skills.copySuccess(skillId), "success");
    } catch {
      ui.notify(m.settings.skills.copyFailed, "error");
    }
  };

  const openSkillDirectory = async (path: string) => {
    try { await window.openmind.openPath(path); }
    catch { ui.notify(m.settings.skills.openFailed, "error"); }
  };

  const refreshBrowserSkill = async () => {
    try { setBrowserStatus(await window.openmind.getBrowserSkillStatus()); }
    catch { ui.notify(m.settings.browser.loadFailed, "error"); }
  };

  const installBrowserSkill = async () => {
    if (browserBusy) return;
    setBrowserBusy(true);
    try {
      setBrowserStatus(await window.openmind.installBrowserSkill());
      await actions.refreshSkills();
      ui.notify(m.settings.browser.installSucceeded, "success");
    } catch (error) {
      ui.notify(error instanceof Error ? error.message : m.settings.browser.installFailed, "error");
    } finally { setBrowserBusy(false); }
  };

  const openBrowserExtensionDocs = async () => {
    try { await window.openmind.openExternal("https://github.com/Tencent/BrowserSkill#quick-start"); }
    catch { ui.notify(m.settings.browser.loadFailed, "error"); }
  };

  const restoreArchivedSession = async (sessionId: string) => {
    if (sessionBusyId) return;
    setSessionBusyId(sessionId);
    try {
      await actions.updateSession(sessionId, { archived: false });
      ui.notify(m.ai.session.unarchived, "success");
    } catch {
      ui.notify(m.settings.notify.sessionRestoreFailed, "error");
    } finally {
      setSessionBusyId(null);
    }
  };

  const openArchivedSession = async (sessionId: string) => {
    if (sessionBusyId) return;
    setSessionBusyId(sessionId);
    try {
      await actions.setActiveSession(sessionId);
      onOpenSession?.();
    } catch {
      ui.notify(m.settings.notify.sessionOpenFailed, "error");
    } finally {
      setSessionBusyId(null);
    }
  };

  return (
    <div className="settings-page" data-settings-section={activeSection} data-compact-detail-open={compactDetailOpen || undefined}>
      <SettingsNavigation
        activeSection={activeSection}
        onBack={onBack}
        onSelect={selectSection}
      />
      <section className="settings-detail" id="settings-detail-panel" ref={detailRef} aria-labelledby="settings-detail-title">
        <div className="settings-detail-inner">
          <button type="button" className="settings-detail-back" data-motion="action" onClick={showSettingsNavigation}>
            <ArrowLeft size={15} aria-hidden />
            <span>{m.settings.page.title}</span>
          </button>
          <header className="settings-detail-header">
            <div>
              <span>{m.settings.page.title}</span>
              <h1 id="settings-detail-title" tabIndex={-1}>{activeDefinition.title}</h1>
              <p>{activeDefinition.description}</p>
            </div>
            {!["skills", "mcp", "runtime", "connectors"].includes(activeSection) && !loading && !loadError ? <small role="status" aria-live="polite">{saving ? m.settings.saveStatus.saving : m.settings.saveStatus.saved}</small> : null}
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
              {activeSection === "providers" ? <><ProviderSettingsSection providers={providers} defaultProviderId={defaultProviderId} providerConfiguration={providersYaml} providerConfigurationBusy={providersYamlBusy} save={save} onSaveProviderConfiguration={saveProvidersYaml} /><AiProvidersSettingsSection view={providersYaml} busy={providersYamlBusy} onSave={saveProvidersYaml} notify={ui.notify} initialCategory={initialProviderCategory} /></> : null}
              {activeSection === "runtime" ? <SharedPythonRuntimeSection status={sharedPythonRuntime} busy={runtimeBusy !== null} onToggle={(enabled) => void toggleSharedPythonRuntime(enabled)} onRefresh={() => void loadSharedPythonRuntime()} /> : null}
              {activeSection === "skills" ? <SkillsPage embedded skills={ai.skills} initialSkillId={initialSkillId} initialSourcePickerOpen={initialSkillImportOpen} onInstallationChange={onRepo} onAvailabilityChange={actions.refreshSkills} /> : null}
              {activeSection === "mcp" ? <SkillSettingsSection mode="mcp" skills={ai.skills} mcpServers={mcpServers} refreshing={refreshingSkills} onRefresh={() => void refreshSkills()} onCopy={(skillId) => void copySkillInvocation(skillId)} onOpenDirectory={(path) => void openSkillDirectory(path)} onOpenMcpSettings={() => selectSection("browser")} /> : null}
              {activeSection === "browser" ? <BrowserSettingsSection status={browserStatus} busy={browserBusy} onInstall={() => void installBrowserSkill()} onRefresh={() => void refreshBrowserSkill()} onOpenDocs={() => void openBrowserExtensionDocs()} /> : null}
              {activeSection === "permissions" ? <PermissionSettingsSection prefs={prefs} save={save} /> : null}
              {activeSection === "workflow" ? <WorkflowSettingsSection prefs={prefs} save={save} onReset={() => void resetWorkflow()} /> : null}
              {activeSection === "connectors" ? <WechatSettingsSection /> : null}
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
  useLocale();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return (
    <aside className="settings-navigation" aria-label={m.settings.navigation.label}>
      <button type="button" className="settings-back-button" data-motion="action" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden />
        <span>{m.settings.navigation.back}</span>
      </button>
      <SearchInput className="settings-nav-search"
          type="search"
          value={query}
          aria-label={m.settings.navigation.searchPlaceholder}
          placeholder={m.settings.navigation.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
      <nav className="settings-navigation-scroll" aria-label={m.settings.navigation.label}>
        {SETTINGS_GROUPS.map((group) => {
          const sections = settingsSections().filter((section) => section.group === group && (!normalizedQuery || `${section.title} ${section.description}`.toLocaleLowerCase().includes(normalizedQuery)));
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
                    data-section-id={section.id}
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
        {normalizedQuery && !settingsSections().some((section) => `${section.title} ${section.description}`.toLocaleLowerCase().includes(normalizedQuery)) ? <p className="settings-nav-empty">{m.settings.navigation.noResults}</p> : null}
      </nav>
    </aside>
  );
}
