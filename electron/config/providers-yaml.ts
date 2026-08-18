import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { findRepoRoot, resolveWorkspaceRoot } from "../lib/settings";
import { writeTextAtomic } from "../lib/fs-utils";
import {
  PROVIDERS_YAML_SCHEMA_VERSION,
  ProviderYamlEntrySchema,
  supportsCliProvider,
  ProvidersYamlInputSchema,
  ProvidersYamlSchema,
  processProviderEnvironment,
  type CliProviderBindings,
  type ProviderYamlEntry,
  type ProvidersYaml,
  type ProvidersYamlInput,
  type ProvidersYamlView
} from "../../shared/providers-yaml";

/**
 * Electron-side file + repository layer for the plaintext
 * `config/providers.yaml` provider source of truth. The pure schemas/types
 * live in `shared/providers-yaml.ts` (importable from the Renderer); this
 * module owns `fs` access, the repo-root path, atomic writes and the
 * `CCTOOLS_PROVIDER_*` env resolution consumed by the Execution Broker.
 *
 * Both execution paths — desktop Broker (here) and crontab Python (reads the
 * same YAML directly) — resolve to the same provider.
 */

// js-yaml is an Electron-side dependency; load it lazily so the module stays
// free of top-level side effects (mirrors skill-package-service.ts).
type YamlLoader = { load(input: string, options?: Record<string, unknown>): unknown; dump(value: unknown, options?: Record<string, unknown>): string };
const yaml = require("js-yaml") as YamlLoader;

/** Absolute path to `config/providers.yaml` inside the active code workspace. */
export function providersYamlPath(): string {
  // Provider config belongs to the AI/code workspace, not the independently
  // selectable mymind content root (ADR-001).
  return path.join(resolveWorkspaceRoot() || findRepoRoot(), "config", "providers.yaml");
}

/**
 * Read and validate the providers file. Returns `null` when the file is
 * absent (legitimate "not configured yet" state, mirrors the Python reader
 * which returns `None`). Throws on a present-but-corrupt file so a malformed
 * config is never silently ignored.
 */
export function readProvidersYaml(): ProvidersYaml | null {
  const filePath = providersYamlPath();
  if (!fs.existsSync(filePath)) return null;
  let parsed: unknown;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, "utf8"), { json: true });
  } catch {
    // js-yaml diagnostics can echo nearby source lines, including apiKey.
    throw new Error("config/providers.yaml 解析失败。请在设置中重新保存完整配置，或手动修复 YAML。");
  }
  const result = ProvidersYamlSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues.map((issue) => {
      const location = issue.path.join(".");
      return location ? `${location}: ${issue.message}` : issue.message;
    }).join("; ");
    throw new Error(`config/providers.yaml 校验失败：${details}`);
  }
  return result.data;
}

/**
 * Resolve the active default provider into the 7 `CCTOOLS_PROVIDER_*` env vars
 * consumed by both the Broker-injected Python process and the legacy direct
 * spawn path. Returns empty env / empty apiKey when no file is configured so
 * that non-AI skills and tests still resolve. Throws when the configured
 * default is disabled or refers to a missing provider.
 */
export function readDefaultProviderEnv(): { env: Record<string, string>; apiKey: string } {
  const config = readProvidersYaml();
  if (!config) return { env: {}, apiKey: "" };
  const byId = new Map(config.providers.map((provider) => [provider.id, provider]));
  const defaultEntry = byId.get(config.default);
  if (!defaultEntry) {
    throw new Error(`config/providers.yaml 的 default 指向不存在的 provider：${config.default}`);
  }
  if (!defaultEntry.enabled) {
    throw new Error(`config/providers.yaml 的 default provider 已禁用：${config.default}`);
  }
  return { env: processProviderEnvironment(defaultEntry), apiKey: defaultEntry.apiKey };
}

/**
 * Resolve the API profile used by a Claude Code/Codex CLI session.
 *
 * - `requestedId === undefined`: use the current top-level `cli` binding.
 * - `requestedId === null`: explicitly use the CLI's own login/configuration.
 * - a string: resolve the profile frozen into an existing desktop session.
 */
export function resolveCliProvider(
  kind: keyof CliProviderBindings,
  requestedId?: string | null,
  expectedRevision?: string | null
): ProviderYamlEntry | null {
  if (requestedId === null) return null;
  if (requestedId !== undefined && expectedRevision == null) {
    throw new Error(`${kind} 会话缺少 Provider 配置指纹，请新建会话后重试。`);
  }
  const config = readProvidersYaml();
  if (!config) {
    if (requestedId !== undefined) {
      throw new Error(`${kind} 绑定的 Provider 不存在：${requestedId}`);
    }
    return null;
  }
  const id = requestedId === undefined ? config.cli[kind] : requestedId;
  if (!id) return null;
  const provider = config.providers.find((entry) => entry.id === id);
  if (!provider) throw new Error(`${kind} 绑定的 Provider 不存在：${id}`);
  if (!provider.enabled) throw new Error(`${kind} 绑定的 Provider 已停用：${id}`);
  if (!supportsCliProvider(kind, provider.protocol)) {
    throw new Error(kind === "claude"
      ? "Claude Code 只能绑定 anthropic-messages Provider。"
      : "Codex CLI 只能绑定 openai-responses Provider。");
  }
  if (provider.tlsPolicy !== "verify") {
    throw new Error(`${kind === "claude" ? "Claude Code" : "Codex CLI"} 托管 Provider 仅支持 tlsPolicy: verify。`);
  }
  // Explicitly requested providers come from persisted sessions. A revision
  // is mandatory so legacy or partially migrated sessions cannot resume on a
  // newly created profile that happens to reuse the same id.
  if (expectedRevision !== undefined && providerConfigurationRevision(provider) !== expectedRevision) {
    throw new Error(`${kind} 会话绑定的 Provider 配置已变更：${id}。为避免把旧会话发送到不同服务，请新建会话。`);
  }
  return provider;
}

/** Stable, non-secret fingerprint of every routing-relevant provider field. */
export function providerConfigurationRevision(provider: ProviderYamlEntry): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: provider.id,
    protocol: provider.protocol,
    authMode: provider.authMode,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl.replace(/\/+$/, ""),
    model: provider.model,
    proxyUrl: provider.proxyUrl,
    proxyPolicy: provider.proxyPolicy,
    tlsPolicy: provider.tlsPolicy
  })).digest("hex");
}

/** Serialize and persist the full providers document (atomic write + 0600). */
export function writeProvidersYaml(value: ProvidersYaml): void {
  const filePath = providersYamlPath();
  const serialized = yaml.dump(value, { lineWidth: 120, noRefs: true });
  writeTextAtomic(filePath, serialized, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* Windows may not expose POSIX modes. */
  }
}

/**
 * Save from UI input. Entries whose `apiKey` is empty keep the previously
 * stored plaintext key (the UI never reads it back), so users can edit
 * non-secret fields without re-typing the secret.
 */
export function saveProvidersFromInput(input: ProvidersYamlInput): ProvidersYaml {
  const parsed = ProvidersYamlInputSchema.parse(input);
  let previous: ProvidersYaml | null = null;
  try {
    previous = readProvidersYaml();
  } catch {
    // A corrupt file is recoverable from the UI only when every replacement
    // entry supplies a fresh key; no secret can be safely recovered from it.
    if (parsed.providers.some((provider) => !provider.apiKey.trim())) {
      throw new Error("原 config/providers.yaml 已损坏。请为所有 Provider 重新输入 API Key 后保存完整配置。");
    }
  }
  const previousKeys = new Map((previous?.providers ?? []).map((provider) => [provider.id, provider.apiKey]));
  const providers: ProviderYamlEntry[] = parsed.providers.map((entry) => {
    const apiKey = entry.apiKey.trim() || previousKeys.get(entry.id) || "";
    if (!apiKey) throw new Error(`Provider ${entry.id} 缺少 apiKey，且历史配置中没有可保留的旧 Key。`);
    return ProviderYamlEntrySchema.parse({ ...entry, apiKey });
  });
  if (!providers.some((provider) => provider.id === parsed.default)) {
    throw new Error(`default 指向不存在的 provider：${parsed.default}`);
  }
  const document: ProvidersYaml = {
    schemaVersion: PROVIDERS_YAML_SCHEMA_VERSION,
    default: parsed.default,
    cli: parsed.cli,
    providers
  };
  // Validate cross-field CLI bindings after old keys have been restored.
  ProvidersYamlSchema.parse(document);
  writeProvidersYaml(document);
  return document;
}

/** Remove a provider by id; if it was the default, repoint default to the first enabled survivor. */
export function deleteProviderEntry(id: string): ProvidersYaml {
  const current = readProvidersYaml();
  if (!current) throw new Error("config/providers.yaml 尚未创建，无法删除 provider。");
  const survivors = current.providers.filter((provider) => provider.id !== id);
  if (survivors.length === current.providers.length) return current;
  if (survivors.length === 0) throw new Error("config/providers.yaml 至少需要保留一个 provider。");
  let nextDefault = current.default;
  if (nextDefault === id) {
    const firstEnabled = survivors.find((provider) => provider.enabled);
    if (!firstEnabled) throw new Error("删除后将没有可用的默认 Provider；请先启用另一个 Provider。");
    nextDefault = firstEnabled.id;
  }
  const document: ProvidersYaml = {
    schemaVersion: PROVIDERS_YAML_SCHEMA_VERSION,
    default: nextDefault,
    cli: {
      claude: current.cli.claude === id ? null : current.cli.claude,
      codex: current.cli.codex === id ? null : current.cli.codex
    },
    providers: survivors
  };
  writeProvidersYaml(document);
  return document;
}

/** Return a UI-safe view (apiKey replaced by `apiKeySet`). Empty document when no file exists. */
export function listProvidersForUi(): ProvidersYamlView {
  const current = readProvidersYaml();
  if (!current) {
    return {
      schemaVersion: PROVIDERS_YAML_SCHEMA_VERSION,
      default: "",
      cli: { claude: null, codex: null },
      providers: []
    };
  }
  return {
    schemaVersion: current.schemaVersion,
    default: current.default,
    cli: current.cli,
    providers: current.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      enabled: provider.enabled,
      protocol: provider.protocol,
      authMode: provider.authMode,
      baseUrl: provider.baseUrl,
      model: provider.model,
      proxyUrl: provider.proxyUrl,
      proxyPolicy: provider.proxyPolicy,
      tlsPolicy: provider.tlsPolicy,
      apiKeySet: Boolean(provider.apiKey)
    }))
  };
}
