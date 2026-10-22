import crypto from "node:crypto";
import { z } from "zod";
import type { YoutubeToolId } from "../../shared/youtube-import";

export type ToolDownload = {
  url: string;
  digest: string;
  filename: string;
  format: "binary" | "gzip" | "zip" | "tar.gz";
  entry?: string;
};
export type ToolRelease = { label: string; version: string | null; fingerprint: string; files: ToolDownload[] };
export type ToolTransport = (url: string, options: { signal: AbortSignal; maxBytes: number }) => Promise<Buffer>;
export const MAX_TOOL_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const repositories = { "yt-dlp": "yt-dlp/yt-dlp", deno: "denoland/deno", ffmpeg: "eugeneware/ffmpeg-static" };
const AssetSchema = z.object({ name: z.string(), browser_download_url: z.string(), digest: z.string().nullable().optional() });
const ReleaseSchema = z.object({ tag_name: z.string().max(100), prerelease: z.literal(false), draft: z.literal(false), assets: z.array(AssetSchema) });

export function toolInstallSupported(id: YoutubeToolId, platform: NodeJS.Platform, arch: string): boolean {
  return ["darwin", "linux", "win32"].includes(platform) && ["x64", "arm64"].includes(arch)
    && !(id === "ffmpeg" && platform === "win32" && arch === "arm64");
}

/** No caller-supplied URLs, commands or package managers cross the IPC boundary. */
function allowedDownloadUrl(value: string): boolean {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (url.hostname === "api.github.com") return Object.values(repositories).some(repo => url.pathname === `/repos/${repo}/releases/latest`);
  if (url.hostname === "github.com") return Object.values(repositories).some(repo => url.pathname.startsWith(`/${repo}/releases/download/`));
  if (["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)) return true;
  return url.hostname === "nodejs.org" && url.pathname.startsWith("/dist/");
}

/** Bound redirects, download size and time. Never execute a remote shell script. */
export const downloadToolFile: ToolTransport = async (url, { signal, maxBytes }) => {
  for (let redirect = 0; redirect < 6; redirect++) {
    if (!allowedDownloadUrl(url)) throw new Error("youtube-tool-untrusted-url");
    const response = await fetch(url, { signal, redirect: "manual", headers: { "User-Agent": "OpenMind-Desktop", Accept: new URL(url).hostname === "api.github.com" ? "application/vnd.github+json" : "*/*" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("youtube-tool-download-failed");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new Error("youtube-tool-download-failed");
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) throw new Error("youtube-tool-download-too-large");
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, received);
    } finally { await reader.cancel(); }
  }
  throw new Error("youtube-tool-too-many-redirects");
};

export function compareToolVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

export async function resolveToolRelease(id: YoutubeToolId, platform: NodeJS.Platform, arch: string, transport: ToolTransport, signal: AbortSignal): Promise<ToolRelease> {
  if (!toolInstallSupported(id, platform, arch)) throw new Error("youtube-tool-platform-unsupported");
  const metadata = (url: string) => transport(url, { signal, maxBytes: MAX_METADATA_BYTES });
  let files: ToolDownload[];
  let label: string;
  let version: string | null;
  if (id === "node") {
    const releases = z.array(z.object({ version: z.string(), lts: z.union([z.string(), z.boolean()]), files: z.array(z.string()) }))
      .parse(JSON.parse((await metadata("https://nodejs.org/dist/index.json")).toString("utf8")));
    const target = `${platform === "win32" ? "win" : platform}-${arch}`;
    const release = releases.filter(item => item.lts && /^v\d+\.\d+\.\d+$/.test(item.version) && compareToolVersions(item.version.slice(1), "22.0.0") >= 0
      && item.files.includes(platform === "win32" ? `${target}-exe` : platform === "darwin" ? `osx-${arch}-tar` : target))
      .sort((a, b) => compareToolVersions(b.version.slice(1), a.version.slice(1)))[0];
    if (!release) throw new Error("youtube-tool-release-not-found");
    label = version = release.version.slice(1);
    const asset = platform === "win32" ? `${target}/node.exe` : `node-${release.version}-${target}.tar.gz`;
    const base = `https://nodejs.org/dist/${release.version}/`;
    const checksums = (await metadata(`${base}SHASUMS256.txt`)).toString("utf8");
    const digest = checksums.split(/\r?\n/).map(line => line.trim().split(/\s+\*?/)).find(parts => parts[1] === asset)?.[0];
    if (!digest || !/^[a-f\d]{64}$/i.test(digest)) throw new Error("youtube-tool-checksum-missing");
    files = [{ url: `${base}${asset}`, digest, filename: platform === "win32" ? "node.exe" : "node", format: platform === "win32" ? "binary" : "tar.gz", entry: `node-${release.version}-${target}/bin/node` }];
  } else {
    const repo = repositories[id];
    const release = ReleaseSchema.parse(JSON.parse((await metadata(`https://api.github.com/repos/${repo}/releases/latest`)).toString("utf8")));
    label = release.tag_name;
    // FFmpeg assets can be refreshed under the same tag and have different
    // upstream versions per OS. Compare build digests, never the tag as semver.
    version = id === "ffmpeg" ? null : label.replace(/^v/, "");
    if (version && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("youtube-tool-invalid-version");
    const asset = (name: string, filename: string, format: ToolDownload["format"], entry?: string): ToolDownload => {
      const item = release.assets.find(value => value.name === name);
      if (!item || !item.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/${encodeURIComponent(label)}/`)) throw new Error("youtube-tool-asset-not-found");
      if (!item.digest || !/^sha256:[a-f\d]{64}$/i.test(item.digest)) throw new Error("youtube-tool-checksum-missing");
      return { url: item.browser_download_url, digest: item.digest.slice(7), filename, format, entry };
    };
    const exe = platform === "win32" ? ".exe" : "";
    if (id === "yt-dlp") {
      const name = platform === "darwin" ? "yt-dlp_macos" : platform === "win32" ? `yt-dlp${arch === "arm64" ? "_arm64" : ""}.exe` : `yt-dlp_linux${arch === "arm64" ? "_aarch64" : ""}`;
      files = [asset(name, `yt-dlp${exe}`, "binary")];
    } else if (id === "deno") {
      const target = `${arch === "arm64" ? "aarch64" : "x86_64"}-${platform === "win32" ? "pc-windows-msvc" : platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu"}`;
      files = [asset(`deno-${target}.zip`, `deno${exe}`, "zip", `deno${exe}`)];
    } else {
      const target = `${platform}-${arch}`;
      files = [asset(`ffmpeg-${target}.gz`, `ffmpeg${exe}`, "gzip"), asset(`ffprobe-${target}.gz`, `ffprobe${exe}`, "gzip"),
        asset(`${target}.LICENSE`, "LICENSE", "binary"), asset(`${target}.README`, "README", "binary")];
      const readme = await metadata(files[3].url);
      if (crypto.createHash("sha256").update(readme).digest("hex") !== files[3].digest.toLowerCase()) throw new Error("youtube-tool-checksum-mismatch");
      // Some upstream builds publish a version field (plain text or JSON),
      // others only publish generic build notes. Do not infer from the tag.
      const notes = readme.toString("utf8");
      try {
        const value: unknown = JSON.parse(notes);
        if (value && typeof value === "object" && "version" in value && typeof value.version === "string") version = value.version.match(/^\d+\.\d+(?:\.\d+)?/)?.[0] ?? null;
      } catch { /* Text README, handled below. */ }
      version ??= /^\s*version:\s*(\d+\.\d+(?:\.\d+)?)(?:[-\s]|$)/im.exec(notes)?.[1] ?? null;
      if (version) label = `${version} (${label})`;
    }
  }
  const fingerprint = crypto.createHash("sha256").update(files.map(file => `${file.filename}:${file.digest}`).join("\n")).digest("hex");
  return { label, version, fingerprint, files };
}
