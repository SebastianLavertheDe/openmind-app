// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_PROVIDERS, type GeneratedImage, type ImageProviderKind } from "../../shared/image-generation";
import { ImageGenerationService, requestImage, type ImageGenerationContext } from "./image-generation";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function context(provider: ImageProviderKind = "volcengine"): ImageGenerationContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-image-test-")); roots.push(root);
  const definition = IMAGE_PROVIDERS.find(item => item.id === provider)!;
  return { openmindRoot: root, cwd: root, sessionId: "session", runId: "run", callId: "call", selection: { provider, model: definition.models[0].id }, credentials: { provider, baseUrl: definition.baseUrl, apiKey: "fixture-secret", enabled: true }, signal: new AbortController().signal, onImage: vi.fn(async () => {}) };
}
const success = () => Response.json({ data: [{ b64_json: png.toString("base64") }] });

describe("image provider requests", () => {
  it.each(IMAGE_PROVIDERS.flatMap(provider => provider.models.map(model => ({ provider: provider.id, model: model.id }))))("uses the selected $provider / $model API", async selection => {
    const ctx = context(selection.provider);
    const request = vi.fn(async () => selection.provider === "google" ? Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64"), mimeType: "image/png" } }] } }] }) : success());
    const image = await requestImage(selection, ctx.credentials, "a leaf", [], ctx.signal, request);
    expect(image.bytes).toEqual(png);
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(options.body));
    expect(options.redirect).toBe("error");
    if (selection.provider === "google") {
      expect(url).toContain(`/models/${selection.model}:generateContent`);
      expect(options.headers).toHaveProperty("x-goog-api-key", "fixture-secret");
      expect(body.contents[0].parts[0].text).toBe("a leaf");
    } else {
      expect(url).toContain("/images/generations");
      expect(options.headers).toHaveProperty("Authorization", "Bearer fixture-secret");
      expect(body.model).toBe(selection.model);
      if (selection.provider === "volcengine") {
        expect(body.response_format).toBe("b64_json");
        expect(body.sequential_image_generation).toBeUndefined();
      }
    }
  });

  it("uses multipart editing for OpenAI references", async () => {
    const ctx = context("openai");
    const request = vi.fn(async () => success());
    await requestImage(ctx.selection, ctx.credentials, "make it green", [{ bytes: png, mediaType: "image/png" }], ctx.signal, request);
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/images/edits");
    expect((options.body as FormData).getAll("image[]")).toHaveLength(1);
    expect(options.headers).not.toHaveProperty("Content-Type");
  });

  it("reuses an API-key header configured on a shared gateway connection", async () => {
    const ctx = context("openai");
    const request = vi.fn(async () => success());
    await requestImage(ctx.selection, { ...ctx.credentials, authMode: "x-api-key" }, "leaf", [], ctx.signal, request);
    const [, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(options.headers).toHaveProperty("x-api-key", "fixture-secret");
    expect(options.headers).not.toHaveProperty("Authorization");
  });

  it("does not retry billable requests or expose provider error bodies", async () => {
    const ctx = context();
    const request = vi.fn(async () => Response.json({ error: { message: "fixture-secret" } }, { status: 429 }));
    await expect(requestImage(ctx.selection, ctx.credentials, "leaf", [], ctx.signal, request)).rejects.toThrow("HTTP 429");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects blocked and non-image results", async () => {
    const ctx = context("google");
    await expect(requestImage(ctx.selection, ctx.credentials, "leaf", [], ctx.signal, async () => Response.json({ candidates: [] }))).rejects.toThrow("未返回图片");
    const other = context();
    await expect(requestImage(other.selection, other.credentials, "leaf", [], other.signal, async () => Response.json({ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }))).rejects.toThrow("无法识别");
  });
  it("explains Volcano activation failures without exposing the provider's account data", async () => {
    const ctx = context();
    const request = async () => Response.json({ error: { code: "ModelNotOpen", message: "private-account-details fixture-secret" } }, { status: 404 });
    await expect(requestImage(ctx.selection, ctx.credentials, "leaf", [], ctx.signal, request)).rejects.toThrow("当前账号尚未开通该模型");
  });
});

describe("durable generated images", () => {
  it("publishes each saved image and deduplicates repeated call delivery", async () => {
    const ctx = context();
    const request = vi.fn(async () => success());
    const service = new ImageGenerationService(request);
    const first = service.generate({ prompt: "leaf", count: 3 }, ctx);
    expect(service.generate({ prompt: "leaf", count: 3 }, ctx)).toBe(first);
    const images = await first;
    expect(request).toHaveBeenCalledTimes(3);
    expect(ctx.onImage).toHaveBeenCalledTimes(3);
    for (const image of images) {
      expect(image.source).toMatch(/^openmind\/assets\/generated-images\//);
      expect(fs.readFileSync(path.join(ctx.openmindRoot, image.source.slice(9)))).toEqual(png);
    }
  });
  it("retains completed images when a later generation fails", async () => {
    const ctx = context();
    const request = vi.fn().mockResolvedValueOnce(success()).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(new ImageGenerationService(request).generate({ prompt: "leaf", count: 3 }, ctx)).rejects.toThrow("HTTP 503");
    expect(ctx.onImage).toHaveBeenCalledTimes(1);
    const image = vi.mocked(ctx.onImage).mock.calls[0][0] as GeneratedImage;
    expect(fs.existsSync(path.join(ctx.openmindRoot, image.source.slice(9)))).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("stops between images and never calls providers for outside references", async () => {
    const ctx = context();
    const abort = new AbortController(); ctx.signal = abort.signal;
    ctx.onImage = vi.fn(async () => abort.abort());
    const request = vi.fn(async () => success());
    await expect(new ImageGenerationService(request).generate({ prompt: "leaf", count: 2 }, ctx)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    const outside = context();
    await expect(new ImageGenerationService(request).generate({ prompt: "leaf", referenceImages: [path.join(outside.openmindRoot, "outside.png")] }, context())).rejects.toThrow("参考图片不在");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
