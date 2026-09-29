// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WechatAccountStore } from "./wechat-account-store";
import { WechatService } from "./wechat-service";
import { ProjectPathResolver } from "../project/project-path-resolver";
import { sanitizeWechatHtml } from "./wechat-html";
import type { WechatDraftInput } from "../../shared/wechat";

const roots: string[] = [];
const ACCOUNT = { appId: "wx1234567890abcdef", appSecret: "1234567890abcdef1234567890abcdef", author: "默认作者" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64");
const TOKEN = "private-wechat-access-token";
function json(value: unknown) { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }
function fixture(responses: Array<unknown | Error> = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-wechat-service-"));
  roots.push(root);
  const accountStore = new WechatAccountStore(path.join(root, "user-data"), {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(value).toString("base64")),
    decryptString: (value) => Buffer.from(value.toString(), "base64").toString()
  });
  accountStore.save(ACCOUNT);
  const content = path.join(root, "content");
  fs.mkdirSync(content);
  const paths = new ProjectPathResolver(content);
  paths.initialize();
  const project = paths.createProjectRoot("项目");
  fs.mkdirSync(path.join(project.rootPath, "outputs"));
  fs.mkdirSync(path.join(project.rootPath, "materials"));
  fs.writeFileSync(path.join(project.rootPath, "outputs/article.md"), "# 文章");
  fs.writeFileSync(path.join(project.rootPath, "materials/inline.png"), PNG);
  const coverPath = path.join(root, "cover.png");
  fs.writeFileSync(coverPath, PNG);
  const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error("unexpected API request");
    return json(response);
  });
  const clipboard = vi.fn();
  const resolveArticle = vi.fn((projectName: string, outputPath: string) => {
    if (outputPath !== "outputs/article.md") throw new Error("项目成品不存在");
    paths.resolveInsideProject(projectName, outputPath, { allowedTopLevels: ["outputs"] });
    return { resolveImage: (source: string) => paths.resolveInsideProject(projectName, path.posix.normalize(path.posix.join(path.posix.dirname(outputPath), source)), { allowedTopLevels: ["outputs", "materials"] }) };
  });
  const service = new WechatService({ accountStore, resolveArticle, writeClipboard: clipboard, fetch: request });
  const input: WechatDraftInput = { projectName: "项目", outputPath: "outputs/article.md", title: "文章", html: "<p>正文</p>", coverPath };
  return { root, project, service, accountStore, request, clipboard, resolveArticle, coverPath, input };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("WechatService", () => {
  it("uploads scoped body images, a permanent cover, and a draft with the default author", async () => {
    const ctx = fixture([{ access_token: TOKEN, expires_in: 7200 }, { url: "https://mmbiz.qpic.cn/article.png" }, { media_id: "cover-id" }, { media_id: "draft-id" }]);
    const cover = await ctx.service.authorizeCover(ctx.coverPath);
    expect(cover.previewUrl).toMatch(/^data:image\/png;base64,/);
    const result = await ctx.service.pushDraft({ ...ctx.input, html: '<p>正文</p><img src="../materials/inline.png"><img src="../materials/inline.png">', digest: "摘要" });
    expect(result).toEqual({ mediaId: "draft-id" });
    expect(ctx.request).toHaveBeenCalledTimes(4);
    expect(new URL(String(ctx.request.mock.calls[0][0])).pathname).toBe("/cgi-bin/stable_token");
    expect(JSON.parse(String(ctx.request.mock.calls[0][1]?.body))).toEqual({ grant_type: "client_credential", appid: ACCOUNT.appId, secret: ACCOUNT.appSecret, force_refresh: false });
    const imageBody = ctx.request.mock.calls[1][1]?.body as FormData;
    expect(imageBody.get("media")).toBeInstanceOf(Blob);
    expect(new URL(String(ctx.request.mock.calls[2][0])).searchParams.get("type")).toBe("image");
    const draft = JSON.parse(String(ctx.request.mock.calls[3][1]?.body)).articles[0];
    expect(draft).toMatchObject({ article_type: "news", title: "文章", author: ACCOUNT.author, digest: "摘要", thumb_media_id: "cover-id", need_open_comment: 0 });
    expect(draft.content.match(/https:\/\/mmbiz.qpic.cn\/article.png/g)).toHaveLength(2);
    expect(draft.content).not.toContain("../materials");
    expect(ctx.request.mock.calls.every(([, init]) => init?.redirect === "error" && init.signal)).toBe(true);
  });

  it("caches tokens between pushes and never publishes a draft", async () => {
    const ctx = fixture([{ access_token: TOKEN, expires_in: 7200 }, { media_id: "cover-1" }, { media_id: "draft-1" }, { media_id: "cover-2" }, { media_id: "draft-2" }]);
    await ctx.service.authorizeCover(ctx.coverPath);
    await ctx.service.pushDraft(ctx.input);
    await ctx.service.pushDraft(ctx.input);
    const endpoints = ctx.request.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(endpoints.filter((value) => value === "/cgi-bin/stable_token")).toHaveLength(1);
    expect(endpoints.filter((value) => value === "/cgi-bin/draft/add")).toHaveLength(2);
    expect(endpoints.some((value) => /freepublish|mass/.test(value))).toBe(false);
  });

  it("refreshes once after explicit token rejection and reuses previously uploaded materials", async () => {
    const ctx = fixture([{ access_token: TOKEN, expires_in: 7200 }, { media_id: "cover-id" }, { errcode: 42001 }, { access_token: "replacement-token", expires_in: 7200 }, { media_id: "draft-id" }]);
    await ctx.service.authorizeCover(ctx.coverPath);
    expect(await ctx.service.pushDraft(ctx.input)).toEqual({ mediaId: "draft-id" });
    expect(JSON.parse(String(ctx.request.mock.calls[3][1]?.body)).force_refresh).toBe(true);
    expect(ctx.request.mock.calls.filter(([url]) => String(url).includes("add_material"))).toHaveLength(1);
    expect(ctx.request.mock.calls.filter(([url]) => String(url).includes("draft/add"))).toHaveLength(2);
  });

  it("stops after one token refresh and never echoes upstream error messages", async () => {
    const ctx = fixture([{ access_token: TOKEN, expires_in: 7200 }, { errcode: 40014 }, { access_token: "replacement", expires_in: 7200 }, { errcode: 40014, errmsg: `${ACCOUNT.appSecret} ${TOKEN}` }]);
    await ctx.service.authorizeCover(ctx.coverPath);
    await expect(ctx.service.pushDraft(ctx.input)).rejects.toThrow("错误码 40014");
    expect(ctx.request).toHaveBeenCalledTimes(4);
  });

  it("does not retry an ambiguous draft network failure and hides secret-bearing transport errors", async () => {
    const ctx = fixture([{ access_token: TOKEN, expires_in: 7200 }, { media_id: "cover-id" }, new Error(`failed: ${TOKEN} ${ACCOUNT.appSecret}`)]);
    await ctx.service.authorizeCover(ctx.coverPath);
    const failure = await ctx.service.pushDraft(ctx.input).catch((error: Error) => error);
    expect(String(failure)).toContain("检查草稿箱");
    expect(String(failure)).not.toContain(TOKEN);
    expect(String(failure)).not.toContain(ACCOUNT.appSecret);
    expect(ctx.request).toHaveBeenCalledTimes(3);
  });

  it("surfaces whitelist failures without raw server text", async () => {
    const ctx = fixture([{ errcode: 40164, errmsg: `invalid ip secret=${ACCOUNT.appSecret}` }]);
    await ctx.service.authorizeCover(ctx.coverPath);
    const failure = await ctx.service.pushDraft(ctx.input).catch((error: Error) => error);
    expect(String(failure)).toContain("公网出口 IP");
    expect(String(failure)).not.toContain(ACCOUNT.appSecret);
  });

  it("requires picker authorization and sends the exact selected cover bytes", async () => {
    const ctx = fixture([{ access_token: TOKEN, expires_in: 7200 }, { media_id: "cover-id" }, { media_id: "draft-id" }]);
    await expect(ctx.service.pushDraft(ctx.input)).rejects.toThrow("重新选择");
    expect(ctx.request).not.toHaveBeenCalled();
    await ctx.service.authorizeCover(ctx.coverPath);
    fs.writeFileSync(ctx.coverPath, "replacement secret");
    await ctx.service.pushDraft(ctx.input);
    const uploaded = (ctx.request.mock.calls[1][1]?.body as FormData).get("media") as Blob;
    expect(Buffer.from(await uploaded.arrayBuffer())).toEqual(PNG);
  });

  it.each(["../../../../credentials/secret.png", "/etc/private.png", "file:///etc/private.png", "%2Fetc/private.png", "../materials/symlink.png", "http://127.0.0.1/private.png"])("rejects unsafe images before API calls: %s", async (source) => {
    const ctx = fixture();
    fs.symlinkSync(ctx.coverPath, path.join(ctx.project.rootPath, "materials/symlink.png"));
    await ctx.service.authorizeCover(ctx.coverPath);
    await expect(ctx.service.pushDraft({ ...ctx.input, html: `<img src="${source}">` })).rejects.toThrow();
    expect(ctx.request).not.toHaveBeenCalled();
  });

  it("requires an existing project output and rejects unsupported or oversized images", async () => {
    const ctx = fixture();
    await ctx.service.authorizeCover(ctx.coverPath);
    await expect(ctx.service.pushDraft({ ...ctx.input, outputPath: "outputs/missing.md" })).rejects.toThrow("成品不存在");
    fs.writeFileSync(path.join(ctx.project.rootPath, "materials/inline.png"), Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]));
    await expect(ctx.service.pushDraft({ ...ctx.input, html: '<img src="../materials/inline.png">' })).rejects.toThrow("小于 1 MB");
    expect(ctx.request).not.toHaveBeenCalled();
  });

  it("rejects oversized formatted content before uploading any image or cover", async () => {
    const ctx = fixture();
    await ctx.service.authorizeCover(ctx.coverPath);
    await expect(ctx.service.pushDraft({ ...ctx.input, html: `<p>${"字".repeat(20_000)}</p><img src="../materials/inline.png">` })).rejects.toThrow("正文超过");
    expect(ctx.request).not.toHaveBeenCalled();
  });

  it("replaces embedded image data before applying the article HTML length limit", async () => {
    const ctx = fixture([{ access_token: TOKEN, expires_in: 7200 }, { url: "https://mmbiz.qpic.cn/image.png" }, { media_id: "cover" }, { media_id: "draft" }]);
    await ctx.service.authorizeCover(ctx.coverPath);
    const bytes = Buffer.concat([PNG, Buffer.alloc(30_000)]);
    const html = `<img src="data:image/png;base64,${bytes.toString("base64")}"><p>正文</p>`;
    expect(html.length).toBeGreaterThan(20_000);
    await expect(ctx.service.pushDraft({ ...ctx.input, html })).resolves.toEqual({ mediaId: "draft" });
  });

  it("blocks duplicate pushes and credential changes while a push is in flight", async () => {
    const ctx = fixture([{ media_id: "cover-id" }, { media_id: "draft-id" }]);
    let release!: (response: Response) => void;
    ctx.request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    await ctx.service.authorizeCover(ctx.coverPath);
    const pending = ctx.service.pushDraft(ctx.input);
    await expect(ctx.service.pushDraft(ctx.input)).rejects.toThrow("正在推送");
    expect(() => ctx.service.saveAccount(ACCOUNT)).toThrow("正在推送");
    expect(() => ctx.service.disconnectAccount()).toThrow("正在推送");
    release(json({ access_token: TOKEN, expires_in: 7200 }));
    await expect(pending).resolves.toEqual({ mediaId: "draft-id" });
  });

  it("copies rich HTML and plain text with inline styles while removing executable content", () => {
    const ctx = fixture();
    ctx.service.copyArticle({ html: '<p style="color:red">正文<strong>加粗</strong></p><script>evil()</script><img src="https://example.com/a.png" onerror="evil()"><a href="javascript:evil()">链接</a><span style="background:url(file:///secret)">文字</span>', text: "正文加粗链接文字" });
    const copied = ctx.clipboard.mock.calls[0][0];
    expect(copied.text).toBe("正文加粗链接文字");
    expect(copied.html).toContain('style="color:red"');
    expect(copied.html).not.toMatch(/script|onerror|javascript|file:|url\(/i);
    expect(sanitizeWechatHtml('<svg><script>evil()</script></svg><iframe src="https://evil.test"></iframe><p>正文</p>')).toBe("<p>正文</p>");
    expect(sanitizeWechatHtml('<p style="background-image:image-set(\'http://127.0.0.1/private.png\' 1x)">正文</p>')).toBe("<p>正文</p>");
  });
});
