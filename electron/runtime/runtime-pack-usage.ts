import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppPaths } from "../paths/app-paths-service";
import type { RuntimePackId, RuntimeTarget } from "../../shared/runtime-targets";

const SCHEMA_VERSION = 1 as const;

export type RuntimePackLease = {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  pid: number;
  packId: RuntimePackId;
  target: RuntimeTarget;
  digest: string;
  acquiredAt: string;
};

/** Small cross-process lease registry used to protect packs during a Run. */
export class RuntimePackUsageRegistry {
  private readonly leasesRoot: string;

  constructor(paths: AppPaths) {
    this.leasesRoot = path.join(paths.runtimes, "leases");
    fs.mkdirSync(this.leasesRoot, { recursive: true });
  }

  acquire(input: Omit<RuntimePackLease, "schemaVersion" | "pid" | "acquiredAt">): void {
    this.cleanupStale();
    const lease: RuntimePackLease = {
      schemaVersion: SCHEMA_VERSION,
      ...input,
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    const target = this.leasePath(input.runId);
    try {
      fs.writeFileSync(target, JSON.stringify(lease), { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Run 已持有 Runtime Pack lease：${input.runId}`);
      throw error;
    }
  }

  release(runId: string): void {
    fs.rmSync(this.leasePath(runId), { force: true });
  }

  list(): RuntimePackLease[] {
    this.cleanupStale();
    return fs.readdirSync(this.leasesRoot)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        try {
          const value = JSON.parse(fs.readFileSync(path.join(this.leasesRoot, name), "utf8")) as RuntimePackLease;
          return value.schemaVersion === SCHEMA_VERSION && typeof value.runId === "string" && typeof value.pid === "number" ? [value] : [];
        } catch {
          return [];
        }
      });
  }

  assertHealthy(): void {
    this.cleanupStale();
    if (this.hasInvalidLease()) throw new Error("Runtime Pack lease 状态无法读取，为安全起见拒绝变更。");
  }

  isInUse(packId: RuntimePackId, target: RuntimeTarget, digest?: string): boolean {
    return this.hasInvalidLease() || this.list().some((lease) => lease.packId === packId && lease.target === target && (!digest || lease.digest === digest));
  }

  assertNotInUse(packId: RuntimePackId, target: RuntimeTarget, digest?: string): void {
    if (this.hasInvalidLease()) throw new Error("Runtime Pack lease 状态无法读取，为安全起见拒绝变更。");
    const lease = this.list().find((item) => item.packId === packId && item.target === target && (!digest || item.digest === digest));
    if (lease) throw new Error(`Runtime Pack 正在被 Run 使用，不能切换或删除：${lease.runId}`);
  }

  private cleanupStale(): void {
    for (const name of fs.readdirSync(this.leasesRoot).filter((item) => item.endsWith(".json"))) {
      const file = path.join(this.leasesRoot, name);
      try {
        const lease = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<RuntimePackLease>;
        if (typeof lease.pid !== "number" || !isProcessAlive(lease.pid)) fs.rmSync(file, { force: true });
      } catch {
        // A partially written lease is a fail-closed block, not stale state.
      }
    }
  }

  private hasInvalidLease(): boolean {
    return fs.readdirSync(this.leasesRoot).filter((name) => name.endsWith(".json")).some((name) => {
      try {
        const value = JSON.parse(fs.readFileSync(path.join(this.leasesRoot, name), "utf8")) as Partial<RuntimePackLease>;
        return value.schemaVersion !== SCHEMA_VERSION || typeof value.runId !== "string" || typeof value.pid !== "number" || typeof value.packId !== "string" || typeof value.target !== "string" || typeof value.digest !== "string";
      } catch {
        return true;
      }
    });
  }

  private leasePath(runId: string): string {
    const digest = crypto.createHash("sha256").update(runId).digest("hex");
    return path.join(this.leasesRoot, `${digest}.json`);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
