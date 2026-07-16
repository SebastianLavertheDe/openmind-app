import type { ReactNode } from "react";
import { FolderOpen, Plus } from "lucide-react";
import type { ProviderCapabilities, UserPreferences } from "@shared/contracts";
import { AUTO_MODEL, MODEL_CATALOG, formatContextWindow, isOneMillionModel, resolveModelSpec } from "@shared/model-catalog";
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

export function ProviderSettingsSection({ prefs, providers, defaultProviderId, save, onAdd }: { prefs: UserPreferences; providers: ProviderCapabilities[]; defaultProviderId: string; save: SavePreferences; onAdd(): void }) {
  return (
    <SettingsPanel title="Provider" scope="新会话行为" action={<button type="button" data-motion="action" className="settings-subtle-action" onClick={onAdd}><Plus size={14} />{m.settings.provider.add}</button>}>
      <div className="settings-provider-list">
        {providers.length ? providers.map((provider) => {
          const active = provider.id === defaultProviderId;
          const model = effectiveModel(provider, prefs.providerModels[provider.provider]);
          return (
            <article key={provider.id} className={`settings-provider-card ${provider.available ? "available" : "unavailable"}`}>
              <span className="settings-provider-dot" aria-hidden="true" />
              <div className="settings-provider-main">
                <div><strong>{provider.label}</strong><small>{providerSubtitle(provider)}</small></div>
                <div className="settings-provider-model">
                  <Select
                    className="settings-select"
                    size="rect"
                    ariaLabel={m.settings.provider.modelAria(provider.label)}
                    value={model.value}
                    onChange={(value) => void save({ providerModels: { ...prefs.providerModels, [provider.provider]: value } })}
                    options={[{ value: AUTO_MODEL, label: m.settings.provider.modelFollowCli }, ...MODEL_CATALOG[provider.provider].map((spec) => ({ value: spec.id, label: `${spec.label}${spec.oneMillion ? " · 1M" : ""}` }))]}
                  />
                  <span className="settings-provider-model-meta">
                    {model.oneMillion ? <StatusBadge tone="info">1M</StatusBadge> : null}
                    <small>{model.label}{model.contextWindow ? ` · ${formatContextWindow(model.contextWindow)}` : ""}{model.isAuto && model.detected ? m.settings.provider.cliDetected(model.detected) : ""}</small>
                  </span>
                </div>
              </div>
              <StatusBadge tone={provider.available ? "success" : "warning"}>{provider.available ? m.settings.provider.available : m.settings.provider.unavailable}</StatusBadge>
              <ToggleSwitch checked={active} disabled={!provider.available} label={m.settings.provider.setDefault(provider.label)} onChange={() => void save({ defaultProvider: provider.id })} />
            </article>
          );
        }) : <p className="settings-note">{m.settings.provider.empty}</p>}
      </div>
      <p className="settings-note">{m.settings.provider.lockedNote}</p>
    </SettingsPanel>
  );
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

export function PathSettingsSection({ workspace, notes, onSelectWorkspace, onOpenNotes }: { workspace: string; notes: string; onSelectWorkspace(): void; onOpenNotes(): void }) {
  return (
    <SettingsPanel title={m.settings.paths.title} scope="本地项目">
      <div className="settings-path-list">
        <PathRow label={m.settings.paths.workspace} path={workspace} buttonLabel={m.settings.paths.browse} onClick={onSelectWorkspace} />
        <PathRow label={m.settings.paths.notes} path={notes} buttonLabel={m.settings.paths.browse} onClick={onOpenNotes} />
      </div>
      <p className="settings-note">{m.settings.paths.note}</p>
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
      <PreferenceRow title={m.settings.workflow.autoBriefTitle} description={m.settings.workflow.autoBriefDesc}>
        <ToggleSwitch checked={prefs.workflowAutoBriefOnSourceComplete} label={m.settings.workflow.autoBriefTitle} onChange={(checked) => void save({ workflowAutoBriefOnSourceComplete: checked })} />
      </PreferenceRow>
      <div className="settings-workflow-preview" role="status" aria-label="工作流规则预览">
        <strong>当前规则预览</strong>
        <span>草稿：{prefs.workflowAutoSaveDraft ? `每 ${formatInterval(prefs.autoSaveIntervalMs)}自动保存` : "仅手动保存"}</span>
        <span>推进：{prefs.workflowAutoVersionOnStageChange ? "创建版本快照" : "不创建自动版本"}；{prefs.workflowReviewRequiredForReady ? "审核通过后进入待发布" : "允许跳过审核门禁"}</span>
        <span>发布：{prefs.workflowPublishChecklistEnabled ? "校验标题、摘要、标签、封面、平台与正文" : "仅校验可导出的正文与平台"}</span>
        <span>自动化：{prefs.workflowAutoArchiveEnabled ? `${prefs.archiveAfterDays} 天后归档` : "不自动归档"}；{prefs.workflowAutoBriefOnSourceComplete ? "来源成功后运行每日简报 Skill" : "来源完成后不自动运行简报"}</span>
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

function effectiveModel(provider: ProviderCapabilities, prefValue: string | undefined) {
  const value = prefValue && prefValue !== AUTO_MODEL ? prefValue : AUTO_MODEL;
  const isAuto = value === AUTO_MODEL;
  const id = isAuto ? provider.detectedModel : value;
  const spec = id ? resolveModelSpec(provider.provider, id) : null;
  return { value, isAuto, id, label: isAuto ? (id ? (spec?.label ?? id) : m.settings.provider.followCli) : (spec?.label ?? id ?? value), contextWindow: spec?.contextWindow ?? provider.contextWindow ?? 0, oneMillion: spec?.oneMillion ?? (isAuto ? provider.oneMillion : isOneMillionModel(id)), detected: isAuto ? provider.detectedModel : null };
}

function formatInterval(value: number): string {
  return value < 60_000 ? `${value / 1000} 秒` : `${value / 60_000} 分钟`;
}
