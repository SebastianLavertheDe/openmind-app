import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Archive, Bot, Cpu, Globe, HardDrive, Package, Route, Search, Server, Settings as SettingsIcon, ShieldCheck, type LucideIcon } from "lucide-react";
import type { BrowserAutomationStatus, InstalledSkillView, McpServerDefinition, ProviderCapabilities, RuntimePackDownloadDescriptor, RuntimePackDownloadJob, RuntimePackReadiness, SharedPythonRuntimeStatus, SkillPackageInspectionView, UserPreferences } from "@shared/contracts";
import { messages } from "@shared/messages";
import { useAi } from "../../ai-context";
import { mymindRootPreviewBody, mymindRootPreviewError } from "../../mymind-root-selection";
import { applyTheme } from "../../theme";
import { SkillsPage } from "../skills";
import {
  ArchivedSessionsSettingsSection,
  AppearanceSettingsSection,
  BrowserSettingsSection,
  DataRetentionSettingsSection,
  PathSettingsSection,
  PermissionSettingsSection,
  ProviderSettingsSection,
  RuntimeSettingsSection,
  SharedPythonRuntimeSection,
  SkillSettingsSection,
  WorkflowSettingsSection
} from "./settings-sections";

const m = messages;
const BLUE_ACCENT = "#2563eb";

type SettingsSectionId = "general" | "providers" | "runtime" | "skills" | "mcp" | "browser" | "permissions" | "workflow" | "storage" | "sessions";
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
  { id: "runtime", group: "ai", icon: Cpu, title: "内置运行时", description: "统一管理供 Skill 与自动化任务使用的共享 Python 环境。" },
  { id: "skills", group: "ai", icon: Package, ...m.settings.navigation.sections.skills },
  { id: "mcp", group: "ai", icon: Server, ...m.settings.navigation.sections.mcp },
  { id: "browser", group: "ai", icon: Globe, ...m.settings.navigation.sections.browser },
  { id: "permissions", group: "ai", icon: ShieldCheck, ...m.settings.navigation.sections.permissions },
  { id: "workflow", group: "creation", icon: Route, ...m.settings.navigation.sections.workflow },
  { id: "storage", group: "data", icon: HardDrive, ...m.settings.navigation.sections.storage },
  { id: "sessions", group: "data", icon: Archive, ...m.settings.navigation.sections.sessions }
];

const SETTINGS_GROUPS: readonly SettingsGroupId[] = ["personal", "ai", "creation", "data"];

export function SettingsPage({ repoRoot: initialRepo, providers, onRepo, onBack, onOpenSession, initialSection, initialSkillId }: { repoRoot: string; providers: ProviderCapabilities[]; onRepo(root: string): void; onBack(): void; onOpenSession?(): void; initialSection?: SettingsSectionId; initialSkillId?: string }) {
  const ai = useAi();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [browserStatus, setBrowserStatus] = useState<BrowserAutomationStatus | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>([]);
  const [runtimePacks, setRuntimePacks] = useState<RuntimePackReadiness[]>([]);
  const [runtimeDownloads, setRuntimeDownloads] = useState<RuntimePackDownloadJob[]>([]);
  const [runtimeDownloadCandidate, setRuntimeDownloadCandidate] = useState<RuntimePackDownloadDescriptor | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState<string | null>(null);
  const [sharedPythonRuntime, setSharedPythonRuntime] = useState<SharedPythonRuntimeStatus | null>(null);
  const [savingBrowserToken, setSavingBrowserToken] = useState(false);
  const [refreshingSkills, setRefreshingSkills] = useState(false);
  const [skillPackageInspections, setSkillPackageInspections] = useState<SkillPackageInspectionView[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkillView[]>([]);
  const [skillPackageBusy, setSkillPackageBusy] = useState<"inspect" | "migrate" | "rollback" | "uninstall" | null>(null);
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

  const loadSkillPackages = useCallback(async () => {
    try {
      const [inspections, installed] = await Promise.all([
        window.cctools.inspectSkillWorkspace(),
        window.cctools.listInstalledSkills()
      ]);
      setSkillPackageInspections(inspections);
      setInstalledSkills(installed);
    } catch {
      setSkillPackageInspections([]);
      setInstalledSkills([]);
    }
  }, []);

  const loadRuntimePacks = useCallback(async () => {
    try {
      setRuntimePacks(await window.cctools.listRuntimePacks());
    } catch {
      setRuntimePacks([]);
    }
    try {
      if (window.cctools.listRuntimePackDownloads) setRuntimeDownloads(await window.cctools.listRuntimePackDownloads());
    } catch {
      setRuntimeDownloads([]);
    }
  }, []);

  const loadSharedPythonRuntime = useCallback(async () => {
    try { setSharedPythonRuntime(await window.cctools.getSharedPythonRuntimeStatus()); }
    catch { setSharedPythonRuntime(null); }
  }, []);

  useEffect(() => {
    if (activeSection === "runtime" && !loading && prefs) void loadSharedPythonRuntime();
  }, [activeSection, loadSharedPythonRuntime, loading, prefs]);

  const toggleSharedPythonRuntime = useCallback(async (enabled: boolean) => {
    if (runtimeBusy) return;
    setRuntimeBusy(enabled ? "shared-python-enable" : "shared-python-disable");
    try {
      setSharedPythonRuntime(await window.cctools.setSharedPythonRuntimeEnabled(enabled));
      ai.notify(enabled ? "内置 Python 运行时已就绪" : "内置 Python 运行时已关闭", "success");
    } catch {
      await loadSharedPythonRuntime();
      ai.notify(enabled ? "内置 Python 初始化失败，请检查发行包资源或依赖冲突" : "内置 Python 运行时关闭失败", "error");
    } finally {
      setRuntimeBusy(null);
    }
  }, [ai, loadSharedPythonRuntime, runtimeBusy]);

  useEffect(() => {
    if (!window.cctools.onRuntimePackDownloadEvent) return;
    return window.cctools.onRuntimePackDownloadEvent((job) => {
      setRuntimeDownloads((current) => {
        const next = current.filter((item) => item.id !== job.id);
        next.push(job);
        return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      });
      if (job.status === "installed") void loadRuntimePacks();
    });
  }, [loadRuntimePacks]);

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
      // New API keeps workspace independent from mymind. The legacy fallback
      // is retained for one release so older preload bundles remain usable.
      const root = window.cctools.selectWorkspaceRoot
        ? await window.cctools.selectWorkspaceRoot()
        : await window.cctools.selectRepo();
      if (!root) return;
      onRepo(root);
      await loadPrefs();
      ai.notify(m.settings.notify.workspaceUpdated, "success");
    } catch {
      ai.notify(m.settings.notify.workspaceSelectFailed, "error");
    }
  };

  const selectMymindRoot = async () => {
    try {
      const root = await window.cctools.selectMymindRoot();
      if (!root) return;
      const preview = await window.cctools.previewMymindRoot(root);
      if (!preview.canBind) throw new Error(mymindRootPreviewError(preview));
      if (!await ai.confirm({ title: "确认绑定 mymind 根目录", body: mymindRootPreviewBody(preview), confirmText: "确认绑定" })) return;
      await window.cctools.setMymindRoot(root);
      await loadPrefs();
      ai.notify("mymind 内容根已更新", "success");
    } catch {
      ai.notify("选择 mymind 内容根失败", "error");
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
      const [next, servers] = await Promise.all([ai.refreshSkills(), loadMcpServers(), loadSkillPackages()]);
      if (next) ai.notify(m.settings.skills.scanComplete(next.length, servers.length), "success");
      else ai.notify(m.settings.skills.scanFailed, "error");
    } finally {
      setRefreshingSkills(false);
    }
  };

  const inspectSkillPackages = async () => {
    if (skillPackageBusy) return;
    setSkillPackageBusy("inspect");
    try {
      await loadSkillPackages();
      ai.notify(m.settings.skills.packageInspect, "success");
    } catch {
      ai.notify(m.settings.skills.packageInspectFailed, "error");
    } finally {
      setSkillPackageBusy(null);
    }
  };

  const migrateSkillPackages = async () => {
    if (skillPackageBusy) return;
    setSkillPackageBusy("migrate");
    try {
      const report = await window.cctools.migrateSkillWorkspace();
      setSkillPackageInspections(report.inspected);
      setInstalledSkills(report.installed);
      ai.notify(m.settings.skills.packageMigrateComplete(report.installed.length, report.skipped.length), "success");
    } catch {
      ai.notify(m.settings.skills.packageInspectFailed, "error");
    } finally {
      setSkillPackageBusy(null);
    }
  };

  const rollbackSkillPackage = async (key: string) => {
    if (skillPackageBusy || !window.cctools.rollbackSkillPackage) return;
    setSkillPackageBusy("rollback");
    try {
      await window.cctools.rollbackSkillPackage(key);
      await loadSkillPackages();
      ai.notify(m.settings.skills.packageActionComplete, "success");
    } catch {
      ai.notify(m.settings.skills.packageInspectFailed, "error");
    } finally {
      setSkillPackageBusy(null);
    }
  };

  const uninstallSkillPackage = async (key: string, digest: string) => {
    if (skillPackageBusy || !window.cctools.uninstallSkillPackage || !window.confirm(m.settings.skills.packageUninstallConfirm)) return;
    setSkillPackageBusy("uninstall");
    try {
      await window.cctools.uninstallSkillPackage(key, digest);
      await loadSkillPackages();
      ai.notify(m.settings.skills.packageActionComplete, "success");
    } catch {
      ai.notify(m.settings.skills.packageInspectFailed, "error");
    } finally {
      setSkillPackageBusy(null);
    }
  };

  const refreshRuntimePacks = async () => {
    if (runtimeBusy) return;
    setRuntimeBusy("refresh");
    try {
      await loadRuntimePacks();
    } finally {
      setRuntimeBusy(null);
    }
  };

  const importRuntimePack = async () => {
    if (runtimeBusy) return;
    setRuntimeBusy("import");
    try {
      const imported = await window.cctools.importRuntimePack();
      if (!imported) return;
      await loadRuntimePacks();
      ai.notify("Runtime Pack 已导入为候选版本", "success");
    } catch {
      ai.notify("Runtime Pack 导入失败：签名、版本或内容校验未通过", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const selectRuntimePackDownloadManifest = async () => {
    if (runtimeBusy || !window.cctools.selectRuntimePackDownloadManifest) return;
    setRuntimeBusy("download-select");
    try {
      const candidate = await window.cctools.selectRuntimePackDownloadManifest();
      if (candidate) setRuntimeDownloadCandidate(candidate);
    } catch {
      ai.notify("Runtime Pack Manifest 无效，或未声明 HTTPS 下载地址", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const startRuntimePackDownload = async () => {
    if (runtimeBusy || !runtimeDownloadCandidate || !window.cctools.startRuntimePackDownload) return;
    setRuntimeBusy("download-start");
    try {
      await window.cctools.startRuntimePackDownload(runtimeDownloadCandidate.metadata);
      setRuntimeDownloadCandidate(null);
      await loadRuntimePacks();
      ai.notify("Runtime Pack 下载已开始，可在当前页面暂停或继续", "success");
    } catch {
      ai.notify("Runtime Pack 下载启动失败：请检查 Manifest 和 HTTPS 地址", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const pauseRuntimePackDownload = async (job: RuntimePackDownloadJob) => {
    if (runtimeBusy || !window.cctools.pauseRuntimePackDownload) return;
    setRuntimeBusy(`download-pause:${job.id}`);
    try {
      await window.cctools.pauseRuntimePackDownload(job.id);
      await loadRuntimePacks();
    } catch {
      ai.notify("Runtime Pack 下载暂停失败", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const resumeRuntimePackDownload = async (job: RuntimePackDownloadJob) => {
    if (runtimeBusy || !window.cctools.resumeRuntimePackDownload) return;
    setRuntimeBusy(`download-resume:${job.id}`);
    try {
      await window.cctools.resumeRuntimePackDownload(job.id);
      await loadRuntimePacks();
    } catch {
      ai.notify("Runtime Pack 下载继续失败", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const removeRuntimePackDownload = async (job: RuntimePackDownloadJob) => {
    if (runtimeBusy || !window.cctools.removeRuntimePackDownload || !window.confirm(`确认删除 ${job.metadata.packId} ${job.metadata.version} 的下载记录和未完成文件？`)) return;
    setRuntimeBusy(`download-remove:${job.id}`);
    try {
      await window.cctools.removeRuntimePackDownload(job.id);
      await loadRuntimePacks();
    } catch {
      ai.notify("Runtime Pack 下载记录删除失败", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const repairRuntimePack = async (pack: RuntimePackReadiness) => {
    if (runtimeBusy) return;
    setRuntimeBusy(`repair:${pack.digest}`);
    try {
      const repaired = await window.cctools.repairRuntimePackFromFile(pack.packId, pack.target, pack.digest);
      if (!repaired) return;
      await loadRuntimePacks();
      ai.notify("Runtime Pack 已修复，请重新检查 readiness", "success");
    } catch {
      ai.notify("Runtime Pack 修复失败：请选择匹配的签名 Manifest 和包文件", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const activateRuntimePack = async (pack: RuntimePackReadiness) => {
    if (runtimeBusy) return;
    setRuntimeBusy(`activate:${pack.digest}`);
    try {
      await window.cctools.activateRuntimePack(pack.packId, pack.target, pack.digest);
      await loadRuntimePacks();
      ai.notify("Runtime Pack 已激活", "success");
    } catch {
      ai.notify("Runtime Pack 激活失败", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const rollbackRuntimePack = async (pack: RuntimePackReadiness) => {
    if (runtimeBusy) return;
    setRuntimeBusy(`rollback:${pack.packId}:${pack.target}`);
    try {
      await window.cctools.rollbackRuntimePack(pack.packId, pack.target);
      await loadRuntimePacks();
      ai.notify("Runtime Pack 已回滚", "success");
    } catch {
      ai.notify("Runtime Pack 回滚失败", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const removeRuntimePack = async (pack: RuntimePackReadiness) => {
    if (runtimeBusy || !window.confirm(`确认移除 ${pack.packId} ${pack.version}？`)) return;
    setRuntimeBusy(`remove:${pack.digest}`);
    try {
      await window.cctools.removeRuntimePack(pack.packId, pack.target, pack.digest);
      await loadRuntimePacks();
      ai.notify("Runtime Pack 已移除", "success");
    } catch {
      ai.notify("Runtime Pack 移除失败", "error");
    } finally {
      setRuntimeBusy(null);
    }
  };

  const garbageCollectRuntimePacks = async () => {
    if (runtimeBusy) return;
    setRuntimeBusy("gc");
    try {
      await window.cctools.garbageCollectRuntimePacks();
      await loadRuntimePacks();
      ai.notify("未激活且未使用的 Runtime Pack 已清理", "success");
    } catch {
      ai.notify("Runtime Pack 清理失败：当前状态可能正在被 Run 使用", "error");
    } finally {
      setRuntimeBusy(null);
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
                  <PathSettingsSection mymind={prefs.mymindRoot || m.settings.paths.unset} workspace={prefs.workspaceRoot || prefs.repoRoot || initialRepo} notes={prefs.notesDir || "mymind"} onSelectMymind={() => void selectMymindRoot()} onSelectWorkspace={() => void selectWorkspace()} onOpenNotes={() => void openNotesDir()} />
                </>
              ) : null}
              {activeSection === "providers" ? <ProviderSettingsSection providers={providers} defaultProviderId={defaultProviderId} save={save} /> : null}
              {activeSection === "runtime" ? <SharedPythonRuntimeSection status={sharedPythonRuntime} busy={runtimeBusy !== null} onToggle={(enabled) => void toggleSharedPythonRuntime(enabled)} onRefresh={() => void loadSharedPythonRuntime()} /> : null}
              {activeSection === "skills" ? <SkillsPage embedded skills={ai.skills} initialSkillId={initialSkillId} /> : null}
              {activeSection === "mcp" ? <SkillSettingsSection mode="mcp" skills={ai.skills} mcpServers={mcpServers} refreshing={refreshingSkills} onRefresh={() => void refreshSkills()} onCopy={(skillId) => void copySkillInvocation(skillId)} onOpenDirectory={(path) => void openSkillDirectory(path)} onOpenMcpSettings={() => selectSection("browser")} packageInspections={skillPackageInspections} installedSkills={installedSkills} packageBusy={skillPackageBusy} onInspectPackages={() => void inspectSkillPackages()} onMigratePackages={() => void migrateSkillPackages()} onRollbackPackage={(key) => void rollbackSkillPackage(key)} onUninstallPackage={(key, digest) => void uninstallSkillPackage(key, digest)} /> : null}
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
        {normalizedQuery && !SETTINGS_SECTIONS.some((section) => `${section.title} ${section.description}`.toLocaleLowerCase().includes(normalizedQuery)) ? <p className="settings-nav-empty">{m.settings.navigation.noResults}</p> : null}
      </nav>
    </aside>
  );
}
