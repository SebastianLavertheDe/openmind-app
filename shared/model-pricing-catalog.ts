import type { ProviderProtocol } from "./provider-profiles";

/**
 * Versioned, deliberately small pricing catalog used only for transparent
 * estimates. Provider-reported costs always take precedence. Unknown models,
 * provider-native endpoints and unsupported pricing modes stay unknown rather
 * than being guessed from a model prefix.
 *
 * Sources:
 * - OpenAI: https://developers.openai.com/api/docs/pricing
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 */
export const MODEL_PRICING_CATALOG_VERSION = 1 as const;
export const MODEL_PRICING_CATALOG_OBSERVED_AT = "2026-08-06" as const;
export const MODEL_PRICING_SOURCES = {
  openai: "https://developers.openai.com/api/docs/pricing",
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing"
} as const;

export type PricingProvider = "openai" | "anthropic";
export type PricingContext = "short" | "long";

export type ModelRate = {
  id: string;
  provider: PricingProvider;
  model: string;
  context: PricingContext;
  scope: "global";
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  outputUsdPerMillion: number;
  catalogVersion: typeof MODEL_PRICING_CATALOG_VERSION;
  observedAt: typeof MODEL_PRICING_CATALOG_OBSERVED_AT;
  sourceUrl: string;
};

type OpenAiRateInput = {
  model: string;
  short: [input: number, cachedInput: number | undefined, output: number];
  long?: [input: number, cachedInput: number | undefined, output: number];
};

const openAiRate = (model: string, context: PricingContext, values: [number, number | undefined, number]): ModelRate => ({
  id: `openai:${model}:standard-global:${context}`,
  provider: "openai",
  model,
  context,
  scope: "global",
  inputUsdPerMillion: values[0],
  ...(values[1] === undefined ? {} : { cachedInputUsdPerMillion: values[1] }),
  outputUsdPerMillion: values[2],
  catalogVersion: MODEL_PRICING_CATALOG_VERSION,
  observedAt: MODEL_PRICING_CATALOG_OBSERVED_AT,
  sourceUrl: MODEL_PRICING_SOURCES.openai
});

const openAiRates = ({ model, short, long }: OpenAiRateInput): ModelRate[] => [
  openAiRate(model, "short", short),
  ...(long ? [openAiRate(model, "long", long)] : [])
];

const anthropicRate = (model: string, context: PricingContext, values: [number, number | undefined, number]): ModelRate => ({
  id: `anthropic:${model}:standard-global:${context}`,
  provider: "anthropic",
  model,
  context,
  scope: "global",
  inputUsdPerMillion: values[0],
  ...(values[1] === undefined ? {} : { cachedInputUsdPerMillion: values[1] }),
  outputUsdPerMillion: values[2],
  catalogVersion: MODEL_PRICING_CATALOG_VERSION,
  observedAt: MODEL_PRICING_CATALOG_OBSERVED_AT,
  sourceUrl: MODEL_PRICING_SOURCES.anthropic
});

/**
 * Standard global, USD-per-million-token rates. OpenAI short/long rows are
 * kept separately because the provider applies different rates to long
 * context. Anthropic entries use the standard global row; models without an
 * all-context row intentionally have no long-context estimate.
 */
export const MODEL_PRICING_CATALOG: readonly ModelRate[] = [
  ...openAiRates({ model: "gpt-5.6-sol", short: [5, 0.5, 30], long: [10, 1, 45] }),
  ...openAiRates({ model: "gpt-5.6-terra", short: [2, 0.2, 12], long: [4, 0.4, 18] }),
  ...openAiRates({ model: "gpt-5.6-luna", short: [0.2, 0.02, 1.2], long: [0.4, 0.04, 1.8] }),
  ...openAiRates({ model: "gpt-5.5", short: [5, 0.5, 30], long: [10, 1, 45] }),
  ...openAiRates({ model: "gpt-5.5-pro", short: [30, undefined, 180], long: [60, undefined, 270] }),
  ...openAiRates({ model: "gpt-5.4", short: [2.5, 0.25, 15], long: [5, 0.5, 22.5] }),
  ...openAiRates({ model: "gpt-5.4-mini", short: [0.75, 0.075, 4.5] }),
  ...openAiRates({ model: "gpt-5.4-nano", short: [0.2, 0.02, 1.25] }),
  ...openAiRates({ model: "gpt-5.4-pro", short: [30, undefined, 180], long: [60, undefined, 270] }),

  anthropicRate("claude-opus-4-7", "short", [5, 0.5, 25]),
  anthropicRate("claude-opus-4-6", "short", [5, 0.5, 25]),
  anthropicRate("claude-sonnet-4-6", "short", [3, 0.3, 15]),
  anthropicRate("claude-opus-4-5", "short", [5, 0.5, 25]),
  anthropicRate("claude-sonnet-4-5", "short", [3, 0.3, 15]),
  anthropicRate("claude-haiku-4-5", "short", [1, 0.1, 5])
];

export type ModelCostEstimate = {
  costUsd: number;
  rate: ModelRate;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export function pricingProviderForProtocol(protocol: ProviderProtocol | PricingProvider): PricingProvider | null {
  if (protocol === "openai" || protocol === "openai-chat" || protocol === "openai-responses") return "openai";
  if (protocol === "anthropic" || protocol === "anthropic-messages") return "anthropic";
  return null;
}

export function findModelRate(
  protocol: ProviderProtocol | PricingProvider,
  model: string | null | undefined,
  context: PricingContext = "short"
): ModelRate | null {
  const provider = pricingProviderForProtocol(protocol);
  const normalizedModel = model?.trim().toLowerCase();
  if (!provider || !normalizedModel) return null;
  return MODEL_PRICING_CATALOG.find((rate) => rate.provider === provider && rate.context === context && rate.model.toLowerCase() === normalizedModel) ?? null;
}

export function estimateModelCost(input: {
  protocol: ProviderProtocol | PricingProvider;
  model: string | null | undefined;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  context?: PricingContext;
}): ModelCostEstimate | null {
  if (!isNonNegativeInteger(input.inputTokens) || !isNonNegativeInteger(input.outputTokens)) return null;
  const cachedInputTokens = input.cachedInputTokens ?? 0;
  if (!isNonNegativeInteger(cachedInputTokens) || cachedInputTokens > input.inputTokens) return null;
  const rate = findModelRate(input.protocol, input.model, input.context ?? "short");
  if (!rate || (cachedInputTokens > 0 && rate.cachedInputUsdPerMillion === undefined)) return null;
  const uncachedInputTokens = input.inputTokens - cachedInputTokens;
  const costUsd = (
    uncachedInputTokens * rate.inputUsdPerMillion
    + cachedInputTokens * (rate.cachedInputUsdPerMillion ?? rate.inputUsdPerMillion)
    + input.outputTokens * rate.outputUsdPerMillion
  ) / 1_000_000;
  return {
    costUsd: Math.round(costUsd * 1e8) / 1e8,
    rate,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cachedInputTokens
  };
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
