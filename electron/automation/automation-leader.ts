import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeTextAtomic } from "../lib/fs-utils";

const LEADER_SCHEMA_VERSION = 1 as const;

type LeaderRecord = {
  schemaVersion: typeof LEADER_SCHEMA_VERSION;
  ownerId: string;
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
};

export type AutomationLeaderOptions = {
  leaseMs?: number;
  ownerId?: string;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
};

/** Cross-process exclusive scheduler lease. Corrupt lease state is quarantined before recovery. */
export class AutomationLeader {
  private readonly filePath: string;
  private readonly ownerId: string;
  private readonly pid: number;
  private readonly leaseMs: number;
  private readonly isProcessAlive: (pid: number) => boolean;
  private owned = false;

  constructor(automationDir: string, options: AutomationLeaderOptions = {}) {
    fs.mkdirSync(automationDir, { recursive: true });
    this.filePath = path.join(automationDir, "scheduler-leader.json");
    this.ownerId = options.ownerId || crypto.randomUUID();
    this.pid = options.pid || process.pid;
    this.leaseMs = options.leaseMs || 90_000;
    this.isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
  }

  isLeader(): boolean { return this.owned; }

  tryAcquire(now = new Date()): boolean {
    if (this.owned) {
      const current = this.read();
      if (current?.ownerId === this.ownerId && current.pid === this.pid) {
        try {
          this.write({ ...current, heartbeatAt: now.toISOString() });
          return true;
        } catch {
          // Fall through to reacquisition. A failed atomic heartbeat should
          // never leave this process believing it still owns the lease.
        }
      }
      this.owned = false;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const candidate = this.record(now);
      try {
        fs.writeFileSync(this.filePath, JSON.stringify(candidate), { encoding: "utf8", flag: "wx", mode: 0o600 });
        this.owned = true;
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const current = this.read();
        if (!current) {
          this.quarantineCorruptLease();
          continue;
        }
        if (!this.isExpired(current, now)) return false;
        const stalePath = `${this.filePath}.stale-${this.ownerId}-${attempt}`;
        try { fs.renameSync(this.filePath, stalePath); }
        catch { continue; }
        try { fs.rmSync(stalePath, { force: true }); } catch { /* stale evidence is harmless */ }
      }
    }
    return false;
  }

  release(): void {
    if (!this.owned) return;
    const current = this.read();
    if (current?.ownerId === this.ownerId && current.pid === this.pid) {
      try { fs.rmSync(this.filePath, { force: true }); } catch { /* another process may have taken over */ }
    }
    this.owned = false;
  }

  private record(now: Date): LeaderRecord {
    return {
      schemaVersion: LEADER_SCHEMA_VERSION,
      ownerId: this.ownerId,
      pid: this.pid,
      acquiredAt: now.toISOString(),
      heartbeatAt: now.toISOString()
    };
  }

  private write(record: LeaderRecord): void {
    writeTextAtomic(this.filePath, JSON.stringify(record), { mode: 0o600 });
  }

  /**
   * A malformed lease cannot identify a live owner. Keep it for diagnostics,
   * then let a scheduler create a fresh lease on the next acquisition attempt.
   */
  private quarantineCorruptLease(): boolean {
    const quarantinedPath = `${this.filePath}.corrupt-${Date.now()}-${crypto.randomUUID()}`;
    try {
      fs.renameSync(this.filePath, quarantinedPath);
      return true;
    } catch {
      // Another scheduler may have repaired/replaced it. Re-read on retry.
      return false;
    }
  }

  private read(): LeaderRecord | undefined {
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<LeaderRecord>;
      if (value.schemaVersion !== LEADER_SCHEMA_VERSION || typeof value.ownerId !== "string" || !value.ownerId
        || !Number.isInteger(value.pid) || (value.pid || 0) <= 0
        || typeof value.acquiredAt !== "string" || !Number.isFinite(Date.parse(value.acquiredAt))
        || typeof value.heartbeatAt !== "string" || !Number.isFinite(Date.parse(value.heartbeatAt))) return undefined;
      return value as LeaderRecord;
    } catch {
      return undefined;
    }
  }

  private isExpired(record: LeaderRecord, now: Date): boolean {
    return now.getTime() - Date.parse(record.heartbeatAt) >= this.leaseMs && !this.isProcessAlive(record.pid);
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
