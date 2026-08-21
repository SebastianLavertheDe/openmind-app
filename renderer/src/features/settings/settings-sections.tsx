import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Archive, ChevronDown, Copy, Download, ExternalLink, FolderOpen, Globe, KeyRound, MessageSquareText, Package, Pause, Play, Plus, RefreshCw, RotateCcw, Search, Server, ShieldCheck, Trash2, Wrench, X } from "lucide-react";
import type { AiSession, BrowserAutomationStatus, CliInstallProgress, CliProviderBindings, CliToolUpdateView, InstalledSkillView, McpServerDefinition, ProviderAuthMode, ProviderCapabilities, ProviderYamlInputEntry, ProviderProtocol, ProvidersYamlInput, ProvidersYamlView, RuntimePackDownloadDescriptor, RuntimePackDownloadJob, RuntimePackReadiness, SharedPythonRuntimeStatus, SkillDefinition, UserPreferences } from "@shared/contracts";
import { PROVIDER_PRESETS, supportsCliProvider } from "@shared/contracts";
import { formatContextWindow } from "@shared/model-catalog";
import { messages } from "@shared/messages";
import { SegmentedControl, Select, StatusBadge, ToggleSwitch } from "../../design-system/components";

const m = messages;

type SavePreferences = (patch: Partial<UserPreferences>) => Promise<void>;

const THEME_OPTIONS: Array<{ value: UserPreferences["themeMode"]; label: string }> = [
  { value: "light", label: m.settings.theme.light },
  { value: "dark", label: m.settings.theme.dark }
];

const DENSITY_OPTIONS: Array<{ value: UserPreferences["density"]; label: string }> = [
  { value: "compact", label: m.settings.density.compact },
  { value: "default", label: m.settings.density.default },
  { value: "comfortable", label: m.settings.density.comfortable }
];

const FONT_SIZE_OPTIONS: Array<{ value: UserPreferences["fontSize"]; label: string }> = [
  { value: "small", label: m.settings.fontSize.small },
  { value: "default", label: m.settings.fontSize.default },
  { value: "large", label: m.settings.fontSize.large }
];

const PERMISSION_OPTIONS: Array<{ value: UserPreferences["defaultPermissionProfile"]; label: string }> = [
  { value: "read-only", label: m.settings.permissions.readOnly },
  { value: "edit", label: m.settings.permissions.edit },
  { value: "auto", label: m.settings.permissions.auto }
];

const AUTO_SAVE_OPTIONS = [5_000, 15_000, 30_000, 60_000].map((value) => ({
  value: String(value),
  label: value < 60_000 ? `${value / 1000} 秒` : "1 分钟"
}));
const AUTO_ARCHIVE_OPTIONS = [30, 60, 90, 180, 365].map((value) => ({ value: String(value), label: `${value} 天` }));
const CACHE_SIZE_OPTIONS = [250, 500, 1000, 2000, 5000].map((value) => ({ value: String(value), label: value >= 1000 ? `${value / 1000} GB` : `${value} MB` }));
const LOG_RETENTION_OPTIONS = [7, 14, 30, 60, 90].map((value) => ({ value: String(value), label: `${value} 天` }));
const NOTIFICATION_HISTORY_OPTIONS = [50, 100, 200, 500].map((value) => ({ value: String(value), label: `${value} 条` }));

export function AppearanceSettingsSection({ prefs, save }: { prefs: UserPreferences; save: SavePreferences }) {
  return (
    <SettingsPanel title={m.settings.appearance.title} scope="本地偏好">
      <PreferenceRow title={m.settings.appearance.theme} description={m.settings.theme.description}>
        <SegmentedControl value={prefs.themeMode} options={THEME_OPTIONS} label={m.settings.appearance.theme} onChange={(themeMode) => void save({ themeMode })} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.appearance.density} description={m.settings.density.description}>
        <SegmentedControl value={prefs.density} options={DENSITY_OPTIONS} label={m.settings.appearance.density} onChange={(density) => void save({ density })} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.appearance.fontSize} description={m.settings.fontSize.description}>
        <SegmentedControl value={prefs.fontSize} options={FONT_SIZE_OPTIONS} label={m.settings.appearance.fontSize} onChange={(fontSize) => void save({ fontSize })} />
      </PreferenceRow>
    </SettingsPanel>
  );
}

export function ProviderSettingsSection({ providers, defaultProviderId, save }: { providers: ProviderCapabilities[]; defaultProviderId: string; save: SavePreferences }) {
  const [installingCli, setInstallingCli] = useState<"claude" | "codex" | null>(null);
  const [installProgress, setInstallProgress] = useState<CliInstallProgress | null>(null);
  const [installError, setInstallError] = useState<{ cli: "claude" | "codex"; message: string } | null>(null);
  const [versionChecks, setVersionChecks] = useState<Partial<Record<"claude" | "codex", CliToolUpdateView>>>({});
  const [versionError, setVersionError] = useState<{ cli: "claude" | "codex"; message: string } | null>(null);
  const [versionCheckBusy, setVersionCheckBusy] = useState<"claude" | "codex" | null>(null);
  const [upgradingCli, setUpgradingCli] = useState<"claude" | "codex" | null>(null);

  useEffect(() => window.openmind.onCliInstallProgress?.((progress) => {
    setInstallProgress(progress);
    if (progress.phase === "done" || progress.phase === "cancelled") setInstallingCli(null);
  }) || undefined, []);

  const installCli = async (cli: "claude" | "codex") => {
    setInstallError(null);
    setInstallProgress({ cli, phase: "resolving", message: "正在准备安装…" });
    setInstallingCli(cli);
    try {
      await window.openmind.installCliTool(cli);
      await window.openmind.aiRefreshProviders();
    } catch (cause) {
      setInstallError({ cli, message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setInstallingCli(null);
    }
  };

  const cancelInstall = async (cli: "claude" | "codex") => {
    await window.openmind.cancelCliToolInstall(cli);
    setInstallingCli(null);
  };

  const checkVersion = async (cli: "claude" | "codex", force = false) => {
    if (!force && (versionCheckBusy || upgradingCli)) return;
    setVersionError(null);
    setVersionCheckBusy(cli);
    try {
      const result = await window.openmind.checkCliToolUpdate(cli);
      setVersionChecks((current) => ({ ...current, [cli]: result }));
    } catch (cause) {
      setVersionError({ cli, message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setVersionCheckBusy(null);
    }
  };

  const upgradeCli = async (cli: "claude" | "codex") => {
    if (upgradingCli || installingCli || versionCheckBusy) return;
    setInstallError(null);
    setInstallProgress({ cli, phase: "resolving", message: "正在准备升级…" });
    setUpgradingCli(cli);
    try {
      await window.openmind.upgradeCliTool(cli);
      await window.openmind.aiRefreshProviders();
      await checkVersion(cli, true);
    } catch (cause) {
      setInstallError({ cli, message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setUpgradingCli(null);
    }
  };

  return (
    <SettingsPanel title="模型提供方" scope="新会话行为">
      <div className="settings-provider-list" role="radiogroup" aria-label="默认 Provider">
        {providers.length ? providers.map((provider) => {
          const active = provider.id === defaultProviderId;
          const canInstall = provider.runtime === "native" && provider.installable && !provider.available && provider.version === null
            && provider.provider !== undefined && (provider.provider === "claude" || provider.provider === "codex");
          // Installed but not logged in (version known, still unavailable).
          const canLogin = !provider.available && provider.version !== null
            && (provider.provider === "claude" || provider.provider === "codex");
          const installing = installingCli === provider.provider;
          const upgrading = upgradingCli === provider.provider;
          const versionCheck = provider.provider ? versionChecks[provider.provider] : undefined;
          return (
            <article key={provider.id} className={`settings-provider-card ${provider.available ? "available" : "unavailable"}`}>
              <span className="settings-provider-dot" aria-hidden="true" />
              <div className="settings-provider-main">
                <div><strong>{provider.label}</strong><small>{providerSubtitle(provider)}</small></div>
                <div className="settings-provider-model" aria-label={m.settings.provider.configuredModelAria(provider.label)}>
                  <small className="settings-provider-model-source">{m.settings.provider.configuredModel}</small>
                  <span className="settings-provider-model-meta">
                    {provider.oneMillion ? <StatusBadge tone="info">1M</StatusBadge> : null}
                    <small title={provider.detectedModel || undefined}>
                      {provider.detectedModel || m.settings.provider.modelNotConfigured}
                      {provider.contextWindow ? ` · ${formatContextWindow(provider.contextWindow)}` : ""}
                    </small>
                  </span>
                </div>
                {canLogin ? <div className="settings-provider-install">
                  <button type="button" className="settings-provider-install-button" onClick={() => void window.openmind.openCliLogin(provider.provider as "claude" | "codex")}>
                    {m.settings.provider.openLogin}
                  </button>
                  <button type="button" className="settings-provider-recheck" onClick={() => void window.openmind.aiRefreshProviders()}>
                    {m.settings.provider.recheck}
                  </button>
                  <small>{m.settings.provider.loginHint}</small>
                </div> : null}
                {provider.runtime === "wsl" && !provider.available ? <details className="settings-provider-wsl-steps">
                  <summary>{m.settings.provider.wslStepsTitle}</summary>
                  <ol>
                    <li><code>{provider.provider === "claude" ? "npm install -g @anthropic-ai/claude-code" : "npm install -g @openai/codex"}</code><button type="button" className="settings-provider-recheck" onClick={() => void navigator.clipboard?.writeText(provider.provider === "claude" ? "npm install -g @anthropic-ai/claude-code" : "npm install -g @openai/codex")}>{m.settings.provider.copyCommand}</button></li>
                    <li><code>{provider.provider === "claude" ? "claude /login" : "codex login"}</code><button type="button" className="settings-provider-recheck" onClick={() => void navigator.clipboard?.writeText(provider.provider === "claude" ? "claude /login" : "codex login")}>{m.settings.provider.copyCommand}</button></li>
                    <li>{m.settings.provider.wslStepsRecheck}</li>
                  </ol>
                </details> : null}
              </div>
              <div className="settings-provider-actions">
                {canInstall ? <div className="settings-provider-install settings-provider-install--action">
                  {installing ? <div className="settings-provider-install-progress" role="status" aria-label={`${provider.label} ${m.settings.provider.installProgress}`}>
                    <progress max={100} value={installProgress?.totalBytes ? Math.min(100, Math.round(((installProgress.receivedBytes || 0) / installProgress.totalBytes) * 100)) : 0} aria-label={`${provider.label} ${m.settings.provider.installProgress}`} />
                    <small>{installProgress?.message || m.settings.provider.installing}</small>
                    <button type="button" className="settings-provider-recheck" onClick={() => void cancelInstall(provider.provider as "claude" | "codex")}>取消安装</button>
                  </div> : <button type="button" className="settings-provider-install-button" disabled={installingCli !== null || upgradingCli !== null} onClick={() => void installCli(provider.provider as "claude" | "codex")}>
                    {m.settings.provider.install}
                  </button>}
                  {installError?.cli === provider.provider ? <div className="settings-provider-install-failure" role="alert">
                    <span>{m.settings.provider.installFailed}{installError.message}</span>
                    <button type="button" className="settings-provider-recheck" onClick={() => void installCli(provider.provider as "claude" | "codex")}>{m.settings.provider.retryInstall}</button>
                  </div> : null}
                </div> : null}
                {provider.version !== null && provider.provider ? <div className="settings-provider-version-actions">
                  <span className="settings-provider-version">v{provider.version}</span>
                  {versionCheck?.updateAvailable && versionCheck.canUpgrade ? <button type="button" className="settings-provider-upgrade" disabled={upgrading || versionCheckBusy !== null} onClick={() => void upgradeCli(provider.provider as "claude" | "codex")}>
                    {upgrading ? "更新中…" : "一键更新"}
                  </button> : versionCheck ? <small className={`settings-provider-version-result ${versionCheck.latestVersion && versionCheck.currentVersion ? "settings-provider-version-latest" : ""}`} role="status">
                    {versionCheck.updateAvailable ? `发现新版本 ${versionCheck.latestVersion}，请手动更新` : versionCheck.latestVersion && versionCheck.currentVersion ? "已是最新" : "暂无法确认最新版本"}
                  </small> : <button type="button" className="settings-provider-recheck" disabled={versionCheckBusy !== null || upgradingCli !== null} onClick={() => void checkVersion(provider.provider as "claude" | "codex")}>
                    {versionCheckBusy === provider.provider ? "检查中…" : "检查更新"}
                  </button>}
                  {versionCheck ? <button type="button" className="settings-provider-recheck" disabled={versionCheckBusy !== null || upgradingCli !== null} onClick={() => void checkVersion(provider.provider as "claude" | "codex")}>
                    {versionCheckBusy === provider.provider ? "检查中…" : "重新检查"}
                  </button> : null}
                  {versionError?.cli === provider.provider ? <div className="settings-provider-version-error" role="alert">
                    <span>版本检测失败：{versionError.message}</span>
                    <button type="button" className="settings-provider-recheck" onClick={() => void checkVersion(provider.provider as "claude" | "codex")}>重试检测</button>
                  </div> : null}
                </div> : null}
                {!canInstall ? <>
                  <StatusBadge tone={provider.available ? "success" : "warning"}>{provider.available ? m.settings.provider.available : m.settings.provider.unavailable}</StatusBadge>
                  <label className="settings-provider-default">
                    <input type="radio" name="default-provider" checked={active} disabled={!provider.available} aria-label={m.settings.provider.setDefault(provider.label)} onChange={() => void save({ defaultProvider: provider.id })} />
                    <span>{active ? "默认" : "设为默认"}</span>
                  </label>
                </> : null}
              </div>
            </article>
          );
        }) : <p className="settings-note">{m.settings.provider.empty}</p>}
      </div>
    </SettingsPanel>
  );
}

export function SharedPythonRuntimeSection({ status, busy, onToggle, onRefresh }: {
  status: SharedPythonRuntimeStatus | null;
  busy: boolean;
  onToggle(enabled: boolean): void;
  onRefresh(): void;
}) {
  const enabled = status?.enabled ?? false;
  const tone = status?.ready ? "success" : status?.phase === "error" ? "danger" : enabled ? "warning" : "neutral";
  const label = busy ? (enabled ? "正在更新" : "正在安装") : status?.ready ? "可用" : status?.phase === "error" ? "需要处理" : enabled ? "准备中" : "未开启";
  return (
    <SettingsPanel title="Python 运行时" scope={status?.ready ? `Python ${status.pythonVersion || "3.12"}` : "应用共享环境"} variant="resource">
      <article className="settings-resource-row settings-runtime-resource">
        <span className="settings-resource-icon settings-shared-runtime-shield"><ShieldCheck size={18} aria-hidden /></span>
        <div className="settings-resource-copy">
          <strong>内置 Python</strong>
          <p>由 OpenMind 安装和维护，供所有 Python Skill 与自动化任务共同使用，依赖由 uv 统一管理。</p>
          <small>{status?.target || "当前平台"}{status?.uvVersion ? ` · uv ${status.uvVersion}` : ""}{status?.managedSkills ? ` · ${status.managedSkills} 个 Skill` : ""}</small>
        </div>
        <div className="settings-resource-actions">
          <StatusBadge tone={tone}>{label}</StatusBadge>
          <ToggleSwitch checked={enabled} disabled={busy || !status} label="启用内置 Python 运行时" onChange={onToggle} />
        </div>
      </article>
      <div className="settings-runtime-feedback">
        {busy ? <div className="settings-shared-runtime-progress" role="status"><span className="spin" /><p>正在校验内置 Python，并通过 uv 合并所有已安装 Skill 的依赖。首次初始化可能需要几分钟。</p></div> : null}
        {status?.lastError ? <p className="settings-shared-runtime-error" role="alert">{status.lastError}</p> : null}
      </div>
      <footer className="settings-panel-footer">
        <p className="settings-note">关闭不会删除已安装的 Python 和依赖；重新开启时可以直接复用。</p>
        <button type="button" className="settings-subtle-action" disabled={busy} onClick={onRefresh}><RefreshCw size={13} aria-hidden />刷新状态</button>
      </footer>
    </SettingsPanel>
  );
}

export function RuntimeSettingsSection({ packs, downloads, downloadCandidate, busy, onRefresh, onImport, onSelectDownloadManifest, onStartDownload, onClearDownloadCandidate, onPauseDownload, onResumeDownload, onRemoveDownload, onGarbageCollect, onRepair, onActivate, onRollback, onRemove }: {
  packs: RuntimePackReadiness[];
  downloads: RuntimePackDownloadJob[];
  downloadCandidate: RuntimePackDownloadDescriptor | null;
  busy: string | null;
  onRefresh(): void;
  onImport(): void;
  onSelectDownloadManifest(): void;
  onStartDownload(): void;
  onClearDownloadCandidate(): void;
  onPauseDownload(job: RuntimePackDownloadJob): void;
  onResumeDownload(job: RuntimePackDownloadJob): void;
  onRemoveDownload(job: RuntimePackDownloadJob): void;
  onGarbageCollect(): void;
  onRepair(pack: RuntimePackReadiness): void;
  onActivate(pack: RuntimePackReadiness): void;
  onRollback(pack: RuntimePackReadiness): void;
  onRemove(pack: RuntimePackReadiness): void;
}) {
  const hasPrevious = (pack: RuntimePackReadiness) => packs.some((item) => item.packId === pack.packId && item.target === pack.target && item.status === "previous");
  const downloadStatus = (job: RuntimePackDownloadJob): { label: string; tone: "info" | "success" | "warning" | "danger" } => {
    if (job.status === "installed") return { label: "已安装候选", tone: "success" };
    if (job.status === "failed") return { label: "下载失败", tone: "danger" };
    if (job.status === "paused") return { label: "已暂停", tone: "warning" };
    if (job.status === "verifying") return { label: "校验中", tone: "info" };
    if (job.status === "queued") return { label: "排队中", tone: "info" };
    return { label: "下载中", tone: "info" };
  };
  const formatBytes = (value: number): string => {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  };
  return (
    <SettingsPanel
      title="Runtime Packs"
      scope={`${packs.length} 个包 · ${downloads.length} 个下载`}
      action={<div className="settings-runtime-header-actions"><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={onSelectDownloadManifest}><Download size={13} aria-hidden />添加可选包</button><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={onImport}><Package size={13} aria-hidden />导入离线包</button><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={onGarbageCollect}><Trash2 size={13} aria-hidden />清理候选包</button><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={onRefresh}><RefreshCw size={13} className={busy === "refresh" ? "spin" : ""} aria-hidden />刷新状态</button></div>}
    >
      <p className="settings-note">只显示 Main 已验证的 Runtime Pack 状态；包路径和签名材料不会暴露给 Renderer。可选包必须由用户选择 Manifest，使用 HTTPS 下载，完成后仍会经过签名、hash、版本和 SBOM 校验。</p>
      {downloadCandidate ? (
        <article className="settings-runtime-download-candidate" aria-label="Runtime Pack 下载确认">
          <div className="settings-runtime-main">
            <div><strong>确认下载 {downloadCandidate.metadata.packId}</strong><small>{downloadCandidate.metadata.target} · v{downloadCandidate.metadata.version}</small></div>
            <button type="button" className="settings-runtime-icon-action" data-motion="action" aria-label="取消下载确认" onClick={onClearDownloadCandidate}><X size={14} aria-hidden /></button>
          </div>
          <div className="settings-runtime-meta"><span>下载 {formatBytes(downloadCandidate.downloadSize)}</span><span>安装后约 {formatBytes(downloadCandidate.installSize)}</span><span>License: {downloadCandidate.license}</span></div>
          <p>来源：{downloadCandidate.sourceUrl}</p>
          {downloadCandidate.conditions.length ? <ul className="settings-runtime-conditions">{downloadCandidate.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul> : <p>此 Manifest 未声明额外安装条件。</p>}
          <div className="settings-runtime-actions"><button type="button" data-motion="action" disabled={busy !== null} onClick={onStartDownload}><Download size={13} aria-hidden />开始下载</button><button type="button" data-motion="action" disabled={busy !== null} onClick={onClearDownloadCandidate}>取消</button></div>
        </article>
      ) : null}
      {downloads.length ? (
        <div className="settings-runtime-download-list" aria-label="Runtime Pack 下载列表">
          {downloads.map((job) => {
            const status = downloadStatus(job);
            const progress = job.totalBytes ? Math.min(100, Math.round((job.bytesDownloaded / job.totalBytes) * 100)) : 0;
            return (
              <article className="settings-runtime-card" key={job.id}>
                <div className="settings-runtime-main"><div><strong>{job.metadata.packId}</strong><small>{job.metadata.target} · v{job.metadata.version} · {formatBytes(job.bytesDownloaded)} / {formatBytes(job.totalBytes)}</small></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
                <progress className="settings-runtime-progress" max={100} value={progress} aria-label={`${job.metadata.packId} 下载进度`} />
                <p>{job.error || (job.status === "installed" ? "已下载并通过 Main 校验，当前为候选版本；请在上方 Runtime Pack 列表中激活。" : `${progress}% · License: ${job.metadata.license}`)}</p>
                <div className="settings-runtime-actions">
                  {job.status === "downloading" || job.status === "queued" ? <button type="button" data-motion="action" disabled={busy !== null} onClick={() => onPauseDownload(job)}><Pause size={13} aria-hidden />暂停</button> : null}
                  {job.status === "paused" || job.status === "failed" ? <button type="button" data-motion="action" disabled={busy !== null} onClick={() => onResumeDownload(job)}><Play size={13} aria-hidden />继续</button> : null}
                  <button type="button" data-motion="action" disabled={busy !== null || job.status === "verifying"} onClick={() => onRemoveDownload(job)}><Trash2 size={13} aria-hidden />删除下载记录</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {packs.length ? (
        <div className="settings-runtime-list" aria-label="Runtime Pack 列表">
          {packs.map((pack) => {
            const tone = pack.ready ? "success" : pack.integrity === "tampered" || pack.integrity === "invalid" ? "danger" : "warning";
            const label = pack.ready ? "Ready" : pack.integrity === "missing" || pack.integrity === "tampered" ? "Needs Repair" : pack.status;
            return (
              <article className="settings-runtime-card" key={`${pack.packId}:${pack.target}:${pack.digest}`}>
                <div className="settings-runtime-main">
                  <div>
                    <strong>{pack.packId}</strong>
                    <small>{pack.target} · v{pack.version}</small>
                  </div>
                  <StatusBadge tone={tone}>{label}</StatusBadge>
                </div>
                <p>{pack.reason}</p>
                <div className="settings-runtime-meta"><code>{pack.digest.slice(0, 16)}…</code><span>{pack.license}</span><span>{pack.status}</span>{pack.inUse ? <StatusBadge tone="info">使用中</StatusBadge> : null}</div>
                <div className="settings-runtime-actions">
                  {pack.integrity !== "verified" ? <button type="button" data-motion="action" disabled={busy !== null || pack.inUse} onClick={() => onRepair(pack)}><Wrench size={13} aria-hidden />修复</button> : null}
                  {pack.status !== "active" && pack.integrity === "verified" ? <button type="button" data-motion="action" disabled={busy !== null || pack.inUse} onClick={() => onActivate(pack)}>激活</button> : null}
                  {pack.status === "active" && hasPrevious(pack) ? <button type="button" data-motion="action" disabled={busy !== null || pack.inUse} onClick={() => onRollback(pack)}>回滚</button> : null}
                  {pack.status !== "active" ? <button type="button" data-motion="action" disabled={busy !== null || pack.inUse} onClick={() => onRemove(pack)}><Trash2 size={13} aria-hidden />移除</button> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="settings-skill-empty" role="status"><Package size={19} aria-hidden /><div><strong>暂无 Runtime Pack</strong><span>当前发行包尚未导入可验证的运行时。</span></div></div>
      )}
    </SettingsPanel>
  );
}

export function SkillSettingsSection({
  mode,
  skills,
  mcpServers,
  refreshing,
  onRefresh,
  onCopy,
  onOpenDirectory,
  onOpenMcpSettings,
  installedSkills,
  packageBusy,
  onUninstallPackage
}: {
  mode?: "skills" | "mcp";
  skills: SkillDefinition[];
  mcpServers: McpServerDefinition[];
  refreshing: boolean;
  onRefresh(): void;
  onCopy(skillId: string): void;
  onOpenDirectory(path: string): void;
  onOpenMcpSettings(): void;
  installedSkills: InstalledSkillView[];
  packageBusy: "uninstall" | null;
  onUninstallPackage(key: string, digest: string): void;
}) {
  const [catalog, setCatalog] = useState<"skills" | "mcp">(mode || "skills");
  const [query, setQuery] = useState("");
  const [mcpQuery, setMcpQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedMcpId, setExpandedMcpId] = useState<string | null>(null);
  const groups = useMemo(() => Array.from(new Set(skills.map(skillGroup))).sort((left, right) => left.localeCompare(right, "zh-CN")), [skills]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return skills
      .filter((skill) => group === "all" || skillGroup(skill) === group)
      .filter((skill) => !needle || `${skill.title} ${skill.id} ${skill.description} ${skillGroup(skill)}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => skillGroup(left).localeCompare(skillGroup(right), "zh-CN") || left.title.localeCompare(right.title, "zh-CN") || left.id.localeCompare(right.id));
  }, [group, query, skills]);
  const filteredMcpServers = useMemo(() => {
    const needle = mcpQuery.trim().toLocaleLowerCase();
    if (!needle) return mcpServers;
    return mcpServers.flatMap((server) => {
      const serverText = `${server.title} ${server.id} ${server.description} ${server.backend} ${server.connection} ${server.providers.join(" ")}`.toLocaleLowerCase();
      if (serverText.includes(needle)) return [server];
      const tools = server.tools.filter((tool) => `${tool.title} ${tool.id} ${tool.description} ${tool.inputs.join(" ")} ${tool.outputs.join(" ")}`.toLocaleLowerCase().includes(needle));
      return tools.length ? [{ ...server, tools }] : [];
    });
  }, [mcpQuery, mcpServers]);

  const groupOptions = [
    { value: "all", label: m.settings.skills.allGroups },
    ...groups.map((value) => ({ value, label: value }))
  ];

  return (
    <SettingsPanel
      title={m.settings.skills.title}
      scope={m.settings.skills.scope(skills.length, mcpServers.length)}
      variant={mode === "mcp" ? "resource" : "standard"}
      action={(
        <button type="button" className="settings-subtle-action" data-motion="action" disabled={refreshing} aria-busy={refreshing || undefined} onClick={onRefresh}>
          <RefreshCw size={13} className={refreshing ? "spin" : ""} aria-hidden />
          {refreshing ? m.settings.skills.refreshing : m.settings.skills.refresh}
        </button>
      )}
    >
      {!mode ? <div className="settings-capability-tabs" role="tablist" aria-label={m.settings.skills.catalogAria}>
        <button type="button" role="tab" data-motion="selection" aria-selected={catalog === "skills"} onClick={() => setCatalog("skills")}>
          <Package size={14} aria-hidden />{m.settings.skills.skillsTab}<span>{skills.length}</span>
        </button>
        <button type="button" role="tab" data-motion="selection" aria-selected={catalog === "mcp"} onClick={() => setCatalog("mcp")}>
          <Server size={14} aria-hidden />{m.settings.skills.mcpTab}<span>{mcpServers.length}</span>
        </button>
      </div> : null}

      {catalog === "skills" ? <>
        <div className="settings-skill-toolbar">
          <label className="settings-skill-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              value={query}
              aria-label={m.settings.skills.searchAria}
              placeholder={m.settings.skills.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Select
            className="settings-skill-group"
            size="rect"
            ariaLabel={m.settings.skills.groupAria}
            value={group}
            options={groupOptions}
            onChange={setGroup}
          />
        </div>

        {filtered.length ? (
        <div className="settings-skill-list" aria-label={m.settings.skills.title}>
          {filtered.map((skill) => {
            const expanded = expandedId === skill.id;
            const title = skill.title || skill.id;
            return (
              <article className="settings-skill-item" data-expanded={expanded || undefined} key={skill.id}>
                <button
                  type="button"
                  className="settings-skill-summary"
                  data-motion="selection"
                  aria-expanded={expanded}
                  aria-label={m.settings.skills.detailAria(title)}
                  onClick={() => setExpandedId((current) => current === skill.id ? null : skill.id)}
                >
                  <span className="settings-skill-icon" aria-hidden><Package size={16} /></span>
                  <span className="settings-skill-copy">
                    <span><strong>{title}</strong><code>/{skill.id}</code></span>
                    <small>{skill.description}</small>
                  </span>
                  <span className="settings-skill-group-label">{skillGroup(skill)}</span>
                  <ChevronDown className="settings-skill-chevron" size={15} aria-hidden />
                </button>
                {expanded ? (
                  <div className="settings-skill-details">
                    <dl>
                      <SkillDetail label={m.settings.skills.cwd} value={skill.cwd || m.settings.skills.notConfigured} />
                      <SkillDetail label={m.settings.skills.command} value={skill.command || m.settings.skills.notConfigured} />
                      <SkillDetail label={m.settings.skills.envFile} value={skill.envFile || m.settings.skills.notConfigured} />
                      <SkillDetail label={m.settings.skills.timeout} value={skill.timeoutMs ? formatSkillTimeout(skill.timeoutMs) : m.settings.skills.notConfigured} />
                      <SkillDetail label={m.settings.skills.outputs} value={skill.outputArtifacts?.length ? skill.outputArtifacts.join("、") : m.settings.skills.notDeclared} />
                    </dl>
                    <div className="settings-skill-actions">
                      <button type="button" data-motion="action" aria-label={m.settings.skills.copyNamed(skill.id)} onClick={() => onCopy(skill.id)}><Copy size={13} aria-hidden />{m.settings.skills.copyInvocation}</button>
                      <button type="button" data-motion="action" aria-label={m.settings.skills.openNamed(title)} onClick={() => onOpenDirectory(skill.cwd)}><FolderOpen size={13} aria-hidden />{m.settings.skills.openDirectory}</button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="settings-skill-empty" role="status">
          <Package size={19} aria-hidden />
          <div>
            <strong>{skills.length ? m.settings.skills.noMatchTitle : m.settings.skills.emptyTitle}</strong>
            <span>{skills.length ? m.settings.skills.noMatchDescription : m.settings.skills.emptyDescription}</span>
          </div>
        </div>
        )}
      </> : <>
        <div className="settings-skill-toolbar settings-mcp-toolbar">
          <label className="settings-skill-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              value={mcpQuery}
              aria-label={m.settings.skills.mcpSearchAria}
              placeholder={m.settings.skills.mcpSearchPlaceholder}
              onChange={(event) => setMcpQuery(event.target.value)}
            />
          </label>
        </div>
        {filteredMcpServers.length ? (
          <div className="settings-mcp-list" aria-label={m.settings.skills.mcpListAria}>
            {filteredMcpServers.map((server) => {
              const expanded = expandedMcpId === server.id || Boolean(mcpQuery.trim());
              return (
              <article className="settings-mcp-server" data-expanded={expanded || undefined} key={server.id}>
                <button type="button" className="settings-mcp-server-header" aria-expanded={expanded} onClick={() => setExpandedMcpId((current) => current === server.id ? null : server.id)}>
                  <span className="settings-skill-icon" aria-hidden><Server size={16} /></span>
                  <span className="settings-mcp-identity">
                    <span><strong>{server.title}</strong><code>{server.id}</code></span>
                    <small>{server.description}</small>
                  </span>
                  <StatusBadge tone={server.status === "enabled" ? "success" : "warning"}>{m.settings.skills.mcpStatus[server.status]}</StatusBadge>
                  <ChevronDown className="settings-mcp-chevron" size={15} aria-hidden />
                </button>
                {expanded ? <div className="settings-mcp-details">
                  <dl>
                    <SkillDetail label={m.settings.skills.mcpBackend} value={server.backend} />
                    <SkillDetail label={m.settings.skills.mcpTransport} value={server.transport} />
                    <SkillDetail label={m.settings.skills.mcpConnection} value={server.connection} />
                    <SkillDetail label={m.settings.skills.mcpProviders} value={server.providers.join("、")} />
                  </dl>
                  <p className="settings-mcp-diagnostic">{server.diagnostic}</p>
                  <div className="settings-mcp-tools">
                    <span className="settings-mcp-tools-title">{m.settings.skills.mcpTools(server.tools.length)}</span>
                    {server.tools.map((tool) => (
                      <section className="settings-mcp-tool" key={tool.id}>
                        <Wrench size={15} aria-hidden />
                        <div>
                          <span><strong>{tool.title}</strong><code>{tool.id}</code></span>
                          <p>{tool.description}</p>
                          <dl>
                            <SkillDetail label={m.settings.skills.mcpInputs} value={tool.inputs.join(" · ")} />
                            <SkillDetail label={m.settings.skills.mcpOutputs} value={tool.outputs.join(" · ")} />
                          </dl>
                        </div>
                      </section>
                    ))}
                  </div>
                  {server.settingsSection ? (
                    <div className="settings-skill-actions">
                      <button type="button" data-motion="action" onClick={onOpenMcpSettings}><ExternalLink size={13} aria-hidden />{m.settings.skills.mcpOpenSettings}</button>
                    </div>
                  ) : null}
                </div> : null}
              </article>
              );
            })}
          </div>
        ) : (
          <div className="settings-skill-empty" role="status">
            <Server size={19} aria-hidden />
            <div>
              <strong>{mcpServers.length ? m.settings.skills.mcpNoMatchTitle : m.settings.skills.mcpEmptyTitle}</strong>
              <span>{mcpServers.length ? m.settings.skills.mcpNoMatchDescription : m.settings.skills.mcpEmptyDescription}</span>
            </div>
          </div>
        )}
      </>}

      <SkillPackagePanel
        installed={installedSkills}
        busy={packageBusy}
        onUninstall={onUninstallPackage}
      />
    </SettingsPanel>
  );
}

function SkillPackagePanel({
  installed,
  busy,
  onUninstall
}: {
  installed: InstalledSkillView[];
  busy: "uninstall" | null;
  onUninstall(key: string, digest: string): void;
}) {
  return (
    <section className="settings-skill-packages" aria-label={m.settings.skills.packageTitle}>
      <header className="settings-skill-packages-header">
        <div>
          <h3>{m.settings.skills.packageTitle}</h3>
          <p>{m.settings.skills.packageDescription}</p>
        </div>
      </header>
      {installed.length ? (
        <div className="settings-skill-package-installed" aria-label="已安装 Skill">
          {installed.map((record) => (
            <div className="settings-skill-package-meta" key={`${record.key}:${record.digest}`}>
              <span><strong>{record.key}@{record.version}</strong></span>
              <StatusBadge tone={record.usable ? "success" : "danger"}>{record.usable ? m.settings.skills.packageInstalled : m.settings.skills.packageUnusable}</StatusBadge>
              <div className="settings-skill-actions">
                <button type="button" data-motion="action" disabled={Boolean(busy)} onClick={() => onUninstall(record.key, record.digest)}>{busy === "uninstall" ? "卸载中…" : m.settings.skills.packageUninstall}</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="settings-skill-package-empty">{m.settings.skills.packageEmpty}</p>
      )}
    </section>
  );
}

function SkillDetail({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd><code title={value}>{value}</code></dd></div>;
}

export function PermissionSettingsSection({ prefs, save }: { prefs: UserPreferences; save: SavePreferences }) {
  return (
    <SettingsPanel title={m.settings.permissions.title} scope="运行规则">
      <PreferenceRow title={m.settings.permissions.defaultLabel} description={m.settings.permissions.defaultDescription}>
        <Select className="settings-select" size="rect" ariaLabel={m.settings.permissions.defaultLabel} value={prefs.defaultPermissionProfile} onChange={(value) => void save({ defaultPermissionProfile: value as UserPreferences["defaultPermissionProfile"] })} options={PERMISSION_OPTIONS} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.permissions.destructiveLabel} description={m.settings.permissions.destructiveDescription}>
        <ToggleSwitch checked={prefs.destructiveOpsRequireApproval} label={m.settings.permissions.destructiveLabel} onChange={(checked) => void save({ destructiveOpsRequireApproval: checked })} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.permissions.riskScanLabel} description={m.settings.permissions.riskScanDescription}>
        <ToggleSwitch checked={prefs.riskScanEnabled} label={m.settings.permissions.riskScanLabel} onChange={(checked) => void save({ riskScanEnabled: checked })} />
      </PreferenceRow>
    </SettingsPanel>
  );
}

export function BrowserSettingsSection({
  prefs,
  status,
  savingToken,
  save,
  onSaveToken,
  onClearToken,
  onOpenExtensionDocs
}: {
  prefs: UserPreferences;
  status: BrowserAutomationStatus | null;
  savingToken: boolean;
  save: SavePreferences;
  onSaveToken(token: string): Promise<void>;
  onClearToken(): Promise<void>;
  onOpenExtensionDocs(): void;
}) {
  const [token, setToken] = useState("");
  const [evidenceDir, setEvidenceDir] = useState(prefs.browserEvidenceDir);
  useEffect(() => setEvidenceDir(prefs.browserEvidenceDir), [prefs.browserEvidenceDir]);
  const ready = Boolean(status?.ready);

  const submitToken = async () => {
    if (!token.trim() || savingToken) return;
    try {
      await onSaveToken(token);
      setToken("");
    } catch { /* SettingsPage 已显示失败反馈；保留输入便于重试。 */ }
  };

  const saveEvidenceDir = () => {
    const next = evidenceDir.trim().replaceAll("\\", "/");
    if (next && next !== prefs.browserEvidenceDir) void save({ browserEvidenceDir: next });
    else setEvidenceDir(prefs.browserEvidenceDir);
  };

  return (
    <>
    <SettingsPanel title="浏览器连接" scope={m.settings.browser.scope} variant="resource">
      <div className="settings-resource-row settings-browser-backend">
        <span className="settings-browser-icon" aria-hidden><Globe size={18} /></span>
        <div className="settings-browser-backend-copy">
          <strong>{m.settings.browser.backend}</strong>
          <span>Microsoft Playwright MCP · {m.settings.browser.extension}</span>
          <small>{status?.diagnostic || m.settings.browser.loadFailed}</small>
        </div>
        <StatusBadge tone={ready ? "success" : "warning"}>{ready ? m.settings.browser.ready : m.settings.browser.needsSetup}</StatusBadge>
      </div>

      <PreferenceRow title={m.settings.browser.enabled} description={m.settings.browser.enabledDescription}>
        <ToggleSwitch checked={prefs.browserAutomationEnabled} label={m.settings.browser.enabled} onChange={(checked) => void save({ browserAutomationEnabled: checked })} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.browser.reuseTabs} description={m.settings.browser.reuseTabsDescription}>
        <ToggleSwitch checked={prefs.browserReuseExistingTabs} label={m.settings.browser.reuseTabs} onChange={(checked) => void save({ browserReuseExistingTabs: checked })} />
      </PreferenceRow>
    </SettingsPanel>
    <SettingsPanel title="证据与授权" scope="本地安全">
      <PreferenceRow title={m.settings.browser.evidenceDir} description={m.settings.browser.evidenceDirDescription}>
        <input
          className="settings-browser-path-input"
          aria-label={m.settings.browser.evidenceDir}
          value={evidenceDir}
          onChange={(event) => setEvidenceDir(event.target.value)}
          onBlur={saveEvidenceDir}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
      </PreferenceRow>

      <div className="settings-browser-token">
        <div className="settings-browser-token-copy">
          <span className="settings-browser-token-title"><KeyRound size={14} aria-hidden /><strong>{m.settings.browser.token}</strong></span>
          <p>{m.settings.browser.tokenDescription}</p>
          <small>{status?.extensionTokenConfigured ? m.settings.browser.configured : m.settings.browser.notConfigured}</small>
        </div>
        <div className="settings-browser-token-controls">
          <input
            type="password"
            autoComplete="off"
            value={token}
            aria-label={m.settings.browser.token}
            placeholder={m.settings.browser.tokenPlaceholder}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void submitToken(); }}
          />
          <button type="button" data-motion="action" disabled={!token.trim() || savingToken || status?.secureStorageAvailable === false} onClick={() => void submitToken()}>
            <KeyRound size={13} aria-hidden />{status?.extensionTokenConfigured ? m.settings.browser.replaceToken : m.settings.browser.saveToken}
          </button>
          {status?.extensionTokenConfigured ? (
            <button type="button" className="settings-browser-clear" data-motion="action" disabled={savingToken} onClick={() => void onClearToken()}>
              <Trash2 size={13} aria-hidden />{m.settings.browser.clearToken}
            </button>
          ) : null}
        </div>
      </div>

      <div className="settings-browser-boundary" role="note">
        <p>{m.settings.browser.boundary}</p>
        <button type="button" className="settings-subtle-action" data-motion="action" onClick={onOpenExtensionDocs}>
          <ExternalLink size={13} aria-hidden />{m.settings.browser.installExtension}
        </button>
      </div>
    </SettingsPanel>
    </>
  );
}

export function PathSettingsSection({ openmind, workspace, notes, onSelectOpenmind, onSelectWorkspace, onOpenNotes }: { openmind: string; workspace: string; notes: string; onSelectOpenmind(): void; onSelectWorkspace(): void; onOpenNotes(): void }) {
  return (
    <SettingsPanel title={m.settings.paths.title} scope="本地项目">
      <div className="settings-path-list">
        <PathRow label={m.settings.paths.workspace} path={workspace} buttonLabel={m.settings.paths.browse} onClick={onSelectWorkspace} />
        <PathRow label={m.settings.paths.notes} path={notes} buttonLabel={m.settings.paths.browse} onClick={onOpenNotes} />
        <PathRow label={m.settings.paths.openmindRoot} path={openmind} buttonLabel={m.settings.paths.selectRoot} onClick={onSelectOpenmind} />
      </div>
      <p className="settings-note">{m.settings.paths.note}</p>
    </SettingsPanel>
  );
}

export function ArchivedSessionsSettingsSection({
  sessions,
  busyId,
  onOpen,
  onRestore
}: {
  sessions: AiSession[];
  busyId: string | null;
  onOpen(sessionId: string): void;
  onRestore(sessionId: string): void;
}) {
  return (
    <SettingsPanel title={m.settings.archivedSessions.title} scope={m.settings.archivedSessions.scope(sessions.length)}>
      <p className="settings-archived-description">{m.settings.archivedSessions.description}</p>
      {sessions.length ? (
        <div className="settings-archived-list" aria-label={m.settings.archivedSessions.listAria}>
          {sessions.map((session) => (
            <article className="settings-archived-item" key={session.id}>
              <span className="settings-archived-icon" aria-hidden><Archive size={15} /></span>
              <div className="settings-archived-main">
                <strong title={session.title}>{session.title || m.common.unnamedTopic}</strong>
                <span>{session.provider === "claude" ? "Claude Code" : "Codex"} · <time dateTime={session.createdAt}>{formatSessionDate(session.createdAt)}</time></span>
              </div>
              <div className="settings-archived-actions">
                <button type="button" data-motion="action" disabled={busyId === session.id} onClick={() => onOpen(session.id)} aria-label={m.settings.archivedSessions.openNamed(session.title || m.common.unnamedTopic)}>
                  <MessageSquareText size={13} />{m.settings.archivedSessions.open}
                </button>
                <button type="button" data-motion="action" disabled={busyId === session.id} onClick={() => onRestore(session.id)} aria-label={m.settings.archivedSessions.restoreNamed(session.title || m.common.unnamedTopic)}>
                  <RotateCcw size={13} />{busyId === session.id ? m.settings.archivedSessions.restoring : m.settings.archivedSessions.restore}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="settings-archived-empty">
          <Archive size={18} aria-hidden />
          <div><strong>{m.settings.archivedSessions.empty}</strong><span>归档后的会话会显示在这里，可随时打开或恢复到最近会话。</span></div>
        </div>
      )}
    </SettingsPanel>
  );
}

export function DataRetentionSettingsSection({ prefs, save }: { prefs: UserPreferences; save: SavePreferences }) {
  return (
    <SettingsPanel title="数据保留" scope="本地偏好">
      <PreferenceRow title="缓存容量上限" description="记录期望的本地缓存容量，供诊断与后续清理策略使用。">
        <Select ariaLabel="缓存容量上限" size="rect" value={String(prefs.cacheMaxSizeMB)} options={CACHE_SIZE_OPTIONS} onChange={(value) => void save({ cacheMaxSizeMB: Number(value) })} />
      </PreferenceRow>
      <PreferenceRow title="日志保留天数" description="记录期望的日志保留周期，不会在后台静默删除现有日志。">
        <Select ariaLabel="日志保留天数" size="rect" value={String(prefs.logRetentionDays)} options={LOG_RETENTION_OPTIONS} onChange={(value) => void save({ logRetentionDays: Number(value) })} />
      </PreferenceRow>
      <PreferenceRow title="通知历史上限" description="记录通知历史的期望条数，不会自动清理当前历史记录。">
        <Select ariaLabel="通知历史上限" size="rect" value={String(prefs.maxNotificationHistory)} options={NOTIFICATION_HISTORY_OPTIONS} onChange={(value) => void save({ maxNotificationHistory: Number(value) })} />
      </PreferenceRow>
      <p className="settings-note" role="note">这些值是本地偏好记录，暂不自动清理文件或历史；执行清理前必须提供可预览、可确认的后台策略。</p>
    </SettingsPanel>
  );
}

export function WorkflowSettingsSection({ prefs, save, onReset }: { prefs: UserPreferences; save: SavePreferences; onReset(): void }) {
  return (
    <>
    <SettingsPanel title="阶段规则" scope="内容流程" action={<button type="button" className="settings-subtle-action" data-motion="action" onClick={onReset}>{m.settings.workflow.resetToDefaults}</button>}>
      <div className="settings-workflow-stages">
        <strong className="settings-workflow-subtitle">{m.settings.workflow.stagesTitle}</strong>
        <p className="settings-workflow-hint">{m.settings.workflow.stagesDescription}</p>
        <ol className="settings-stage-list">
          <li><StatusBadge tone="info">{m.settings.workflow.stageToday}</StatusBadge><span>{m.settings.workflow.entryNone}</span></li>
          <li><StatusBadge tone="info">{m.settings.workflow.stageDrafting}</StatusBadge><span>{m.settings.workflow.entryNone}</span></li>
          <li><StatusBadge tone="warning">{m.settings.workflow.stageReview}</StatusBadge><span>{m.settings.workflow.entryNone}</span></li>
          <li><StatusBadge tone="info">{m.settings.workflow.stageReady}</StatusBadge><span>{prefs.workflowReviewRequiredForReady ? m.settings.workflow.entryReview : m.settings.workflow.entryNone}</span></li>
          <li><StatusBadge tone="success">{m.settings.workflow.stagePublished}</StatusBadge><span>{m.settings.workflow.entryPublish}</span></li>
        </ol>
      </div>
    </SettingsPanel>
    <SettingsPanel title="草稿与版本" scope="编辑行为">
      <PreferenceRow title={m.settings.workflow.autoSaveTitle} description={m.settings.workflow.autoSaveDesc}>
        <div className="settings-inline-controls">
          <Select ariaLabel="自动保存间隔" size="rect" value={String(prefs.autoSaveIntervalMs)} options={AUTO_SAVE_OPTIONS} onChange={(value) => void save({ autoSaveIntervalMs: Number(value) })} />
          <ToggleSwitch checked={prefs.workflowAutoSaveDraft} label={m.settings.workflow.autoSaveTitle} onChange={(checked) => void save({ workflowAutoSaveDraft: checked })} />
        </div>
      </PreferenceRow>
      <PreferenceRow title={m.settings.workflow.autoVersionTitle} description={m.settings.workflow.autoVersionDesc}>
        <ToggleSwitch checked={prefs.workflowAutoVersionOnStageChange} label={m.settings.workflow.autoVersionTitle} onChange={(checked) => void save({ workflowAutoVersionOnStageChange: checked })} />
      </PreferenceRow>
    </SettingsPanel>
    <SettingsPanel title="审核与发布" scope="发布门禁">
      <PreferenceRow title={m.settings.workflow.reviewGateTitle} description={m.settings.workflow.reviewGateDesc}>
        <ToggleSwitch checked={prefs.workflowReviewRequiredForReady} label={m.settings.workflow.reviewGateTitle} onChange={(checked) => void save({ workflowReviewRequiredForReady: checked })} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.workflow.publishCheckTitle} description={m.settings.workflow.publishCheckDesc}>
        <ToggleSwitch checked={prefs.workflowPublishChecklistEnabled} label={m.settings.workflow.publishCheckTitle} onChange={(checked) => void save({ workflowPublishChecklistEnabled: checked })} />
      </PreferenceRow>
      <div className="settings-workflow-preview" role="status" aria-label="工作流规则预览">
        <strong>当前规则预览</strong>
        <span>草稿：{prefs.workflowAutoSaveDraft ? `每 ${formatInterval(prefs.autoSaveIntervalMs)}自动保存` : "仅手动保存"}</span>
        <span>推进：{prefs.workflowAutoVersionOnStageChange ? "创建版本快照" : "不创建自动版本"}；{prefs.workflowReviewRequiredForReady ? "审核通过后进入待发布" : "允许跳过审核门禁"}</span>
        <span>发布：{prefs.workflowPublishChecklistEnabled ? "校验标题、摘要、标签、封面、平台与正文" : "仅校验可导出的正文与平台"}</span>
      </div>
    </SettingsPanel>
    <SettingsPanel title="自动归档" scope="内容生命周期">
      <PreferenceRow title={m.settings.workflow.autoArchiveTitle} description={m.settings.workflow.autoArchiveDesc}>
        <div className="settings-inline-controls">
          <Select ariaLabel="自动归档期限" size="rect" value={String(prefs.archiveAfterDays)} options={AUTO_ARCHIVE_OPTIONS} onChange={(value) => void save({ archiveAfterDays: Number(value) })} />
          <ToggleSwitch checked={prefs.workflowAutoArchiveEnabled} label={m.settings.workflow.autoArchiveTitle} onChange={(checked) => void save({ workflowAutoArchiveEnabled: checked })} />
        </div>
      </PreferenceRow>
    </SettingsPanel>
    </>
  );
}

/**
 * Manages the plaintext `config/providers.yaml` — the single source of truth
 * for the AI provider used by both desktop runs and crontab Python runs. The
 * apiKey is never read back from main; the UI only knows whether one is set,
 * and an empty password field means "keep the existing key".
 */
export function AiProvidersSettingsSection({
  view,
  busy,
  onSave,
  notify
}: {
  view: ProvidersYamlView | null;
  busy: boolean;
  onSave(input: ProvidersYamlInput): Promise<void>;
  notify(message: string, tone?: "info" | "success" | "error"): void;
}) {
  const [draft, setDraft] = useState<ProviderYamlInputEntry[]>([]);
  const [defaultId, setDefaultId] = useState("");
  const [cliBindings, setCliBindings] = useState<CliProviderBindings>({ claude: null, codex: null });
  const [apiKeyKeys, setApiKeyKeys] = useState<Record<string, string>>({});
  const [apiKeySetMap, setApiKeySetMap] = useState<Record<string, boolean>>({});
  const [presetId, setPresetId] = useState(PROVIDER_PRESETS[0]?.id ?? "custom");
  const [adding, setAdding] = useState(false);
  const [newProvider, setNewProvider] = useState<ProviderYamlInputEntry | null>(null);

  useEffect(() => {
    if (!view) return;
    setDraft(view.providers.map((provider) => ({
      id: provider.id, name: provider.name, enabled: provider.enabled, protocol: provider.protocol, authMode: provider.authMode || "bearer",
      apiKey: "", baseUrl: provider.baseUrl, model: provider.model, proxyUrl: provider.proxyUrl,
      proxyPolicy: provider.proxyPolicy, tlsPolicy: provider.tlsPolicy
    })));
    setDefaultId(view.default);
    setCliBindings(view.cli || { claude: null, codex: null });
    setApiKeyKeys({});
    setApiKeySetMap(Object.fromEntries(view.providers.map((provider) => [provider.id, provider.apiKeySet])));
  }, [view]);

  const update = (id: string, patch: Partial<ProviderYamlInputEntry>) => {
    const currentEntry = draft.find((entry) => entry.id === id);
    const nextEntry = currentEntry ? { ...currentEntry, ...patch } : null;
    setDraft((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
    if (nextEntry) {
      setCliBindings((current) => ({
        claude: current.claude === id && (!nextEntry.enabled || !supportsCliProvider("claude", nextEntry.protocol)) ? null : current.claude,
        codex: current.codex === id && (!nextEntry.enabled || !supportsCliProvider("codex", nextEntry.protocol)) ? null : current.codex
      }));
    }
  };
  const updateKey = (id: string, value: string) => {
    setApiKeyKeys((current) => ({ ...current, [id]: value }));
  };

  const providerFromPreset = (nextPresetId: string): ProviderYamlInputEntry => {
    const preset = PROVIDER_PRESETS.find((item) => item.id === nextPresetId);
    const base = preset ?? { id: "custom", name: "自定义", protocol: "openai-chat" as ProviderProtocol, authMode: "bearer" as ProviderAuthMode, baseUrl: "", model: "" };
    let counter = 0;
    let id = base.id;
    while (draft.some((entry) => entry.id === id)) id = `${base.id}-${++counter}`;
    return {
      id, name: base.name, enabled: true, protocol: base.protocol, authMode: base.authMode, apiKey: "",
      baseUrl: base.baseUrl, model: base.model, proxyUrl: "", proxyPolicy: "system", tlsPolicy: "verify"
    };
  };

  const openAddDialog = () => {
    setNewProvider(providerFromPreset(presetId));
    setAdding(true);
  };

  const changePreset = (nextPresetId: string) => {
    setPresetId(nextPresetId);
    setNewProvider(providerFromPreset(nextPresetId));
  };

  const addProvider = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newProvider) return;
    const entry = { ...newProvider, id: newProvider.id.trim(), name: newProvider.name.trim(), baseUrl: newProvider.baseUrl.trim(), model: newProvider.model.trim() };
    if (!entry.id || !entry.name || !entry.baseUrl || !entry.model || !entry.apiKey) {
      notify("请填写所有必填项", "info");
      return;
    }
    if (draft.some((item) => item.id === entry.id)) {
      notify("Provider ID 已存在，请换一个 ID", "info");
      return;
    }
    setDraft((current) => [...current, { ...entry, apiKey: "" }]);
    setApiKeyKeys((current) => ({ ...current, [entry.id]: entry.apiKey }));
    setApiKeySetMap((current) => ({ ...current, [entry.id]: false }));
    if (!defaultId) setDefaultId(entry.id);
    setAdding(false);
    setNewProvider(null);
  };

  useEffect(() => {
    if (!adding) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAdding(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [adding]);

  const remove = (id: string) => {
    if (draft.length <= 1) { notify("至少需要保留一个 Provider", "info"); return; }
    const survivors = draft.filter((entry) => entry.id !== id);
    const nextEnabledDefault = survivors.find((entry) => entry.enabled);
    if (defaultId === id && !nextEnabledDefault) {
      notify("请先启用另一个 Provider，再删除当前默认 Provider", "info");
      return;
    }
    setDraft(survivors);
    if (defaultId === id) setDefaultId(nextEnabledDefault!.id);
    setCliBindings((current) => ({
      claude: current.claude === id ? null : current.claude,
      codex: current.codex === id ? null : current.codex
    }));
    setApiKeyKeys((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    setApiKeySetMap((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  };

  const submit = () => {
    if (!draft.length) { notify("至少需要一个 Provider", "info"); return; }
    if (!draft.some((entry) => entry.id === defaultId)) { notify("默认 Provider 不存在", "info"); return; }
    const providers = draft.map((entry) => ({ ...entry, apiKey: apiKeyKeys[entry.id] ?? "" }));
    void onSave({ schemaVersion: 1, default: defaultId, cli: cliBindings, providers });
  };

  return (
    <>
      <SettingsPanel title="Provider 列表" scope={`${draft.length} 个`} variant="standard"
        action={<button type="button" className="settings-provider-add-button" data-motion="icon" onClick={openAddDialog} disabled={busy} aria-label="添加 Provider" title="添加 Provider"><Plus size={17} /></button>}>
        <p className="settings-note settings-provider-list-note">桌面运行、Claude Code、Codex CLI 与定时任务共用此配置。API Key 明文保存在项目内的 config/providers.yaml，不会在界面中回显；请仅在受信任的本地项目中使用。</p>
        <div className="settings-stack">
          {draft.length === 0 ? <p className="settings-note">尚未配置 Provider。点击上方「添加」开始。</p> : null}
          {draft.map((entry) => (
            <article key={entry.id} className="settings-provider-config-card" data-entrance-item>
              <header className="settings-provider-config-header">
                <div>
                  <strong>{entry.name || entry.id}</strong>
                  <p>{entry.protocol} · {entry.model || "未设置模型"}</p>
                </div>
                <div className="settings-provider-config-actions">
                  {entry.id === defaultId ? <StatusBadge tone="info">默认</StatusBadge> : null}
                  <StatusBadge tone={entry.enabled ? "success" : "neutral"}>{entry.enabled ? "启用" : "停用"}</StatusBadge>
                  <ToggleSwitch checked={entry.enabled} disabled={entry.id === defaultId} label={`启用 ${entry.name || entry.id}`} onChange={(checked) => update(entry.id, { enabled: checked })} />
                  <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => setDefaultId(entry.id)} disabled={entry.id === defaultId || !entry.enabled}>设为默认</button>
                  <button type="button" className="settings-subtle-action settings-provider-delete" data-motion="icon" onClick={() => remove(entry.id)} aria-label={`删除 ${entry.id}`}><Trash2 size={14} /></button>
                </div>
              </header>
              <div className="settings-provider-config-body">
                <div className="settings-grid-2">
                  <label className="settings-field"><span>ID</span><input className="settings-browser-path-input" value={entry.id} readOnly title="Provider ID 添加后不可修改" /></label>
                  <label className="settings-field"><span>名称</span><input className="settings-browser-path-input" value={entry.name} onChange={(event) => update(entry.id, { name: event.target.value })} /></label>
                  <label className="settings-field"><span>Base URL</span><input className="settings-browser-path-input" value={entry.baseUrl} onChange={(event) => update(entry.id, { baseUrl: event.target.value })} placeholder="https://api.example.com" /></label>
                  <label className="settings-field"><span>模型</span><input className="settings-browser-path-input" value={entry.model} onChange={(event) => update(entry.id, { model: event.target.value })} /></label>
                  <label className="settings-field"><span>协议</span>
                    <select className="settings-select" value={entry.protocol} onChange={(event) => update(entry.id, { protocol: event.target.value as ProviderProtocol })} data-motion="selection">
                      <option value="anthropic-messages">anthropic-messages</option>
                      <option value="openai-chat">openai-chat</option>
                      <option value="openai-responses">openai-responses</option>
                    </select>
                  </label>
                  <label className="settings-field"><span>认证方式</span>
                    <select className="settings-select" value={entry.authMode} onChange={(event) => update(entry.id, { authMode: event.target.value as ProviderAuthMode })}>
                      <option value="bearer">Bearer Token</option>
                      <option value="x-api-key">X-API-Key</option>
                    </select>
                  </label>
                  <label className="settings-field"><span>API Key</span>
                    <input className="settings-browser-path-input" type="password" value={apiKeyKeys[entry.id] ?? ""}
                      placeholder={apiKeySetMap[entry.id] ? "已设置（留空保留）" : "未设置"}
                      onChange={(event) => updateKey(entry.id, event.target.value)} />
                  </label>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="settings-panel-footer settings-provider-save-row">
          <p className="settings-note">修改只会在点击保存后写入本地配置。</p>
          <button type="button" className="primary-button" data-motion="action" onClick={submit} disabled={busy}>{busy ? "保存中…" : "保存配置"}</button>
        </div>
      </SettingsPanel>

      {adding && newProvider && typeof document !== "undefined" ? createPortal(
        <div className="modal-scrim settings-provider-dialog-scrim ui-overlay" onMouseDown={() => setAdding(false)}>
          <section className="settings-provider-dialog" role="dialog" aria-modal="true" aria-labelledby="add-provider-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>AI Provider</span><h2 id="add-provider-title">添加 Provider</h2><p>选择预设并确认连接信息，添加后仍可在列表中修改。</p></div>
              <button type="button" className="settings-subtle-action" data-motion="icon" aria-label="关闭添加 Provider 弹窗" onClick={() => setAdding(false)}><X size={16} /></button>
            </header>
            <form onSubmit={addProvider}>
              <div className="settings-provider-dialog-body">
                <label className="settings-field settings-field--wide"><span>Provider 预设</span>
                  <select className="settings-select" value={presetId} aria-label="Provider 预设" onChange={(event) => changePreset(event.target.value)} autoFocus data-motion="selection">
                    {PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                    <option value="custom">自定义</option>
                  </select>
                  <small>预设会自动填写协议、Base URL 和推荐模型。</small>
                </label>
                <div className="settings-grid-2">
                  <label className="settings-field"><span>ID</span><input className="settings-browser-path-input" value={newProvider.id} required onChange={(event) => setNewProvider({ ...newProvider, id: event.target.value })} /></label>
                  <label className="settings-field"><span>名称</span><input className="settings-browser-path-input" value={newProvider.name} required onChange={(event) => setNewProvider({ ...newProvider, name: event.target.value })} /></label>
                  <label className="settings-field"><span>Base URL</span><input className="settings-browser-path-input" type="url" value={newProvider.baseUrl} required placeholder="https://api.example.com" onChange={(event) => setNewProvider({ ...newProvider, baseUrl: event.target.value })} /></label>
                  <label className="settings-field"><span>模型</span><input className="settings-browser-path-input" value={newProvider.model} required placeholder="例如：deepseek-v4-flash" onChange={(event) => setNewProvider({ ...newProvider, model: event.target.value })} /></label>
                  <label className="settings-field"><span>协议</span>
                    <select className="settings-select" value={newProvider.protocol} onChange={(event) => setNewProvider({ ...newProvider, protocol: event.target.value as ProviderProtocol })} data-motion="selection">
                      <option value="anthropic-messages">anthropic-messages</option>
                      <option value="openai-chat">openai-chat</option>
                      <option value="openai-responses">openai-responses</option>
                    </select>
                  </label>
                  <label className="settings-field"><span>认证方式</span>
                    <select className="settings-select" value={newProvider.authMode} onChange={(event) => setNewProvider({ ...newProvider, authMode: event.target.value as ProviderAuthMode })}>
                      <option value="bearer">Bearer Token</option>
                      <option value="x-api-key">X-API-Key</option>
                    </select>
                  </label>
                  <label className="settings-field"><span>API Key</span><input className="settings-browser-path-input" type="password" value={newProvider.apiKey} required placeholder="请输入 API Key" onChange={(event) => setNewProvider({ ...newProvider, apiKey: event.target.value })} /></label>
                </div>
              </div>
              <footer><button type="button" className="settings-subtle-action" onClick={() => setAdding(false)}>取消</button><button type="submit" className="primary-button"><Plus size={14} />添加到列表</button></footer>
            </form>
          </section>
        </div>,
        document.body
      ) : null}
    </>
  );
}

function SettingsPanel({ title, scope, action, variant = "standard", children }: { title: string; scope: string; action?: ReactNode; variant?: "standard" | "resource"; children: ReactNode }) {
  return <section className={`settings-card settings-card--${variant}`} data-entrance-item><header><div className="settings-card-title"><h2>{title}</h2><span>{scope}</span></div>{action}</header><div className="settings-card-body">{children}</div></section>;
}

function PreferenceRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="settings-preference-row"><div className="settings-preference-copy"><strong>{title}</strong><p>{description}</p></div><div className="settings-preference-control">{children}</div></div>;
}

function PathRow({ label, path, buttonLabel, onClick }: { label: string; path: string; buttonLabel: string; onClick(): void }) {
  return <div className="settings-path-card"><small>{label}</small><code>{path || m.settings.paths.unset}</code><button type="button" data-motion="icon" onClick={onClick}><FolderOpen size={13} />{buttonLabel}</button></div>;
}

function providerSubtitle(provider: ProviderCapabilities): string {
  if (!provider.available) return provider.diagnostic || m.settings.provider.notLoggedIn;
  const protocol = provider.provider === "claude" ? m.settings.provider.claudeProtocol : m.settings.provider.codexProtocol;
  return `${protocol} · ${m.settings.provider.loggedIn}`;
}

function formatSessionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function skillGroup(skill: SkillDefinition): string {
  return skill.group?.trim() || m.settings.skills.fallbackGroup;
}

function formatSkillTimeout(value: number): string {
  if (value < 60_000) return `${Math.round(value / 1000)} 秒`;
  const minutes = value / 60_000;
  return Number.isInteger(minutes) ? `${minutes} 分钟` : `${minutes.toFixed(1)} 分钟`;
}

function formatInterval(value: number): string {
  return value < 60_000 ? `${value / 1000} 秒` : `${value / 60_000} 分钟`;
}
