import { describe, expect, it } from "vitest";
import {
  ProvidersYamlInputSchema,
  ProvidersYamlSchema,
  ProvidersYamlViewSchema,
  processProviderEnvironment,
  providerEndpoint
} from "./providers-yaml";

function provider(
  id: string,
  protocol: "openai-chat" | "openai-responses" | "anthropic-messages",
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    name: id,
    enabled: true,
    protocol,
    apiKey: `key-${id}`,
    baseUrl: `https://${id}.example.com/v1`,
    model: `model-${id}`,
    ...overrides
  };
}

describe("provider request endpoints", () => {
  it.each([
    ["https://api.anthropic.com", "https://api.anthropic.com/v1/messages"],
    ["https://open.bigmodel.cn/api/anthropic", "https://open.bigmodel.cn/api/anthropic/v1/messages"],
    ["https://api.deepseek.com/anthropic/v1", "https://api.deepseek.com/anthropic/v1/messages"],
    ["https://gateway.example.com/v1/", "https://gateway.example.com/v1/messages"],
    ["https://gateway.example.com/custom/messages/", "https://gateway.example.com/custom/messages"]
  ])("resolves the Messages endpoint for %s", (base, expected) => {
    expect(providerEndpoint(base, "anthropic-messages")).toBe(expected);
    expect(providerEndpoint(expected, "anthropic-messages")).toBe(expected);
    const entry = ProvidersYamlSchema.parse({
      schemaVersion: 1, default: "summary", providers: [provider("summary", "anthropic-messages", { baseUrl: base })]
    }).providers[0];
    expect(processProviderEnvironment(entry).OPENMIND_PROVIDER_BASE_URL).toBe(expected);
  });
});

describe("providers.yaml schemas", () => {
  it("keeps shared image capabilities on one text provider and validates supported generation models", () => {
    const imageGeneration = { provider: "volcengine", models: ["doubao-seedream-5-0-flash-260915"] };
    const document = { schemaVersion: 1, default: "shared", providers: [provider("shared", "openai-chat", { imageGeneration })] };
    expect(ProvidersYamlSchema.parse(document).providers).toHaveLength(1);
    expect(ProvidersYamlSchema.parse(document).providers[0].imageGeneration).toEqual(imageGeneration);
    for (const models of [[], ["gpt-4o"], ["gpt-image-2"], [imageGeneration.models[0], imageGeneration.models[0]]]) {
      expect(() => ProvidersYamlSchema.parse({ ...document, providers: [provider("shared", "openai-chat", { imageGeneration: { ...imageGeneration, models } })] })).toThrow();
    }
  });
  it("defaults cli bindings and authMode when reading a legacy schemaVersion 1 document", () => {
    const parsed = ProvidersYamlSchema.parse({
      schemaVersion: 1,
      default: "legacy",
      providers: [provider("legacy", "openai-chat")]
    });

    expect(parsed.cli).toEqual({ claude: null, codex: null });
    expect(parsed.providers[0]).toMatchObject({
      authMode: "bearer",
      proxyUrl: "",
      proxyPolicy: "system",
      tlsPolicy: "verify"
    });
  });

  it("applies the same compatibility defaults at save-input and UI-view boundaries", () => {
    const input = ProvidersYamlInputSchema.parse({
      schemaVersion: 1,
      default: "legacy",
      providers: [{ ...provider("legacy", "openai-chat"), apiKey: "" }]
    });
    const view = ProvidersYamlViewSchema.parse({
      schemaVersion: 1,
      default: "legacy",
      providers: [{
        id: "legacy",
        name: "legacy",
        enabled: true,
        protocol: "openai-chat",
        baseUrl: "https://legacy.example.com/v1",
        model: "model-legacy",
        apiKeySet: true
      }]
    });

    expect(input.cli).toEqual({ claude: null, codex: null });
    expect(input.providers[0].authMode).toBe("bearer");
    expect(view.cli).toEqual({ claude: null, codex: null });
    expect(view.providers[0].authMode).toBe("bearer");
  });

  it("accepts multiple providers and independent Claude/Codex bindings", () => {
    const parsed = ProvidersYamlSchema.parse({
      schemaVersion: 1,
      default: "general-chat",
      cli: { claude: "claude-gateway", codex: "codex-gateway" },
      providers: [
        provider("general-chat", "openai-chat"),
        provider("claude-gateway", "anthropic-messages", { authMode: "x-api-key" }),
        provider("codex-gateway", "openai-responses")
      ]
    });

    expect(parsed.providers.map((entry) => entry.id)).toEqual([
      "general-chat",
      "claude-gateway",
      "codex-gateway"
    ]);
    expect(parsed.cli).toEqual({ claude: "claude-gateway", codex: "codex-gateway" });
  });

  it("rejects duplicate provider ids", () => {
    const result = ProvidersYamlSchema.safeParse({
      schemaVersion: 1,
      default: "duplicate",
      providers: [
        provider("duplicate", "openai-chat"),
        provider("duplicate", "openai-responses")
      ]
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["providers", 1, "id"], message: "Provider ID 重复：duplicate" })
    ]));
  });

  it("requires the default provider to exist and remain enabled", () => {
    expect(() => ProvidersYamlSchema.parse({
      schemaVersion: 1,
      default: "missing",
      providers: [provider("available", "openai-chat")]
    })).toThrow("默认 Provider 不存在");
    expect(() => ProvidersYamlSchema.parse({
      schemaVersion: 1,
      default: "disabled",
      providers: [provider("disabled", "openai-chat", { enabled: false })]
    })).toThrow("默认 Provider 已停用");
  });

  it("rejects an explicit proxy policy without a proxy URL", () => {
    const result = ProvidersYamlSchema.safeParse({
      schemaVersion: 1,
      default: "explicit-proxy",
      providers: [provider("explicit-proxy", "openai-chat", {
        proxyPolicy: "explicit",
        proxyUrl: ""
      })]
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["providers", 0, "proxyUrl"],
        message: "proxyPolicy 为 explicit 时必须填写 Proxy URL。"
      })
    ]));
  });

  it.each([
    {
      name: "Claude protocol mismatch",
      cli: { claude: "chat", codex: null },
      providers: [provider("chat", "openai-chat")],
      path: ["cli", "claude"],
      message: "Claude Code 只能绑定 anthropic-messages Provider。"
    },
    {
      name: "Codex protocol mismatch",
      cli: { claude: null, codex: "chat" },
      providers: [provider("chat", "openai-chat")],
      path: ["cli", "codex"],
      message: "Codex CLI 只能绑定 openai-responses Provider。"
    },
    {
      name: "disabled Claude binding",
      cli: { claude: "claude-off", codex: null },
      providers: [provider("claude-off", "anthropic-messages", { enabled: false })],
      path: ["cli", "claude"],
      message: "claude 绑定的 Provider 已停用：claude-off"
    },
    {
      name: "disabled Codex binding",
      cli: { claude: null, codex: "codex-off" },
      providers: [provider("codex-off", "openai-responses", { enabled: false })],
      path: ["cli", "codex"],
      message: "codex 绑定的 Provider 已停用：codex-off"
    }
  ])("rejects $name", ({ cli, providers, path, message }) => {
    const result = ProvidersYamlSchema.safeParse({
      schemaVersion: 1,
      default: providers[0].id,
      cli,
      providers
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path, message })
    ]));
  });

  it.each([
    ["claude", "anthropic-messages", "Claude Code"],
    ["codex", "openai-responses", "Codex CLI"]
  ] as const)("rejects allow-insecure TLS for a managed %s binding", (kind, protocol, label) => {
    const id = `${kind}-insecure`;
    const result = ProvidersYamlSchema.safeParse({
      schemaVersion: 1,
      default: id,
      cli: { claude: null, codex: null, [kind]: id },
      providers: [provider(id, protocol, { tlsPolicy: "allow-insecure" })]
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["cli", kind],
        message: `${label} 托管 Provider 仅支持 tlsPolicy: verify。`
      })
    ]));
  });
});
