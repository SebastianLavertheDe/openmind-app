// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YoutubeToolId } from "../../shared/youtube-import";
import { YoutubeToolsService } from "./youtube-tools-service";
import type { ToolTransport } from "./youtube-tool-releases";

const roots: string[] = [];
beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live network forbidden in these tests")); });
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { force: true, recursive: true }); });
const digest = (data: Buffer) => crypto.createHash("sha256").update(data).digest("hex");

function tar(entries: Array<{ name: string; body: string; type?: string }>): Buffer {
  return gzipSync(Buffer.concat([...entries.flatMap(entry => {
    const bytes = Buffer.from(entry.body);
    const header = Buffer.alloc(512);
    header.write(entry.name);
    header.write(bytes.length.toString(8).padStart(11, "0"), 124);
    header.write(entry.type ?? "0", 156);
    header.fill(32, 148, 156);
    header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0"), 148);
    return [header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)];
  }), Buffer.alloc(1024)]));
}

function setup(options: { platform?: NodeJS.Platform; arch?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-tools-unit-"));
  roots.push(root);
  const versions: Record<string, string> = {};
  const responses = new Map<string, Buffer>();
  const detector = {
    browsers: () => [{ id: "firefox" as const, name: "Firefox" }],
    findTool: (id: string) => versions[id] ? path.join(root, "system", id) : undefined
  };
  const run = vi.fn(async (file: string, _args: string[]) => {
    if (file.startsWith(path.join(root, "system") + path.sep)) {
      const result = versions[path.basename(file)];
      if (!result) throw new Error("fixture missing executable");
      return result;
    }
    return fs.readFileSync(file, "utf8"); // Text fixtures only; never execute a binary.
  });
  const transport = vi.fn<ToolTransport>(async url => {
    const data = responses.get(url);
    if (!data) throw new Error(`Unexpected fixture URL: ${url}`);
    return data;
  });
  const paths = { tools: path.join(root, "tools") };
  const service = new YoutubeToolsService(paths, { platform: "linux", arch: "x64", detector, transport, run, ...options });
  function github(id: "yt-dlp" | "deno" | "ffmpeg", tag: string, assets: Record<string, Buffer>) {
    const repo = id === "deno" ? "denoland/deno" : id === "yt-dlp" ? "yt-dlp/yt-dlp" : "eugeneware/ffmpeg-static";
    const items = Object.entries(assets).map(([name, body]) => {
      const url = `https://github.com/${repo}/releases/download/${tag}/${name}`;
      responses.set(url, body);
      return { name, browser_download_url: url, digest: `sha256:${digest(body)}` };
    });
    responses.set(`https://api.github.com/repos/${repo}/releases/latest`, Buffer.from(JSON.stringify({ tag_name: tag, prerelease: false, draft: false, assets: items })));
    return items;
  }
  const ytdlp = (version = "2026.10.21") => github("yt-dlp", version, { yt_dlp_unused: Buffer.from("ignore"), "yt-dlp_linux": Buffer.from(version) });
  const deno = (version = "2.9.8", binaryVersion = version) => github("deno", `v${version}`, { "deno-x86_64-unknown-linux-gnu.zip": Buffer.from(zipSync({ deno: Buffer.from(`deno ${binaryVersion}\nv8 fixture`), "../escape": Buffer.from("not extracted") })) });
  const ffmpeg = (version = "7.0.2", variant = "", readme = "fixture build info") => github("ffmpeg", "b6.1.1", {
    "ffmpeg-linux-x64.gz": gzipSync(Buffer.from(`ffmpeg version ${version} fixture\n${variant}`)),
    "ffprobe-linux-x64.gz": gzipSync(Buffer.from(`ffprobe version ${version} fixture\n${variant}`)),
    "linux-x64.LICENSE": Buffer.from("fixture license"), "linux-x64.README": Buffer.from(readme)
  });
  function node(archive = tar([{ name: "node-v24.8.0-linux-x64/bin/node", body: "v24.8.0" }, { name: "../../escape", body: "untrusted" }])) {
    responses.set("https://nodejs.org/dist/index.json", Buffer.from(JSON.stringify([{ version: "v24.8.0", lts: "Krypton", files: ["linux-x64"] }])));
    responses.set("https://nodejs.org/dist/v24.8.0/SHASUMS256.txt", Buffer.from(`${digest(archive)}  node-v24.8.0-linux-x64.tar.gz\n`));
    responses.set("https://nodejs.org/dist/v24.8.0/node-v24.8.0-linux-x64.tar.gz", archive);
  }
  return { root, paths, versions, responses, detector, run, transport, service, ytdlp, deno, ffmpeg, node };
}

describe("YouTube tool detection", () => {
  it("resolves yt-dlp alone for Bilibili subtitles without probing or requiring media tools", async () => {
    const f = setup(); f.versions["yt-dlp"] = "2026.10.21";
    expect(await f.service.resolveTool("yt-dlp")).toBe(path.join(f.root, "system/yt-dlp"));
    expect(f.run).toHaveBeenCalledExactlyOnceWith(path.join(f.root, "system/yt-dlp"), ["--version"]);
    expect(f.transport).not.toHaveBeenCalled();
    delete f.versions["yt-dlp"];
    expect(await f.service.resolveTool("yt-dlp")).toBeUndefined();
  });

  it("probes versions and accepts either supported runtime without making network requests", async () => {
    const f = setup();
    Object.assign(f.versions, { "yt-dlp": "2026.10.21", ffmpeg: "ffmpeg version 7.0.2 fixture", ffprobe: "ffprobe version 7.0.2 fixture", deno: "deno 2.2.0", node: "v22.12.0" });
    const status = await f.service.status();
    expect(status).toMatchObject({ browsers: [{ id: "firefox" }], downloaderAvailable: true, ffmpegAvailable: true, javascriptRuntimeAvailable: true });
    expect(status.tools.find(tool => tool.id === "deno")).toMatchObject({ state: "too-old", source: "system", version: "2.2.0" });
    expect((await f.service.resolveTools()).deno).toBeUndefined();
    expect((await f.service.resolveTools()).node).toBe(path.join(f.root, "system/node"));
    expect(f.transport).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(f.paths.tools)).toBe(false);
  });

  it("reports missing, old and broken components independently, including ffprobe", async () => {
    const f = setup();
    Object.assign(f.versions, { ffmpeg: "ffmpeg version 7.0.2 fixture", deno: "invalid output", node: "v20.11.0" });
    const status = await f.service.status();
    expect(status.tools.map(tool => [tool.id, tool.state])).toEqual([["yt-dlp", "missing"], ["ffmpeg", "broken"], ["deno", "broken"], ["node", "too-old"]]);
    expect(status.javascriptRuntimeAvailable).toBe(false);
    expect(status.ffmpegAvailable).toBe(false);
    expect(await f.service.resolveTools()).toEqual({});
  });

  it("ignores a malformed manifest instead of probing a path outside app tools", async () => {
    const f = setup();
    const directory = path.join(f.paths.tools, "youtube/node");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "current.json"), JSON.stringify({ generation: "../../../../system", fingerprint: "a".repeat(64), release: "24.8.0", version: "24.8.0" }));
    expect((await f.service.status()).tools.find(tool => tool.id === "node")?.state).toBe("missing");
    expect(f.run).not.toHaveBeenCalled();
  });
});

describe("app-private YouTube tool installs", () => {
  it.each(["yt-dlp", "deno", "ffmpeg", "node"] as const)("installs %s with verified fixtures and uses it immediately", async id => {
    const f = setup();
    if (id === "yt-dlp") f.ytdlp(); else f[id]();
    const result = await f.service.install(id);
    expect(result).toMatchObject({ id, state: "ready", source: "app", update: "current", operation: "idle" });
    const executable = (await f.service.resolveTools())[id]!;
    expect(executable.startsWith(path.join(f.paths.tools, "youtube", id, "versions") + path.sep)).toBe(true);
    expect(fs.statSync(executable).mode & 0o777).toBe(0o700);
    expect(f.run.mock.calls.every(([, args]) => args.length === 1 && ["--version", "-version"].includes(args[0]))).toBe(true);
    if (id === "ffmpeg") {
      expect(fs.readFileSync(path.join(path.dirname(executable), "LICENSE"), "utf8")).toBe("fixture license");
      expect(fs.existsSync(path.join(path.dirname(executable), "ffprobe"))).toBe(true);
    }
    expect(fs.existsSync(path.join(f.root, "escape"))).toBe(false);
    expect(fs.readdirSync(path.join(f.paths.tools, "youtube", id))).toEqual(["current.json", "versions"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("installs a newer private copy while preserving the system installation", async () => {
    const f = setup();
    f.versions["yt-dlp"] = "2025.01.01";
    f.ytdlp();
    expect(await f.service.checkUpdate("yt-dlp")).toMatchObject({ update: "available", latestVersion: "2026.10.21", source: "system" });
    await f.service.install("yt-dlp");
    expect((await f.service.resolveTools())["yt-dlp"]).not.toBe(f.detector.findTool("yt-dlp"));
    expect(f.versions["yt-dlp"]).toBe("2025.01.01");
  });

  it("keeps the old generation active when an upgrade fails its checksum", async () => {
    const f = setup();
    f.ytdlp("2026.10.20");
    await f.service.install("yt-dlp");
    const before = (await f.service.resolveTools())["yt-dlp"]!;
    const assets = f.ytdlp();
    const binary = assets.find(asset => asset.name === "yt-dlp_linux")!;
    f.responses.set(binary.browser_download_url, Buffer.from("corrupted bytes"));
    await f.service.checkUpdate("yt-dlp");
    f.run.mockClear();
    await expect(f.service.install("yt-dlp")).rejects.toThrow("checksum-mismatch");
    expect(f.run).not.toHaveBeenCalled();
    expect((await f.service.resolveTools())["yt-dlp"]).toBe(before);
    expect(fs.readFileSync(before, "utf8")).toBe("2026.10.20");
    expect(fs.readdirSync(path.join(f.paths.tools, "youtube/yt-dlp"))).toEqual(["current.json", "versions"]);
  });

  it.each(["2.2.0", "2.9.7"])("rejects an unusable or unexpected staged version (%s) and preserves the old install", async version => {
    const f = setup();
    f.deno("2.9.6");
    await f.service.install("deno");
    const before = (await f.service.resolveTools()).deno;
    f.deno("2.9.8", version);
    await f.service.checkUpdate("deno");
    await expect(f.service.install("deno")).rejects.toThrow("verification-failed");
    expect((await f.service.resolveTools()).deno).toBe(before);
  });

  it("retains prior generations for running imports after a successful update", async () => {
    const f = setup();
    f.ytdlp("2026.10.20");
    await f.service.install("yt-dlp");
    const before = (await f.service.resolveTools())["yt-dlp"]!;
    f.ytdlp();
    await f.service.checkUpdate("yt-dlp");
    await f.service.install("yt-dlp");
    expect((await f.service.resolveTools())["yt-dlp"]).not.toBe(before);
    expect(fs.existsSync(before)).toBe(true);
  });

  it("refuses to replace a newer system version with an older available build", async () => {
    const f = setup();
    Object.assign(f.versions, { ffmpeg: "ffmpeg version 8.0 fixture", ffprobe: "ffprobe version 8.0 fixture" });
    f.ffmpeg();
    await expect(f.service.install("ffmpeg")).rejects.toThrow("downgrade-refused");
    expect((await f.service.status()).tools.find(tool => tool.id === "ffmpeg")?.source).toBe("system");
    expect(fs.existsSync(path.join(f.paths.tools, "youtube/ffmpeg/current.json"))).toBe(false);
  });

  it.each(["link", "traversal"])("does not extract a %s in place of the Node binary", async kind => {
    const f = setup();
    f.node(tar([{ name: kind === "link" ? "node-v24.8.0-linux-x64/bin/node" : "../../escape", body: "/tmp/escape", type: kind === "link" ? "2" : "0" }]));
    await expect(f.service.install("node")).rejects.toThrow(/archive-invalid|binary-missing/);
    expect(f.run).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(f.root, "escape"))).toBe(false);
  });

  it("prevents concurrent installs and releases the lock after a network error", async () => {
    const f = setup();
    let reject!: (error: Error) => void;
    f.transport.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const install = f.service.install("yt-dlp");
    expect((await f.service.status()).tools.find(tool => tool.id === "yt-dlp")?.operation).toBe("installing");
    await expect(f.service.install("yt-dlp")).rejects.toThrow("busy");
    await expect(f.service.checkUpdate("yt-dlp")).rejects.toThrow("busy");
    reject(new Error("fixture network error"));
    await expect(install).rejects.toThrow("fixture network error");
    f.ytdlp();
    await expect(f.service.install("yt-dlp")).resolves.toMatchObject({ operation: "idle", state: "ready" });
  });

  it("releases its lock even if the OS refuses temporary-directory cleanup", async () => {
    const f = setup();
    const assets = f.ytdlp();
    f.responses.set(assets.find(item => item.name === "yt-dlp_linux")!.browser_download_url, Buffer.from("bad checksum"));
    const cleanup = vi.spyOn(fs, "rmSync").mockImplementationOnce(() => { throw new Error("fixture EBUSY"); });
    await expect(f.service.install("yt-dlp")).rejects.toThrow("fixture EBUSY");
    cleanup.mockRestore();
    f.ytdlp();
    await expect(f.service.install("yt-dlp")).resolves.toMatchObject({ state: "ready" });
  });
});

describe("dependency update checks", () => {
  it("compares numeric versions and clears stale results on check failure", async () => {
    const f = setup();
    f.versions["yt-dlp"] = "2026.10.22";
    f.ytdlp();
    expect(await f.service.checkUpdate("yt-dlp")).toMatchObject({ update: "current", version: "2026.10.22" });
    f.transport.mockRejectedValueOnce(new Error("offline"));
    await expect(f.service.checkUpdate("yt-dlp")).rejects.toThrow("offline");
    expect((await f.service.status()).tools.find(tool => tool.id === "yt-dlp")).toMatchObject({ update: "unchecked", latestVersion: null, state: "ready" });
  });

  it("compares FFmpeg build digests even when the release tag stays unchanged", async () => {
    const f = setup();
    f.ffmpeg();
    await f.service.install("ffmpeg");
    expect(await f.service.checkUpdate("ffmpeg")).toMatchObject({ update: "current", latestVersion: "b6.1.1", version: "7.0.2" });
    f.ffmpeg("7.0.2", "new build");
    expect(await f.service.checkUpdate("ffmpeg")).toMatchObject({ update: "available", latestVersion: "b6.1.1" });
  });

  it("does not claim an unrelated system FFmpeg build is current", async () => {
    const f = setup();
    Object.assign(f.versions, { ffmpeg: "ffmpeg version 7.0.2-custom fixture", ffprobe: "ffprobe version 7.0.2-custom fixture" });
    f.ffmpeg();
    expect(await f.service.checkUpdate("ffmpeg")).toMatchObject({ update: "unknown", source: "system" });
  });

  it.each(["Version: 8.0-essentials_build", '{"version":"8.0"}'])("compares a system FFmpeg version when the build publishes it: %s", async notes => {
    const f = setup();
    Object.assign(f.versions, { ffmpeg: "ffmpeg version 7.0.2-static fixture", ffprobe: "ffprobe version 7.0.2-static fixture" });
    f.ffmpeg("8.0", "", notes);
    expect(await f.service.checkUpdate("ffmpeg")).toMatchObject({ update: "available", latestVersion: "8.0 (b6.1.1)" });
    expect(await f.service.install("ffmpeg")).toMatchObject({ update: "current", version: "8.0" });
    f.ffmpeg("8.0", "rebuilt", notes);
    expect(await f.service.checkUpdate("ffmpeg")).toMatchObject({ update: "available" });
  });

  it("returns unsupported installation status while still detecting system tools", async () => {
    const f = setup({ platform: "freebsd" });
    f.versions.node = "v24.8.0";
    expect((await f.service.status()).tools.find(tool => tool.id === "node")).toMatchObject({ state: "ready", canInstall: false });
    await expect(f.service.install("node")).rejects.toThrow("platform-unsupported");
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("validates tool identifiers before touching disk or resolving a release", async () => {
    const f = setup();
    await expect(f.service.install("../../node" as YoutubeToolId)).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
    expect(fs.readdirSync(f.root)).toEqual([]);
  });
});
