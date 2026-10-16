import { afterEach, describe, expect, it } from "vitest";
import { IMAGE_PROVIDERS, ImageCapabilitySchema, ImageProviderInputSchema, ImageSelectionSchema } from "../image-generation";
import { PROVIDER_PRESETS, ProviderYamlEntrySchema, ProvidersYamlSchema } from "../providers-yaml";
import { setLocale } from ".";

afterEach(() => setLocale("zh-CN"));

const provider = { id: "fixture", name: "Fixture", protocol: "openai-chat", apiKey: "fixture-key", baseUrl: "https://example.com", model: "fixture-model" };

// The table inspects validation issues, so avoid retaining every schema's full output type.
type ValidationResult = { success: true } | { success: false; error: { issues: readonly { message: string }[] } };
const invalidCases: Array<[string, () => ValidationResult]> = [
  ["empty image selection", () => ImageCapabilitySchema.safeParse({ provider: "openai", models: [] })],
  ["duplicate image models", () => ImageCapabilitySchema.safeParse({ provider: "openai", models: ["gpt-image-2", "gpt-image-2"] })],
  ["wrong image provider", () => ImageSelectionSchema.safeParse({ provider: "google", model: "gpt-image-2" })],
  ["unsafe image endpoint", () => ImageProviderInputSchema.safeParse({ provider: "openai", baseUrl: "http://example.com", apiKey: "", enabled: true })],
  ["invalid identifier", () => ProviderYamlEntrySchema.safeParse({ ...provider, id: "invalid id" })],
  ["unsafe provider endpoint", () => ProviderYamlEntrySchema.safeParse({ ...provider, baseUrl: "http://example.com" })],
  ["invalid proxy URL", () => ProviderYamlEntrySchema.safeParse({ ...provider, proxyUrl: "https://example.com/path" })],
  ["missing explicit proxy", () => ProviderYamlEntrySchema.safeParse({ ...provider, proxyPolicy: "explicit" })],
  ["invalid provider document", () => ProvidersYamlSchema.safeParse({ schemaVersion: 1, default: "missing", providers: [provider, provider] })]
];

describe("provider UI localization", () => {
  it("updates existing preset and model descriptions while keeping connection identifiers stable", () => {
    const imageProvider = IMAGE_PROVIDERS[0];
    const imageModel = imageProvider.models[0];
    const preset = PROVIDER_PRESETS.find(entry => entry.id === "glm")!;
    const connection = { provider: imageProvider.id, model: imageModel.id, baseUrl: imageProvider.baseUrl, protocol: preset.protocol, presetModel: preset.model };

    setLocale("en");
    expect(imageProvider.name).toBe("ByteDance Volcengine");
    expect(imageModel.description).toBe("Fast generation · Everyday creativity");
    expect(preset.name).toBe("Zhipu GLM");

    setLocale("zh-CN");
    expect(imageProvider.name).toBe("字节火山");
    expect(imageModel.description).toBe("快速生成 · 日常创作");
    expect(preset.name).toBe("智谱 GLM");
    expect({ provider: imageProvider.id, model: imageModel.id, baseUrl: imageProvider.baseUrl, protocol: preset.protocol, presetModel: preset.model }).toEqual(connection);
  });

  it.each(invalidCases)("validates %s in the active language after schemas were imported", (_name, parse) => {
    for (const locale of ["zh-CN", "en", "zh-CN"] as const) {
      setLocale(locale);
      const result = parse();
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Invalid fixture was accepted");
      expect(result.error.issues.length).toBeGreaterThan(0);
      for (const issue of result.error.issues) expect(/\p{Script=Han}/u.test(issue.message)).toBe(locale === "zh-CN");
    }
  });
});
