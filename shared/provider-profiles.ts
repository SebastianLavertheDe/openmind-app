import { z } from "zod";

export const PROVIDER_PROFILE_SCHEMA_VERSION = 1 as const;
export const CREDENTIAL_SCHEMA_VERSION = 1 as const;

const IdentifierSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "标识只能包含字母、数字、点、下划线和连字符。");

export const CredentialKindSchema = z.enum([
  "api-key",
  "token",
  "password",
  "cookie",
  "credential-file",
  "oauth-refresh-token",
  "client-certificate",
  "session-only"
]);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

export const CredentialScopeSchema = z.object({
  publisherId: IdentifierSchema,
  skillId: IdentifierSchema,
  version: z.string().trim().min(1).max(120),
  digest: z.string().trim().regex(/^[a-f0-9]{64}$/i)
}).strict();
export type CredentialScope = z.infer<typeof CredentialScopeSchema>;

export const CredentialStatusSchema = z.enum(["active", "revoked"]);
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;

export const CredentialMetadataSchema = z.object({
  schemaVersion: z.literal(CREDENTIAL_SCHEMA_VERSION),
  id: IdentifierSchema,
  label: z.string().trim().min(1).max(160),
  kind: CredentialKindSchema,
  scope: CredentialScopeSchema.nullable(),
  status: CredentialStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();
export type CredentialMetadata = z.infer<typeof CredentialMetadataSchema>;

export const CredentialSetInputSchema = z.object({
  id: IdentifierSchema.optional(),
  label: z.string().trim().min(1).max(160),
  kind: CredentialKindSchema,
  secret: z.string().min(1).max(1024 * 1024),
  scope: CredentialScopeSchema.optional()
}).strict();
export type CredentialSetInput = z.infer<typeof CredentialSetInputSchema>;

export const CredentialVaultStatusSchema = z.object({
  available: z.boolean(),
  backend: z.enum(["safeStorage", "unavailable"]),
  credentials: z.array(CredentialMetadataSchema)
}).strict();
export type CredentialVaultStatus = z.infer<typeof CredentialVaultStatusSchema>;

export const CredentialTestResultSchema = z.object({
  id: IdentifierSchema,
  ok: z.boolean(),
  status: z.enum(["available", "missing", "revoked", "unavailable", "corrupt"]),
  diagnostic: z.string().max(500)
}).strict();
export type CredentialTestResult = z.infer<typeof CredentialTestResultSchema>;

export const ProviderProtocolSchema = z.enum([
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "provider-native"
]);
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

export const ProxyPolicySchema = z.enum(["system", "disabled", "explicit"]);
export type ProxyPolicy = z.infer<typeof ProxyPolicySchema>;

export const TlsPolicySchema = z.enum(["verify", "allow-insecure"]);
export type TlsPolicy = z.infer<typeof TlsPolicySchema>;

/** Non-secret knobs which are safe to persist with a Provider Profile. */
export const ProviderOptionsSchema = z.object({
  organization: z.string().trim().max(200).optional(),
  project: z.string().trim().max(200).optional(),
  anthropicVersion: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  apiVersion: z.string().trim().max(80).optional()
}).strict();
export type ProviderOptions = z.infer<typeof ProviderOptionsSchema>;

export const ProviderTestStateSchema = z.object({
  status: z.enum(["never", "success", "failed"]),
  testedAt: z.string().datetime().nullable(),
  diagnostic: z.string().max(500).nullable()
}).strict();
export type ProviderTestState = z.infer<typeof ProviderTestStateSchema>;

const ProviderProfileObjectSchema = z.object({
  schemaVersion: z.literal(PROVIDER_PROFILE_SCHEMA_VERSION),
  id: IdentifierSchema,
  name: z.string().trim().min(1).max(160),
  protocol: ProviderProtocolSchema,
  credentialId: IdentifierSchema.nullable(),
  baseUrl: z.string().trim().max(2048).refine((value) => !value || isSafeBaseUrl(value), {
    message: "Base URL 必须是无凭据的 HTTPS URL；HTTP 仅允许 localhost/loopback。"
  }),
  proxyUrl: z.string().trim().max(2048).optional().refine((value) => !value || isSafeProxyUrl(value), {
    message: "Proxy URL 必须是无凭据的 HTTP(S) URL。"
  }),
  model: z.string().trim().max(200),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  maxRetries: z.number().int().min(0).max(10),
  proxyPolicy: ProxyPolicySchema,
  tlsPolicy: TlsPolicySchema,
  providerOptions: ProviderOptionsSchema.optional(),
  fallbackProfileId: IdentifierSchema.nullable(),
  test: ProviderTestStateSchema
}).strict();

function validateProviderOptions(profile: { protocol: ProviderProtocol; providerOptions?: ProviderOptions }, context: z.RefinementCtx): void {
  const options = profile.providerOptions || {};
  const allowed = profile.protocol === "anthropic-messages"
    ? new Set(["anthropicVersion"])
    : profile.protocol === "openai-chat" || profile.protocol === "openai-responses"
      ? new Set(["organization", "project", "apiVersion"])
      : new Set<string>();
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) context.addIssue({ code: "custom", path: ["providerOptions", key], message: `Provider Protocol 不支持字段：${key}` });
  }
}

export const ProviderProfileSchema = ProviderProfileObjectSchema.superRefine(validateProviderOptions);
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

export const ProviderProfileInputSchema = ProviderProfileObjectSchema.omit({ schemaVersion: true, test: true }).strict().superRefine(validateProviderOptions);
export type ProviderProfileInput = z.infer<typeof ProviderProfileInputSchema>;

/**
 * Validate without ever accepting credentials embedded in the URL. The
 * normalized URL is returned for callers that want a canonical config value.
 */
export function normalizeBaseUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (!isSafeBaseUrl(value)) throw new Error("Base URL 必须是无凭据的 HTTPS URL；HTTP 仅允许 localhost/loopback。");
  const url = new URL(value);
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${pathname}`;
}

export function isSafeBaseUrl(raw: string): boolean {
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

export function normalizeProxyUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (!isSafeProxyUrl(value)) throw new Error("Proxy URL 必须是无凭据的 HTTP(S) URL。 ");
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

export function isSafeProxyUrl(raw: string): boolean {
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
