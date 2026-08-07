import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, ChevronDown, Copy, Download, ExternalLink, FolderOpen, Globe, KeyRound, MessageSquareText, Package, Pause, Play, RefreshCw, RotateCcw, Search, Server, Trash2, Wrench, X } from "lucide-react";
import type { AiSession, BrowserAutomationStatus, CredentialKind, CredentialMetadata, CredentialSetInput, CredentialVaultStatus, InstalledSkillView, McpServerDefinition, ProviderCapabilities, ProviderProfile, ProviderProfileInput, RuntimePackDownloadDescriptor, RuntimePackDownloadJob, RuntimePackReadiness, SkillDefinition, SkillPackageInspectionView, UserPreferences } from "@shared/contracts";
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

export function ProviderSettingsSection({ providers, defaultProviderId, save, credentialStatus, providerProfiles, onSaveCredential, onDeleteCredential, onSaveProviderProfile, onTestProviderProfile, onDeleteProviderProfile }: { providers: ProviderCapabilities[]; defaultProviderId: string; save: SavePreferences; credentialStatus: CredentialVaultStatus | null; providerProfiles: ProviderProfile[]; onSaveCredential(input: CredentialSetInput): Promise<void>; onDeleteCredential(id: string): Promise<void>; onSaveProviderProfile(input: ProviderProfileInput): Promise<void>; onTestProviderProfile(id: string): Promise<void>; onDeleteProviderProfile(id: string): Promise<void> }) {
  return (
    <SettingsPanel title="Provider" scope="新会话行为">
      <div className="settings-provider-list" role="radiogroup" aria-label="默认 Provider">
        {providers.length ? providers.map((provider) => {
          const active = provider.id === defaultProviderId;
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
              </div>
              <StatusBadge tone={provider.available ? "success" : "warning"}>{provider.available ? m.settings.provider.available : m.settings.provider.unavailable}</StatusBadge>
              <label className="settings-provider-default">
                <input type="radio" name="default-provider" checked={active} disabled={!provider.available} aria-label={m.settings.provider.setDefault(provider.label)} onChange={() => void save({ defaultProvider: provider.id })} />
                <span>{active ? "默认" : "设为默认"}</span>
              </label>
            </article>
          );
        }) : <p className="settings-note">{m.settings.provider.empty}</p>}
      </div>
      <p className="settings-note">{m.settings.provider.lockedNote}</p>
      <div className="settings-browser-backend" role="status">
        <span className="settings-browser-icon" aria-hidden><KeyRound size={18} /></span>
        <div>
          <strong>{m.settings.credentials.title}</strong>
          <span>{m.settings.credentials.scope} · {m.settings.credentials.profileCount(providerProfiles.length)}</span>
          <small>{credentialStatus ? (credentialStatus.available ? m.settings.credentials.availableDescription : m.settings.credentials.unavailableDescription) : "安全存储状态尚未读取。"}</small>
        </div>
        <StatusBadge tone={credentialStatus ? (credentialStatus.available ? "success" : "warning") : "neutral"}>
          {credentialStatus ? (credentialStatus.available ? m.settings.credentials.available : m.settings.credentials.unavailable) : m.settings.credentials.notLoaded}
        </StatusBadge>
      </div>
      <p className="settings-note">{m.settings.credentials.credentialCount(credentialStatus?.credentials.length || 0)}。表单只展示元数据，已保存 Secret 不会回显。</p>
      <ProviderConfigurationForms
        credentialStatus={credentialStatus}
        providerProfiles={providerProfiles}
        onSaveCredential={onSaveCredential}
        onDeleteCredential={onDeleteCredential}
        onSaveProviderProfile={onSaveProviderProfile}
        onTestProviderProfile={onTestProviderProfile}
        onDeleteProviderProfile={onDeleteProviderProfile}
      />
    </SettingsPanel>
  );
}

const CREDENTIAL_KIND_OPTIONS: Array<{ value: CredentialKind; label: string }> = [
  { value: "api-key", label: "API Key" },
  { value: "token", label: "Token" },
  { value: "password", label: "Password" },
  { value: "cookie", label: "Cookie" },
  { value: "credential-file", label: "Credential File" },
  { value: "oauth-refresh-token", label: "OAuth Refresh Token" },
  { value: "client-certificate", label: "Client Certificate" },
  { value: "session-only", label: "Session Only" }
];

const PROFILE_PROTOCOL_OPTIONS: Array<{ value: ProviderProfileInput["protocol"]; label: string }> = [
  { value: "openai-chat", label: "OpenAI Chat" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "provider-native", label: "Provider Native" }
];

const EMPTY_PROFILE: ProviderProfileInput = {
  id: "provider-local",
  name: "Local Provider",
  protocol: "provider-native",
  credentialId: null,
  baseUrl: "",
  model: "",
  timeoutMs: 120_000,
  maxRetries: 2,
  proxyPolicy: "system",
  tlsPolicy: "verify",
  proxyUrl: "",
  providerOptions: {},
  fallbackProfileId: null
};

function ProviderConfigurationForms({ credentialStatus, providerProfiles, onSaveCredential, onDeleteCredential, onSaveProviderProfile, onTestProviderProfile, onDeleteProviderProfile }: {
  credentialStatus: CredentialVaultStatus | null;
  providerProfiles: ProviderProfile[];
  onSaveCredential(input: CredentialSetInput): Promise<void>;
  onDeleteCredential(id: string): Promise<void>;
  onSaveProviderProfile(input: ProviderProfileInput): Promise<void>;
  onTestProviderProfile(id: string): Promise<void>;
  onDeleteProviderProfile(id: string): Promise<void>;
}) {
  const [credentialLabel, setCredentialLabel] = useState("");
  const [credentialKind, setCredentialKind] = useState<CredentialKind>("api-key");
  const [credentialSecret, setCredentialSecret] = useState("");
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [profile, setProfile] = useState<ProviderProfileInput>(EMPTY_PROFILE);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileTestBusy, setProfileTestBusy] = useState<string | null>(null);
  const activeCredentials = credentialStatus?.credentials.filter((item) => item.status === "active") || [];

  const submitCredential = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!credentialLabel.trim() || !credentialSecret || credentialBusy) return;
    setCredentialBusy(true);
    try {
      await onSaveCredential({ label: credentialLabel.trim(), kind: credentialKind, secret: credentialSecret });
      setCredentialSecret("");
    } finally {
      setCredentialBusy(false);
    }
  };

  const submitProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile.id.trim() || !profile.name.trim() || profileBusy) return;
    setProfileBusy(true);
    try {
      await onSaveProviderProfile({ ...profile, id: profile.id.trim(), name: profile.name.trim(), baseUrl: profile.baseUrl.trim(), model: profile.model.trim() });
    } finally {
      setProfileBusy(false);
    }
  };

  return (
    <div className="settings-config-stack">
      <form className="settings-config-form" onSubmit={(event) => void submitCredential(event)}>
        <div className="settings-config-heading"><strong>{m.settings.credentials.title}</strong><small>{m.settings.credentials.credentialSecretPlaceholder}</small></div>
        <div className="settings-config-grid">
          <label>{m.settings.credentials.credentialLabel}<input value={credentialLabel} onChange={(event) => setCredentialLabel(event.target.value)} maxLength={160} /></label>
          <label>{m.settings.credentials.credentialKind}<select value={credentialKind} onChange={(event) => setCredentialKind(event.target.value as CredentialKind)}>{CREDENTIAL_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="settings-config-wide">{m.settings.credentials.credentialSecret}<input type="password" autoComplete="new-password" value={credentialSecret} placeholder={m.settings.credentials.credentialSecretPlaceholder} onChange={(event) => setCredentialSecret(event.target.value)} maxLength={1024 * 1024} /></label>
        </div>
        <button type="submit" className="settings-subtle-action" data-motion="action" disabled={!credentialStatus?.available || credentialBusy || !credentialLabel.trim() || !credentialSecret}>{credentialBusy ? "保存中…" : m.settings.credentials.credentialSave}</button>
      </form>

      <div className="settings-config-list" aria-label={m.settings.credentials.title}>
        {credentialStatus?.credentials.length ? credentialStatus.credentials.map((credential: CredentialMetadata) => (
          <div className="settings-config-row" key={credential.id}>
            <div><strong>{credential.label}</strong><small>{credential.kind} · {credential.status === "active" ? "active" : "revoked"} · {credential.id}</small></div>
            <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void onDeleteCredential(credential.id)}>{m.settings.credentials.credentialDelete}</button>
          </div>
        )) : <p className="settings-note">{m.settings.credentials.credentialEmpty}</p>}
      </div>

      <form className="settings-config-form" onSubmit={(event) => void submitProfile(event)}>
        <div className="settings-config-heading"><strong>{m.settings.credentials.profileTitle}</strong><small>{m.settings.credentials.availableDescription}</small></div>
        <div className="settings-config-grid">
          <label>{m.settings.credentials.profileId}<input value={profile.id} onChange={(event) => setProfile((current) => ({ ...current, id: event.target.value }))} maxLength={120} /></label>
          <label>{m.settings.credentials.profileName}<input value={profile.name} onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} maxLength={160} /></label>
          <label>{m.settings.credentials.profileProtocol}<select value={profile.protocol} onChange={(event) => {
            const protocol = event.target.value as ProviderProfileInput["protocol"];
            setProfile((current) => ({ ...current, protocol, providerOptions: protocol === "anthropic-messages" ? { anthropicVersion: "2023-06-01" } : {} }));
          }}>{PROFILE_PROTOCOL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>{m.settings.credentials.profileCredential}<select value={profile.credentialId || ""} onChange={(event) => setProfile((current) => ({ ...current, credentialId: event.target.value || null }))}><option value="">{m.settings.credentials.profileNoCredential}</option>{activeCredentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.label} · {credential.id}</option>)}</select></label>
          <label className="settings-config-wide">{m.settings.credentials.profileBaseUrl}<input value={profile.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => setProfile((current) => ({ ...current, baseUrl: event.target.value }))} maxLength={2048} /></label>
          <label>{m.settings.credentials.profileModel}<input value={profile.model} onChange={(event) => setProfile((current) => ({ ...current, model: event.target.value }))} maxLength={200} /></label>
          <label>代理策略<select value={profile.proxyPolicy} onChange={(event) => setProfile((current) => ({ ...current, proxyPolicy: event.target.value as ProviderProfileInput["proxyPolicy"] }))}><option value="system">系统</option><option value="disabled">禁用</option><option value="explicit">显式代理</option></select></label>
          {profile.proxyPolicy === "explicit" ? <label className="settings-config-wide">代理地址<input value={profile.proxyUrl || ""} placeholder="http://127.0.0.1:7890" onChange={(event) => setProfile((current) => ({ ...current, proxyUrl: event.target.value }))} maxLength={2048} /></label> : null}
          <label>TLS 策略<select value={profile.tlsPolicy} onChange={(event) => setProfile((current) => ({ ...current, tlsPolicy: event.target.value as ProviderProfileInput["tlsPolicy"] }))}><option value="verify">验证证书</option><option value="allow-insecure">允许不安全 TLS</option></select></label>
          {profile.protocol === "openai-chat" || profile.protocol === "openai-responses" ? <>
            <label>Organization<input value={profile.providerOptions?.organization || ""} onChange={(event) => setProfile((current) => ({ ...current, providerOptions: { ...current.providerOptions, organization: event.target.value || undefined } }))} maxLength={200} /></label>
            <label>Project<input value={profile.providerOptions?.project || ""} onChange={(event) => setProfile((current) => ({ ...current, providerOptions: { ...current.providerOptions, project: event.target.value || undefined } }))} maxLength={200} /></label>
          </> : null}
          {profile.protocol === "anthropic-messages" ? <label>Anthropic-Version<input value={profile.providerOptions?.anthropicVersion || "2023-06-01"} onChange={(event) => setProfile((current) => ({ ...current, providerOptions: { ...current.providerOptions, anthropicVersion: event.target.value } }))} maxLength={10} /></label> : null}
        </div>
        <button type="submit" className="settings-subtle-action" data-motion="action" disabled={profileBusy || !profile.id.trim() || !profile.name.trim()}>{profileBusy ? "保存中…" : m.settings.credentials.profileSave}</button>
      </form>

      <div className="settings-config-list" aria-label={m.settings.credentials.profileTitle}>
        {providerProfiles.length ? providerProfiles.map((item) => (
          <div className="settings-config-row" key={item.id}>
            <div><strong>{item.name}</strong><small>{item.protocol} · {item.baseUrl || "default endpoint"} · {item.proxyPolicy === "explicit" ? `proxy ${item.proxyUrl || "未配置"}` : `proxy ${item.proxyPolicy}`} · {item.id}</small><small>{item.test.status === "success" ? m.settings.credentials.profileTestSuccess : item.test.status === "failed" ? `${m.settings.credentials.profileTestFailed}：${item.test.diagnostic || "未知错误"}` : m.settings.credentials.profileTestNever}</small></div>
            <button type="button" className="settings-subtle-action" data-motion="action" disabled={profileTestBusy === item.id} onClick={() => { setProfileTestBusy(item.id); void onTestProviderProfile(item.id).finally(() => setProfileTestBusy(null)); }}>{profileTestBusy === item.id ? m.settings.credentials.profileTesting : m.settings.credentials.profileTest}</button>
            <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void onDeleteProviderProfile(item.id)}>{m.settings.credentials.profileDelete}</button>
          </div>
        )) : <p className="settings-note">{m.settings.credentials.profileEmpty}</p>}
      </div>
    </div>
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
  skills,
  mcpServers,
  refreshing,
  onRefresh,
  onCopy,
  onOpenDirectory,
  onOpenMcpSettings,
  packageInspections,
  installedSkills,
  packageBusy,
  onInspectPackages,
  onMigratePackages,
  onUpdatePackage,
  onRollbackPackage,
  onUninstallPackage
}: {
  skills: SkillDefinition[];
  mcpServers: McpServerDefinition[];
  refreshing: boolean;
  onRefresh(): void;
  onCopy(skillId: string): void;
  onOpenDirectory(path: string): void;
  onOpenMcpSettings(): void;
  packageInspections: SkillPackageInspectionView[];
  installedSkills: InstalledSkillView[];
  packageBusy: "inspect" | "migrate" | "update" | "rollback" | "uninstall" | null;
  onInspectPackages(): void;
  onMigratePackages(): void;
  onUpdatePackage(sourcePath: string): void;
  onRollbackPackage(key: string): void;
  onUninstallPackage(key: string, digest: string): void;
}) {
  const [catalog, setCatalog] = useState<"skills" | "mcp">("skills");
  const [query, setQuery] = useState("");
  const [mcpQuery, setMcpQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
      action={(
        <button type="button" className="settings-subtle-action" data-motion="action" disabled={refreshing} aria-busy={refreshing || undefined} onClick={onRefresh}>
          <RefreshCw size={13} className={refreshing ? "spin" : ""} aria-hidden />
          {refreshing ? m.settings.skills.refreshing : m.settings.skills.refresh}
        </button>
      )}
    >
      <div className="settings-capability-tabs" role="tablist" aria-label={m.settings.skills.catalogAria}>
        <button type="button" role="tab" data-motion="selection" aria-selected={catalog === "skills"} onClick={() => setCatalog("skills")}>
          <Package size={14} aria-hidden />{m.settings.skills.skillsTab}<span>{skills.length}</span>
        </button>
        <button type="button" role="tab" data-motion="selection" aria-selected={catalog === "mcp"} onClick={() => setCatalog("mcp")}>
          <Server size={14} aria-hidden />{m.settings.skills.mcpTab}<span>{mcpServers.length}</span>
        </button>
      </div>

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
            {filteredMcpServers.map((server) => (
              <article className="settings-mcp-server" key={server.id}>
                <header className="settings-mcp-server-header">
                  <span className="settings-skill-icon" aria-hidden><Server size={16} /></span>
                  <span className="settings-mcp-identity">
                    <span><strong>{server.title}</strong><code>{server.id}</code></span>
                    <small>{server.description}</small>
                  </span>
                  <StatusBadge tone={server.status === "enabled" ? "success" : "warning"}>{m.settings.skills.mcpStatus[server.status]}</StatusBadge>
                </header>
                <div className="settings-mcp-details">
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
                </div>
              </article>
            ))}
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
        inspections={packageInspections}
        installed={installedSkills}
        busy={packageBusy}
        onInspect={onInspectPackages}
        onMigrate={onMigratePackages}
        onUpdate={onUpdatePackage}
        onRollback={onRollbackPackage}
        onUninstall={onUninstallPackage}
      />
    </SettingsPanel>
  );
}

function SkillPackagePanel({
  inspections,
  installed,
  busy,
  onInspect,
  onMigrate,
  onUpdate,
  onRollback,
  onUninstall
}: {
  inspections: SkillPackageInspectionView[];
  installed: InstalledSkillView[];
  busy: "inspect" | "migrate" | "update" | "rollback" | "uninstall" | null;
  onInspect(): void;
  onMigrate(): void;
  onUpdate(sourcePath: string): void;
  onRollback(key: string): void;
  onUninstall(key: string, digest: string): void;
}) {
  const installedBySource = new Map(installed.map((item) => [item.sourcePath, item]));
  const canRollback = (key: string) => installed.some((item) => item.key === key && item.status === "active") && installed.some((item) => item.key === key && item.status === "previous" && item.readiness === "ready");
  return (
    <section className="settings-skill-packages" aria-label={m.settings.skills.packageTitle}>
      <header className="settings-skill-packages-header">
        <div>
          <h3>{m.settings.skills.packageTitle}</h3>
          <p>{m.settings.skills.packageDescription}</p>
        </div>
        <div className="settings-skill-actions">
          <button type="button" data-motion="action" disabled={Boolean(busy)} onClick={onInspect}>
            <Search size={13} aria-hidden />{busy === "inspect" ? m.settings.skills.packageInspecting : m.settings.skills.packageInspect}
          </button>
          <button type="button" data-motion="action" disabled={Boolean(busy) || !inspections.some((item) => item.valid)} onClick={onMigrate}>
            <Package size={13} aria-hidden />{busy === "migrate" ? m.settings.skills.packageMigrating : m.settings.skills.packageMigrate}
          </button>
        </div>
      </header>
      <div className="settings-skill-package-summary" role="status">
        {m.settings.skills.packageScope(inspections.length, installed.length)}
      </div>
      {inspections.length ? (
        <div className="settings-skill-package-list">
          {inspections.map((item) => {
            const record = installedBySource.get(item.sourcePath);
            const status = record ? m.settings.skills.packageInstalled : item.sourceKind === "legacy-claude" ? m.settings.skills.packageLegacy : item.valid ? m.settings.skills.packageValid : m.settings.skills.packageInvalid;
            return (
              <article className="settings-skill-package-item" key={`${item.sourcePath}:${item.digest}`}>
                <div className="settings-skill-package-main">
                  <span className={`settings-skill-package-dot ${item.valid || record ? "is-valid" : "is-invalid"}`} aria-hidden />
                  <div>
                    <strong>{item.manifest && typeof item.manifest === "object" && "id" in item.manifest ? String(item.manifest.id) : item.sourcePath.split(/[\\/]/).pop()}</strong>
                    <small>{item.sourcePath}</small>
                  </div>
                  <StatusBadge tone={record ? "success" : item.valid ? "warning" : "danger"}>{status}</StatusBadge>
                </div>
                <div className="settings-skill-package-meta">
                  <span>{m.settings.skills.packageDigest}: <code>{item.digest.slice(0, 12)}</code></span>
                  <span>{item.files.length} files · {Math.round(item.totalBytes / 1024)} KB</span>
                  {record ? <span>{m.settings.skills.packageQuarantined}</span> : null}
                  {item.issues.length ? <span className="is-invalid">{m.settings.skills.packageIssues(item.issues.length)}</span> : null}
                  {item.warnings.length ? <span>{m.settings.skills.packageWarnings(item.warnings.length)}</span> : null}
                </div>
                {record && item.valid ? (
                  <div className="settings-skill-actions">
                    <button type="button" data-motion="action" disabled={Boolean(busy)} onClick={() => onUpdate(item.sourcePath)}>{busy === "update" ? m.settings.skills.packageUpdating : m.settings.skills.packageUpdate}</button>
                  </div>
                ) : null}
                {item.issues.length ? <ul className="settings-skill-package-issues">{item.issues.slice(0, 3).map((issue) => <li key={`${issue.code}:${issue.path || ""}`}>{issue.message}</li>)}</ul> : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="settings-skill-package-empty">{m.settings.skills.packageEmpty}</p>
      )}
      {installed.length ? (
        <div className="settings-skill-package-installed" aria-label="已安装 Skill 版本">
          {installed.map((record) => (
            <div className="settings-skill-package-meta" key={`${record.key}:${record.digest}`}>
              <span><strong>{record.key}@{record.version}</strong> · {record.status} · {record.readiness}</span>
              <div className="settings-skill-actions">
                {canRollback(record.key) && record.status === "active" ? <button type="button" data-motion="action" disabled={Boolean(busy)} onClick={() => onRollback(record.key)}>{busy === "rollback" ? "回滚中…" : m.settings.skills.packageRollback}</button> : null}
                {record.status !== "active" ? <button type="button" data-motion="action" disabled={Boolean(busy)} onClick={() => onUninstall(record.key, record.digest)}>{busy === "uninstall" ? "卸载中…" : m.settings.skills.packageUninstall}</button> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {!installed.length && inspections.length ? <p className="settings-skill-package-empty">{m.settings.skills.packageNoInstalled}</p> : null}
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
    <SettingsPanel title={m.settings.browser.title} scope={m.settings.browser.scope}>
      <div className="settings-browser-backend">
        <span className="settings-browser-icon" aria-hidden><Globe size={18} /></span>
        <div>
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
  );
}

export function PathSettingsSection({ mymind, workspace, notes, onSelectMymind, onSelectWorkspace, onOpenNotes }: { mymind: string; workspace: string; notes: string; onSelectMymind(): void; onSelectWorkspace(): void; onOpenNotes(): void }) {
  return (
    <SettingsPanel title={m.settings.paths.title} scope="本地项目">
      <div className="settings-path-list">
        <PathRow label={m.settings.paths.workspace} path={workspace} buttonLabel={m.settings.paths.browse} onClick={onSelectWorkspace} />
        <PathRow label={m.settings.paths.notes} path={notes} buttonLabel={m.settings.paths.browse} onClick={onOpenNotes} />
        <PathRow label={m.settings.paths.mymindRoot} path={mymind} buttonLabel={m.settings.paths.selectRoot} onClick={onSelectMymind} />
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
          <span>{m.settings.archivedSessions.empty}</span>
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
    <SettingsPanel title={m.settings.workflow.title} scope="后台执行" action={<button type="button" className="settings-subtle-action" data-motion="action" onClick={onReset}>{m.settings.workflow.resetToDefaults}</button>}>
      <p className="settings-workflow-desc">{m.settings.workflow.description}</p>
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
      <PreferenceRow title={m.settings.workflow.autoSaveTitle} description={m.settings.workflow.autoSaveDesc}>
        <div className="settings-inline-controls">
          <Select ariaLabel="自动保存间隔" size="rect" value={String(prefs.autoSaveIntervalMs)} options={AUTO_SAVE_OPTIONS} onChange={(value) => void save({ autoSaveIntervalMs: Number(value) })} />
          <ToggleSwitch checked={prefs.workflowAutoSaveDraft} label={m.settings.workflow.autoSaveTitle} onChange={(checked) => void save({ workflowAutoSaveDraft: checked })} />
        </div>
      </PreferenceRow>
      <PreferenceRow title={m.settings.workflow.autoVersionTitle} description={m.settings.workflow.autoVersionDesc}>
        <ToggleSwitch checked={prefs.workflowAutoVersionOnStageChange} label={m.settings.workflow.autoVersionTitle} onChange={(checked) => void save({ workflowAutoVersionOnStageChange: checked })} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.workflow.reviewGateTitle} description={m.settings.workflow.reviewGateDesc}>
        <ToggleSwitch checked={prefs.workflowReviewRequiredForReady} label={m.settings.workflow.reviewGateTitle} onChange={(checked) => void save({ workflowReviewRequiredForReady: checked })} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.workflow.publishCheckTitle} description={m.settings.workflow.publishCheckDesc}>
        <ToggleSwitch checked={prefs.workflowPublishChecklistEnabled} label={m.settings.workflow.publishCheckTitle} onChange={(checked) => void save({ workflowPublishChecklistEnabled: checked })} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.workflow.autoArchiveTitle} description={m.settings.workflow.autoArchiveDesc}>
        <div className="settings-inline-controls">
          <Select ariaLabel="自动归档期限" size="rect" value={String(prefs.archiveAfterDays)} options={AUTO_ARCHIVE_OPTIONS} onChange={(value) => void save({ archiveAfterDays: Number(value) })} />
          <ToggleSwitch checked={prefs.workflowAutoArchiveEnabled} label={m.settings.workflow.autoArchiveTitle} onChange={(checked) => void save({ workflowAutoArchiveEnabled: checked })} />
        </div>
      </PreferenceRow>
      <div className="settings-workflow-preview" role="status" aria-label="工作流规则预览">
        <strong>当前规则预览</strong>
        <span>草稿：{prefs.workflowAutoSaveDraft ? `每 ${formatInterval(prefs.autoSaveIntervalMs)}自动保存` : "仅手动保存"}</span>
        <span>推进：{prefs.workflowAutoVersionOnStageChange ? "创建版本快照" : "不创建自动版本"}；{prefs.workflowReviewRequiredForReady ? "审核通过后进入待发布" : "允许跳过审核门禁"}</span>
        <span>发布：{prefs.workflowPublishChecklistEnabled ? "校验标题、摘要、标签、封面、平台与正文" : "仅校验可导出的正文与平台"}</span>
        <span>自动化：规则、调度与运行历史统一在“自动化”页面管理。</span>
      </div>
    </SettingsPanel>
  );
}

function SettingsPanel({ title, scope, action, children }: { title: string; scope: string; action?: ReactNode; children: ReactNode }) {
  return <section className="settings-card" data-entrance-item><header><div className="settings-card-title"><h2>{title}</h2><span>{scope}</span></div>{action}</header><div className="settings-card-body">{children}</div></section>;
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
