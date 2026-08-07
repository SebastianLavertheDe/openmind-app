import { describe, expect, it } from "vitest";
import {
  MODEL_PRICING_CATALOG,
  MODEL_PRICING_CATALOG_VERSION,
  estimateModelCost,
  findModelRate,
  pricingProviderForProtocol
} from "./model-pricing-catalog";

describe("model-pricing-catalog", () => {
  it("keeps a versioned catalog with source-backed rates", () => {
    expect(MODEL_PRICING_CATALOG_VERSION).toBe(1);
    expect(MODEL_PRICING_CATALOG.length).toBeGreaterThan(0);
    expect(MODEL_PRICING_CATALOG.every((rate) => rate.sourceUrl.startsWith("https://"))).toBe(true);
    expect(MODEL_PRICING_CATALOG.every((rate) => rate.inputUsdPerMillion >= 0 && rate.outputUsdPerMillion >= 0)).toBe(true);
  });

  it("resolves protocol families but leaves provider-native endpoints unknown", () => {
    expect(pricingProviderForProtocol("openai-responses")).toBe("openai");
    expect(pricingProviderForProtocol("anthropic-messages")).toBe("anthropic");
    expect(pricingProviderForProtocol("provider-native")).toBeNull();
    expect(findModelRate("openai-responses", "GPT-5.4")?.id).toBe("openai:gpt-5.4:standard-global:short");
    expect(findModelRate("provider-native", "gpt-5.4")).toBeNull();
  });

  it("calculates uncached and cached tokens separately", () => {
    const estimate = estimateModelCost({
      protocol: "openai-responses",
      model: "gpt-5.4",
      inputTokens: 1_000_000,
      cachedInputTokens: 100_000,
      outputTokens: 200_000
    });
    expect(estimate?.costUsd).toBe(5.275);
    expect(estimate?.rate.cachedInputUsdPerMillion).toBe(0.25);
  });

  it("does not guess unknown models or invalid token counts", () => {
    expect(estimateModelCost({ protocol: "openai-chat", model: "local-test-model", inputTokens: 10, outputTokens: 5 })).toBeNull();
    expect(estimateModelCost({ protocol: "anthropic-messages", model: "claude-sonnet-4-6", inputTokens: 10, outputTokens: -1 })).toBeNull();
    expect(estimateModelCost({ protocol: "anthropic-messages", model: "claude-haiku-4-5", inputTokens: 10, cachedInputTokens: 11, outputTokens: 5 })).toBeNull();
    expect(findModelRate("anthropic-messages", "claude-sonnet-4-6", "long")).toBeNull();
  });
});
