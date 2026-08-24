import type { AppPaths } from "../paths/app-paths-service";
import { RuntimePackMetadataSchema, RuntimePackReadinessSchema, type RuntimePackId, type RuntimePackReadiness, type RuntimeTarget } from "../../shared/runtime-targets";
import { RuntimePackRepository, type RuntimePackRecord } from "./runtime-pack-repository";
import { compareRuntimeVersions, RuntimePackVerifier, type RuntimeTrustRoots } from "./runtime-pack-verifier";
import { RuntimePackUsageRegistry } from "./runtime-pack-usage";
import { garbageCollectRuntimeStaging } from "./runtime-staging";

/** Main-process boundary for verified offline packs; no network or execution. */
export class RuntimePackService {
  private readonly repository: RuntimePackRepository;
  private readonly verifier: RuntimePackVerifier;
  private readonly usage: RuntimePackUsageRegistry;

  constructor(private readonly paths: AppPaths, trustRoots: RuntimeTrustRoots) {
    this.repository = new RuntimePackRepository(paths);
    this.verifier = new RuntimePackVerifier(trustRoots);
    this.usage = new RuntimePackUsageRegistry(paths);
  }

  install(metadata: unknown, bytes: Uint8Array): RuntimePackRecord {
    const parsed = RuntimePackMetadataSchema.parse(metadata);
    const previous = this.repository.list()
      .filter((record) => record.packId === parsed.packId && record.target === parsed.target)
      .map((record) => record.version)
      .sort((left, right) => compareRuntimeVersions(right, left))[0];
    const verified = this.verifier.verify({ metadata: parsed, bytes, previousVersion: previous });
    return this.repository.installVerified({ ...verified, bytes });
  }

  list(): RuntimePackRecord[] {
    return this.repository.list();
  }

  listReadiness(): RuntimePackReadiness[] {
    return this.repository.list().map((record) => this.toReadiness(record));
  }

  getReadiness(packId: RuntimePackId, target: RuntimeTarget): RuntimePackReadiness | undefined {
    const record = this.repository.getActive(packId, target) || this.repository.get(packId, target);
    return record ? this.toReadiness(record) : undefined;
  }

  getActive(packId: RuntimePackId, target: RuntimeTarget): RuntimePackRecord | undefined {
    return this.repository.getActive(packId, target);
  }

  activate(packId: RuntimePackId, target: RuntimeTarget, digest: string): { active: RuntimePackRecord; previous?: RuntimePackRecord } {
    this.usage.assertNotInUse(packId, target);
    const candidate = this.repository.get(packId, target, digest);
    if (!candidate) throw new Error(`Runtime pack 不存在：${packId}@${target}@${digest}`);
    const integrity = this.repository.inspectIntegrity(candidate);
    if (integrity !== "verified") throw new Error(`Runtime pack 未通过完整性校验，不能激活：${integrity}`);
    return this.repository.activate(packId, target, digest);
  }

  rollback(packId: RuntimePackId, target: RuntimeTarget): { active: RuntimePackRecord; previous: RuntimePackRecord } {
    this.usage.assertNotInUse(packId, target);
    const previous = this.repository.list().find((record) => record.packId === packId && record.target === target && record.status === "previous");
    if (!previous) throw new Error(`Runtime pack 没有可回滚版本：${packId}@${target}`);
    const integrity = this.repository.inspectIntegrity(previous);
    if (integrity !== "verified") throw new Error(`Runtime pack 回滚目标未通过完整性校验：${integrity}`);
    return this.repository.rollback(packId, target);
  }

  remove(packId: RuntimePackId, target: RuntimeTarget, digest: string): boolean {
    this.usage.assertNotInUse(packId, target, digest);
    return this.repository.remove(packId, target, digest);
  }

  /**
   * Removes only candidate Packs that are not active/previous and have no
   * live Run lease. Active and previous versions are retained for rollback;
   * unknown files are left untouched so GC never becomes an implicit repair
   * or broad directory cleanup operation.
   */
  garbageCollect(): RuntimePackReadiness[] {
    this.usage.assertHealthy();
    const candidates = this.repository.list().filter((record) => record.status === "candidate");
    for (const record of candidates) {
      this.usage.assertNotInUse(record.packId, record.target, record.digest);
      this.repository.remove(record.packId, record.target, record.digest);
    }
    garbageCollectRuntimeStaging(this.paths);
    return this.listReadiness();
  }

  repair(metadata: unknown, bytes: Uint8Array): RuntimePackRecord {
    const parsed = RuntimePackMetadataSchema.parse(metadata);
    this.usage.assertNotInUse(parsed.packId, parsed.target, parsed.sha256);
    const previous = this.repository.list()
      .filter((record) => record.packId === parsed.packId && record.target === parsed.target)
      .map((record) => record.version)
      .sort((left, right) => compareRuntimeVersions(right, left))[0];
    const verified = this.verifier.verify({ metadata: parsed, bytes, previousVersion: previous });
    return this.repository.repairVerified({ ...verified, bytes });
  }

  private toReadiness(record: RuntimePackRecord): RuntimePackReadiness {
    const integrity = this.repository.inspectIntegrity(record);
    const inUse = this.usage.isInUse(record.packId, record.target, record.digest);
    const ready = record.status === "active" && integrity === "verified";
    return RuntimePackReadinessSchema.parse({
      packId: record.packId,
      target: record.target,
      version: record.version,
      digest: record.digest,
      status: record.status,
      verifiedAt: record.verifiedAt,
      license: record.license,
      ...(record.originUrl ? { originUrl: record.originUrl } : {}),
      sbom: record.sbom,
      integrity,
      inUse,
      ready,
      reason: ready ? "Runtime Pack 已激活且完整性校验通过。" : integrity === "missing" ? "Runtime Pack 文件缺失，需要 repair。" : integrity === "tampered" ? "Runtime Pack digest 不一致，需要 repair。" : record.status !== "active" ? "Runtime Pack 尚未激活。" : "Runtime Pack 路径或格式无效。"
    });
  }

}
