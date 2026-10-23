import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { GenerateImageInputSchema, IMAGE_MAX_BYTES, ImageSelectionSchema, type GeneratedImage, type GenerateImageInput, type ImageProviderInput, type ImageSelection } from "../../shared/image-generation";
import { resolvePathInsideRoot } from "../ai/scheduler-paths";
import { OpenmindPathResolver } from "../paths/openmind-path-resolver";

type ReferenceImage = { bytes: Buffer; mediaType: string };
type ImageBytes = { bytes: Buffer; mediaType: GeneratedImage["mediaType"] };
export type ImageGenerationContext = {
  openmindRoot: string;
  cwd: string;
  sessionId: string;
  runId: string;
  callId: string;
  selection: ImageSelection;
  credentials: ImageProviderInput;
  signal: AbortSignal;
  attachmentPaths?: readonly string[];
  onImage(image: GeneratedImage): Promise<void>;
};

export function imageMime(bytes: Buffer): GeneratedImage["mediaType"] {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("服务商返回了无法识别的图片格式。");
}

function decodeImage(value: unknown): ImageBytes {
  if (typeof value !== "string" || !value || value.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("服务商返回的图片为空、格式无效或超过 20 MB。");
  }
  const bytes = Buffer.from(value, "base64");
  return { bytes, mediaType: imageMime(bytes) };
}

async function boundedJson(response: Response, maxBytes = IMAGE_MAX_BYTES * 1.5): Promise<Record<string, any>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("图片服务返回了空响应。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw new Error("图片服务响应过大。");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => undefined); }
}

/** No automatic POST retry: a timeout can already represent a paid generation. */
export async function requestImage(selection: ImageSelection, credentials: ImageProviderInput, prompt: string, references: ReferenceImage[], signal: AbortSignal, request: typeof fetch = fetch): Promise<ImageBytes> {
  const baseUrl = credentials.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  let url: string;
  let body: BodyInit;
  if (selection.provider === "google") {
    url = `${baseUrl}/models/${encodeURIComponent(selection.model)}:generateContent`;
    headers["x-goog-api-key"] = credentials.apiKey;
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, ...references.map(image => ({ inlineData: { mimeType: image.mediaType, data: image.bytes.toString("base64") } }))] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } });
  } else {
    if (credentials.authMode === "x-api-key") headers["x-api-key"] = credentials.apiKey;
    else headers.Authorization = `Bearer ${credentials.apiKey}`;
    if (selection.provider === "openai" && references.length) {
      url = `${baseUrl}/images/edits`;
      const form = new FormData();
      form.set("model", selection.model);
      form.set("prompt", prompt);
      form.set("output_format", "png");
      references.forEach((image, index) => form.append("image[]", new Blob([new Uint8Array(image.bytes)], { type: image.mediaType }), `reference-${index}.${image.mediaType === "image/jpeg" ? "jpg" : image.mediaType.split("/")[1]}`));
      body = form;
    } else {
      url = `${baseUrl}/images/generations`;
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ model: selection.model, prompt, output_format: "png", ...(selection.provider === "volcengine" ? { response_format: "b64_json", size: "2K", watermark: false, ...(references.length ? { image: references.map(image => `data:${image.mediaType};base64,${image.bytes.toString("base64")}`) } : {}) } : { n: 1 }) });
    }
  }
  const response = await request(url, { method: "POST", headers, body, signal, redirect: "error" });
  if (!response.ok) {
    // Map known codes, never echo provider messages which can contain credentials.
    const failure: Record<string, any> = await boundedJson(response, 65_536).catch(() => ({}));
    const code = failure.error?.code;
    const hint = code === "ModelNotOpen" ? "当前账号尚未开通该模型，请在火山方舟控制台开通模型服务"
      : response.status === 401 || response.status === 403 ? "请检查 API Key 和模型权限"
      : response.status === 404 ? "模型不可用，请检查模型开通状态和接口地址"
      : response.status === 429 ? "请求频率或额度受限，请稍后重试" : "请检查模型和接口配置后重试";
    throw new Error(`图片生成失败（HTTP ${response.status}）：${hint}。`);
  }
  const result = await boundedJson(response);
  if (selection.provider === "google") {
    const parts = result.candidates?.[0]?.content?.parts;
    const part = Array.isArray(parts) ? parts.find(part => !part.thought && (part.inlineData?.data || part.inline_data?.data)) : null;
    if (!part) throw new Error("Google 未返回图片，可能触发了内容限制，请调整描述后重试。");
    return decodeImage(part.inlineData?.data ?? part.inline_data?.data);
  }
  if (!result.data?.[0]?.b64_json) throw new Error("服务商未返回图片数据，请检查模型能力或调整描述。");
  return decodeImage(result.data[0].b64_json);
}

export class ImageGenerationService {
  private readonly calls = new Map<string, Promise<GeneratedImage[]>>();
  constructor(private readonly request: typeof fetch = fetch) {}

  generate(raw: GenerateImageInput, context: ImageGenerationContext): Promise<GeneratedImage[]> {
    const key = `${context.runId}:${context.callId}`;
    const existing = this.calls.get(key);
    if (existing) return existing;
    const job = this.execute(GenerateImageInputSchema.parse(raw), context);
    this.calls.set(key, job);
    return job;
  }

  private async execute(input: GenerateImageInput, context: ImageGenerationContext): Promise<GeneratedImage[]> {
    ImageSelectionSchema.parse(context.selection);
    if (context.credentials.provider !== context.selection.provider) throw new Error("图片服务商与模型配置不匹配。");
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(600_000)]);
    const references: ReferenceImage[] = [];
    for (const source of input.referenceImages || []) {
      const rawPath = source.startsWith("openmind/") ? path.resolve(context.openmindRoot, source.slice(9)) : path.resolve(context.cwd, source);
      const file = context.attachmentPaths?.includes(rawPath) ? rawPath : resolvePathInsideRoot(context.openmindRoot, rawPath, "参考图片不在当前内容目录内。");
      const handle = await fs.open(file, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > IMAGE_MAX_BYTES) throw new Error("参考图片超过 20 MB 或不是文件。");
        const bytes = await handle.readFile();
        if (bytes.length > IMAGE_MAX_BYTES) throw new Error("参考图片超过 20 MB。");
        references.push({ bytes, mediaType: imageMime(bytes) });
      } finally { await handle.close(); }
    }
    const resolver = new OpenmindPathResolver({ rootPath: context.openmindRoot, rootId: "image-generation", rootGeneration: 1 });
    const sessionFolder = crypto.createHash("sha256").update(context.sessionId).digest("hex").slice(0, 24);
    const images: GeneratedImage[] = [];
    for (let index = 0; index < (input.count || 1); index++) {
      signal.throwIfAborted();
      let generated: ImageBytes;
      try { generated = await requestImage(context.selection, context.credentials, input.prompt, references, signal, this.request); }
      catch (error) {
        if (signal.aborted) throw new Error(context.signal.aborted ? "图片生成已取消。" : "图片生成超时；结果未知，请确认后再重试。");
        throw error;
      }
      signal.throwIfAborted();
      const id = crypto.randomUUID();
      const extension = generated.mediaType === "image/jpeg" ? "jpg" : generated.mediaType.split("/")[1];
      const logical = `assets/generated-images/${sessionFolder}/${id}.${extension}`;
      const target = resolver.resolve(logical, "write").physicalPath;
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Recheck after mkdir before the exclusive write.
      const resolvedTarget = resolver.resolve(logical, "write").physicalPath;
      await fs.writeFile(resolvedTarget, generated.bytes, { flag: "wx", mode: 0o600 });
      const image: GeneratedImage = { id, source: `openmind/${logical}`, title: input.prompt.slice(0, 100), ...context.selection, mediaType: generated.mediaType, createdAt: new Date().toISOString(), batchId: context.callId, index };
      images.push(image);
      await context.onImage(image);
    }
    return images;
  }
}
