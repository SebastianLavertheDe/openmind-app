import { describe, expect, it } from "vitest";
import {
  CredentialScopeSchema,
  ProviderProfileInputSchema,
  isSafeBaseUrl,
  isSafeProxyUrl,
  normalizeBaseUrl
} from "./provider-profiles";

describe("provider profile contracts", () => {
  it("accepts HTTPS and normalizes only the trailing path slash", () => {
    expect(isSafeBaseUrl("https://api.example.com/v1/")).toBe(true);
    expect(normalizeBaseUrl("  https://api.example.com/v1/// ")).toBe("https://api.example.com/v1");
    expect(normalizeBaseUrl("")).toBe("");
    expect(isSafeProxyUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isSafeProxyUrl("https://proxy.example.com:8443")).toBe(true);
    expect(isSafeProxyUrl("http://user:password@proxy.example.com")).toBe(false);
    expect(isSafeProxyUrl("https://proxy.example.com/forward")).toBe(false);
  });

  it("allows HTTP only for loopback development endpoints", () => {
    expect(isSafeBaseUrl("http://localhost:3000/v1")).toBe(true);
    expect(isSafeBaseUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isSafeBaseUrl("http://[::1]:3000")).toBe(true);
    expect(isSafeBaseUrl("http://api.example.com")).toBe(false);
    expect(isSafeBaseUrl("https://user:password@api.example.com")).toBe(false);
    expect(isSafeBaseUrl("https://api.example.com?token=secret")).toBe(false);
  });

  it("requires a digest-bound skill scope", () => {
    expect(() => CredentialScopeSchema.parse({ publisherId: "cctools", skillId: "demo", version: "1.0.0", digest: "not-a-digest" })).toThrow();
    expect(CredentialScopeSchema.parse({ publisherId: "cctools", skillId: "demo", version: "1.0.0", digest: "a".repeat(64) }).skillId).toBe("demo");
  });

  it("does not accept a secret in Provider Profile input", () => {
    expect(() => ProviderProfileInputSchema.parse({
      id: "openai",
      name: "OpenAI",
      protocol: "openai-responses",
      credentialId: "credential-1",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-5",
      timeoutMs: 120_000,
      maxRetries: 2,
      proxyPolicy: "system",
      tlsPolicy: "verify",
      proxyUrl: "http://127.0.0.1:8080",
      providerOptions: { organization: "org-test" },
      fallbackProfileId: null,
      secret: "must-not-be-accepted"
    })).toThrow();
    expect(() => ProviderProfileInputSchema.parse({
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic-messages",
      credentialId: null,
      baseUrl: "https://api.anthropic.com",
      model: "claude",
      timeoutMs: 120_000,
      maxRetries: 2,
      proxyPolicy: "disabled",
      tlsPolicy: "verify",
      providerOptions: { organization: "not-supported" },
      fallbackProfileId: null
    })).toThrow();
  });
});
