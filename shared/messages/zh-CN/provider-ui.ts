export const providerUiMessages = {
  providerUi: {
    providerNames: { volcengine: "字节火山", openai: "OpenAI", google: "Google", deepseek: "DeepSeek", anthropic: "Anthropic", glm: "智谱 GLM", doubao: "火山豆包", openaiCodex: "OpenAI · Codex", gemini: "Google Gemini" },
    imageModels: {
      seedreamFlash: "快速生成 · 日常创作", seedreamPro: "精细画面 · 专业创作", imageSunburst: "细节与编辑精度", imageFlare: "快速生成 · 高品质", imageGeneral: "通用图像创作",
      banana21: "高效生成 · 图文表达", banana2: "快速生成 · 多图融合", bananaPro: "专业设计 · 复杂创作"
    },
    validation: {
      imageModelProvider: "图片模型不属于所选服务商。", imageModelRequired: "请至少选择一个图片模型。", imageModelDuplicate: "图片模型不能重复。", imageModelSupported: "请选择该服务商支持的图片生成模型。",
      imageBaseUrl: "请输入不含凭据和查询参数的 HTTPS 地址。", identifier: "标识只能包含字母、数字、点、下划线和连字符。",
      baseUrl: "Base URL 必须是无凭据的 HTTPS URL；HTTP 仅允许 localhost/loopback。", proxyUrl: "Proxy URL 必须是无凭据的 HTTP(S) URL。", explicitProxyRequired: "proxyPolicy 为 explicit 时必须填写 Proxy URL。",
      duplicateId: (id: string) => `Provider ID 重复：${id}`, defaultMissing: (id: string) => `默认 Provider 不存在：${id}`, defaultDisabled: (id: string) => `默认 Provider 已停用：${id}`,
      bindingMissing: (kind: string, id: string) => `${kind} 绑定的 Provider 不存在：${id}`, bindingDisabled: (kind: string, id: string) => `${kind} 绑定的 Provider 已停用：${id}`,
      claudeProtocol: "Claude Code 只能绑定 anthropic-messages Provider。", codexProtocol: "Codex CLI 只能绑定 openai-responses Provider。", managedTls: (label: string) => `${label} 托管 Provider 仅支持 tlsPolicy: verify。`
    }
  }
} as const;
