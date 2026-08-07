import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { RuntimePackDownloadService, type RuntimePackDownloadResponse } from "./runtime-pack-download-service";
import type { RuntimePackMetadata } from "../../shared/runtime-targets";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("RuntimePackDownloadService", () => {
  it("only describes HTTPS manifest downloads and exposes install conditions", () => {
    const fixture = createFixture();
    const service = new RuntimePackDownloadService(fixture.paths, fixture.runtimePacks);
    const descriptor = service.describe(metadata({ originUrl: "https://cdn.example.test/python.zip", installSize: 12, conditions: ["需要接受 PSF-2.0 License"] }));
    expect(descriptor).toMatchObject({
      downloadSize: 4,
      installSize: 12,
      license: "PSF-2.0",
      conditions: ["需要接受 PSF-2.0 License"],
      sourceUrl: "https://cdn.example.test/python.zip"
    });
    expect(() => service.describe(metadata({ originUrl: "http://cdn.example.test/python.zip" }))).toThrow("HTTPS");
  });

  it("downloads into app-private staging and re-enters RuntimePackService verification", async () => {
    const fixture = createFixture();
    const install = vi.fn().mockReturnValue({ packId: "python-core", target: "windows-x64", version: "1.0.0", digest: "a".repeat(64) });
    const getReadiness = vi.fn();
    const transport = vi.fn(async (): Promise<RuntimePackDownloadResponse> => response(200, "4", [new Uint8Array([1, 2]), new Uint8Array([3, 4])]));
    const service = new RuntimePackDownloadService(fixture.paths, { install, getReadiness } as never, undefined, transport);

    const job = service.start(metadata());
    await waitForStatus(service, job.id, "installed");

    expect(transport).toHaveBeenCalledWith("https://cdn.example.test/python.zip", 0);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ packId: "python-core" }), new Uint8Array([1, 2, 3, 4]));
    expect(getReadiness).toHaveBeenCalledWith("python-core", "windows-x64");
    expect(service.list()[0]).toMatchObject({ id: job.id, status: "installed", bytesDownloaded: 4, totalBytes: 4 });
    expect(fs.existsSync(path.join(fixture.paths.runtimeDownloads, job.id))).toBe(false);
  });

  it("pauses without losing the partial file and resumes with an HTTP Range request", async () => {
    const fixture = createFixture();
    const install = vi.fn().mockReturnValue({ packId: "python-core", target: "windows-x64", version: "1.0.0", digest: "a".repeat(64) });
    const firstChunkReleased = deferred<void>();
    const secondRequest = deferred<void>();
    const transport = vi.fn()
      .mockImplementationOnce(async (): Promise<RuntimePackDownloadResponse> => response(200, "4", (async function* () {
        yield new Uint8Array([1, 2]);
        await firstChunkReleased.promise;
        yield new Uint8Array([3, 4]);
      })()))
      .mockImplementationOnce(async (_url: string, rangeStart: number): Promise<RuntimePackDownloadResponse> => {
        expect(rangeStart).toBe(2);
        secondRequest.resolve();
        return response(206, "2", [new Uint8Array([3, 4])], "bytes 2-3/4");
      });
    const service = new RuntimePackDownloadService(fixture.paths, { install, getReadiness: vi.fn() } as never, undefined, transport);
    const job = service.start(metadata());
    await waitForStatus(service, job.id, "downloading");
    await waitForBytes(service, job.id, 2);

    expect(service.pause(job.id).status).toBe("paused");
    firstChunkReleased.resolve();
    await waitForStatus(service, job.id, "paused");
    expect(service.list()[0].bytesDownloaded).toBe(2);

    service.resume(job.id);
    await secondRequest.promise;
    await waitForStatus(service, job.id, "installed");
    expect(install).toHaveBeenCalledWith(expect.anything(), new Uint8Array([1, 2, 3, 4]));
    expect(transport).toHaveBeenNthCalledWith(2, "https://cdn.example.test/python.zip", 2);
  });

  it("recovers in-flight jobs as paused after a process restart", async () => {
    const fixture = createFixture();
    const gate = deferred<void>();
    const service = new RuntimePackDownloadService(fixture.paths, fixture.runtimePacks, undefined, async () => response(200, "4", (async function* () {
      await gate.promise;
      yield new Uint8Array([1, 2, 3, 4]);
    })()));
    const job = service.start(metadata());
    await waitForStatus(service, job.id, "downloading");
    expect(service.list()).toHaveLength(1);
    // A new service instance sees the persisted queued/downloading record and
    // fails closed to paused instead of restarting network activity.
    const recovered = new RuntimePackDownloadService(fixture.paths, fixture.runtimePacks, undefined, async () => response(200, "4", []));
    expect(recovered.list()).toEqual([expect.objectContaining({ id: job.id, status: "paused", error: "应用重启后已暂停，可继续下载。" })]);
    gate.resolve(undefined);
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-runtime-download-"));
  roots.push(root);
  const paths = buildAppPaths(root);
  ensureAppPaths(paths);
  const runtimePacks = { install: vi.fn(), getReadiness: vi.fn() } as never;
  return { paths, runtimePacks };
}

function metadata(overrides: Partial<RuntimePackMetadata> = {}): RuntimePackMetadata {
  return {
    schemaVersion: 1,
    packId: "python-core",
    version: "1.0.0",
    target: "windows-x64",
    filename: "python.zip",
    size: 4,
    sha256: "a".repeat(64),
    publisherKeyId: "runtime-root",
    signatureAlgorithm: "ed25519",
    signature: "test-signature",
    expiresAt: "2099-01-01T00:00:00.000Z",
    originUrl: "https://cdn.example.test/python.zip",
    license: "PSF-2.0",
    sbom: { format: "spdx", digest: "b".repeat(64) },
    ...overrides
  };
}

function response(statusCode: number, contentLength: string, chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, contentRange?: string): RuntimePackDownloadResponse {
  return {
    statusCode,
    headers: { "content-length": contentLength, ...(contentRange ? { "content-range": contentRange } : {}) },
    body: isAsyncIterable(chunks) ? chunks : (async function* () { yield* chunks; })(),
    abort: vi.fn()
  };
}

function isAsyncIterable(value: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): value is AsyncIterable<Uint8Array> {
  return typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function";
}

function deferred<T>() {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

async function waitForStatus(service: RuntimePackDownloadService, id: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.list().find((job) => job.id === id)?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`download job did not reach ${status}: ${JSON.stringify(service.list().find((job) => job.id === id))}`);
}

async function waitForBytes(service: RuntimePackDownloadService, id: string, bytes: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((service.list().find((job) => job.id === id)?.bytesDownloaded || 0) >= bytes) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`download job did not reach ${bytes} bytes: ${JSON.stringify(service.list().find((job) => job.id === id))}`);
}
