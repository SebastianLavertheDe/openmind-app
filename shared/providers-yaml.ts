import { z } from "zod";
import { ImageCapabilitySchema } from "./image-generation";
import { messages } from "./messages";

/**
 * Pure schema + types for the plaintext `config/providers.yaml` provider
 * source of truth. This module is dependency-free (no `fs`, no Electron) so
 * it can be imported from both the Electron main process (which adds the
 * file/repository layer in `electron/config/providers-yaml.ts`) and the
 * Renderer (via `shared/contracts.ts`) and the IPC contract surface.
 */

export const PROVIDERS_YAML_SCHEMA_VERSION = 1 as const;

const IdentifierSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { error: () => messages.providerUi.validation.identifier });

export const ProviderProtocolSchema = z.enum([
  "openai-chat",
  "openai-responses",
  "anthropic-messages"
]);
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

export const ProxyPolicySchema = z.enum(["system", "disabled", "explicit"]);
export type ProxyPolicy = z.infer<typeof ProxyPolicySchema>;

export const TlsPolicySchema = z.enum(["verify", "allow-insecure"]);
export type TlsPolicy = z.infer<typeof TlsPolicySchema>;

export const ProviderAuthModeSchema = z.enum(["bearer", "x-api-key"]);
export type ProviderAuthMode = z.infer<typeof ProviderAuthModeSchema>;

/**
 * Which managed API profile each CLI bridge should use. `null` keeps the
 * corresponding CLI's own login/configuration. The binding is stored beside
 * the profiles so `config/providers.yaml` remains the single source of truth.
 */
export const CliProviderBindingsSchema = z.object({
  claude: IdentifierSchema.nullable().default(null),
  codex: IdentifierSchema.nullable().default(null)
}).strict().default({ claude: null, codex: null });
export type CliProviderBindings = z.infer<typeof CliProviderBindingsSchema>;

/**
 * One provider entry inside `config/providers.yaml`. `apiKey` is stored in
 * plaintext alongside the non-secret knobs — same threat model as the legacy
 * per-skill `.env` files, now collapsed to one file.
 */
const ProviderYamlEntryObjectSchema = z.object({
  id: IdentifierSchema,
  name: z.string().trim().min(1).max(160),
  enabled: z.boolean().default(true),
  protocol: ProviderProtocolSchema,
  /** Header style used by CLI bridges; generic Process Skills keep their existing protocol adapter. */
  authMode: ProviderAuthModeSchema.default("bearer"),
  apiKey: z.string().min(1).max(2048),
  baseUrl: z.string().trim().min(1).max(2048).refine((value) => isSafeBaseUrl(value), {
    error: () => messages.providerUi.validation.baseUrl
  }),
  model: z.string().trim().min(1).max(200),
  /** Image understanding alone does not grant image-generation capability. */
  imageGeneration: ImageCapabilitySchema.nullable().optional(),
  proxyUrl: z.string().trim().max(2048).default("").refine((value) => !value || isSafeProxyUrl(value), {
    error: () => messages.providerUi.validation.proxyUrl
  }),
  proxyPolicy: ProxyPolicySchema.default("system"),
  tlsPolicy: TlsPolicySchema.default("verify")
}).strict();

export const ProviderYamlEntrySchema = ProviderYamlEntryObjectSchema.superRefine(validateProviderProxy);
export type ProviderYamlEntry = z.infer<typeof ProviderYamlEntrySchema>;

export const ProvidersYamlSchema = z.object({
  schemaVersion: z.literal(PROVIDERS_YAML_SCHEMA_VERSION),
  default: IdentifierSchema,
  cli: CliProviderBindingsSchema.optional().default({ claude: null, codex: null }),
  providers: z.array(ProviderYamlEntrySchema).min(1)
}).strict().superRefine(validateProvidersDocument);
export type ProvidersYaml = z.infer<typeof ProvidersYamlSchema>;

/**
 * Save input: `apiKey` may be empty to mean "keep the previously stored key"
 * (the UI never reads the plaintext key back). Validation of a non-empty key
 * still applies.
 */
export const ProviderYamlInputEntrySchema = ProviderYamlEntryObjectSchema.omit({ apiKey: true }).extend({
  apiKey: z.string().max(2048)
}).superRefine(validateProviderProxy);
export type ProviderYamlInputEntry = z.infer<typeof ProviderYamlInputEntrySchema>;

export const ProvidersYamlInputSchema = z.object({
  schemaVersion: z.literal(PROVIDERS_YAML_SCHEMA_VERSION),
  default: IdentifierSchema,
  cli: CliProviderBindingsSchema.optional().default({ claude: null, codex: null }),
  providers: z.array(ProviderYamlInputEntrySchema).min(1)
}).strict().superRefine(validateProvidersDocument);
export type ProvidersYamlInput = z.infer<typeof ProvidersYamlInputSchema>;

/** UI view of a provider: never exposes the plaintext apiKey. */
export const ProviderYamlViewSchema = ProviderYamlEntryObjectSchema.omit({ apiKey: true }).extend({
  apiKeySet: z.boolean()
}).superRefine(validateProviderProxy);
export type ProviderYamlView = z.infer<typeof ProviderYamlViewSchema>;

/** Top-level UI document returned by `getProviders()`. */
export const ProvidersYamlViewSchema = z.object({
  schemaVersion: z.literal(PROVIDERS_YAML_SCHEMA_VERSION),
  default: z.string(),
  cli: CliProviderBindingsSchema.optional().default({ claude: null, codex: null }),
  providers: z.array(ProviderYamlViewSchema)
});
export type ProvidersYamlView = z.infer<typeof ProvidersYamlViewSchema>;

/**
 * Built-in presets for the UI "add provider" flow. Selecting one pre-fills
 * protocol / baseUrl / model; the user only supplies the apiKey.
 */
export interface ProviderPreset {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  authMode: ProviderAuthMode;
  baseUrl: string;
  model: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "deepseek", get name() { return messages.providerUi.providerNames.deepseek; }, protocol: "anthropic-messages", authMode: "bearer", baseUrl: "https://api.deepseek.com/anthropic", model: "deepseek-v4-flash" },
  { id: "anthropic", get name() { return messages.providerUi.providerNames.anthropic; }, protocol: "anthropic-messages", authMode: "x-api-key", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-6" },
  { id: "glm", get name() { return messages.providerUi.providerNames.glm; }, protocol: "anthropic-messages", authMode: "bearer", baseUrl: "https://open.bigmodel.cn/api/anthropic", model: "glm-5.2[1m]" },
  { id: "doubao", get name() { return messages.providerUi.providerNames.doubao; }, protocol: "openai-chat", authMode: "bearer", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-pro-32k" },
  { id: "openai", get name() { return messages.providerUi.providerNames.openai; }, protocol: "openai-chat", authMode: "bearer", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "openai-responses", get name() { return messages.providerUi.providerNames.openaiCodex; }, protocol: "openai-responses", authMode: "bearer", baseUrl: "https://api.openai.com/v1", model: "gpt-5.3-codex" },
  { id: "gemini", get name() { return messages.providerUi.providerNames.gemini; }, protocol: "openai-chat", authMode: "bearer", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" }
];

export function supportsCliProvider(
  kind: keyof CliProviderBindings,
  protocol: ProviderProtocol
): boolean {
  // Claude Code consumes the Anthropic Messages shape. Current Codex CLI
  // custom model providers support the Responses wire API only.
  return kind === "claude"
    ? protocol === "anthropic-messages"
    : protocol === "openai-responses";
}

/**
 * The 7-var `OPENMIND_PROVIDER_*` output contract, shared by the desktop
 * Broker path and the Python `_resolve_bound_provider()` reader. Kept stable
 * so the two execution paths stay identical.
 */
export function processProviderEnvironment(entry: ProviderYamlEntry): Record<string, string> {
  return {
    OPENMIND_PROVIDER_API_KEY: entry.apiKey,
    OPENMIND_PROVIDER_BASE_URL: providerEndpoint(entry.baseUrl, entry.protocol),
    OPENMIND_PROVIDER_MODEL: entry.model,
    OPENMIND_PROVIDER_PROTOCOL: entry.protocol,
    OPENMIND_PROVIDER_PROXY_URL: entry.proxyUrl || "",
    OPENMIND_PROVIDER_PROXY_POLICY: entry.proxyPolicy,
    OPENMIND_PROVIDER_TLS_POLICY: entry.tlsPolicy
  };
}

/** Append the protocol-specific request path to the base URL (idempotent). */
export function providerEndpoint(baseUrl: string, protocol: ProviderProtocol): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (protocol === "anthropic-messages") {
    if (base.endsWith("/messages")) return base;
    return `${base.endsWith("/v1") ? base : `${base}/v1`}/messages`;
  }
  if (protocol === "openai-responses") return base.endsWith("/responses") ? base : `${base}/responses`;
  if (protocol === "openai-chat") return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  return base;
}

function isSafeBaseUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (!url.hostname || url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function isSafeProxyUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return (url.protocol === "http:" || url.protocol === "https:")
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && url.pathname === "/"
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || host === "127.0.0.1" || host.startsWith("127.");
}

function validateProviderProxy(
  value: { proxyPolicy: ProxyPolicy; proxyUrl: string },
  context: z.RefinementCtx
): void {
  if (value.proxyPolicy === "explicit" && !value.proxyUrl) {
    context.addIssue({
      code: "custom",
      path: ["proxyUrl"],
      message: messages.providerUi.validation.explicitProxyRequired
    });
  }
}

function validateProvidersDocument(
  value: { default: string; cli: CliProviderBindings; providers: Array<{ id: string; enabled: boolean; protocol: ProviderProtocol; tlsPolicy: TlsPolicy }> },
  context: z.RefinementCtx
): void {
  const ids = new Set<string>();
  value.providers.forEach((provider, index) => {
    if (ids.has(provider.id)) {
      context.addIssue({ code: "custom", path: ["providers", index, "id"], message: messages.providerUi.validation.duplicateId(provider.id) });
    }
    ids.add(provider.id);
  });
  const defaultProvider = value.providers.find((provider) => provider.id === value.default);
  if (!defaultProvider) {
    context.addIssue({ code: "custom", path: ["default"], message: messages.providerUi.validation.defaultMissing(value.default) });
  } else if (!defaultProvider.enabled) {
    context.addIssue({ code: "custom", path: ["default"], message: messages.providerUi.validation.defaultDisabled(value.default) });
  }
  for (const kind of ["claude", "codex"] as const) {
    const id = value.cli[kind];
    if (!id) continue;
    const provider = value.providers.find((entry) => entry.id === id);
    if (!provider) {
      context.addIssue({
        code: "custom",
        path: ["cli", kind],
        message: messages.providerUi.validation.bindingMissing(kind, id)
      });
      continue;
    }
    if (!provider.enabled) {
      context.addIssue({
        code: "custom",
        path: ["cli", kind],
        message: messages.providerUi.validation.bindingDisabled(kind, id)
      });
    } else if (!supportsCliProvider(kind, provider.protocol)) {
      context.addIssue({
        code: "custom",
        path: ["cli", kind],
        message: kind === "claude"
          ? messages.providerUi.validation.claudeProtocol
          : messages.providerUi.validation.codexProtocol
      });
    } else if (provider.tlsPolicy !== "verify") {
      context.addIssue({
        code: "custom",
        path: ["cli", kind],
        message: messages.providerUi.validation.managedTls(kind === "claude" ? "Claude Code" : "Codex CLI")
      });
    }
  }
}
