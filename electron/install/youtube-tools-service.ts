import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { unzip } from "fflate";
import { z } from "zod";
import { YOUTUBE_TOOLS, YoutubeToolIdSchema, type YoutubeImportStatus, type YoutubeToolId, type YoutubeToolStatus } from "../../shared/youtube-import";
import { createYoutubeHostDetector } from "../project/youtube-browser";
import { compareToolVersions, downloadToolFile, MAX_TOOL_DOWNLOAD_BYTES, resolveToolRelease, toolInstallSupported, type ToolDownload, type ToolRelease, type ToolTransport } from "./youtube-tool-releases";

const execute = promisify(execFile);
const decompress = promisify(gunzip);
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
const ManifestSchema = z.object({ generation: z.string().uuid(), fingerprint: z.string().regex(/^[a-f\d]{64}$/), release: z.string(), version: z.string() });
type Manifest = z.infer<typeof ManifestSchema>;
export type YoutubeToolPaths = Partial<Record<YoutubeToolId, string>>;
type ProbeRunner = (file: string, args: string[]) => Promise<string>;
type Detection = { status: YoutubeToolStatus; executable?: string; manifest?: Manifest };
type Options = {
  platform?: NodeJS.Platform;
  arch?: string;
  detector?: Pick<ReturnType<typeof createYoutubeHostDetector>, "browsers" | "findTool">;
  transport?: ToolTransport;
  run?: ProbeRunner;
};

const probe: ProbeRunner = async (file, args) => {
  // Do not inherit NODE_OPTIONS, loader paths or provider credentials into
  // downloaded executables. Version probes never read browser profiles.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const result = await execute(file, args, { env, encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024, windowsHide: true, shell: false, killSignal: "SIGKILL" });
  return result.stdout;
};

function parseVersion(id: YoutubeToolId, output: string): string | null {
  const first = output.split(/\r?\n/, 1)[0].trim();
  if (id === "ffmpeg") return /^ff(?:mpeg|probe) version ([\w.+-]{1,100})(?:\s|$)/.exec(first)?.[1] ?? null;
  const pattern = id === "deno" ? /^deno (\d+\.\d+\.\d+)(?:\s|$)/ : id === "node" ? /^v(\d+\.\d+\.\d+)$/ : /^(\d+\.\d+\.\d+)$/;
  return pattern.exec(first)?.[1] ?? null;
}

function usableVersion(id: YoutubeToolId, version: string): boolean {
  return id === "node" ? compareToolVersions(version, "22.0.0") >= 0 : id === "deno" ? compareToolVersions(version, "2.3.0") >= 0 : true;
}

function comparableVersion(version: string | null): string | undefined {
  return version?.match(/^\d+\.\d+(?:\.\d+)?(?=$|[-+])/)?.[0];
}

async function extract(file: ToolDownload, data: Buffer): Promise<Buffer> {
  if (file.format === "binary") return data;
  if (file.format === "zip") {
    return new Promise((resolve, reject) => {
      unzip(data, { filter: item => item.name === file.entry && item.originalSize <= MAX_EXTRACTED_BYTES }, (error, entries) => {
        const binary = entries?.[file.entry!];
        if (error || !binary?.length || binary.length > MAX_EXTRACTED_BYTES) reject(new Error("youtube-tool-archive-invalid"));
        else resolve(Buffer.from(binary));
      });
    });
  }
  const unpacked = await decompress(data, { maxOutputLength: MAX_EXTRACTED_BYTES });
  if (file.format === "gzip") return unpacked;
  // Extract only one exact, regular tar entry into a fixed app-owned filename.
  // No archive paths, links or install scripts are materialized on disk.
  for (let offset = 0; offset + 512 <= unpacked.length;) {
    const header = unpacked.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, "");
    if (!name) break;
    const prefix = header.subarray(345, 500).toString().replace(/\0.*$/, "");
    const entryName = prefix ? `${prefix}/${name}` : name;
    const sizeField = header.subarray(124, 136).toString().replace(/\0.*$/, "").trim();
    if (!/^[0-7]+$/.test(sizeField)) throw new Error("youtube-tool-archive-invalid");
    const size = parseInt(sizeField, 8);
    if (size > MAX_EXTRACTED_BYTES || offset + 512 + size > unpacked.length) throw new Error("youtube-tool-archive-invalid");
    if (entryName === file.entry) {
      if (header[156] !== 0 && header[156] !== 48) throw new Error("youtube-tool-archive-invalid");
      return unpacked.subarray(offset + 512, offset + 512 + size);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("youtube-tool-binary-missing");
}

/** Install private copies; never change a system installation or a content repository. */
export class YoutubeToolsService {
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly host: NonNullable<Options["detector"]>;
  private readonly transport: ToolTransport;
  private readonly run: ProbeRunner;
  private readonly operations = new Map<YoutubeToolId, "checking" | "installing">();
  private readonly releases = new Map<YoutubeToolId, { value: ToolRelease; checkedAt: number }>();

  constructor(private readonly paths: { tools: string }, options: Options = {}) {
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.host = options.detector ?? createYoutubeHostDetector();
    this.transport = options.transport ?? downloadToolFile;
    this.run = options.run ?? probe;
  }

  private directory(id: YoutubeToolId): string { return path.join(this.paths.tools, "youtube", id); }
  private binaryName(id: YoutubeToolId | "ffprobe"): string { return `${id}${this.platform === "win32" ? ".exe" : ""}`; }
  private manifest(id: YoutubeToolId): Manifest | undefined {
    try { return ManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(this.directory(id), "current.json"), "utf8"))); }
    catch { return undefined; }
  }

  private async inspect(id: YoutubeToolId, executable: string): Promise<Pick<YoutubeToolStatus, "state" | "version">> {
    try {
      const version = parseVersion(id, await this.run(executable, [id === "ffmpeg" ? "-version" : "--version"]));
      if (!version) return { state: "broken", version: null };
      if (!usableVersion(id, version)) return { state: "too-old", version };
      if (id === "ffmpeg") {
        const ffprobe = path.join(path.dirname(executable), this.binaryName("ffprobe"));
        if (!parseVersion("ffmpeg", await this.run(ffprobe, ["-version"]))) return { state: "broken", version };
      }
      return { state: "ready", version };
    } catch { return { state: "broken", version: null }; }
  }

  private async detect(id: YoutubeToolId): Promise<Detection> {
    const manifest = this.manifest(id);
    const privatePath = manifest && path.join(this.directory(id), "versions", manifest.generation, this.binaryName(id));
    const executable = privatePath && fs.existsSync(privatePath) ? privatePath : this.host.findTool(id);
    const source = executable ? executable === privatePath ? "app" : "system" : null;
    const detected = executable ? await this.inspect(id, executable) : { state: "missing" as const, version: null };
    const release = this.releases.get(id)?.value;
    let update: YoutubeToolStatus["update"] = "unchecked";
    if (release) {
      if (detected.state !== "ready") update = "available";
      else if (id === "ffmpeg" && source === "app" && manifest) update = release.fingerprint === manifest.fingerprint ? "current" : "available";
      else if (release.version && comparableVersion(detected.version)) {
        update = compareToolVersions(release.version, comparableVersion(detected.version)!) > 0 ? "available" : "current";
      }
      else update = "unknown";
    }
    return { executable, manifest: source === "app" ? manifest : undefined, status: {
      id, ...detected, source, canInstall: toolInstallSupported(id, this.platform, this.arch),
      operation: this.operations.get(id) ?? "idle", update, latestVersion: release?.label ?? null
    } };
  }

  async status(): Promise<YoutubeImportStatus> {
    const tools = await Promise.all(YOUTUBE_TOOLS.map(async id => (await this.detect(id)).status));
    const ready = (id: YoutubeToolId) => tools.some(tool => tool.id === id && tool.state === "ready");
    return { browsers: this.host.browsers(), tools, downloaderAvailable: ready("yt-dlp"), ffmpegAvailable: ready("ffmpeg"), javascriptRuntimeAvailable: ready("deno") || ready("node") };
  }

  async resolveTools(): Promise<YoutubeToolPaths> {
    const result: YoutubeToolPaths = {};
    await Promise.all(YOUTUBE_TOOLS.map(async id => {
      const detected = await this.detect(id);
      if (detected.status.state === "ready") result[id] = detected.executable;
    }));
    return result;
  }

  async resolveTool(id: YoutubeToolId): Promise<string | undefined> {
    const detected = await this.detect(YoutubeToolIdSchema.parse(id));
    return detected.status.state === "ready" ? detected.executable : undefined;
  }

  private begin(id: YoutubeToolId, operation: "checking" | "installing"): void {
    YoutubeToolIdSchema.parse(id);
    if (this.operations.has(id)) throw new Error("youtube-tool-busy");
    if (!toolInstallSupported(id, this.platform, this.arch)) throw new Error("youtube-tool-platform-unsupported");
    this.operations.set(id, operation);
  }

  private async release(id: YoutubeToolId, signal: AbortSignal): Promise<ToolRelease> {
    const value = await resolveToolRelease(id, this.platform, this.arch, this.transport, signal);
    this.releases.set(id, { value, checkedAt: Date.now() });
    return value;
  }

  async checkUpdate(id: YoutubeToolId): Promise<YoutubeToolStatus> {
    this.begin(id, "checking");
    this.releases.delete(id);
    try { await this.release(id, AbortSignal.timeout(30_000)); }
    finally { this.operations.delete(id); }
    return (await this.detect(id)).status;
  }

  async install(id: YoutubeToolId): Promise<YoutubeToolStatus> {
    this.begin(id, "installing");
    let staging: string | undefined;
    let candidate: string | undefined;
    let pointer: string | undefined;
    let committed = false;
    try {
      const signal = AbortSignal.timeout(10 * 60_000);
      const cached = this.releases.get(id);
      const release = cached && Date.now() - cached.checkedAt < 10 * 60_000 ? cached.value : await this.release(id, signal);
      const root = this.directory(id);
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      staging = fs.mkdtempSync(path.join(root, ".install-"));
      for (const file of release.files) {
        const data = await this.transport(file.url, { signal, maxBytes: MAX_TOOL_DOWNLOAD_BYTES });
        if (!data.length || data.length > MAX_TOOL_DOWNLOAD_BYTES || crypto.createHash("sha256").update(data).digest("hex") !== file.digest.toLowerCase()) throw new Error("youtube-tool-checksum-mismatch");
        const binary = await extract(file, data);
        if (!binary.length || binary.length > MAX_EXTRACTED_BYTES) throw new Error("youtube-tool-archive-invalid");
        fs.writeFileSync(path.join(staging, file.filename), binary, { mode: file.filename === "LICENSE" || file.filename === "README" ? 0o600 : 0o700 });
      }
      const verified = await this.inspect(id, path.join(staging, this.binaryName(id)));
      if (verified.state !== "ready" || !verified.version || (release.version && (!comparableVersion(verified.version) || compareToolVersions(comparableVersion(verified.version)!, release.version) !== 0))) throw new Error("youtube-tool-verification-failed");
      const current = (await this.detect(id)).status;
      const currentVersion = comparableVersion(current.version);
      const nextVersion = comparableVersion(verified.version);
      if (current.state === "ready" && currentVersion && nextVersion && compareToolVersions(nextVersion, currentVersion) < 0) throw new Error("youtube-tool-downgrade-refused");
      signal.throwIfAborted();
      const generation = crypto.randomUUID();
      const manifest: Manifest = { generation, fingerprint: release.fingerprint, release: release.label, version: verified.version };
      fs.mkdirSync(path.join(root, "versions"), { recursive: true, mode: 0o700 });
      candidate = path.join(root, "versions", generation);
      fs.renameSync(staging, candidate);
      staging = undefined;
      pointer = path.join(root, `.current-${generation}.json`);
      fs.writeFileSync(pointer, JSON.stringify(manifest), { mode: 0o600 });
      // Switch only after the complete install passes its version probe. Keep
      // earlier generations available for imports that already resolved them.
      fs.renameSync(pointer, path.join(root, "current.json"));
      committed = true;
    } finally {
      this.operations.delete(id);
      if (staging) fs.rmSync(staging, { recursive: true, force: true });
      if (candidate && !committed) fs.rmSync(candidate, { recursive: true, force: true });
      if (pointer) fs.rmSync(pointer, { force: true });
    }
    return (await this.detect(id)).status;
  }
}
