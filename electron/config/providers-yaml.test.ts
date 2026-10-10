import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProtocol, ProviderYamlInputEntry, ProvidersYamlInput } from "../../shared/providers-yaml";

const originalWorkspaceRoot = process.env.OPENMIND_WORKSPACE_ROOT;
const originalOpenmindRoot = process.env.OPENMIND_ROOT;
const originalUserDataDir = process.env.OPENMIND_USER_DATA_DIR;
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-provider-config-data-"));
const separateWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-provider-config-workspace-"));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-provider-config-user-data-"));
process.env.OPENMIND_WORKSPACE_ROOT = separateWorkspace;
process.env.OPENMIND_ROOT = repo;
process.env.OPENMIND_USER_DATA_DIR = userDataDir;

vi.mock("electron", () => ({ app: { getPath: () => userDataDir } }));

let config: typeof import("./providers-yaml");

beforeAll(async () => {
  config = await import("./providers-yaml");
});

beforeEach(() => {
  fs.rmSync(path.join(repo, "config"), { recursive: true, force: true });
});

afterAll(() => {
  if (originalWorkspaceRoot === undefined) delete process.env.OPENMIND_WORKSPACE_ROOT;
  else process.env.OPENMIND_WORKSPACE_ROOT = originalWorkspaceRoot;
  if (originalOpenmindRoot === undefined) delete process.env.OPENMIND_ROOT;
  else process.env.OPENMIND_ROOT = originalOpenmindRoot;
  if (originalUserDataDir === undefined) delete process.env.OPENMIND_USER_DATA_DIR;
  else process.env.OPENMIND_USER_DATA_DIR = originalUserDataDir;
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(separateWorkspace, { recursive: true, force: true });
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

function entry(
  id: string,
  protocol: ProviderProtocol,
  apiKey = `secret-${id}`,
  overrides: Partial<ProviderYamlInputEntry> = {}
): ProviderYamlInputEntry {
  return {
    id,
    name: id,
    enabled: true,
    protocol,
    authMode: protocol === "anthropic-messages" ? "x-api-key" : "bearer",
    apiKey,
    baseUrl: `https://${id}.example.com/v1`,
    model: `model-${id}`,
    proxyUrl: "",
    proxyPolicy: "system",
    tlsPolicy: "verify",
    ...overrides
  };
}

function providerDocument(): ProvidersYamlInput {
  return {
    schemaVersion: 1,
    default: "general-chat",
    cli: { claude: "claude-primary", codex: "codex-primary" },
    providers: [
      entry("general-chat", "openai-chat"),
      entry("claude-primary", "anthropic-messages"),
      entry("claude-session", "anthropic-messages", "secret-claude-session", { authMode: "bearer" }),
      entry("codex-primary", "openai-responses")
    ]
  };
}

describe("config/providers.yaml file repository", () => {
  it("round-trips image capability without duplicating credentials or changing the text route", () => {
    const document = providerDocument();
    const imageGeneration = { provider: "openai" as const, models: ["gpt-image-2"] };
    document.providers[0].imageGeneration = imageGeneration;
    const saved = config.saveProvidersFromInput(document);
    const revision = config.providerConfigurationRevision(saved.providers[0]);
    expect(config.listProvidersForUi().providers[0].imageGeneration).toEqual(imageGeneration);
    expect(config.readDefaultProviderEnv().env.OPENMIND_PROVIDER_MODEL).toBe("model-general-chat");
    const updated = config.saveProvidersFromInput({ ...document, providers: document.providers.map(entry => ({ ...entry, apiKey: "", imageGeneration: null })) });
    expect(updated.providers).toHaveLength(document.providers.length);
    expect(updated.providers[0].apiKey).toBe("secret-general-chat");
    expect(updated.providers[0].imageGeneration).toBeNull();
    expect(config.providerConfigurationRevision(updated.providers[0])).toBe(revision);
  });
  it("saves multiple providers and preserves stored keys when UI inputs leave them blank", () => {
    const first = config.saveProvidersFromInput(providerDocument());
    expect(config.providersYamlPath()).toBe(path.join(repo, "config", "providers.yaml"));
    expect(first.providers.map((provider) => provider.id)).toEqual([
      "general-chat",
      "claude-primary",
      "claude-session",
      "codex-primary"
    ]);

    const rawAfterFirstSave = fs.readFileSync(config.providersYamlPath(), "utf8");
    expect(rawAfterFirstSave).toContain("secret-claude-primary");
    expect(rawAfterFirstSave).toContain("secret-codex-primary");

    const second = config.saveProvidersFromInput({
      ...providerDocument(),
      providers: providerDocument().providers.map((provider) => ({
        ...provider,
        name: `${provider.name} updated`,
        apiKey: ""
      }))
    });

    expect(second.providers.map((provider) => provider.apiKey)).toEqual([
      "secret-general-chat",
      "secret-claude-primary",
      "secret-claude-session",
      "secret-codex-primary"
    ]);
    expect(config.readProvidersYaml()?.providers.every((provider) => provider.name.endsWith(" updated"))).toBe(true);
  });

  it("resolves an explicit openmind snapshot and emits the OPENMIND_PROVIDER_* env namespace", () => {
    config.saveProvidersFromInput(providerDocument());
    const explicitRoot = repo;

    expect(config.providersYamlPath(explicitRoot)).toBe(path.join(repo, "config", "providers.yaml"));
    const env = config.readDefaultProviderEnv(explicitRoot).env;
    expect(env).toMatchObject({
      OPENMIND_PROVIDER_API_KEY: "secret-general-chat",
      OPENMIND_PROVIDER_BASE_URL: "https://general-chat.example.com/v1/chat/completions",
      OPENMIND_PROVIDER_MODEL: "model-general-chat"
    });
    for (const name of Object.keys(env)) expect(name.startsWith("CCTOOLS_PROVIDER_")).toBe(false);
  });

  it("returns a UI view that reports key presence without leaking plaintext keys", () => {
    config.saveProvidersFromInput(providerDocument());

    const view = config.listProvidersForUi();
    expect(view.cli).toEqual({ claude: "claude-primary", codex: "codex-primary" });
    expect(view.providers.every((provider) => provider.apiKeySet)).toBe(true);
    for (const provider of view.providers) expect(provider).not.toHaveProperty("apiKey");
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("secret-general-chat");
    expect(serialized).not.toContain("secret-claude-primary");
    expect(serialized).not.toContain("secret-claude-session");
    expect(serialized).not.toContain("secret-codex-primary");
  });

  it("returns the original key only for an explicitly requested Provider editor", () => {
    config.saveProvidersFromInput(providerDocument());

    expect(config.readProviderApiKeyForUi("claude-primary")).toBe("secret-claude-primary");
    expect(() => config.readProviderApiKeyForUi("missing")).toThrow("未找到 Provider");
  });

  it("resolves current CLI bindings and a provider id frozen into an existing session", () => {
    config.saveProvidersFromInput(providerDocument());

    expect(config.resolveCliProvider("claude")?.id).toBe("claude-primary");
    expect(config.resolveCliProvider("codex")?.id).toBe("codex-primary");
    const pinned = config.readProvidersYaml()?.providers.find((provider) => provider.id === "claude-session");
    if (!pinned) throw new Error("expected pinned provider");
    expect(config.resolveCliProvider("claude", "claude-session", config.providerConfigurationRevision(pinned))?.id)
      .toBe("claude-session");
    expect(config.resolveCliProvider("codex", null)).toBeNull();
  });

  it("rejects resuming a session after its routing-sensitive provider configuration changes", () => {
    config.saveProvidersFromInput(providerDocument());
    const pinned = config.readProvidersYaml()?.providers.find((provider) => provider.id === "claude-session");
    if (!pinned) throw new Error("expected pinned provider");
    const revision = config.providerConfigurationRevision(pinned);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);

    config.saveProvidersFromInput({
      ...providerDocument(),
      providers: providerDocument().providers.map((provider) => provider.id === "claude-session"
        ? { ...provider, baseUrl: "https://different-backend.example.com/anthropic" }
        : provider)
    });

    expect(() => config.resolveCliProvider("claude", "claude-session", revision))
      .toThrow("为避免把旧会话发送到不同服务，请新建会话");
  });

  it("throws a typed mismatch error and re-resolves when the acknowledged rebind ignores the revision check", () => {
    config.saveProvidersFromInput(providerDocument());
    const pinned = config.readProvidersYaml()?.providers.find((provider) => provider.id === "claude-session");
    if (!pinned) throw new Error("expected pinned provider");
    const revision = config.providerConfigurationRevision(pinned);

    config.saveProvidersFromInput({
      ...providerDocument(),
      providers: providerDocument().providers.map((provider) => provider.id === "claude-session"
        ? { ...provider, baseUrl: "https://different-backend.example.com/anthropic" }
        : provider)
    });

    let caught: unknown;
    try {
      config.resolveCliProvider("claude", "claude-session", revision);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(config.ProviderRevisionMismatchError);
    const mismatch = caught as InstanceType<typeof config.ProviderRevisionMismatchError>;
    expect(mismatch.kind).toBe("claude");
    expect(mismatch.providerId).toBe("claude-session");

    const rebound = config.resolveCliProvider("claude", "claude-session", revision, { ignoreRevisionCheck: true });
    if (!rebound) throw new Error("expected rebound provider");
    expect(rebound.id).toBe("claude-session");
    expect(config.providerConfigurationRevision(rebound)).not.toBe(revision);
  });

  it("reports explicit errors for missing or protocol-incompatible session provider ids", () => {
    expect(() => config.resolveCliProvider("claude", "missing-session-provider"))
      .toThrow("claude 会话缺少 Provider 配置指纹");

    config.saveProvidersFromInput(providerDocument());

    expect(() => config.resolveCliProvider("claude", "missing-session-provider", "a".repeat(64)))
      .toThrow("claude 绑定的 Provider 不存在：missing-session-provider");
    expect(() => config.resolveCliProvider("claude", "codex-primary", "a".repeat(64)))
      .toThrow("Claude Code 只能绑定 anthropic-messages Provider。");
    expect(() => config.resolveCliProvider("codex", "general-chat", "a".repeat(64)))
      .toThrow("Codex CLI 只能绑定 openai-responses Provider。");
  });

  it("rejects invalid current bindings before overwriting the file", () => {
    config.saveProvidersFromInput(providerDocument());

    expect(() => config.saveProvidersFromInput({
      ...providerDocument(),
      cli: { claude: "missing-provider", codex: "codex-primary" }
    })).toThrow("claude 绑定的 Provider 不存在：missing-provider");
    expect(() => config.saveProvidersFromInput({
      ...providerDocument(),
      cli: { claude: "claude-primary", codex: "general-chat" }
    })).toThrow("Codex CLI 只能绑定 openai-responses Provider。");

    expect(config.readProvidersYaml()?.cli).toEqual({ claude: "claude-primary", codex: "codex-primary" });
  });

  it("repairs corrupt YAML only when a complete replacement supplies every key", () => {
    fs.mkdirSync(path.dirname(config.providersYamlPath()), { recursive: true });
    fs.writeFileSync(config.providersYamlPath(), [
      "schemaVersion: 1",
      "default: broken",
      "providers:",
      "  - id: broken",
      "    apiKey: secret-that-must-not-appear-in-errors",
      "    malformed: ["
    ].join("\n"), "utf8");

    expect(() => config.readProvidersYaml()).toThrow("config/providers.yaml 解析失败");
    try { config.readProvidersYaml(); } catch (error) {
      expect(String(error)).not.toContain("secret-that-must-not-appear-in-errors");
    }
    expect(() => config.saveProvidersFromInput({
      ...providerDocument(),
      providers: providerDocument().providers.map((provider) => ({ ...provider, apiKey: "" }))
    })).toThrow("请为所有 Provider 重新输入 API Key");

    expect(config.saveProvidersFromInput(providerDocument()).providers).toHaveLength(4);
    expect(config.readProvidersYaml()?.default).toBe("general-chat");
  });
});
