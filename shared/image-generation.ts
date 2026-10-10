import { z } from "zod";

export const ImageProviderKindSchema = z.enum(["volcengine", "openai", "google"]);
export type ImageProviderKind = z.infer<typeof ImageProviderKindSchema>;

/** Public API model IDs (not marketing names).
 * https://docs.volcengine.com/docs/ark/model-list
 * https://developers.openai.com/api/docs/guides/image-generation
 * https://ai.google.dev/gemini-api/docs/generate-content/image-generation
 */
export const IMAGE_PROVIDERS = [
  { id: "volcengine", name: "字节火山", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: [
    { id: "doubao-seedream-5-0-flash-260915", name: "Doubao-Seedream-5.0-flash", description: "快速生成 · 日常创作" },
    { id: "doubao-seedream-5-0-pro-260628", name: "Doubao-Seedream-5.0-Pro", description: "精细画面 · 专业创作" }
  ] },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: [
    { id: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", description: "细节与编辑精度" },
    { id: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", description: "快速生成 · 高品质" },
    { id: "gpt-image-2", name: "GPT Image 2", description: "通用图像创作" }
  ] },
  { id: "google", name: "Google", baseUrl: "https://generativelanguage.googleapis.com/v1", models: [
    { id: "gemini-nano-banana-2.1", name: "Nano Banana 2.1", description: "高效生成 · 图文表达" },
    { id: "gemini-3.1-flash-image", name: "Nano Banana 2", description: "快速生成 · 多图融合" },
    { id: "gemini-3-pro-image", name: "Nano Banana Pro", description: "专业设计 · 复杂创作" }
  ] }
] as const;

export const ImageSelectionSchema = z.object({
  providerId: z.string().min(1).max(120).optional(),
  provider: ImageProviderKindSchema,
  model: z.string().min(1).max(160)
}).strict().refine(value => IMAGE_PROVIDERS.find(provider => provider.id === value.provider)?.models.some(model => model.id === value.model), "图片模型不属于所选服务商。");
export type ImageSelection = z.infer<typeof ImageSelectionSchema>;

/** Opt-in generation capability on a shared text Provider connection. */
export const ImageCapabilitySchema = z.object({
  provider: ImageProviderKindSchema,
  models: z.array(z.string().min(1).max(160)).min(1, "请至少选择一个图片模型。").max(8)
}).strict().superRefine((value, context) => {
  const supported = IMAGE_PROVIDERS.find(provider => provider.id === value.provider)!;
  if (new Set(value.models).size !== value.models.length) context.addIssue({ code: "custom", path: ["models"], message: "图片模型不能重复。" });
  value.models.forEach((model, index) => {
    if (!supported.models.some(entry => entry.id === model)) context.addIssue({ code: "custom", path: ["models", index], message: "请选择该服务商支持的图片生成模型。" });
  });
});
export type ImageCapability = z.infer<typeof ImageCapabilitySchema>;

export const ImageProviderInputSchema = z.object({
  provider: ImageProviderKindSchema,
  baseUrl: z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }, "请输入不含凭据和查询参数的 HTTPS 地址。"),
  apiKey: z.string().trim().max(2048),
  authMode: z.enum(["bearer", "x-api-key"]).optional(),
  enabled: z.boolean()
}).strict();
export type ImageProviderInput = z.infer<typeof ImageProviderInputSchema>;
export type ImageProviderView = Omit<ImageProviderInput, "apiKey"> & { id: string; name: string; models: string[]; configured: boolean };
export type ImageConfiguration = { providers: ImageProviderView[]; defaultSelection: ImageSelection | null };

export function imageProviderBaseUrl(baseUrl: string, provider: ImageProviderKind): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  // Google's text preset uses its OpenAI-compatible route; images use native REST.
  if (provider === "google" && /^https:\/\/generativelanguage\.googleapis\.com\/v1(?:beta)?\/openai$/.test(normalized)) return IMAGE_PROVIDERS[2].baseUrl;
  return normalized;
}

export const GenerateImageInputSchema = z.object({
  prompt: z.string().trim().min(1).max(16_000).describe("Describe the image to generate, including composition, style, aspect ratio and any exact text."),
  count: z.number().int().min(1).max(4).optional().describe("Number of images, 1 to 4. Defaults to 1."),
  referenceImages: z.array(z.string().min(1).max(4096)).max(8).optional().describe("Optional local image paths from this conversation or the OpenMind content root for editing/reference. Never URLs.")
}).strict();
export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

export const GeneratedImageSchema = z.object({
  id: z.string().uuid(),
  source: z.string().min(1),
  title: z.string(),
  provider: ImageProviderKindSchema,
  model: z.string(),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  createdAt: z.string(),
  batchId: z.string(),
  index: z.number().int().nonnegative()
});
export type GeneratedImage = z.infer<typeof GeneratedImageSchema>;

export const ChatImageRequestSchema = z.object({
  source: z.string().min(1).max(8192),
  variant: z.enum(["thumbnail", "original"]).default("thumbnail"),
  projectName: z.string().min(1).max(80).optional()
}).strict();
export type ChatImageRequest = z.input<typeof ChatImageRequestSchema>;
export type ChatImageData = { dataUrl: string; width: number; height: number };
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_TOOL_NAME = "openmind_generate_image";
export const IMAGE_TOOL_DESCRIPTION = "Generate or edit images using the image provider and model selected by the user in OpenMind. Use for requests to create pictures, illustrations, covers or edit an existing image. Images are saved and displayed directly in the conversation. Return a short description; do not repeat the generated images as Markdown. Never use shell commands or another image provider to bypass the user's selection.";
