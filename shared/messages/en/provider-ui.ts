import type { TranslationOf } from "../types";
import type { providerUiMessages as zhCN } from "../zh-CN/provider-ui";

export const providerUiMessages = {
  providerUi: {
    providerNames: { volcengine: "ByteDance Volcengine", openai: "OpenAI", google: "Google", deepseek: "DeepSeek", anthropic: "Anthropic", glm: "Zhipu GLM", doubao: "Volcengine Doubao", openaiCodex: "OpenAI · Codex", gemini: "Google Gemini" },
    imageModels: {
      seedreamFlash: "Fast generation · Everyday creativity", seedreamPro: "Fine detail · Professional creation", imageSunburst: "Fine detail and precise editing", imageFlare: "Fast generation · High quality", imageGeneral: "General image creation",
      banana21: "Efficient generation · Text and images", banana2: "Fast generation · Multi-image blending", bananaPro: "Professional design · Complex creation"
    },
    validation: {
      imageModelProvider: "This image model does not belong to the selected provider.", imageModelRequired: "Select at least one image model.", imageModelDuplicate: "Image models cannot be repeated.", imageModelSupported: "Select an image generation model supported by this provider.",
      imageBaseUrl: "Enter an HTTPS URL without credentials or query parameters.", identifier: "Identifiers may contain only letters, numbers, dots, underscores, and hyphens.",
      baseUrl: "Base URL must use HTTPS and contain no credentials. HTTP is allowed only for localhost or loopback addresses.", proxyUrl: "Proxy URL must use HTTP or HTTPS and contain no credentials.", explicitProxyRequired: "A Proxy URL is required when proxyPolicy is explicit.",
      duplicateId: (id: string) => `Duplicate provider ID: ${id}`, defaultMissing: (id: string) => `Default provider not found: ${id}`, defaultDisabled: (id: string) => `Default provider is disabled: ${id}`,
      bindingMissing: (kind: string, id: string) => `The provider bound to ${kind} was not found: ${id}`, bindingDisabled: (kind: string, id: string) => `The provider bound to ${kind} is disabled: ${id}`,
      claudeProtocol: "Claude Code can only use an anthropic-messages provider.", codexProtocol: "Codex CLI can only use an openai-responses provider.", managedTls: (label: string) => `${label} managed providers only support tlsPolicy: verify.`
    }
  }
} satisfies TranslationOf<typeof zhCN>;
