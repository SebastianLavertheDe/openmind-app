import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import type { ClientRequest, IncomingMessage } from "node:http";
import { writeJsonAtomic } from "../lib/fs-utils";
import type { AppPaths } from "../paths/app-paths-service";
import {
  RuntimePackDownloadDescriptorSchema,
  RuntimePackDownloadJobSchema,
  RuntimePackMetadataSchema,
  type RuntimePackDownloadDescriptor,
  type RuntimePackDownloadJob,
  type RuntimePackMetadata
} from "../../shared/runtime-targets";
import type { RuntimePackService } from "./runtime-pack-service";

export const MAX_RUNTIME_PACK_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const DOWNLOAD_REGISTRY_SCHEMA_VERSION = 1 as const;
const DOWNLOAD_REGISTRY_FILE = "registry.json";
const MAX_REDIRECTS = 5;
const PROGRESS_PERSIST_INTERVAL_MS = 250;

type DownloadRegistry = {
  schemaVersion: typeof DOWNLOAD_REGISTRY_SCHEMA_VERSION;
  jobs: RuntimePackDownloadJob[];
};

export type RuntimePackDownloadResponse = {
  statusCode: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  abort(): void;
};

export type RuntimePackDownloadTransport = (url: string, rangeStart: number) => Promise<RuntimePackDownloadResponse>;

type ActiveDownload = {
  intent: "none" | "pause" | "remove";
  abort: () => void;
  done: Promise<void>;
};

class DownloadInterruptedError extends Error {
  constructor() {
    super("Runtime Pack 下载已暂停。");
    this.name = "DownloadInterruptedError";
  }
}

/**
 * User-initiated, manifest-driven Runtime Pack download boundary.
 *
 * There is deliberately no catalog lookup or automatic update here. The
 * caller supplies signed metadata; the only network URL accepted is the
 * metadata's HTTPS originUrl. Completed bytes always re-enter
 * RuntimePackService.install(), so a bad download can never replace active
 * state.
 */
export class RuntimePackDownloadService {
  private readonly registryFile: string;
  private readonly jobs = new Map<string, RuntimePackDownloadJob>();
  private readonly active = new Map<string, ActiveDownload>();
  private readonly transport: RuntimePackDownloadTransport;

  constructor(
    private readonly paths: AppPaths,
    private readonly runtimePacks: RuntimePackService,
    private readonly onEvent: (job: RuntimePackDownloadJob) => void = () => undefined,
    transport: RuntimePackDownloadTransport = requestHttps
  ) {
    this.registryFile = path.join(paths.runtimeDownloads, DOWNLOAD_REGISTRY_FILE);
    this.transport = transport;
    fs.mkdirSync(paths.runtimeDownloads, { recursive: true });
    for (const job of this.readRegistry().jobs) this.jobs.set(job.id, job);
    this.recoverInterruptedJobs();
  }

  describe(metadata: unknown): RuntimePackDownloadDescriptor {
    const parsed = RuntimePackMetadataSchema.parse(metadata);
    if (!parsed.originUrl || !isHttpsUrl(parsed.originUrl)) {
      throw new Error("Runtime Pack 下载只接受 metadata 中声明的 HTTPS originUrl。");
    }
    if (parsed.size > MAX_RUNTIME_PACK_DOWNLOAD_BYTES) {
      throw new Error("Runtime Pack 超过单包下载大小限制。");
    }
    return RuntimePackDownloadDescriptorSchema.parse({
      metadata: parsed,
      downloadSize: parsed.size,
      installSize: parsed.installSize ?? parsed.size,
      license: parsed.license,
      conditions: parsed.conditions ?? [],
      sourceUrl: parsed.originUrl
    });
  }

  list(): RuntimePackDownloadJob[] {
    return [...this.jobs.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((job) => RuntimePackDownloadJobSchema.parse(job));
  }

  start(metadata: unknown): RuntimePackDownloadJob {
    const descriptor = this.describe(metadata);
    const existing = [...this.jobs.values()].find((job) =>
      job.metadata.packId === descriptor.metadata.packId
      && job.metadata.target === descriptor.metadata.target
      && job.metadata.sha256 === descriptor.metadata.sha256
    );
    if (existing) {
      if (JSON.stringify(existing.metadata) !== JSON.stringify(descriptor.metadata)) {
        throw new Error("同一 Runtime Pack digest 对应的 metadata 不一致，拒绝复用下载任务。");
      }
      if (existing.status === "installed" || existing.status === "downloading" || existing.status === "queued" || existing.status === "verifying") {
        return existing;
      }
      return this.enqueue(existing);
    }

    const now = new Date().toISOString();
    const job = RuntimePackDownloadJobSchema.parse({
      id: crypto.randomUUID(),
      metadata: descriptor.metadata,
      status: "queued",
      bytesDownloaded: 0,
      totalBytes: descriptor.metadata.size,
      createdAt: now,
      updatedAt: now,
      error: null,
      completedAt: null
    });
    this.jobs.set(job.id, job);
    this.persistAndEmit(job);
    this.launch(job.id);
    return job;
  }

  pause(id: string): RuntimePackDownloadJob {
    const job = this.get(id);
    if (job.status === "installed" || job.status === "failed" || job.status === "paused" || job.status === "verifying") return job;
    const active = this.active.get(id);
    if (active) {
      active.intent = "pause";
      active.abort();
    }
    return this.update(job, { status: "paused", error: null });
  }

  resume(id: string): RuntimePackDownloadJob {
    const job = this.get(id);
    if (job.status === "installed" || job.status === "downloading" || job.status === "queued" || job.status === "verifying") return job;
    const next = this.update(job, { status: "queued", error: null, completedAt: null });
    this.launch(next.id);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const job = this.getOptional(id);
    if (!job) return false;
    const active = this.active.get(id);
    if (active) {
      active.intent = "remove";
      active.abort();
      await active.done;
    }
    this.jobs.delete(id);
    this.persist();
    this.removeJobDirectory(id);
    return true;
  }

  private enqueue(job: RuntimePackDownloadJob): RuntimePackDownloadJob {
    const next = this.update(job, { status: "queued", error: null, completedAt: null });
    this.launch(next.id);
    return next;
  }

  private launch(id: string): void {
    const current = this.active.get(id);
    if (current) {
      if (current.intent === "pause") {
        void current.done.then(() => {
          if (current.intent === "pause" && this.jobs.get(id)?.status === "queued") this.launch(id);
        });
      }
      return;
    }
    const promise = this.run(id);
    const active = this.active.get(id);
    if (active) active.done = promise;
    void promise.catch(() => undefined);
  }

  private async run(id: string): Promise<void> {
    const job = this.get(id);
    if (this.active.has(id)) return;
    const active: ActiveDownload = { intent: "none", abort: () => undefined, done: Promise.resolve() };
    this.active.set(id, active);
    try {
      this.update(job, { status: "downloading", error: null });
      await this.downloadToPartialFile(job, active);
      if (active.intent !== "none") return;

      this.update(job, { status: "verifying", error: null });
      const bytes = new Uint8Array(await fsPromises.readFile(this.partialPath(job)));
      const record = this.runtimePacks.install(job.metadata, bytes);
      this.removeJobDirectory(job.id);
      this.update(job, {
        status: "installed",
        bytesDownloaded: job.totalBytes,
        error: null,
        completedAt: new Date().toISOString()
      });
      // Force a readiness read here so a Runtime Pack that was accepted by
      // install() also has a renderer-safe state before the job is complete.
      this.runtimePacks.getReadiness(record.packId, record.target);
    } catch (error) {
      if (active.intent === "pause" || active.intent === "remove" || error instanceof DownloadInterruptedError) return;
      this.update(job, { status: "failed", error: safeDownloadError(error) });
    } finally {
      this.active.delete(id);
    }
  }

  private async downloadToPartialFile(job: RuntimePackDownloadJob, active: ActiveDownload): Promise<void> {
    const partialPath = this.partialPath(job);
    fs.mkdirSync(path.dirname(partialPath), { recursive: true });
    let offset = await fileSize(partialPath);
    if (offset > job.totalBytes) {
      await fsPromises.truncate(partialPath, 0);
      offset = 0;
    }
    job.bytesDownloaded = offset;
    this.persistAndEmit(job);
    if (offset === job.totalBytes) return;

    const response = await this.requestWithRedirects(job.metadata.originUrl!, offset, active);
    active.abort = response.abort;
    if (active.intent !== "none") {
      response.abort();
      throw new DownloadInterruptedError();
    }
    validateResponse(response, offset, job.totalBytes);
    const append = response.statusCode === 206 && offset > 0;
    if (!append) {
      if (fs.existsSync(partialPath)) await fsPromises.truncate(partialPath, 0);
      offset = 0;
      job.bytesDownloaded = 0;
      this.persistAndEmit(job);
    }

    const handle = await fsPromises.open(partialPath, append ? "a" : "w");
    let written = offset;
    try {
      for await (const chunk of response.body) {
        if (active.intent !== "none") throw new DownloadInterruptedError();
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        if (written + bytes.byteLength > job.totalBytes) throw new Error("Runtime Pack 响应超过 metadata 声明大小。");
        await handle.write(bytes);
        written += bytes.byteLength;
        job.bytesDownloaded = written;
        job.updatedAt = new Date().toISOString();
        this.emit(job);
        this.persistProgressIfDue();
      }
    } finally {
      await handle.close();
      response.abort();
    }
    if (written !== job.totalBytes) throw new Error(`Runtime Pack 下载不完整：${written}/${job.totalBytes}`);
    this.persistAndEmit(job);
  }

  private async requestWithRedirects(url: string, rangeStart: number, active: ActiveDownload): Promise<RuntimePackDownloadResponse> {
    let current = url;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (active.intent !== "none") throw new DownloadInterruptedError();
      const response = await this.transport(current, rangeStart);
      if (![301, 302, 303, 307, 308].includes(response.statusCode)) return response;
      const location = response.headers.location;
      response.abort();
      if (!location) throw new Error("Runtime Pack 下载重定向缺少 Location。");
      const next = new URL(location, current).toString();
      if (!isHttpsUrl(next)) throw new Error("Runtime Pack 下载重定向必须继续使用 HTTPS。");
      current = next;
    }
    throw new Error("Runtime Pack 下载重定向次数超过限制。");
  }

  private recoverInterruptedJobs(): void {
    let changed = false;
    for (const job of this.jobs.values()) {
      if (job.status !== "queued" && job.status !== "downloading" && job.status !== "verifying") continue;
      job.status = "paused";
      job.error = "应用重启后已暂停，可继续下载。";
      job.updatedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) this.persist();
  }

  private get(id: string): RuntimePackDownloadJob {
    const job = this.getOptional(id);
    if (!job) throw new Error(`Runtime Pack 下载任务不存在：${id}`);
    return job;
  }

  private getOptional(id: string): RuntimePackDownloadJob | undefined {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Runtime Pack 下载任务 ID 无效。");
    return this.jobs.get(id);
  }

  private update(job: RuntimePackDownloadJob, patch: Partial<RuntimePackDownloadJob>): RuntimePackDownloadJob {
    const next = RuntimePackDownloadJobSchema.parse({ ...job, ...patch, updatedAt: new Date().toISOString() });
    Object.assign(job, next);
    this.jobs.set(job.id, job);
    this.persistAndEmit(job);
    return job;
  }

  private partialPath(job: RuntimePackDownloadJob): string {
    const root = path.resolve(this.paths.runtimeDownloads);
    const jobRoot = path.resolve(root, job.id);
    if (!jobRoot.startsWith(`${root}${path.sep}`)) throw new Error("Runtime Pack 下载路径越界。");
    return path.join(jobRoot, `${job.metadata.sha256}.partial`);
  }

  private removeJobDirectory(id: string): void {
    const root = path.resolve(this.paths.runtimeDownloads);
    const candidate = path.resolve(root, id);
    if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("Runtime Pack 下载目录越界。");
    fs.rmSync(candidate, { recursive: true, force: true });
  }

  private readRegistry(): DownloadRegistry {
    if (!fs.existsSync(this.registryFile)) return { schemaVersion: DOWNLOAD_REGISTRY_SCHEMA_VERSION, jobs: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryFile, "utf8")) as Partial<DownloadRegistry>;
      if (parsed.schemaVersion !== DOWNLOAD_REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.jobs)) throw new Error("schema mismatch");
      const jobs = parsed.jobs.map((job) => RuntimePackDownloadJobSchema.parse(job));
      for (const job of jobs) {
        if (job.totalBytes !== job.metadata.size || job.bytesDownloaded > job.totalBytes) throw new Error("size mismatch");
      }
      return { schemaVersion: DOWNLOAD_REGISTRY_SCHEMA_VERSION, jobs };
    } catch (error) {
      throw new Error(`Runtime Pack 下载 registry 无法读取，拒绝覆盖现有状态：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persist(): void {
    const jobs = [...this.jobs.values()].map((job) => RuntimePackDownloadJobSchema.parse(job));
    writeJsonAtomic(this.registryFile, { schemaVersion: DOWNLOAD_REGISTRY_SCHEMA_VERSION, jobs });
    this.lastProgressPersistAt = Date.now();
  }

  private lastProgressPersistAt = 0;

  private persistProgressIfDue(): void {
    if (Date.now() - this.lastProgressPersistAt < PROGRESS_PERSIST_INTERVAL_MS) return;
    this.persist();
  }

  private persistAndEmit(job: RuntimePackDownloadJob): void {
    this.persist();
    this.emit(job);
  }

  private emit(job: RuntimePackDownloadJob): void {
    try {
      this.onEvent(RuntimePackDownloadJobSchema.parse(job));
    } catch {
      // Renderer notification must never change the persisted download state.
    }
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function validateResponse(response: RuntimePackDownloadResponse, offset: number, totalBytes: number): void {
  if (response.statusCode !== 200 && response.statusCode !== 206) {
    response.abort();
    throw new Error(`Runtime Pack 下载 HTTP 状态异常：${response.statusCode}`);
  }
  const contentLength = response.headers["content-length"];
  if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > totalBytes)) {
    response.abort();
    throw new Error("Runtime Pack 下载响应的 Content-Length 无效。");
  }
  if (response.statusCode === 206) {
    const range = response.headers["content-range"]?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
    const rangeStart = range ? Number(range[1]) : -1;
    const rangeEnd = range ? Number(range[2]) : -1;
    const rangeTotal = range ? Number(range[3]) : -1;
    if (!range || rangeStart !== offset || rangeEnd < rangeStart || rangeEnd >= totalBytes || rangeTotal !== totalBytes) {
      response.abort();
      throw new Error("Runtime Pack 下载响应的 Content-Range 与续传位置不一致。");
    }
    if (contentLength !== undefined && (Number(contentLength) !== rangeEnd - rangeStart + 1 || Number(contentLength) + offset > totalBytes)) {
      response.abort();
      throw new Error("Runtime Pack 下载响应超过 metadata 声明大小。");
    }
  } else if (offset > 0 && contentLength !== undefined && Number(contentLength) !== totalBytes) {
    // A server that ignores Range is allowed to restart from byte zero, but
    // it must still declare the complete signed package size.
    response.abort();
    throw new Error("Runtime Pack 不支持续传且响应大小不完整。");
  }
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const stat = await fsPromises.stat(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function safeDownloadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/https?:\/\/[^\s)]+/gi, "[url]").slice(0, 240) || "Runtime Pack 下载失败。";
}

function requestHttps(url: string, rangeStart: number): Promise<RuntimePackDownloadResponse> {
  if (!isHttpsUrl(url)) return Promise.reject(new Error("Runtime Pack 下载只接受 HTTPS URL。"));
  return new Promise((resolve, reject) => {
    let request: ClientRequest;
    request = https.request(new URL(url), {
      method: "GET",
      headers: rangeStart > 0 ? { Range: `bytes=${rangeStart}-` } : undefined
    }, (response: IncomingMessage) => {
      resolve({
        statusCode: response.statusCode || 0,
        headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value])),
        body: response,
        abort: () => {
          response.destroy();
          request.destroy();
        }
      });
    });
    request.setTimeout(30_000, () => request.destroy(new Error("Runtime Pack 下载连接超时。")));
    request.once("error", reject);
    request.end();
  });
}
