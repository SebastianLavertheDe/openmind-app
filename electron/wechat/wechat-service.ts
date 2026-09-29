import fs from "node:fs/promises";
import path from "node:path";
import {
  WECHAT_BODY_IMAGE_MAX_BYTES, WECHAT_COVER_MAX_BYTES,
  WechatCopyInputSchema, WechatDraftInputSchema,
  type WechatAccountInput, type WechatAccountView, type WechatCopyInput,
  type WechatCover, type WechatDraftInput, type WechatDraftResult
} from "../../shared/wechat";
import { safeHttpGet } from "../project/converters/safe-http";
import { WechatAccountStore, type WechatCredentials } from "./wechat-account-store";
import { sanitizeWechatHtml, wechatDocument } from "./wechat-html";

const API_ORIGIN = "https://api.weixin.qq.com";
const TOKEN_ERRORS = new Set([40001, 40014, 42001]);
const IMAGE_COUNT_LIMIT = 50;
type ImageData = { bytes: Buffer; mime: string; name: string };
export type WechatArticleScope = { resolveImage(source: string): string };
type ServiceOptions = {
  accountStore: WechatAccountStore;
  resolveArticle(projectName: string, outputPath: string): WechatArticleScope;
  writeClipboard(input: WechatCopyInput): void;
  fetch?: typeof fetch;
  downloadImage?: (url: string) => Promise<Buffer>;
  now?: () => number;
};
type PushContext = { account: WechatCredentials; refreshed: boolean };

class WechatApiError extends Error {
  constructor(readonly code: number) {
    const explanations: Record<number, string> = {
      40001: "公众号调用凭据无效，请稍后重试。", 40014: "公众号调用凭据无效，请稍后重试。", 42001: "公众号调用凭据已过期，请稍后重试。",
      40013: "AppID 无效，请检查公众号设置。", 40125: "AppSecret 无效，请检查公众号设置。",
      40164: "当前网络的公网出口 IP 不在公众号白名单中，请在微信公众平台添加后重试。",
      48001: "该公众号没有此接口权限，请检查认证状态和草稿箱接口权限。",
      40007: "封面素材无效，请重新选择封面。", 40005: "图片格式不受微信支持，请使用 JPG 或 PNG。",
      40009: "图片过大，请压缩图片后重试。", 45003: "标题超出微信长度限制，请缩短标题。",
      45004: "正文超出微信长度限制，请缩短文章或减少排版。", 45009: "公众号接口调用额度已用完，请稍后重试。",
      45011: "公众号接口调用过于频繁，请稍后重试。", 89503: "此次连接需要公众号管理员确认，请确认后重试。"
    };
    // Never expose errmsg: upstream errors can echo AppSecret or access_token.
    super(`${explanations[code] || "微信接口拒绝了请求，请检查公众号配置和接口权限。"}（错误码 ${code}）`);
  }
}

export class WechatService {
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private token: { value: string; appId: string; expiresAt: number } | null = null;
  private readonly covers = new Map<string, ImageData>();
  private pushing = false;

  constructor(private readonly options: ServiceOptions) {
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  getAccount(): WechatAccountView { return this.options.accountStore.getView(); }

  saveAccount(input: WechatAccountInput): WechatAccountView {
    this.assertIdle();
    const account = this.options.accountStore.save(input);
    this.token = null;
    return account;
  }

  disconnectAccount(): void {
    this.assertIdle();
    this.options.accountStore.disconnect();
    this.token = null;
    this.covers.clear();
  }

  /** Called only after an affirmative native picker result, never with renderer-supplied paths. */
  async authorizeCover(filePath: string): Promise<WechatCover> {
    const image = await readLocalImage(filePath, WECHAT_COVER_MAX_BYTES, "封面");
    // Keep the selected bytes as the grant so replacing the file cannot change what gets uploaded.
    this.covers.set(filePath, image);
    while (this.covers.size > 8) this.covers.delete(this.covers.keys().next().value!);
    return { path: filePath, name: image.name, previewUrl: `data:${image.mime};base64,${image.bytes.toString("base64")}` };
  }

  copyArticle(raw: WechatCopyInput): void {
    const input = WechatCopyInputSchema.parse(raw);
    this.options.writeClipboard({ html: sanitizeWechatHtml(input.html), text: input.text });
  }

  async pushDraft(raw: WechatDraftInput): Promise<WechatDraftResult> {
    const input = WechatDraftInputSchema.parse(raw);
    this.assertIdle();
    this.pushing = true;
    try {
      const account = this.options.accountStore.read();
      if (!account) throw new Error("请先在设置中配置微信公众号 AppID 和 AppSecret。 ");
      const cover = this.covers.get(input.coverPath);
      if (!cover) throw new Error("封面选择已失效，请重新选择文章封面。 ");
      const scope = this.options.resolveArticle(input.projectName, input.outputPath);
      const context: PushContext = { account, refreshed: false };
      const dom = wechatDocument(input.html);
      try {
        // Inline CSS counts toward the API's HTML limit. Do this before uploading any material.
        const sizePreview = dom.window.document.body.cloneNode(true) as HTMLElement;
        // Uploaded URLs replace data/local sources, so their original byte length is not article content.
        for (const image of Array.from(sizePreview.querySelectorAll("img"))) image.setAttribute("src", "");
        assertContentSize(sizePreview.innerHTML);
        const images = Array.from(dom.window.document.body.querySelectorAll("img"));
        if (images.length > IMAGE_COUNT_LIMIT) throw new Error("单篇文章最多支持 50 张正文图片，请减少图片后重试。 ");
        const prepared = new Map<string, ImageData>();
        // Validate all images before performing any external mutation.
        for (const image of images) {
          const source = (image.getAttribute("src") || "").trim();
          if (!source) throw new Error("正文包含无法导出的图片，请检查图片地址。 ");
          if (!prepared.has(source)) prepared.set(source, await this.readBodyImage(source, scope));
        }
        const uploaded = new Map<string, string>();
        for (const [source, image] of prepared) {
          const result = await this.api(context, "/cgi-bin/media/uploadimg", () => imageForm(image));
          if (typeof result.url !== "string" || !/^https?:\/\//i.test(result.url)) throw new Error("微信未返回正文图片地址，请稍后重试。 ");
          uploaded.set(source, result.url);
        }
        for (const image of images) image.setAttribute("src", uploaded.get((image.getAttribute("src") || "").trim())!);
        const html = dom.window.document.body.innerHTML;
        assertContentSize(html);
        const coverResult = await this.api(context, "/cgi-bin/material/add_material", () => imageForm(cover), { type: "image" });
        if (typeof coverResult.media_id !== "string" || !coverResult.media_id) throw new Error("微信未返回封面素材编号，请重新选择封面后重试。 ");
        const articles = [{
          article_type: "news", title: input.title, author: input.author ?? account.author,
          ...(input.digest ? { digest: input.digest } : {}), content: html, content_source_url: "",
          thumb_media_id: coverResult.media_id, need_open_comment: 0, only_fans_can_comment: 0
        }];
        const result = await this.api(context, "/cgi-bin/draft/add", () => JSON.stringify({ articles }));
        if (typeof result.media_id !== "string" || !result.media_id) throw new Error("微信未返回草稿编号，请先在微信公众平台检查草稿箱，避免重复推送。 ");
        return { mediaId: result.media_id };
      } finally {
        dom.window.close();
      }
    } finally {
      this.pushing = false;
    }
  }

  private assertIdle(): void {
    if (this.pushing) throw new Error("正在推送公众号草稿，请等待当前操作完成。 ");
  }

  private async readBodyImage(source: string, scope: WechatArticleScope): Promise<ImageData> {
    if (/^data:/i.test(source)) {
      const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(source);
      if (!match) throw new Error("正文内嵌图片仅支持 JPG 和 PNG。 ");
      const bytes = Buffer.from(match[2], "base64");
      return validateImage(bytes, WECHAT_BODY_IMAGE_MAX_BYTES, "正文图片", `image.${match[1]}`);
    }
    if (/^https?:\/\//i.test(source)) {
      try {
        const bytes = this.options.downloadImage
          ? await this.options.downloadImage(source)
          : (await safeHttpGet(source, { maxBytes: WECHAT_BODY_IMAGE_MAX_BYTES, timeoutMs: 20_000, accept: "image/png,image/jpeg" })).body;
        return validateImage(bytes, WECHAT_BODY_IMAGE_MAX_BYTES, "正文图片", "image");
      } catch {
        throw new Error("正文网络图片无法读取：请使用可公开访问的 JPG/PNG 图片，且每张小于 1 MB。 ");
      }
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith("/") || source.startsWith("\\") || source.includes("\0")) {
      throw new Error("正文图片必须位于当前项目中，或使用公开的 HTTP/HTTPS 图片地址。 ");
    }
    let decoded: string;
    try { decoded = decodeURIComponent(source.split(/[?#]/)[0]); } catch { throw new Error("正文图片地址编码无效。 "); }
    if (path.isAbsolute(decoded) || decoded.includes("\\") || decoded.includes("\0")) throw new Error("正文图片地址无效。 ");
    return readLocalImage(scope.resolveImage(decoded), WECHAT_BODY_IMAGE_MAX_BYTES, "正文图片");
  }

  private async getToken(account: WechatCredentials, forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token?.appId === account.appId && this.now() < this.token.expiresAt) return this.token.value;
    const result = await this.requestJson("/cgi-bin/stable_token", JSON.stringify({
      grant_type: "client_credential", appid: account.appId, secret: account.appSecret, force_refresh: forceRefresh
    }));
    if (typeof result.access_token !== "string" || !result.access_token || typeof result.expires_in !== "number" || result.expires_in <= 0) {
      throw new Error("微信未返回有效调用凭据，请检查公众号配置。 ");
    }
    this.token = { value: result.access_token, appId: account.appId, expiresAt: this.now() + Math.max(0, result.expires_in - 300) * 1000 };
    return this.token.value;
  }

  private async api(context: PushContext, endpoint: string, body: () => string | FormData, parameters: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const token = await this.getToken(context.account);
    try {
      return await this.requestJson(endpoint, body(), { ...parameters, access_token: token });
    } catch (error) {
      // Only explicit token rejection is safe to retry. Never repeat draft/add after transport/JSON errors.
      if (!(error instanceof WechatApiError) || !TOKEN_ERRORS.has(error.code) || context.refreshed) throw error;
      context.refreshed = true;
      const replacement = await this.getToken(context.account, true);
      return this.requestJson(endpoint, body(), { ...parameters, access_token: replacement });
    }
  }

  private async requestJson(endpoint: string, body: string | FormData, parameters: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const url = new URL(endpoint, API_ORIGIN);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    try {
      const response = await this.request(url, {
        method: "POST", body, redirect: "error", signal: AbortSignal.timeout(30_000),
        ...(typeof body === "string" ? { headers: { "content-type": "application/json; charset=utf-8" } } : {})
      });
      if (!response.ok) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 64 * 1024) { await reader.cancel(); throw new Error(); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
      if (typeof result.errcode === "number" && result.errcode !== 0) throw new WechatApiError(result.errcode);
      return result;
    } catch (error) {
      if (error instanceof WechatApiError) throw error;
      // Native fetch errors can contain the complete token-bearing URL: discard their messages.
      throw new Error(endpoint === "/cgi-bin/draft/add"
        ? "未能确认草稿推送结果。请先在微信公众平台检查草稿箱，再决定是否重试，避免重复创建。 "
        : "连接微信接口失败或请求超时，请检查网络后重试。 ");
    }
  }
}

function assertContentSize(html: string): void {
  if (html.length >= 20_000 || Buffer.byteLength(html) >= 1024 * 1024) throw new Error("排版后的正文超过微信公众号接口限制，请缩短文章或使用简洁排版。 ");
}

function imageForm(image: ImageData): FormData {
  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(image.bytes)], { type: image.mime }), image.name);
  return form;
}

function validateImage(bytes: Buffer, maxBytes: number, label: string, name: string): ImageData {
  if (bytes.length === 0 || bytes.length > maxBytes) throw new Error(`${label}过大或为空，请使用${maxBytes < 1024 * 1024 ? "小于 1 MB" : "不超过 10 MB"}的图片。`);
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw new Error(`${label}仅支持 JPG 或 PNG 图片。`);
  const extension = png ? ".png" : ".jpg";
  return { bytes, mime: png ? "image/png" : "image/jpeg", name: `${path.parse(name).name}${extension}` };
}

async function readLocalImage(filePath: string, maxBytes: number, label: string): Promise<ImageData> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`${label}需为${maxBytes < 1024 * 1024 ? "小于 1 MB" : "不超过 10 MB"}的 JPG/PNG 文件。`);
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    return validateImage(bytes.subarray(0, offset), maxBytes, label, path.basename(filePath));
  } finally { await handle.close(); }
}
