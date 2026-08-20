import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths, type AppPaths } from "../paths/app-paths-service";
import { RuntimePackVerificationError } from "./runtime-pack-verifier";
import { RuntimePackService } from "./runtime-pack-service";
import { RuntimePackUsageRegistry } from "./runtime-pack-usage";
import { RuntimePackMetadataSchema } from "../../shared/runtime-targets";
import { canonicalRuntimePackPayload } from "./runtime-pack-verifier";
import { createRuntimeStaging, RUNTIME_STAGING_MARKER } from "./runtime-staging";

const testKeys = crypto.generateKeyPairSync("ed25519");
const testPublicKey = testKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

describe("RuntimePackService", () => {
  let root = "";
  let paths: AppPaths;
  let service: RuntimePackService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-runtime-pack-"));
    paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    service = new RuntimePackService(paths, { runtimeRoot: testPublicKey });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("installs a verified pack as a candidate and keeps active unchanged until activation", () => {
    const first = pack("1.0.0", Buffer.from("runtime-v1"));
    const firstRecord = service.install(first.metadata, first.bytes);
    expect(firstRecord.status).toBe("candidate");
    expect(fs.existsSync(firstRecord.packagePath)).toBe(true);

    service.activate(firstRecord.packId, firstRecord.target, firstRecord.digest);
    const second = pack("2.0.0", Buffer.from("runtime-v2"));
    const secondRecord = service.install(second.metadata, second.bytes);

    expect(secondRecord.status).toBe("candidate");
    expect(service.list().find((record) => record.digest === firstRecord.digest)?.status).toBe("active");
  });

  it("atomically switches, rolls back, and rejects a downgrade", () => {
    const firstPack = pack("1.0.0", Buffer.from("runtime-v1"));
    const first = service.install(firstPack.metadata, firstPack.bytes);
    service.activate(first.packId, first.target, first.digest);
    const secondPack = pack("2.0.0", Buffer.from("runtime-v2"));
    const second = service.install(secondPack.metadata, secondPack.bytes);
    service.activate(second.packId, second.target, second.digest);

    const rolledBack = service.rollback(first.packId, first.target);
    expect(rolledBack.active.digest).toBe(first.digest);
    expect(rolledBack.previous.digest).toBe(second.digest);
    const downgradePack = pack("1.5.0", Buffer.from("runtime-old"));
    expect(() => service.install(downgradePack.metadata, downgradePack.bytes)).toThrowError(RuntimePackVerificationError);
  });

  it("fails closed when the trusted root is unavailable", () => {
    const packValue = pack("1.0.0", Buffer.from("runtime"));
    const unavailable = new RuntimePackService(paths, {});
    expect(() => unavailable.install(packValue.metadata, packValue.bytes)).toThrowError(/publisher key/);
  });

  it("reports active readiness, detects tampering, and repairs by verified replacement", () => {
    const packValue = pack("1.0.0", Buffer.from("runtime-repair-v1"));
    const record = service.install(packValue.metadata, packValue.bytes);
    service.activate(record.packId, record.target, record.digest);

    expect(service.getReadiness(record.packId, record.target)).toMatchObject({
      status: "active",
      integrity: "verified",
      ready: true
    });
    fs.writeFileSync(record.packagePath, "tampered");
    expect(service.getReadiness(record.packId, record.target)).toMatchObject({
      integrity: "tampered",
      ready: false,
      reason: "Runtime Pack digest 不一致，需要 repair。"
    });

    service.repair(packValue.metadata, packValue.bytes);
    expect(service.getReadiness(record.packId, record.target)).toMatchObject({
      status: "active",
      integrity: "verified",
      ready: true
    });
  });

  it("refuses to activate a candidate after its bytes are tampered", () => {
    const packValue = pack("1.0.0", Buffer.from("runtime-candidate"));
    const record = service.install(packValue.metadata, packValue.bytes);
    fs.writeFileSync(record.packagePath, "changed-before-activation");

    expect(() => service.activate(record.packId, record.target, record.digest)).toThrow(/完整性校验/);
    expect(service.getReadiness(record.packId, record.target)).toMatchObject({ status: "candidate", integrity: "tampered", ready: false });
  });

  it("does not allow repair metadata to downgrade an existing pack", () => {
    const current = pack("2.0.0", Buffer.from("runtime-current"));
    const record = service.install(current.metadata, current.bytes);
    service.activate(record.packId, record.target, record.digest);
    fs.writeFileSync(record.packagePath, "tampered");
    const older = pack("1.0.0", Buffer.from("runtime-older"));

    expect(() => service.repair(older.metadata, older.bytes)).toThrowError(RuntimePackVerificationError);
    expect(service.getReadiness(record.packId, record.target)).toMatchObject({ status: "active", integrity: "tampered", ready: false });
  });

  it("blocks active-pack switching and repair while a Run holds a lease", () => {
    const firstPack = pack("1.0.0", Buffer.from("runtime-v1"));
    const first = service.install(firstPack.metadata, firstPack.bytes);
    service.activate(first.packId, first.target, first.digest);
    const secondPack = pack("2.0.0", Buffer.from("runtime-v2"));
    const second = service.install(secondPack.metadata, secondPack.bytes);
    const usage = new RuntimePackUsageRegistry(paths);
    usage.acquire({ runId: "run-in-use", packId: first.packId, target: first.target, digest: first.digest });

    expect(service.getReadiness(first.packId, first.target)).toMatchObject({ inUse: true, ready: true });
    expect(() => service.activate(second.packId, second.target, second.digest)).toThrow(/正在被 Run 使用/);
    expect(() => service.repair(firstPack.metadata, firstPack.bytes)).toThrow(/正在被 Run 使用/);
    usage.release("run-in-use");
  });

  it("garbage-collects only unused candidates and preserves active/previous rollback slots", () => {
    const firstPack = pack("1.0.0", Buffer.from("runtime-v1"));
    const first = service.install(firstPack.metadata, firstPack.bytes);
    service.activate(first.packId, first.target, first.digest);
    const secondPack = pack("2.0.0", Buffer.from("runtime-v2"));
    const second = service.install(secondPack.metadata, secondPack.bytes);
    service.activate(second.packId, second.target, second.digest);
    const candidatePack = pack("3.0.0", Buffer.from("runtime-candidate"));
    const candidate = service.install(candidatePack.metadata, candidatePack.bytes);

    const readiness = service.garbageCollect();

    expect(service.list().map((record) => record.digest)).toEqual(expect.arrayContaining([first.digest, second.digest]));
    expect(service.list().some((record) => record.digest === candidate.digest)).toBe(false);
    expect(fs.existsSync(candidate.packagePath)).toBe(false);
    expect(readiness.find((record) => record.digest === first.digest)?.status).toBe("previous");
    expect(readiness.find((record) => record.digest === second.digest)?.status).toBe("active");
  });

  it("fails closed when a candidate has an active lease", () => {
    const candidatePack = pack("1.0.0", Buffer.from("runtime-leased-candidate"));
    const candidate = service.install(candidatePack.metadata, candidatePack.bytes);
    const usage = new RuntimePackUsageRegistry(paths);
    usage.acquire({ runId: "candidate-in-use", packId: candidate.packId, target: candidate.target, digest: candidate.digest });

    expect(() => service.garbageCollect()).toThrow(/正在被 Run 使用/);
    expect(service.list().some((record) => record.digest === candidate.digest)).toBe(true);
    usage.release("candidate-in-use");
  });

  it("cleans only marked staging roots owned by dead processes", () => {
    const stale = fs.mkdtempSync(path.join(paths.staging, "runtime-pack-extract-"));
    fs.writeFileSync(path.join(stale, RUNTIME_STAGING_MARKER), JSON.stringify({
      schemaVersion: 1,
      pid: deadProcessId(),
      kind: "pack-extract",
      createdAt: new Date().toISOString()
    }));
    const live = createRuntimeStaging(paths, "runtime-env-", "python-environment");
    const unmarked = fs.mkdtempSync(path.join(paths.staging, "runtime-pack-extract-"));
    const mismatched = fs.mkdtempSync(path.join(paths.staging, "runtime-pack-repair-"));
    fs.writeFileSync(path.join(mismatched, RUNTIME_STAGING_MARKER), JSON.stringify({
      schemaVersion: 1,
      pid: deadProcessId(),
      kind: "pack-install",
      createdAt: new Date().toISOString()
    }));
    const unknown = fs.mkdtempSync(path.join(paths.staging, "user-data-"));

    service.garbageCollect();

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(live.root)).toBe(true);
    expect(fs.existsSync(unmarked)).toBe(true);
    expect(fs.existsSync(mismatched)).toBe(true);
    expect(fs.existsSync(unknown)).toBe(true);
  });

  it("refuses staging cleanup when the lease registry is invalid", () => {
    const stale = fs.mkdtempSync(path.join(paths.staging, "runtime-pack-extract-"));
    fs.writeFileSync(path.join(stale, RUNTIME_STAGING_MARKER), JSON.stringify({
      schemaVersion: 1,
      pid: deadProcessId(),
      kind: "pack-extract",
      createdAt: new Date().toISOString()
    }));
    fs.writeFileSync(path.join(paths.runtimes, "leases", "corrupt.json"), "not-json");

    expect(() => service.garbageCollect()).toThrow(/lease 状态无法读取/);
    expect(fs.existsSync(stale)).toBe(true);
  });
});

function deadProcessId(): number {
  for (let pid = Math.max(process.pid + 1, 40000); pid < 2147483647; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return pid;
    }
  }
  throw new Error("Unable to find a dead process id for runtime staging test.");
}

function pack(version: string, bytes: Buffer): { metadata: ReturnType<typeof RuntimePackMetadataSchema.parse>; bytes: Buffer } {
  const unsigned = RuntimePackMetadataSchema.parse({
    schemaVersion: 1,
    packId: "python-core",
    version,
    target: "linux-x64",
    filename: "python-core.pack",
    size: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    publisherKeyId: "runtimeRoot",
    signatureAlgorithm: "ed25519",
    signature: "placeholder",
    expiresAt: "2027-01-01T00:00:00.000Z",
    license: "PSF-2.0",
    sbom: { format: "spdx", digest: "b".repeat(64) }
  });
  return {
    metadata: { ...unsigned, signature: crypto.sign(null, Buffer.from(canonicalRuntimePackPayload(unsigned)), testKeys.privateKey).toString("base64") },
    bytes
  };
}
