import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  RemoteSkillCatalogSchema,
  RemoteSkillCatalogEntrySchema,
  SKILL_REGISTRY_CATALOG_MAX_BYTES,
  SKILL_REGISTRY_PACKAGE_MAX_BYTES,
  type RemoteSkillCatalog,
  type RemoteSkillCatalogEntry
} from "../../shared/skill-registry";
import type { AppPaths } from "../paths/app-paths-service";

export interface RemoteSkillRegistryStatus {
  state: "fresh" | "cached" | "unavailable";
  updatedAt: string | null;
  error: string | null;
}

export interface RemoteSkillRegistryOptions {
  timeoutMs?: number;
  /** Directory sources are checked on every request; HTTP defaults to five minutes. */
  ttlMs?: number;
}

type CachedCatalog = { source: string; updatedAt: string; catalog: RemoteSkillCatalog };
type RegistryActivity = { refresh?: Promise<RemoteSkillCatalog | null>; lastSuccess: number; error: string | null };

// IPC callers create services independently. Share in-flight work by app-private
// cache + source, without ever sharing caches between userData directories.
const activity = new Map<string, RegistryActivity>();
const downloads = new Map<string, Promise<string>>();

class RegistryError extends Error {}

/** The source cannot currently supply an archive; an intact installed copy may be kept. */
export class RemoteSkillPackageUnavailableError extends RegistryError {
  constructor(message = "Unable to download the Skill package. Check the configured source and try again.") {
    super(message);
    this.name = "RemoteSkillPackageUnavailableError";
  }
}

function fail(message: string): never { throw new RegistryError(message); }

function publicError(error: unknown): string {
  // Do not expose a source URL, OS path, response body or fetch error (which may
  // include private configuration) in renderer-facing diagnostics.
  return error instanceof RegistryError ? error.message : "Unable to read the Skill registry. Check the configured source and try again.";
}

function safeUrlPath(url: URL): boolean {
  try {
    return url.pathname.split("/").every(segment => {
      const decoded = decodeURIComponent(segment);
      return decoded !== "." && decoded !== ".." && !/[\/\\\0]/.test(decoded);
    });
  } catch { return false; }
}

function normalizeSource(source: string | null): string | null {
  if (!source?.trim()) return null;
  const value = source.trim();
  if (value.length > 4096 || value.includes("\0")) fail("Invalid Skill registry source.");
  if (path.isAbsolute(value)) return path.resolve(value);
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !safeUrlPath(url)) {
      fail("The Skill registry needs an absolute directory or an HTTP(S) base URL without credentials, query or fragment.");
    }
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    fail("The Skill registry needs an absolute directory or an HTTP(S) base URL.");
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/** Resolve the explicitly selected directory, but never follow child symlinks. */
function safeChild(root: string, relative: string): string {
  const resolvedRoot = fs.realpathSync(root);
  let current = resolvedRoot;
  for (const segment of relative.split("/")) {
    if (!segment || segment === "." || segment === ".." || /[\\\0:]/.test(segment)) fail("Unsafe Skill registry path.");
    current = path.join(current, segment);
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink()) fail("Symbolic links are not allowed in the Skill registry.");
  }
  if (!inside(resolvedRoot, fs.realpathSync(current))) fail("Unsafe Skill registry path.");
  return current;
}

function checkedFileSize(info: fs.Stats, maxBytes: number): number {
  if (!info.isFile()) fail("The Skill registry entry is not a regular file.");
  if (info.size > maxBytes) fail("The Skill registry response exceeds its size limit.");
  return info.size;
}

function readBoundedSync(file: string, maxBytes: number): Buffer {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const size = checkedFileSize(fs.fstatSync(fd), maxBytes);
    const data = Buffer.alloc(size + 1);
    let total = 0;
    while (total < data.length) {
      const count = fs.readSync(fd, data, total, data.length - total, null);
      if (!count) break;
      total += count;
    }
    if (total !== size) fail("The Skill registry file changed while being read. Try again.");
    return data.subarray(0, total);
  } finally { fs.closeSync(fd); }
}

async function readBounded(file: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const size = checkedFileSize(await handle.stat(), maxBytes);
    const data = Buffer.alloc(size + 1);
    let total = 0;
    while (total < data.length) {
      const { bytesRead } = await handle.read(data, total, data.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total !== size) fail("The Skill registry file changed while being read. Try again.");
    return data.subarray(0, total);
  } finally { await handle.close(); }
}

/** Read a catalogue or acquire one archive. Installing/extracting remains in the package service. */
export class RemoteSkillRegistry {
  readonly source: string | null;
  private readonly cacheBase: string;
  private readonly cacheKey: string;
  private readonly cacheRoot: string;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly remote: boolean;

  constructor(paths: AppPaths, source: string | null, options: RemoteSkillRegistryOptions = {}) {
    this.source = normalizeSource(source);
    this.cacheBase = path.resolve(paths.cache);
    this.cacheKey = crypto.createHash("sha256").update(this.source ?? "").digest("hex");
    this.cacheRoot = path.join(this.cacheBase, "skill-registry", this.cacheKey);
    this.remote = this.source !== null && /^https?:\/\//.test(this.source);
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 15_000);
    this.ttlMs = Math.max(0, options.ttlMs ?? (this.remote ? 5 * 60_000 : 0));
  }

  private get activity(): RegistryActivity {
    let state = activity.get(this.cacheRoot);
    if (!state) {
      state = { lastSuccess: 0, error: null };
      activity.set(this.cacheRoot, state);
    }
    return state;
  }

  private cachedEnvelope(): CachedCatalog | null {
    if (!this.source) return null;
    try {
      const file = safeChild(this.cacheBase, `skill-registry/${this.cacheKey}/catalog.json`);
      const value = JSON.parse(readBoundedSync(file, SKILL_REGISTRY_CATALOG_MAX_BYTES + 8192).toString("utf8")) as CachedCatalog;
      if (value.source !== this.source || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return null;
      const catalog = RemoteSkillCatalogSchema.safeParse(value.catalog);
      return catalog.success ? { source: this.source, updatedAt: value.updatedAt, catalog: catalog.data } : null;
    } catch { return null; }
  }

  /** Every read validates the on-disk envelope and schema, including after restart. */
  readCached(): RemoteSkillCatalog | null { return this.cachedEnvelope()?.catalog ?? null; }

  status(): RemoteSkillRegistryStatus {
    const cached = this.cachedEnvelope();
    return {
      state: !cached ? "unavailable" : this.activity.lastSuccess > 0 && !this.activity.error ? "fresh" : "cached",
      updatedAt: cached?.updatedAt ?? null,
      error: this.source ? this.activity.error : null
    };
  }

  async refresh(force = false): Promise<RemoteSkillCatalog | null> {
    if (!this.source) return null;
    const state = this.activity;
    if (state.refresh) return state.refresh;
    const cached = this.readCached();
    if (!force && cached && !state.error && Date.now() - state.lastSuccess < this.ttlMs) return cached;
    const pending = (async () => {
      try {
        const data = await this.readSource("catalog.json", SKILL_REGISTRY_CATALOG_MAX_BYTES);
        let catalog: RemoteSkillCatalog;
        try { catalog = RemoteSkillCatalogSchema.parse(JSON.parse(data.toString("utf8"))); }
        catch { fail("The Skill registry catalogue is invalid. The last downloaded catalogue has been kept."); }
        if (Buffer.byteLength(JSON.stringify(catalog)) > SKILL_REGISTRY_CATALOG_MAX_BYTES) fail("The Skill registry response exceeds its size limit.");
        const updatedAt = new Date().toISOString();
        await this.writeCache("catalog.json", Buffer.from(JSON.stringify({ source: this.source, updatedAt, catalog })));
        state.lastSuccess = Date.now();
        state.error = null;
        return catalog;
      } catch (error) {
        state.error = publicError(error);
        return this.readCached();
      }
    })();
    state.refresh = pending;
    try { return await pending; }
    finally { if (state.refresh === pending) state.refresh = undefined; }
  }

  async packageFile(input: RemoteSkillCatalogEntry): Promise<string> {
    if (!this.source) fail("No Skill registry source is configured.");
    const parsed = RemoteSkillCatalogEntrySchema.safeParse(input);
    if (!parsed.success) fail("The Skill registry package entry is invalid.");
    const entry = parsed.data;
    const key = `${this.cacheRoot}/${entry.package.sha256}/${entry.package.size}`;
    const existing = downloads.get(key);
    if (existing) return existing;
    const pending = this.acquirePackage(entry);
    downloads.set(key, pending);
    try { return await pending; }
    finally { if (downloads.get(key) === pending) downloads.delete(key); }
  }

  private async acquirePackage(entry: RemoteSkillCatalogEntry): Promise<string> {
    const relative = `archives/${entry.package.sha256}.zip`;
    const target = path.join(this.cacheRoot, relative);
    try {
      const cached = safeChild(this.cacheBase, `skill-registry/${this.cacheKey}/${relative}`);
      const data = await readBounded(cached, SKILL_REGISTRY_PACKAGE_MAX_BYTES);
      if (this.matchesPackage(data, entry)) return cached;
      await fs.promises.rm(cached, { force: true });
    } catch {
      // Missing, unreadable and corrupt archives never count as a successful
      // cache hit. The source is retried below and still must pass verification.
    }
    try {
      const data = await this.readSource(entry.package.path, Math.min(entry.package.size, SKILL_REGISTRY_PACKAGE_MAX_BYTES));
      if (!this.matchesPackage(data, entry)) fail("The Skill package size or checksum does not match its catalogue entry.");
      await this.writeCache(relative, data);
      return target;
    } catch (error) {
      if (error instanceof RemoteSkillPackageUnavailableError) throw error;
      throw new RegistryError(error instanceof RegistryError ? error.message : "Unable to download the Skill package. Check the configured source and try again.");
    }
  }

  private matchesPackage(data: Buffer, entry: RemoteSkillCatalogEntry): boolean {
    return data.length === entry.package.size && crypto.createHash("sha256").update(data).digest("hex") === entry.package.sha256;
  }

  private async readSource(relative: string, maxBytes: number): Promise<Buffer> {
    if (!this.source) fail("No Skill registry source is configured.");
    if (!this.remote) {
      try { return await readBounded(safeChild(this.source, relative), maxBytes); }
      catch (error) {
        // File availability and integrity are deliberately separate: callers
        // must not hide a bad checksum, symlink or malformed path as offline.
        if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EIO", "ENODEV", "ENXIO", "ENETUNREACH", "EBUSY", "EMFILE", "ENFILE"].includes((error as NodeJS.ErrnoException).code ?? "")) {
          throw new RemoteSkillPackageUnavailableError();
        }
        throw error;
      }
    }
    const base = new URL(this.source);
    let current = new URL(relative, base);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (current.origin !== base.origin || !current.pathname.startsWith(base.pathname) || current.username || current.password || current.search || current.hash || !safeUrlPath(current)) {
          fail("The Skill registry redirected outside its configured source.");
        }
        const response = await fetch(current, { signal: controller.signal, redirect: "manual", credentials: "omit" });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const location = response.headers.get("location");
          if (!location || redirects === 3) fail("The Skill registry returned an invalid redirect.");
          try { current = new URL(location, current); }
          catch { fail("The Skill registry returned an invalid redirect."); }
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new RemoteSkillPackageUnavailableError(`The Skill registry returned HTTP ${response.status}.`);
        }
        const length = response.headers.get("content-length");
        if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
          await response.body?.cancel();
          fail("The Skill registry response exceeds its size limit.");
        }
        if (!response.body) fail("The Skill registry returned an empty response.");
        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let total = 0;
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) break;
            total += result.value.byteLength;
            if (total > maxBytes) fail("The Skill registry response exceeds its size limit.");
            chunks.push(Buffer.from(result.value));
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        return Buffer.concat(chunks, total);
      }
      fail("The Skill registry returned an invalid redirect.");
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      if (controller.signal.aborted) throw new RemoteSkillPackageUnavailableError("The Skill registry request timed out. Try again.");
      throw new RemoteSkillPackageUnavailableError();
    } finally { clearTimeout(timer); }
  }

  private async writeCache(relative: string, data: Buffer): Promise<void> {
    // Cache files are only beneath the application cache. Reject symlinked
    // children before mkdir/open/rename, including stale tampered cache entries.
    fs.mkdirSync(this.cacheBase, { recursive: true });
    let directory = fs.realpathSync(this.cacheBase);
    for (const part of ["skill-registry", this.cacheKey, ...relative.split("/").slice(0, -1)]) {
      directory = path.join(directory, part);
      try { fs.mkdirSync(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const info = fs.lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) fail("Unsafe Skill registry cache path.");
    }
    const target = path.join(directory, path.basename(relative));
    const existing = fs.lstatSync(target, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) fail("Unsafe Skill registry cache path.");
    const temporary = path.join(directory, `.${path.basename(relative)}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      await fs.promises.rename(temporary, target);
    } finally { await fs.promises.rm(temporary, { force: true }).catch(() => undefined); }
  }
}
