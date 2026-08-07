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

  it("fails closed on malformed lease state", () => {
    const directory = makeDirectory();
    const file = path.join(directory, "scheduler-leader.json");
    fs.writeFileSync(file, "not-json");
    const leader = new AutomationLeader(directory, { ownerId: "next", pid: 203, isProcessAlive: () => false });

    expect(leader.tryAcquire(new Date("2026-08-06T10:00:00.000Z"))).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("not-json");
  });
});

function makeDirectory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-automation-leader-"));
  roots.push(root);
  return root;
}
