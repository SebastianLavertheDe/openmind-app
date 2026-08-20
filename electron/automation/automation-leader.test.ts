import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationLeader } from "./automation-leader";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AutomationLeader", () => {
  it("elects exactly one owner and releases only its own lease", () => {
    const directory = makeDirectory();
    const first = new AutomationLeader(directory, { ownerId: "first", pid: 101 });
    const second = new AutomationLeader(directory, { ownerId: "second", pid: 102 });
    const now = new Date("2026-08-06T10:00:00.000Z");

    expect(first.tryAcquire(now)).toBe(true);
    expect(second.tryAcquire(now)).toBe(false);
    second.release();
    expect(first.isLeader()).toBe(true);
    first.release();
    expect(second.tryAcquire(now)).toBe(true);
  });

  it("takes over only an expired lease whose process is dead", () => {
    const directory = makeDirectory();
    const first = new AutomationLeader(directory, { ownerId: "dead", pid: 201, leaseMs: 1_000, isProcessAlive: () => false });
    const second = new AutomationLeader(directory, { ownerId: "next", pid: 202, leaseMs: 1_000, isProcessAlive: () => false });
    const acquiredAt = new Date("2026-08-06T10:00:00.000Z");

    expect(first.tryAcquire(acquiredAt)).toBe(true);
    expect(second.tryAcquire(new Date(acquiredAt.getTime() + 999))).toBe(false);
    expect(second.tryAcquire(new Date(acquiredAt.getTime() + 1_001))).toBe(true);
  });

  it("quarantines a zero-filled lease state and elects a new owner", () => {
    const directory = makeDirectory();
    const file = path.join(directory, "scheduler-leader.json");
    const corrupted = Buffer.alloc(64);
    fs.writeFileSync(file, corrupted);
    const leader = new AutomationLeader(directory, { ownerId: "next", pid: 203, isProcessAlive: () => false });

    expect(leader.tryAcquire(new Date("2026-08-06T10:00:00.000Z"))).toBe(true);
    expect(leader.isLeader()).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ ownerId: "next", pid: 203 });
    const quarantined = fs.readdirSync(directory).find((entry) => entry.startsWith("scheduler-leader.json.corrupt-"));
    expect(quarantined).toBeDefined();
    expect(fs.readFileSync(path.join(directory, quarantined!))).toEqual(corrupted);
  });

  it("reclaims a lease after its active heartbeat file is corrupted", () => {
    const directory = makeDirectory();
    const file = path.join(directory, "scheduler-leader.json");
    const leader = new AutomationLeader(directory, { ownerId: "owner", pid: 204, isProcessAlive: () => true });
    const acquiredAt = new Date("2026-08-06T10:00:00.000Z");

    expect(leader.tryAcquire(acquiredAt)).toBe(true);
    fs.writeFileSync(file, Buffer.alloc(16));

    expect(leader.tryAcquire(new Date(acquiredAt.getTime() + 1_000))).toBe(true);
    expect(leader.isLeader()).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ ownerId: "owner", pid: 204 });
  });
});

function makeDirectory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-automation-leader-"));
  roots.push(root);
  return root;
}
