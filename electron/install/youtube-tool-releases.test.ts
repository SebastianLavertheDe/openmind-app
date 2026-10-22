// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadToolFile, resolveToolRelease, type ToolTransport } from "./youtube-tool-releases";

afterEach(() => { vi.unstubAllGlobals(); });
const checksum = "a".repeat(64);

describe("YouTube dependency release lookup (mocked network)", () => {
  it.each([
    ["linux", "x64", "yt-dlp_linux"], ["linux", "arm64", "yt-dlp_linux_aarch64"],
    ["darwin", "x64", "yt-dlp_macos"], ["darwin", "arm64", "yt-dlp_macos"],
    ["win32", "x64", "yt-dlp.exe"], ["win32", "arm64", "yt-dlp_arm64.exe"]
  ] as const)("chooses the standalone yt-dlp binary for %s/%s", async (platform, arch, name) => {
    const url = `https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/${name}`;
    const transport = vi.fn<ToolTransport>().mockResolvedValue(Buffer.from(JSON.stringify({ tag_name: "2026.10.21", prerelease: false, draft: false, assets: [{ name, browser_download_url: url, digest: `sha256:${checksum}` }] })));
    const release = await resolveToolRelease("yt-dlp", platform, arch, transport, AbortSignal.timeout(1000));
    expect(release.files[0]).toMatchObject({ url, digest: checksum, format: "binary", filename: platform === "win32" ? "yt-dlp.exe" : "yt-dlp" });
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    ["linux", "x64", "x86_64-unknown-linux-gnu"], ["linux", "arm64", "aarch64-unknown-linux-gnu"],
    ["darwin", "x64", "x86_64-apple-darwin"], ["darwin", "arm64", "aarch64-apple-darwin"],
    ["win32", "x64", "x86_64-pc-windows-msvc"], ["win32", "arm64", "aarch64-pc-windows-msvc"]
  ] as const)("chooses Deno, not denort, for %s/%s", async (platform, arch, target) => {
    const name = `deno-${target}.zip`;
    const transport = vi.fn<ToolTransport>().mockResolvedValue(Buffer.from(JSON.stringify({ tag_name: "v2.9.8", prerelease: false, draft: false, assets: [{ name, browser_download_url: `https://github.com/denoland/deno/releases/download/v2.9.8/${name}`, digest: `sha256:${checksum}` }] })));
    expect((await resolveToolRelease("deno", platform, arch, transport, AbortSignal.timeout(1000))).files[0]).toMatchObject({ entry: platform === "win32" ? "deno.exe" : "deno", format: "zip" });
  });

  it.each([
    ["darwin", "arm64", "osx-arm64-tar", "node-v24.8.0-darwin-arm64.tar.gz"],
    ["darwin", "x64", "osx-x64-tar", "node-v24.8.0-darwin-x64.tar.gz"],
    ["linux", "x64", "linux-x64", "node-v24.8.0-linux-x64.tar.gz"],
    ["linux", "arm64", "linux-arm64", "node-v24.8.0-linux-arm64.tar.gz"],
    ["win32", "x64", "win-x64-exe", "win-x64/node.exe"],
    ["win32", "arm64", "win-arm64-exe", "win-arm64/node.exe"]
  ] as const)("selects the newest compatible Node LTS and its exact checksum on %s/%s", async (platform, arch, file, asset) => {
    const transport = vi.fn<ToolTransport>(async url => url.endsWith("index.json") ? Buffer.from(JSON.stringify([
      { version: "v26.0.0", lts: false, files: [file] }, { version: "v22.12.0", lts: "Jod", files: [file] }, { version: "v24.8.0", lts: "Krypton", files: [file] }
    ])) : Buffer.from(`${"b".repeat(64)}  other-file\n${checksum}  ${asset}\n`));
    const release = await resolveToolRelease("node", platform, arch, transport, AbortSignal.timeout(1000));
    expect(release.version).toBe("24.8.0");
    expect(release.files[0]).toMatchObject({ url: `https://nodejs.org/dist/v24.8.0/${asset}`, digest: checksum });
  });

  it.each(["missing", "untrusted"])("rejects %s asset checksums or URLs before downloading binaries", async failure => {
    const transport = vi.fn<ToolTransport>().mockResolvedValue(Buffer.from(JSON.stringify({ tag_name: "v2.9.8", prerelease: false, draft: false,
      assets: [{ name: "deno-x86_64-unknown-linux-gnu.zip", browser_download_url: failure === "untrusted" ? "https://evil.example/deno.zip" : "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-unknown-linux-gnu.zip", digest: failure === "missing" ? null : `sha256:${checksum}` }] })));
    await expect(resolveToolRelease("deno", "linux", "x64", transport, AbortSignal.timeout(1000))).rejects.toThrow(failure === "missing" ? "checksum-missing" : "asset-not-found");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rejects unsupported targets without network access", async () => {
    const transport = vi.fn<ToolTransport>();
    await expect(resolveToolRelease("ffmpeg", "win32", "arm64", transport, AbortSignal.timeout(1000))).rejects.toThrow("platform-unsupported");
    await expect(resolveToolRelease("node", "linux", "ia32", transport, AbortSignal.timeout(1000))).rejects.toThrow("platform-unsupported");
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("bounded installer transport", () => {
  it("rejects untrusted redirect destinations before connecting to them", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/binary" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(downloadToolFile("https://nodejs.org/dist/index.json", { signal: AbortSignal.timeout(1000), maxBytes: 100 })).rejects.toThrow("untrusted-url");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts the GitHub asset redirect with a bounded body and shared abort signal", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/github-production-release-asset/fixture" } }))
      .mockResolvedValueOnce(new Response("fixture"));
    vi.stubGlobal("fetch", fetch);
    const signal = AbortSignal.timeout(1000);
    expect((await downloadToolFile("https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp_linux", { signal, maxBytes: 20 })).toString()).toBe("fixture");
    expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ signal, redirect: "manual" }));
  });

  it.each([true, false])("bounds downloads with and without content-length (%s)", async knownLength => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("too many bytes", { headers: knownLength ? { "content-length": "14" } : {} })));
    await expect(downloadToolFile("https://nodejs.org/dist/index.json", { signal: AbortSignal.timeout(1000), maxBytes: 4 })).rejects.toThrow(/download-(?:failed|too-large)/);
  });
});
