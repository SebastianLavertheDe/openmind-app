import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../lib/fs-utils";
import { RuntimePackMetadataSchema, type RuntimePackMetadata, type RuntimePackId, type RuntimeTarget } from "../../shared/runtime-targets";
import type { AppPaths } from "../paths/app-paths-service";
import { createRuntimeStaging } from "./runtime-staging";

export const RUNTIME_PACK_REGISTRY_SCHEMA_VERSION = 1 as const;
export type RuntimePackStatus = "candidate" | "active" | "previous";

export type RuntimePackRecord = {
  schemaVersion: typeof RUNTIME_PACK_REGISTRY_SCHEMA_VERSION;
  packId: RuntimePackId;
  target: RuntimeTarget;
  version: string;
  digest: string;
  packagePath: string;
  status: RuntimePackStatus;
  verifiedAt: string;
  license: string;
  originUrl?: string;
  sbom: RuntimePackMetadata["sbom"];
};

type RuntimePackRegistry = {
  schemaVersion: typeof RUNTIME_PACK_REGISTRY_SCHEMA_VERSION;
  records: RuntimePackRecord[];
};

export class RuntimePackRepository {
  private readonly registryFile: string;

  constructor(private readonly paths: AppPaths) {
    this.registryFile = path.join(paths.runtimes, "registry.json");
  }

  list(): RuntimePackRecord[] {
    return this.read().records.slice().sort((left, right) =>
      `${left.packId}@${left.target}@${left.version}`.localeCompare(`${right.packId}@${right.target}@${right.version}`)
    );
  }

  get(packId: RuntimePackId, target: RuntimeTarget, digest?: string): RuntimePackRecord | undefined {
    return this.read().records.find((record) => record.packId === packId && record.target === target && (!digest || record.digest === digest));
  }

  getActive(packId: RuntimePackId, target: RuntimeTarget): RuntimePackRecord | undefined {
    return this.read().records.find((record) => record.packId === packId && record.target === target && record.status === "active");
  }

  inspectIntegrity(record: RuntimePackRecord): "verified" | "missing" | "tampered" | "invalid" {
    try {
      this.assertManagedPath(record.packagePath);
      const candidate = path.resolve(record.packagePath);
      if (!fs.existsSync(candidate)) return "missing";
      const realRoot = fs.realpathSync(path.resolve(this.paths.runtimePacks));
      const realCandidate = fs.realpathSync(candidate);
      if (!realCandidate.startsWith(`${realRoot}${path.sep}`)) return "invalid";
      if (!fs.statSync(realCandidate).isFile()) return "invalid";
      const digest = crypto.createHash("sha256").update(fs.readFileSync(realCandidate)).digest("hex");
      return digest === record.digest ? "verified" : "tampered";
    } catch {
      return "invalid";
    }
  }

  /** Stores a verified pack as a candidate; it never changes active. */
  installVerified(input: { metadata: RuntimePackMetadata; bytes: Uint8Array; verifiedAt: string }): RuntimePackRecord {
    const metadata = RuntimePackMetadataSchema.parse(input.metadata);
    if (input.bytes.byteLength !== metadata.size) throw new Error("Runtime pack 大小与 metadata 不一致。");
    const digest = crypto.createHash("sha256").update(input.bytes).digest("hex");
    if (digest !== metadata.sha256) throw new Error("Runtime pack SHA-256 与 metadata 不一致。");
    const existing = this.get(metadata.packId, metadata.target, metadata.sha256);
    if (existing) return existing;
    const destination = path.join(this.paths.runtimePacks, metadata.packId, metadata.target, `${metadata.version}-${metadata.sha256.slice(0, 16)}`);
    const staging = createRuntimeStaging(this.paths, "runtime-pack-", "pack-install");
    const stagingRoot = staging.root;
    const stagedPackage = path.join(stagingRoot, metadata.filename);
    try {
      fs.writeFileSync(stagedPackage, input.bytes, { flag: "wx" });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (fs.existsSync(destination)) {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
      } else {
        staging.clearMarker();
        fs.renameSync(stagingRoot, destination);
      }
      const record: RuntimePackRecord = {
        schemaVersion: RUNTIME_PACK_REGISTRY_SCHEMA_VERSION,
        packId: metadata.packId,
        target: metadata.target,
        version: metadata.version,
        digest: metadata.sha256,
        packagePath: path.join(destination, metadata.filename),
        status: "candidate",
        verifiedAt: input.verifiedAt,
        license: metadata.license,
        ...(metadata.originUrl ? { originUrl: metadata.originUrl } : {}),
        sbom: metadata.sbom
      };
      return this.upsert(record);
    } catch (error) {
      if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  /** Replaces a verified same-digest package with a recoverable directory swap. */
  repairVerified(input: { metadata: RuntimePackMetadata; bytes: Uint8Array; verifiedAt: string }): RuntimePackRecord {
    const metadata = RuntimePackMetadataSchema.parse(input.metadata);
    const digest = crypto.createHash("sha256").update(input.bytes).digest("hex");
    if (input.bytes.byteLength !== metadata.size || digest !== metadata.sha256) throw new Error("Runtime pack repair 校验失败。");
    const existing = this.get(metadata.packId, metadata.target, metadata.sha256);
    if (!existing) return this.installVerified(input);
    this.assertManagedPath(existing.packagePath);
    const packageRoot = path.dirname(existing.packagePath);
    const staging = createRuntimeStaging(this.paths, "runtime-pack-repair-", "pack-repair");
    const stagingRoot = staging.root;
    const stagedPackage = path.join(stagingRoot, metadata.filename);
    const backupRoot = path.join(this.paths.staging, `runtime-pack-backup-${metadata.sha256}-${Date.now()}`);
    fs.writeFileSync(stagedPackage, input.bytes, { flag: "wx" });
    let swapped = false;
    try {
      staging.clearMarker();
      fs.renameSync(packageRoot, backupRoot);
      fs.renameSync(stagingRoot, packageRoot);
      swapped = true;
      const registry = this.read();
      const repaired: RuntimePackRecord = {
        ...existing,
        version: metadata.version,
        packagePath: path.join(packageRoot, metadata.filename),
        verifiedAt: input.verifiedAt,
        license: metadata.license,
        ...(metadata.originUrl ? { originUrl: metadata.originUrl } : {}),
        sbom: metadata.sbom
      };
      this.write({ schemaVersion: registry.schemaVersion, records: registry.records.map((record) => record === existing ? repaired : record) });
      fs.rmSync(backupRoot, { recursive: true, force: true });
      return repaired;
    } catch (error) {
      if (swapped && fs.existsSync(packageRoot)) fs.rmSync(packageRoot, { recursive: true, force: true });
      if (fs.existsSync(backupRoot) && !fs.existsSync(packageRoot)) fs.renameSync(backupRoot, packageRoot);
      throw error;
    } finally {
      if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
      if (fs.existsSync(backupRoot)) fs.rmSync(backupRoot, { recursive: true, force: true });
    }
  }

  activate(packId: RuntimePackId, target: RuntimeTarget, digest: string): { active: RuntimePackRecord; previous?: RuntimePackRecord } {
    const registry = this.read();
    const candidate = registry.records.find((record) => record.packId === packId && record.target === target && record.digest === digest);
    if (!candidate) throw new Error(`Runtime pack 不存在：${packId}@${target}@${digest}`);
    if (candidate.status === "active") return { active: candidate };
    const previous = registry.records.find((record) => record.packId === packId && record.target === target && record.status === "active");
    const records = registry.records.map((record) => {
      if (record.packId !== packId || record.target !== target) return record;
      if (record.digest === digest) return { ...record, status: "active" as const };
      if (record.status === "active") return { ...record, status: "previous" as const };
      if (record.status === "previous") return { ...record, status: "candidate" as const };
      return record;
    });
    this.write({ schemaVersion: registry.schemaVersion, records });
    return {
      active: records.find((record) => record.packId === packId && record.target === target && record.digest === digest)!,
      ...(previous ? { previous: records.find((record) => record.packId === packId && record.target === target && record.digest === previous.digest) } : {})
    };
  }

  rollback(packId: RuntimePackId, target: RuntimeTarget): { active: RuntimePackRecord; previous: RuntimePackRecord } {
    const registry = this.read();
    const active = registry.records.find((record) => record.packId === packId && record.target === target && record.status === "active");
    const previous = registry.records.find((record) => record.packId === packId && record.target === target && record.status === "previous");
    if (!active || !previous) throw new Error(`Runtime pack 没有可回滚版本：${packId}@${target}`);
    const records = registry.records.map((record) => {
      if (record.packId !== packId || record.target !== target) return record;
      if (record.digest === previous.digest) return { ...record, status: "active" as const };
      if (record.digest === active.digest) return { ...record, status: "previous" as const };
      return record;
    });
    this.write({ schemaVersion: registry.schemaVersion, records });
    return {
      active: records.find((record) => record.packId === packId && record.target === target && record.status === "active")!,
      previous: records.find((record) => record.packId === packId && record.target === target && record.status === "previous")!
    };
  }

  remove(packId: RuntimePackId, target: RuntimeTarget, digest: string): boolean {
    const registry = this.read();
    const record = registry.records.find((item) => item.packId === packId && item.target === target && item.digest === digest);
    if (!record) return false;
    if (record.status === "active") throw new Error("active Runtime pack 不能删除。");
    this.assertManagedPath(record.packagePath);
    const trash = path.join(this.paths.staging, `runtime-remove-${digest}-${Date.now()}`);
    const packageRoot = path.dirname(record.packagePath);
    const moved = fs.existsSync(packageRoot);
    fs.mkdirSync(this.paths.staging, { recursive: true });
    if (moved) fs.renameSync(packageRoot, trash);
    try {
      const next = registry.records.filter((item) => item !== record);
      this.write({ schemaVersion: registry.schemaVersion, records: next });
      fs.rmSync(trash, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (moved && !fs.existsSync(packageRoot) && fs.existsSync(trash)) fs.renameSync(trash, packageRoot);
      throw error;
    }
  }

  private upsert(record: RuntimePackRecord): RuntimePackRecord {
    const registry = this.read();
    const records = registry.records.filter((item) => !(item.packId === record.packId && item.target === record.target && item.digest === record.digest));
    records.push(record);
    this.write({ schemaVersion: registry.schemaVersion, records });
    return record;
  }

  private read(): RuntimePackRegistry {
    if (!fs.existsSync(this.registryFile)) return { schemaVersion: RUNTIME_PACK_REGISTRY_SCHEMA_VERSION, records: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryFile, "utf8")) as RuntimePackRegistry;
      if (parsed.schemaVersion !== RUNTIME_PACK_REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.records)) throw new Error("Runtime registry schema mismatch");
      const registry = { schemaVersion: RUNTIME_PACK_REGISTRY_SCHEMA_VERSION, records: parsed.records.map(validateRecord) };
      validateRegistry(registry);
      return registry;
    } catch (error) {
      throw new Error(`Runtime registry 无法读取，拒绝覆盖现有运行时状态：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(registry: RuntimePackRegistry): void {
    validateRegistry(registry);
    writeJsonAtomic(this.registryFile, registry);
  }

  private assertManagedPath(value: string): void {
    const root = path.resolve(this.paths.runtimePacks);
    const candidate = path.resolve(value);
    if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) throw new Error("Runtime pack 路径越出 app-private runtimePacks。");
  }
}

function validateRegistry(registry: RuntimePackRegistry): void {
  const active = new Set<string>();
  const previous = new Set<string>();
  for (const record of registry.records) {
    validateRecord(record);
    const key = `${record.packId}@${record.target}`;
    if (record.status === "active") {
      if (active.has(key)) throw new Error(`Runtime pack 出现多个 active：${key}`);
      active.add(key);
    }
    if (record.status === "previous") {
      if (previous.has(key)) throw new Error(`Runtime pack 出现多个 previous：${key}`);
      previous.add(key);
    }
  }
}

function validateRecord(value: unknown): RuntimePackRecord {
  if (!value || typeof value !== "object") throw new Error("Runtime registry record 不是对象");
  const record = value as Partial<RuntimePackRecord>;
  if (record.schemaVersion !== RUNTIME_PACK_REGISTRY_SCHEMA_VERSION
    || typeof record.packId !== "string" || typeof record.target !== "string"
    || typeof record.version !== "string" || !/^[a-f0-9]{64}$/.test(record.digest || "")
    || typeof record.packagePath !== "string" || !["candidate", "active", "previous"].includes(record.status || "")
    || typeof record.verifiedAt !== "string" || typeof record.license !== "string"
    || !record.sbom || typeof record.sbom !== "object") {
    throw new Error("Runtime registry record schema mismatch");
  }
  RuntimePackMetadataSchema.shape.packId.parse(record.packId);
  RuntimePackMetadataSchema.shape.target.parse(record.target);
  RuntimePackMetadataSchema.shape.sbom.parse(record.sbom);
  return record as RuntimePackRecord;
}
