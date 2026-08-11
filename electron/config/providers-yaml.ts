import fs from "node:fs";
import path from "node:path";
import { findRepoRoot } from "../lib/settings";
import { writeTextAtomic } from "../lib/fs-utils";
import {
  PROVIDERS_YAML_SCHEMA_VERSION,
  ProviderYamlEntrySchema,
  ProvidersYamlInputSchema,
  ProvidersYamlSchema,
  processProviderEnvironment,
  type ProviderYamlEntry,
  type ProviderYamlView,
  type ProvidersYaml,
  type ProvidersYamlInput
} from "../../shared/providers-yaml";

/**
 * Electron-side file + repository layer for the plaintext
 * `config/providers.yaml` provider source of truth. The pure schemas/types
 * live in `shared/providers-yaml.ts` (importable from the Renderer); this
 * module owns `fs` access, the repo-root path, atomic writes and the
 * `CCTOOLS_PROVIDER_*` env resolution consumed by the Execution Broker.
 *
 * Both execution paths — desktop Broker (here) and crontab Python (reads the
 * same YAML directly) — resolve to the same provider. See
 * `docs/providers-yaml-migration.md`.
 */

// js-yaml is an Electron-side dependency; load it lazily so the module stays
// free of top-level side effects (mirrors skill-package-service.ts).
type YamlLoader = { load(input: string, options?: Record<string, unknown>): unknown; dump(value: unknown, options?: Record<string, unknown>): string };
const yaml = require("js-yaml") as YamlLoader;

/** Absolute path to `config/providers.yaml` inside the repo root. */
export function providersYamlPath(): string {
  return path.join(findRepoRoot(), "config", "providers.yaml");
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
  } catch (error) {
    throw new Error(`config/providers.yaml 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const result = ProvidersYamlSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`config/providers.yaml 校验失败：${result.error.issues.map((issue) => issue.path.join(".") || issue.message).join("; ")}`);
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

/** Serialize and persist the full providers document (atomic write + 0600). */
export function writeProvidersYaml(value: ProvidersYaml): void {
  const filePath = providersYamlPath();
  const serialized = yaml.dump(value, { lineWidth: 120, noRefs: true });
  writeTextAtomic(filePath, serialized);
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
  const previous = readProvidersYaml();
  const previousKeys = new Map((previous?.providers ?? []).map((provider) => [provider.id, provider.apiKey]));
  const providers: ProviderYamlEntry[] = parsed.providers.map((entry) => {
    const apiKey = entry.apiKey.trim() || previousKeys.get(entry.id) || "";
    if (!apiKey) throw new Error(`Provider ${entry.id} 缺少 apiKey，且历史配置中没有可保留的旧 Key。`);
    return ProviderYamlEntrySchema.parse({ ...entry, apiKey });
  });
  if (!providers.some((provider) => provider.id === parsed.default)) {
    throw new Error(`default 指向不存在的 provider：${parsed.default}`);
  }
  const document: ProvidersYaml = { schemaVersion: PROVIDERS_YAML_SCHEMA_VERSION, default: parsed.default, providers };
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
    nextDefault = (firstEnabled ?? survivors[0]).id;
  }
  const document: ProvidersYaml = { schemaVersion: PROVIDERS_YAML_SCHEMA_VERSION, default: nextDefault, providers: survivors };
  writeProvidersYaml(document);
  return document;
}

/** Return a UI-safe view (apiKey replaced by `apiKeySet`). Empty document when no file exists. */
export function listProvidersForUi(): { schemaVersion: typeof PROVIDERS_YAML_SCHEMA_VERSION; default: string; providers: ProviderYamlView[] } {
  const current = readProvidersYaml();
  if (!current) {
    return { schemaVersion: PROVIDERS_YAML_SCHEMA_VERSION, default: "", providers: [] };
  }
  return {
    schemaVersion: current.schemaVersion,
    default: current.default,
    providers: current.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      enabled: provider.enabled,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      model: provider.model,
      proxyUrl: provider.proxyUrl,
      proxyPolicy: provider.proxyPolicy,
      tlsPolicy: provider.tlsPolicy,
      apiKeySet: Boolean(provider.apiKey)
    }))
  };
}
