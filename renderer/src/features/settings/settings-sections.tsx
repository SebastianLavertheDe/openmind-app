import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, ChevronDown, Copy, ExternalLink, FolderOpen, Globe, KeyRound, MessageSquareText, Package, RefreshCw, RotateCcw, Search, Server, Trash2, Wrench } from "lucide-react";
import type { AiSession, BrowserAutomationStatus, McpServerDefinition, ProviderCapabilities, SkillDefinition, UserPreferences } from "@shared/contracts";
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
  onOpenMcpSettings
}: {
  skills: SkillDefinition[];
  mcpServers: McpServerDefinition[];
  refreshing: boolean;
  onRefresh(): void;
  onCopy(skillId: string): void;
  onOpenDirectory(path: string): void;
  onOpenMcpSettings(): void;
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
        <button type="button" className="settings-subtle-action" disabled={refreshing} aria-busy={refreshing || undefined} onClick={onRefresh}>
          <RefreshCw size={13} className={refreshing ? "spin" : ""} aria-hidden />
          {refreshing ? m.settings.skills.refreshing : m.settings.skills.refresh}
        </button>
      )}
    >
      <div className="settings-capability-tabs" role="tablist" aria-label={m.settings.skills.catalogAria}>
        <button type="button" role="tab" aria-selected={catalog === "skills"} onClick={() => setCatalog("skills")}>
          <Package size={14} aria-hidden />{m.settings.skills.skillsTab}<span>{skills.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={catalog === "mcp"} onClick={() => setCatalog("mcp")}>
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
                      <button type="button" aria-label={m.settings.skills.copyNamed(skill.id)} onClick={() => onCopy(skill.id)}><Copy size={13} aria-hidden />{m.settings.skills.copyInvocation}</button>
                      <button type="button" aria-label={m.settings.skills.openNamed(title)} onClick={() => onOpenDirectory(skill.cwd)}><FolderOpen size={13} aria-hidden />{m.settings.skills.openDirectory}</button>
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
                      <button type="button" onClick={onOpenMcpSettings}><ExternalLink size={13} aria-hidden />{m.settings.skills.mcpOpenSettings}</button>
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
    </SettingsPanel>
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
          <button type="button" disabled={!token.trim() || savingToken || status?.secureStorageAvailable === false} onClick={() => void submitToken()}>
            <KeyRound size={13} aria-hidden />{status?.extensionTokenConfigured ? m.settings.browser.replaceToken : m.settings.browser.saveToken}
          </button>
          {status?.extensionTokenConfigured ? (
            <button type="button" className="settings-browser-clear" disabled={savingToken} onClick={() => void onClearToken()}>
              <Trash2 size={13} aria-hidden />{m.settings.browser.clearToken}
            </button>
          ) : null}
        </div>
      </div>

      <div className="settings-browser-boundary" role="note">
        <p>{m.settings.browser.boundary}</p>
        <button type="button" className="settings-subtle-action" onClick={onOpenExtensionDocs}>
          <ExternalLink size={13} aria-hidden />{m.settings.browser.installExtension}
        </button>
      </div>
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
                <button type="button" disabled={busyId === session.id} onClick={() => onOpen(session.id)} aria-label={m.settings.archivedSessions.openNamed(session.title || m.common.unnamedTopic)}>
                  <MessageSquareText size={13} />{m.settings.archivedSessions.open}
                </button>
                <button type="button" disabled={busyId === session.id} onClick={() => onRestore(session.id)} aria-label={m.settings.archivedSessions.restoreNamed(session.title || m.common.unnamedTopic)}>
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
