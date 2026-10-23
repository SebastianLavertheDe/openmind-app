import { z } from "zod";
import { messages } from "./messages";

export const ImageProviderKindSchema = z.enum(["volcengine", "openai", "google"]);
export type ImageProviderKind = z.infer<typeof ImageProviderKindSchema>;

/** Public API model IDs (not marketing names).
 * https://docs.volcengine.com/docs/ark/model-list
 * https://developers.openai.com/api/docs/guides/image-generation
 * https://ai.google.dev/gemini-api/docs/generate-content/image-generation
 */
export const IMAGE_PROVIDERS = [
  { id: "volcengine", get name() { return messages.providerUi.providerNames.volcengine; }, baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: [
    { id: "doubao-seedream-5-0-flash-260915", name: "Doubao-Seedream-5.0-flash", get description() { return messages.providerUi.imageModels.seedreamFlash; } },
    { id: "doubao-seedream-5-0-pro-260628", name: "Doubao-Seedream-5.0-Pro", get description() { return messages.providerUi.imageModels.seedreamPro; } }
  ] },
  { id: "openai", get name() { return messages.providerUi.providerNames.openai; }, baseUrl: "https://api.openai.com/v1", models: [
    { id: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", get description() { return messages.providerUi.imageModels.imageSunburst; } },
    { id: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", get description() { return messages.providerUi.imageModels.imageFlare; } },
    { id: "gpt-image-2", name: "GPT Image 2", get description() { return messages.providerUi.imageModels.imageGeneral; } }
  ] },
  { id: "google", get name() { return messages.providerUi.providerNames.google; }, baseUrl: "https://generativelanguage.googleapis.com/v1", models: [
    { id: "gemini-nano-banana-2.1", name: "Nano Banana 2.1", get description() { return messages.providerUi.imageModels.banana21; } },
    { id: "gemini-3.1-flash-image", name: "Nano Banana 2", get description() { return messages.providerUi.imageModels.banana2; } },
    { id: "gemini-3-pro-image", name: "Nano Banana Pro", get description() { return messages.providerUi.imageModels.bananaPro; } }
  ] }
] as const;

export const ImageSelectionSchema = z.object({
  providerId: z.string().min(1).max(120).optional(),
  provider: ImageProviderKindSchema,
  model: z.string().min(1).max(160)
}).strict().refine(value => IMAGE_PROVIDERS.find(provider => provider.id === value.provider)?.models.some(model => model.id === value.model), { error: () => messages.providerUi.validation.imageModelProvider });
export type ImageSelection = z.infer<typeof ImageSelectionSchema>;

/** Opt-in generation capability on a shared text Provider connection. */
export const ImageCapabilitySchema = z.object({
  provider: ImageProviderKindSchema,
  models: z.array(z.string().min(1).max(160)).min(1, { error: () => messages.providerUi.validation.imageModelRequired }).max(8)
}).strict().superRefine((value, context) => {
  const supported = IMAGE_PROVIDERS.find(provider => provider.id === value.provider)!;
  if (new Set(value.models).size !== value.models.length) context.addIssue({ code: "custom", path: ["models"], message: messages.providerUi.validation.imageModelDuplicate });
  value.models.forEach((model, index) => {
    if (!supported.models.some(entry => entry.id === model)) context.addIssue({ code: "custom", path: ["models", index], message: messages.providerUi.validation.imageModelSupported });
  });
});
export type ImageCapability = z.infer<typeof ImageCapabilitySchema>;

export const ImageProviderInputSchema = z.object({
  provider: ImageProviderKindSchema,
  baseUrl: z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }, { error: () => messages.providerUi.validation.imageBaseUrl }),
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
export const IMAGE_TOOL_DESCRIPTION = "Generate or edit images using the image provider and model selected by the user in OpenMind. Use for pictures, illustrations, covers or image editing. Returns saved working resources, which may be intermediate assets for a presentation or video. Declare only the user's final deliverables using openmind-deliverables in the final reply. Never use shell commands or another image provider to bypass the user's selection.";
