import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Archive, ChevronDown, ChevronRight, Copy, ExternalLink, FolderOpen, Globe, KeyRound, MessageSquareText, MoreHorizontal, Package, Plus, RefreshCw, RotateCcw, Search, Server, ShieldCheck, Trash2, Wrench, X } from "lucide-react";
import type { AiSession, BrowserAutomationStatus, CliInstallProgress, CliProviderBindings, CliToolUpdateView, McpServerDefinition, ProviderAuthMode, ProviderCapabilities, ProviderYamlInputEntry, ProviderProtocol, ProvidersYamlInput, ProvidersYamlView, SharedPythonRuntimeStatus, SkillDefinition, UserPreferences } from "@shared/contracts";
import { PROVIDER_PRESETS, supportsCliProvider } from "@shared/contracts";
import { formatContextWindow } from "@shared/model-catalog";
import { messages } from "@shared/messages";
import { DropdownMenu, SegmentedControl, Select, StatusBadge, ToggleSwitch, useModalFocusScope } from "../../design-system/components";

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
  label: value < 60_000 ? m.settings.duration.seconds(value / 1000) : m.settings.duration.oneMinute
}));
const AUTO_ARCHIVE_OPTIONS = [30, 60, 90, 180, 365].map((value) => ({ value: String(value), label: m.settings.duration.days(value) }));

export function AppearanceSettingsSection({ prefs, save }: { prefs: UserPreferences; save: SavePreferences }) {
  return (
    <SettingsPanel title={m.settings.appearance.title} scope={m.settings.scopes.localPreference}>
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
    setInstallProgress({ cli, phase: "resolving", message: m.settings.provider.preparingInstall });
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
    setInstallProgress({ cli, phase: "resolving", message: m.settings.provider.preparingUpgrade });
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
    <SettingsPanel title={m.settings.provider.title} scope={m.settings.scopes.newSession}>
      <div className="settings-provider-list" role="radiogroup" aria-label={m.settings.provider.defaultAria}>
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
                  <button type="button" className="settings-provider-install-button" data-motion="action" onClick={() => void window.openmind.openCliLogin(provider.provider as "claude" | "codex")}>
                    {m.settings.provider.openLogin}
                  </button>
                  <button type="button" className="settings-provider-recheck" data-motion="action" onClick={() => void window.openmind.aiRefreshProviders()}>
                    {m.settings.provider.recheck}
                  </button>
                  <small>{m.settings.provider.loginHint}</small>
                </div> : null}
                {provider.runtime === "wsl" && !provider.available ? <details className="settings-provider-wsl-steps">
                  <summary>{m.settings.provider.wslStepsTitle}</summary>
                  <ol>
                    <li><code>{provider.provider === "claude" ? "npm install -g @anthropic-ai/claude-code" : "npm install -g @openai/codex"}</code><button type="button" className="settings-provider-recheck" data-motion="action" onClick={() => void navigator.clipboard?.writeText(provider.provider === "claude" ? "npm install -g @anthropic-ai/claude-code" : "npm install -g @openai/codex")}>{m.settings.provider.copyCommand}</button></li>
                    <li><code>{provider.provider === "claude" ? "claude /login" : "codex login"}</code><button type="button" className="settings-provider-recheck" data-motion="action" onClick={() => void navigator.clipboard?.writeText(provider.provider === "claude" ? "claude /login" : "codex login")}>{m.settings.provider.copyCommand}</button></li>
                    <li>{m.settings.provider.wslStepsRecheck}</li>
                  </ol>
                </details> : null}
              </div>
              <div className="settings-provider-actions">
                {canInstall ? <div className="settings-provider-install settings-provider-install--action">
                  {installing ? <div className="settings-provider-install-progress" role="status" aria-label={`${provider.label} ${m.settings.provider.installProgress}`}>
                    <progress max={100} value={installProgress?.totalBytes ? Math.min(100, Math.round(((installProgress.receivedBytes || 0) / installProgress.totalBytes) * 100)) : 0} aria-label={`${provider.label} ${m.settings.provider.installProgress}`} />
                    <small>{installProgress?.message || m.settings.provider.installing}</small>
                    <button type="button" className="settings-provider-recheck" data-motion="action" onClick={() => void cancelInstall(provider.provider as "claude" | "codex")}>{m.settings.provider.cancelInstall}</button>
                  </div> : <button type="button" className="settings-provider-install-button" data-motion="action" disabled={installingCli !== null || upgradingCli !== null} onClick={() => void installCli(provider.provider as "claude" | "codex")}>
                    {m.settings.provider.install}
                  </button>}
                  {installError?.cli === provider.provider ? <div className="settings-provider-install-failure" role="alert">
                    <span>{m.settings.provider.installFailed}{installError.message}</span>
                    <button type="button" className="settings-provider-recheck" data-motion="action" onClick={() => void installCli(provider.provider as "claude" | "codex")}>{m.settings.provider.retryInstall}</button>
                  </div> : null}
                </div> : null}
                {provider.version !== null && provider.provider ? <div className="settings-provider-version-actions">
                  <div className="settings-provider-version-copy">
                    <span className="settings-provider-version">v{provider.version}</span>
                    {versionCheck ? <small className={`settings-provider-version-result ${!versionCheck.updateAvailable && versionCheck.latestVersion && versionCheck.currentVersion ? "settings-provider-version-latest" : ""}`} role="status">
                      {versionCheck.updateAvailable ? m.settings.provider.updateAvailable(versionCheck.latestVersion) : versionCheck.latestVersion && versionCheck.currentVersion ? m.settings.provider.latest : m.settings.provider.latestUnknown}
                    </small> : null}
                  </div>
                  {versionCheck?.updateAvailable ? <button type="button" className="settings-provider-upgrade" data-motion="action" disabled={!versionCheck.canUpgrade || upgrading || versionCheckBusy !== null} title={!versionCheck.canUpgrade ? m.settings.provider.upgradeUnavailable : undefined} onClick={() => void upgradeCli(provider.provider as "claude" | "codex")}>
                    {upgrading ? m.settings.provider.updating : m.settings.provider.upgrade}
                  </button> : <button type="button" className="settings-provider-recheck" data-motion="action" disabled={versionCheckBusy !== null || upgradingCli !== null} onClick={() => void checkVersion(provider.provider as "claude" | "codex")}>
                    {versionCheckBusy === provider.provider ? m.settings.provider.checking : versionCheck ? m.settings.provider.recheckUpdate : m.settings.provider.checkUpdate}
                  </button>}
                  {installError?.cli === provider.provider && !canInstall ? <div className="settings-provider-version-error" role="alert">
                    <span>{m.settings.provider.upgradeFailed}{installError.message}</span>
                  </div> : null}
                  {versionError?.cli === provider.provider ? <div className="settings-provider-version-error" role="alert">
                    <span>{m.settings.provider.versionFailed(versionError.message)}</span>
                    <button type="button" className="settings-provider-recheck" data-motion="action" onClick={() => void checkVersion(provider.provider as "claude" | "codex")}>{m.settings.provider.retryVersion}</button>
                  </div> : null}
                </div> : null}
                {!canInstall ? <>
                  <StatusBadge tone={provider.available ? "success" : "warning"}>{provider.available ? m.settings.provider.available : m.settings.provider.unavailable}</StatusBadge>
                  <label className="settings-provider-default">
                    <input type="radio" name="default-provider" checked={active} disabled={!provider.available} aria-label={m.settings.provider.setDefault(provider.label)} onChange={() => void save({ defaultProvider: provider.id })} />
                    <span>{active ? m.settings.provider.default : m.settings.provider.setAsDefault}</span>
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
  const label = busy ? (enabled ? m.settings.pythonRuntime.status.updating : m.settings.pythonRuntime.status.installing) : status?.ready ? m.settings.pythonRuntime.status.available : status?.phase === "error" ? m.settings.pythonRuntime.status.needsAction : enabled ? m.settings.pythonRuntime.status.preparing : m.settings.pythonRuntime.status.disabled;
  return (
    <SettingsPanel title={m.settings.pythonRuntime.title} scope={status?.ready ? `Python ${status.pythonVersion || "3.12"}` : m.settings.pythonRuntime.sharedScope} variant="resource">
      <article className="settings-resource-row settings-runtime-resource">
        <span className="settings-resource-icon settings-shared-runtime-shield"><ShieldCheck size={18} aria-hidden /></span>
        <div className="settings-resource-copy">
          <strong>{m.settings.pythonRuntime.builtIn}</strong>
          <p>{m.settings.pythonRuntime.description}</p>
          <small>{status?.target || m.settings.pythonRuntime.currentPlatform}{status?.uvVersion ? ` · uv ${status.uvVersion}` : ""}{status?.managedSkills ? ` · ${m.settings.pythonRuntime.managedSkills(status.managedSkills)}` : ""}</small>
        </div>
        <div className="settings-resource-actions">
          <StatusBadge tone={tone}>{label}</StatusBadge>
          <ToggleSwitch checked={enabled} disabled={busy || !status} label={m.settings.pythonRuntime.toggle} onChange={onToggle} />
        </div>
      </article>
      <div className="settings-runtime-feedback">
        {busy ? <div className="settings-shared-runtime-progress" role="status"><span className="spin" /><p>{m.settings.pythonRuntime.progress}</p></div> : null}
        {status?.lastError ? <p className="settings-shared-runtime-error" role="alert">{status.lastError}</p> : null}
      </div>
      <footer className="settings-panel-footer">
        <p className="settings-note">{m.settings.pythonRuntime.disabledHint}</p>
        <button type="button" className="settings-subtle-action" data-motion="action" disabled={busy} onClick={onRefresh}><RefreshCw size={13} aria-hidden />{m.settings.pythonRuntime.refresh}</button>
      </footer>
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
  onOpenMcpSettings
}: {
  mode?: "skills" | "mcp";
  skills: SkillDefinition[];
  mcpServers: McpServerDefinition[];
  refreshing: boolean;
  onRefresh(): void;
  onCopy(skillId: string): void;
  onOpenDirectory(path: string): void;
  onOpenMcpSettings(): void;
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
      variant={mode === "mcp" ? "mcp" : "standard"}
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
                <button type="button" className="settings-mcp-server-header" data-motion="disclosure" aria-expanded={expanded} onClick={() => setExpandedMcpId((current) => current === server.id ? null : server.id)}>
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
    </SettingsPanel>
  );
}

function SkillDetail({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd><code title={value}>{value}</code></dd></div>;
}

export function PermissionSettingsSection({ prefs, save }: { prefs: UserPreferences; save: SavePreferences }) {
  return (
    <SettingsPanel title={m.settings.permissions.title} scope={m.settings.scopes.runtimeRules}>
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
    <SettingsPanel title={m.settings.browser.connectionTitle} scope={m.settings.browser.scope} variant="resource">
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
    <SettingsPanel title={m.settings.browser.evidenceTitle} scope={m.settings.scopes.localSecurity}>
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

export function PathSettingsSection({ openmind, notes, onSelectOpenmind, onOpenNotes }: { openmind: string; notes: string; onSelectOpenmind(): void; onOpenNotes(): void }) {
  return (
    <SettingsPanel title={m.settings.paths.title} scope={m.settings.scopes.localProject}>
      <div className="settings-path-list">
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
          <div><strong>{m.settings.archivedSessions.empty}</strong><span>{m.settings.archivedSessions.emptyDescription}</span></div>
        </div>
      )}
    </SettingsPanel>
  );
}

export function WorkflowSettingsSection({ prefs, save, onReset }: { prefs: UserPreferences; save: SavePreferences; onReset(): void }) {
  return (
    <>
    <SettingsPanel title={m.settings.workflow.panels.stages} scope={m.settings.scopes.contentFlow} action={<button type="button" className="settings-subtle-action" data-motion="action" onClick={onReset}>{m.settings.workflow.resetToDefaults}</button>}>
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
    <SettingsPanel title={m.settings.workflow.panels.drafts} scope={m.settings.scopes.editBehavior}>
      <PreferenceRow title={m.settings.workflow.autoSaveTitle} description={m.settings.workflow.autoSaveDesc}>
        <div className="settings-inline-controls">
          <Select ariaLabel={m.settings.workflow.autoSaveAria} size="rect" value={String(prefs.autoSaveIntervalMs)} options={AUTO_SAVE_OPTIONS} onChange={(value) => void save({ autoSaveIntervalMs: Number(value) })} />
          <ToggleSwitch checked={prefs.workflowAutoSaveDraft} label={m.settings.workflow.autoSaveTitle} onChange={(checked) => void save({ workflowAutoSaveDraft: checked })} />
        </div>
      </PreferenceRow>
      <PreferenceRow title={m.settings.workflow.autoVersionTitle} description={m.settings.workflow.autoVersionDesc}>
        <ToggleSwitch checked={prefs.workflowAutoVersionOnStageChange} label={m.settings.workflow.autoVersionTitle} onChange={(checked) => void save({ workflowAutoVersionOnStageChange: checked })} />
      </PreferenceRow>
    </SettingsPanel>
    <SettingsPanel title={m.settings.workflow.panels.review} scope={m.settings.scopes.publishGate}>
      <PreferenceRow title={m.settings.workflow.reviewGateTitle} description={m.settings.workflow.reviewGateDesc}>
        <ToggleSwitch checked={prefs.workflowReviewRequiredForReady} label={m.settings.workflow.reviewGateTitle} onChange={(checked) => void save({ workflowReviewRequiredForReady: checked })} />
      </PreferenceRow>
      <PreferenceRow title={m.settings.workflow.publishCheckTitle} description={m.settings.workflow.publishCheckDesc}>
        <ToggleSwitch checked={prefs.workflowPublishChecklistEnabled} label={m.settings.workflow.publishCheckTitle} onChange={(checked) => void save({ workflowPublishChecklistEnabled: checked })} />
      </PreferenceRow>
      <div className="settings-workflow-preview" role="status" aria-label={m.settings.workflow.preview.aria}>
        <strong>{m.settings.workflow.preview.title}</strong>
        <span>{prefs.workflowAutoSaveDraft ? m.settings.workflow.preview.draftAuto(formatInterval(prefs.autoSaveIntervalMs)) : m.settings.workflow.preview.draftManual}</span>
        <span>{m.settings.workflow.preview.advance(prefs.workflowAutoVersionOnStageChange, prefs.workflowReviewRequiredForReady)}</span>
        <span>{prefs.workflowPublishChecklistEnabled ? m.settings.workflow.preview.publishFull : m.settings.workflow.preview.publishBasic}</span>
      </div>
    </SettingsPanel>
    <SettingsPanel title={m.settings.workflow.panels.archive} scope={m.settings.scopes.contentLifecycle}>
      <PreferenceRow title={m.settings.workflow.autoArchiveTitle} description={m.settings.workflow.autoArchiveDesc}>
        <div className="settings-inline-controls">
          <Select ariaLabel={m.settings.workflow.archiveAria} size="rect" value={String(prefs.archiveAfterDays)} options={AUTO_ARCHIVE_OPTIONS} onChange={(value) => void save({ archiveAfterDays: Number(value) })} />
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
 * Provider list reads stay key-free. The original key is fetched only after a
 * user explicitly opens that Provider's trusted local editor.
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
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingSnapshot, setEditingSnapshot] = useState<{ entry: ProviderYamlInputEntry; apiKey: string; cliBindings: CliProviderBindings } | null>(null);
  const [advancedProviderId, setAdvancedProviderId] = useState<string | null>(null);
  const addDialogRef = useRef<HTMLDivElement | null>(null);
  const editDialogRef = useRef<HTMLDivElement | null>(null);

  const closeAddDialog = () => {
    setAdding(false);
    setNewProvider(null);
  };

  const dismissEditDialog = () => {
    setEditingProviderId(null);
    setEditingSnapshot(null);
    setAdvancedProviderId(null);
  };

  const cancelEditDialog = () => {
    if (editingSnapshot) {
      setDraft((current) => current.map((entry) => entry.id === editingSnapshot.entry.id ? editingSnapshot.entry : entry));
      setApiKeyKeys((current) => {
        const next = { ...current };
        if (editingSnapshot.apiKey) next[editingSnapshot.entry.id] = editingSnapshot.apiKey;
        else delete next[editingSnapshot.entry.id];
        return next;
      });
      setCliBindings(editingSnapshot.cliBindings);
    }
    dismissEditDialog();
  };

  useModalFocusScope({ open: adding, containerRef: addDialogRef, onDismiss: closeAddDialog, layer: "global" });
  useModalFocusScope({ open: Boolean(editingProviderId), containerRef: editDialogRef, onDismiss: cancelEditDialog, layer: "global" });

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
    setEditingProviderId(null);
    setEditingSnapshot(null);
    setAdvancedProviderId(null);
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

  const saveDraft = (
    nextDraft: ProviderYamlInputEntry[] = draft,
    nextDefaultId = defaultId,
    nextCliBindings: CliProviderBindings = cliBindings,
    nextApiKeyKeys: Record<string, string> = apiKeyKeys
  ): boolean => {
    if (busy) return false;
    if (!nextDraft.length) { notify(m.settings.providerConfig.validation.atLeastOne, "info"); return false; }
    if (!nextDraft.some((entry) => entry.id === nextDefaultId)) { notify(m.settings.providerConfig.validation.defaultMissing, "info"); return false; }
    const incomplete = nextDraft.find((entry) => !entry.name.trim() || !entry.baseUrl.trim() || !entry.model.trim());
    if (incomplete) {
      notify(m.settings.providerConfig.validation.incomplete(incomplete.name || incomplete.id), "info");
      return false;
    }
    const providers = nextDraft.map((entry) => ({ ...entry, apiKey: nextApiKeyKeys[entry.id] ?? "" }));
    void onSave({ schemaVersion: 1, default: nextDefaultId, cli: nextCliBindings, providers });
    return true;
  };

  const setProviderEnabled = (id: string, enabled: boolean) => {
    const currentEntry = draft.find((entry) => entry.id === id);
    if (!currentEntry) return;
    const nextEntry = { ...currentEntry, enabled };
    const nextDraft = draft.map((entry) => entry.id === id ? nextEntry : entry);
    const nextCliBindings = {
      claude: cliBindings.claude === id && (!enabled || !supportsCliProvider("claude", nextEntry.protocol)) ? null : cliBindings.claude,
      codex: cliBindings.codex === id && (!enabled || !supportsCliProvider("codex", nextEntry.protocol)) ? null : cliBindings.codex
    };
    setDraft(nextDraft);
    setCliBindings(nextCliBindings);
    saveDraft(nextDraft, defaultId, nextCliBindings, apiKeyKeys);
  };

  const setProviderAsDefault = (id: string) => {
    setDefaultId(id);
    saveDraft(draft, id, cliBindings, apiKeyKeys);
  };

  const providerFromPreset = (nextPresetId: string): ProviderYamlInputEntry => {
    const preset = PROVIDER_PRESETS.find((item) => item.id === nextPresetId);
    const base = preset ?? { id: "custom", name: m.settings.providerConfig.custom, protocol: "openai-chat" as ProviderProtocol, authMode: "bearer" as ProviderAuthMode, baseUrl: "", model: "" };
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

  const openEditDialog = async (entry: ProviderYamlInputEntry) => {
    let apiKey = apiKeyKeys[entry.id];
    if (apiKey === undefined) {
      try {
        apiKey = await window.openmind.getProviderApiKey(entry.id);
      } catch {
        notify(m.settings.providerConfig.validation.apiKeyReadFailed, "error");
        return;
      }
    }
    setApiKeyKeys((current) => ({ ...current, [entry.id]: apiKey }));
    setEditingSnapshot({ entry: { ...entry }, apiKey, cliBindings: { ...cliBindings } });
    setEditingProviderId(entry.id);
    setAdvancedProviderId(null);
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
      notify(m.settings.providerConfig.validation.required, "info");
      return;
    }
    if (draft.some((item) => item.id === entry.id)) {
      notify(m.settings.providerConfig.validation.duplicateId, "info");
      return;
    }
    const nextDraft = [...draft, { ...entry, apiKey: "" }];
    const nextApiKeyKeys = { ...apiKeyKeys, [entry.id]: entry.apiKey };
    const nextDefaultId = defaultId || entry.id;
    setDraft(nextDraft);
    setApiKeyKeys(nextApiKeyKeys);
    setApiKeySetMap((current) => ({ ...current, [entry.id]: false }));
    setDefaultId(nextDefaultId);
    if (saveDraft(nextDraft, nextDefaultId, cliBindings, nextApiKeyKeys)) closeAddDialog();
  };

  const remove = (id: string) => {
    if (busy) return;
    if (draft.length <= 1) { notify(m.settings.providerConfig.validation.keepOne, "info"); return; }
    const survivors = draft.filter((entry) => entry.id !== id);
    const nextEnabledDefault = survivors.find((entry) => entry.enabled);
    if (defaultId === id && !nextEnabledDefault) {
      notify(m.settings.providerConfig.validation.enableAnother, "info");
      return;
    }
    const nextDefaultId = defaultId === id ? nextEnabledDefault!.id : defaultId;
    const nextCliBindings = {
      claude: cliBindings.claude === id ? null : cliBindings.claude,
      codex: cliBindings.codex === id ? null : cliBindings.codex
    };
    const nextApiKeyKeys = Object.fromEntries(Object.entries(apiKeyKeys).filter(([key]) => key !== id));
    setDraft(survivors);
    setDefaultId(nextDefaultId);
    setCliBindings(nextCliBindings);
    setApiKeyKeys(nextApiKeyKeys);
    setApiKeySetMap((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    if (editingProviderId === id) dismissEditDialog();
    saveDraft(survivors, nextDefaultId, nextCliBindings, nextApiKeyKeys);
  };

  const saveEditingProvider = () => {
    if (saveDraft()) dismissEditDialog();
  };

  const editingProvider = editingProviderId ? draft.find((entry) => entry.id === editingProviderId) ?? null : null;
  const editingAdvanced = Boolean(editingProvider && advancedProviderId === editingProvider.id);

  return (
    <>
      <SettingsPanel title={m.settings.providerConfig.title} scope={m.settings.providerConfig.count(draft.length)} variant="standard"
        action={<button type="button" className="settings-provider-add-button" data-motion="action" onClick={openAddDialog} disabled={busy} aria-label={m.settings.providerConfig.add}><Plus size={15} aria-hidden />{m.settings.providerConfig.add}</button>}>
        <p className="settings-note settings-provider-list-note">{m.settings.providerConfig.note}</p>
        <div className="settings-provider-config-list">
          {draft.length === 0 ? <p className="settings-note">{m.settings.providerConfig.empty}</p> : null}
          {draft.map((entry) => {
            const displayName = entry.name || entry.id;
            const apiKeyDrafted = Boolean((apiKeyKeys[entry.id] ?? "").trim());
            const apiKeyStatus = apiKeySetMap[entry.id] ? m.settings.providerConfig.apiKey.set : apiKeyDrafted ? m.settings.providerConfig.apiKey.pending : m.settings.providerConfig.apiKey.missing;
            const apiKeyState = apiKeySetMap[entry.id] ? "set" : apiKeyDrafted ? "pending" : "missing";
            return (
              <article key={entry.id} className="settings-provider-config-card" data-entrance-item>
                <header className="settings-provider-config-header">
                  <button type="button" className="settings-provider-config-summary" data-motion="disclosure" aria-haspopup="dialog"
                    aria-label={m.settings.providerConfig.editAria(displayName)} onClick={() => void openEditDialog(entry)} disabled={busy}>
                    <span className="settings-provider-config-identity">
                      <span className="settings-provider-config-title"><strong>{displayName}</strong>{entry.id === defaultId ? <StatusBadge tone="info">{m.settings.providerConfig.default}</StatusBadge> : null}</span>
                      <span className="settings-provider-config-meta"><code>{entry.protocol} · {entry.model || m.settings.providerConfig.noModel}</code><span data-state={apiKeyState}>{apiKeyStatus}</span></span>
                    </span>
                    <ChevronRight className="settings-provider-config-chevron" size={16} aria-hidden />
                  </button>
                  <div className="settings-provider-config-actions">
                    <ToggleSwitch checked={entry.enabled} disabled={busy || entry.id === defaultId} label={m.settings.providerConfig.enable(displayName)} onChange={(checked) => setProviderEnabled(entry.id, checked)} />
                    <div className="settings-provider-menu">
                      <DropdownMenu
                        ariaLabel={m.settings.providerConfig.more(entry.id)}
                        menuLabel={m.settings.providerConfig.menu(displayName)}
                        disabled={busy}
                        label={<span className="settings-provider-menu-trigger" data-motion="icon"><MoreHorizontal size={17} aria-hidden /></span>}
                      >
                        <button type="button" role="menuitem" data-motion="selection" aria-label={m.settings.providerConfig.setDefaultAria(entry.id)} onClick={() => setProviderAsDefault(entry.id)} disabled={busy || entry.id === defaultId || !entry.enabled}>{m.settings.providerConfig.setDefault}</button>
                        <button type="button" role="menuitem" className="settings-provider-menu-danger" data-motion="action" aria-label={m.settings.providerConfig.deleteAria(entry.id)} onClick={() => remove(entry.id)} disabled={busy}>{m.settings.providerConfig.delete}</button>
                      </DropdownMenu>
                    </div>
                  </div>
                </header>
              </article>
            );
          })}
        </div>
      </SettingsPanel>

      {adding && newProvider && typeof document !== "undefined" ? createPortal(
        <div ref={addDialogRef} className="modal-scrim settings-provider-dialog-scrim ui-overlay" data-focus-scope-backdrop onMouseDown={closeAddDialog}>
          <section className="settings-provider-dialog" role="dialog" aria-modal="true" aria-labelledby="add-provider-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>{m.settings.providerConfig.dialogEyebrow}</span><h2 id="add-provider-title">{m.settings.providerConfig.addTitle}</h2><p>{m.settings.providerConfig.addDescription}</p></div>
              <button type="button" className="settings-subtle-action" data-motion="icon" aria-label={m.settings.providerConfig.closeAdd} onClick={closeAddDialog}><X size={16} /></button>
            </header>
            <form onSubmit={addProvider}>
              <div className="settings-provider-dialog-body">
                <label className="settings-field settings-field--wide"><span>{m.settings.providerConfig.preset}</span>
                  <select className="settings-select" value={presetId} aria-label={m.settings.providerConfig.preset} onChange={(event) => changePreset(event.target.value)} autoFocus data-motion="selection">
                    {PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                    <option value="custom">{m.settings.providerConfig.custom}</option>
                  </select>
                  <small>{m.settings.providerConfig.presetHint}</small>
                </label>
                <div className="settings-grid-2">
                  <label className="settings-field"><span>ID</span><input className="settings-browser-path-input" value={newProvider.id} required onChange={(event) => setNewProvider({ ...newProvider, id: event.target.value })} /></label>
                  <label className="settings-field"><span>{m.settings.providerConfig.fields.name}</span><input className="settings-browser-path-input" value={newProvider.name} required onChange={(event) => setNewProvider({ ...newProvider, name: event.target.value })} /></label>
                  <label className="settings-field"><span>Base URL</span><input className="settings-browser-path-input" type="url" value={newProvider.baseUrl} required placeholder="https://api.example.com" onChange={(event) => setNewProvider({ ...newProvider, baseUrl: event.target.value })} /></label>
                  <label className="settings-field"><span>{m.settings.providerConfig.fields.model}</span><input className="settings-browser-path-input" value={newProvider.model} required placeholder={m.settings.providerConfig.modelPlaceholder} onChange={(event) => setNewProvider({ ...newProvider, model: event.target.value })} /></label>
                  <label className="settings-field"><span>{m.settings.providerConfig.fields.protocol}</span>
                    <select className="settings-select" value={newProvider.protocol} onChange={(event) => setNewProvider({ ...newProvider, protocol: event.target.value as ProviderProtocol })} data-motion="selection">
                      <option value="anthropic-messages">anthropic-messages</option>
                      <option value="openai-chat">openai-chat</option>
                      <option value="openai-responses">openai-responses</option>
                    </select>
                  </label>
                  <label className="settings-field"><span>{m.settings.providerConfig.fields.authMode}</span>
                    <select className="settings-select" value={newProvider.authMode} onChange={(event) => setNewProvider({ ...newProvider, authMode: event.target.value as ProviderAuthMode })}>
                      <option value="bearer">Bearer Token</option>
                      <option value="x-api-key">X-API-Key</option>
                    </select>
                  </label>
                  <label className="settings-field"><span>{m.settings.providerConfig.fields.apiKey}</span><input className="settings-browser-path-input settings-provider-api-key-input" type="text" value={newProvider.apiKey} required placeholder={m.settings.providerConfig.apiKeyPlaceholder} autoComplete="off" spellCheck={false} onChange={(event) => setNewProvider({ ...newProvider, apiKey: event.target.value })} /></label>
                </div>
              </div>
              <footer><button type="button" className="settings-subtle-action" data-motion="action" onClick={closeAddDialog}>{m.settings.providerConfig.cancel}</button><button type="submit" className="primary-button"><Plus size={14} />{m.settings.providerConfig.addToList}</button></footer>
            </form>
          </section>
        </div>,
        document.body
      ) : null}

      {editingProvider && typeof document !== "undefined" ? createPortal(
        <div ref={editDialogRef} className="modal-scrim settings-provider-dialog-scrim ui-overlay" data-focus-scope-backdrop onMouseDown={cancelEditDialog}>
          <section className="settings-provider-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-provider-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>{m.settings.providerConfig.dialogEyebrow}</span><h2 id="edit-provider-title">{m.settings.providerConfig.editTitle(editingProvider.name || editingProvider.id)}</h2><p>{m.settings.providerConfig.editDescription}</p></div>
              <button type="button" className="settings-subtle-action" data-motion="icon" aria-label={m.settings.providerConfig.cancelEdit(editingProvider.name || editingProvider.id)} onClick={cancelEditDialog}><X size={16} /></button>
            </header>
            <form onSubmit={(event) => { event.preventDefault(); saveEditingProvider(); }}>
              <div className="settings-provider-dialog-body">
                <div className="settings-grid-2">
                  <label className="settings-field"><span>{m.settings.providerConfig.fields.name}</span><input className="settings-browser-path-input" value={editingProvider.name} onChange={(event) => update(editingProvider.id, { name: event.target.value })} autoFocus /></label>
                  <label className="settings-field"><span>{m.settings.providerConfig.fields.model}</span><input className="settings-browser-path-input" value={editingProvider.model} onChange={(event) => update(editingProvider.id, { model: event.target.value })} /></label>
                  <label className="settings-field settings-field--wide"><span>Base URL</span><input className="settings-browser-path-input" type="url" value={editingProvider.baseUrl} onChange={(event) => update(editingProvider.id, { baseUrl: event.target.value })} placeholder="https://api.example.com" /></label>
                  <label className="settings-field settings-field--wide"><span>API Key</span>
                    <input className="settings-browser-path-input settings-provider-api-key-input" type="text" value={apiKeyKeys[editingProvider.id] ?? ""}
                      placeholder={m.settings.providerConfig.unset} autoComplete="off" spellCheck={false}
                      onChange={(event) => updateKey(editingProvider.id, event.target.value)} />
                  </label>
                </div>
                <button type="button" className="settings-provider-advanced-trigger" data-motion="disclosure" aria-expanded={editingAdvanced} aria-controls={`provider-advanced-${editingProvider.id}`}
                  onClick={() => setAdvancedProviderId((current) => current === editingProvider.id ? null : editingProvider.id)}>
                  <span><strong>{m.settings.providerConfig.advanced}</strong><small>{m.settings.providerConfig.advancedDescription}</small></span><ChevronDown size={16} aria-hidden />
                </button>
                {editingAdvanced ? <div className="settings-provider-advanced-grid" id={`provider-advanced-${editingProvider.id}`}>
                  <label className="settings-field"><span>ID</span><input className="settings-browser-path-input" value={editingProvider.id} readOnly title={m.settings.providerConfig.idImmutable} /></label>
                  <label className="settings-field"><span>{m.settings.providerConfig.fields.protocol}</span>
                    <select className="settings-select" value={editingProvider.protocol} onChange={(event) => update(editingProvider.id, { protocol: event.target.value as ProviderProtocol })} data-motion="selection">
                      <option value="anthropic-messages">anthropic-messages</option>
                      <option value="openai-chat">openai-chat</option>
                      <option value="openai-responses">openai-responses</option>
                    </select>
                  </label>
                  <label className="settings-field"><span>{m.settings.providerConfig.fields.authMode}</span>
                    <select className="settings-select" value={editingProvider.authMode} onChange={(event) => update(editingProvider.id, { authMode: event.target.value as ProviderAuthMode })}>
                      <option value="bearer">Bearer Token</option>
                      <option value="x-api-key">X-API-Key</option>
                    </select>
                  </label>
                </div> : null}
              </div>
              <footer>
                <button type="button" className="settings-subtle-action" data-motion="action" onClick={cancelEditDialog}>{m.settings.providerConfig.cancel}</button>
                <button type="submit" className="primary-button" disabled={busy}>{busy ? m.settings.providerConfig.saving : m.settings.providerConfig.save}</button>
              </footer>
            </form>
          </section>
        </div>,
        document.body
      ) : null}
    </>
  );
}

function SettingsPanel({ title, scope, action, variant = "standard", children }: { title: string; scope: string; action?: ReactNode; variant?: "standard" | "resource" | "mcp"; children: ReactNode }) {
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
  if (value < 60_000) return m.settings.duration.seconds(Math.round(value / 1000));
  const minutes = value / 60_000;
  return m.settings.duration.minutes(Number.isInteger(minutes) ? minutes : minutes.toFixed(1));
}

function formatInterval(value: number): string {
  return value < 60_000 ? m.settings.duration.seconds(value / 1000) : m.settings.duration.minutes(value / 60_000);
}
