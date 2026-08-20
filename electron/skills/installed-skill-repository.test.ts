import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
  InstalledSkillRepository,
  type InstalledSkillRecord
} from "./installed-skill-repository";

type LegacyStatus = "quarantined" | "installed-not-ready" | "active" | "previous";
type LegacyReadiness = "installed-not-ready" | "ready" | "blocked" | "stale";

const LEGAL_V1_STATES: Array<[LegacyStatus, LegacyReadiness]> = [
  ["quarantined", "installed-not-ready"],
  ["quarantined", "ready"],
  ["quarantined", "blocked"],
  ["quarantined", "stale"],
  ["installed-not-ready", "installed-not-ready"],
  ["installed-not-ready", "ready"],
  ["installed-not-ready", "blocked"],
  ["installed-not-ready", "stale"],
  ["active", "ready"],
  ["previous", "installed-not-ready"],
  ["previous", "ready"],
  ["previous", "blocked"],
  ["previous", "stale"]
];

describe("InstalledSkillRepository", () => {
  let root = "";
  let file = "";
  let repository: InstalledSkillRepository;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-installed-skills-"));
    file = path.join(root, "skills", "registry.json");
    repository = new InstalledSkillRepository(file);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("keeps one canonical record per key and persists source package provenance", () => {
    const first = record("1.0.0", "digest-1");
    const second = {
      ...record("2.0.0", "digest-2"),
      sourcePackageRef: "packages/example-skill",
      sourceRevision: "0123456789abcdef"
    };

    repository.upsert(first);
    repository.upsert(second);
    expect(repository.list()).toEqual([second]);
    expect(repository.get(first.key)?.digest).toBe(second.digest);

    repository.upsert({ ...second, installedAt: "later" });
    expect(repository.get(first.key)?.installedAt).toBe("later");
    expect(readDisk(file)).toMatchObject({
      schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
      records: [{ sourcePackageRef: "packages/example-skill", sourceRevision: "0123456789abcdef" }]
    });
  });

  it("fails closed on a corrupt registry", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{broken", "utf8");

    expect(() => repository.list()).toThrow(/拒绝覆盖现有安装状态/);
  });

  it("supports removal without reading package source files", () => {
    const installed = record("1.0.0", "digest-1");
    repository.upsert(installed);

    expect(repository.remove(installed.key, installed.digest)?.digest).toBe(installed.digest);
    expect(repository.list()).toEqual([]);
  });

  it("rejects duplicate keys in a v3 registry", () => {
    writeRegistry(file, 3, [record("1.0.0", "digest-1"), record("2.0.0", "digest-2")]);

    expect(() => repository.list()).toThrow(/多个记录/);
  });

  it("rejects ambiguous duplicate ids across publishers", () => {
    writeRegistry(file, 3, [
      record("1.0.0", "digest-1"),
      { ...record("1.0.0", "digest-2"), key: "other/example-skill", publisherId: "other" }
    ]);

    expect(() => repository.list()).toThrow(/多个发布者/);
  });

  it("migrates v1 immediately, keeps the unique active record, and strips lifecycle fields", () => {
    const active = legacyRecord(1, "2.0.0", "digest-active", "2026-08-05T11:00:00.000Z", "active", "ready", {
      executionTrust: "approved-host",
      sourcePackageRef: "packages/example-skill",
      sourceRevision: "resolved-commit"
    });
    const previous = legacyRecord(1, "1.0.0", "digest-previous", "2026-08-05T10:00:00.000Z", "previous", "ready");
    const newerCandidate = legacyRecord(1, "3.0.0", "digest-newer", "2026-08-05T12:00:00.000Z", "quarantined", "installed-not-ready");
    writeRegistry(file, 1, [previous, newerCandidate, active]);

    const loaded = repository.list();
    const disk = readDisk(file);
    expect(loaded).toEqual([expect.objectContaining({
      schemaVersion: 3,
      digest: "digest-active",
      sourcePackageRef: "packages/example-skill",
      sourceRevision: "resolved-commit"
    })]);
    expect(loaded[0]).not.toHaveProperty("status");
    expect(loaded[0]).not.toHaveProperty("readiness");
    expect(loaded[0]).not.toHaveProperty("executionTrust");
    expect(disk.schemaVersion).toBe(3);
    expect(disk.records[0]).not.toHaveProperty("status");
    expect(disk.records[0]).not.toHaveProperty("readiness");
    expect(disk.records[0]).not.toHaveProperty("executionTrust");
  });

  it("chooses the newest v1 record without an active record regardless of input order", () => {
    const olderPrevious = legacyRecord(1, "1.0.0", "digest-older", "2026-08-05T10:00:00.000Z", "previous", "ready");
    const newerCandidate = legacyRecord(1, "2.0.0", "digest-newer", "2026-08-05T11:00:00.000Z", "installed-not-ready", "blocked");

    for (const records of [[olderPrevious, newerCandidate], [newerCandidate, olderPrevious]]) {
      writeRegistry(file, 1, records);
      expect(repository.list()[0]?.digest).toBe("digest-newer");
    }
  });

  it("selects each v1 key independently and persists records in key order", () => {
    const keyBActive = legacyRecord(1, "1.0.0", "digest-b-active", "2026-08-05T10:00:00.000Z", "active", "ready", {
      key: "cctools/skill-b",
      id: "skill-b"
    });
    const keyBNewer = legacyRecord(1, "2.0.0", "digest-b-newer", "2026-08-05T11:00:00.000Z", "quarantined", "ready", {
      key: "cctools/skill-b",
      id: "skill-b"
    });
    const keyAOlder = legacyRecord(1, "1.0.0", "digest-a-older", "2026-08-05T09:00:00.000Z", "quarantined", "ready", {
      key: "cctools/skill-a",
      id: "skill-a"
    });
    const keyANewer = legacyRecord(1, "2.0.0", "digest-a-newer", "2026-08-05T12:00:00.000Z", "installed-not-ready", "stale", {
      key: "cctools/skill-a",
      id: "skill-a"
    });
    writeRegistry(file, 1, [keyBNewer, keyAOlder, keyBActive, keyANewer]);

    expect(repository.list().map((item) => [item.key, item.digest])).toEqual([
      ["cctools/skill-a", "digest-a-newer"],
      ["cctools/skill-b", "digest-b-active"]
    ]);
    expect(readDisk(file).records.map((item) => item.key)).toEqual(["cctools/skill-a", "cctools/skill-b"]);
  });

  it("uses digest and packagePath as stable v1 tie breakers", () => {
    const installedAt = "2026-08-05T10:00:00.000Z";
    const digestA = legacyRecord(1, "1.0.0", "digest-a", installedAt, "quarantined", "ready");
    const digestB = legacyRecord(1, "1.0.0", "digest-b", installedAt, "quarantined", "ready");
    for (const records of [[digestA, digestB], [digestB, digestA]]) {
      writeRegistry(file, 1, records);
      expect(repository.list()[0]?.digest).toBe("digest-b");
    }

    const pathA = { ...digestB, packagePath: "/tmp/package/a" };
    const pathB = { ...digestB, packagePath: "/tmp/package/b" };
    for (const records of [[pathA, pathB], [pathB, pathA]]) {
      writeRegistry(file, 1, records);
      expect(repository.list()[0]?.packagePath).toBe("/tmp/package/b");
    }
  });

  it.each(LEGAL_V1_STATES)("migrates legal v1 state %s/%s", (status, readiness) => {
    writeRegistry(file, 1, [legacyRecord(1, "1.0.0", `digest-${status}-${readiness}`, "2026-08-05T10:00:00.000Z", status, readiness)]);

    const loaded = repository.list();
    const disk = readDisk(file);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).not.toHaveProperty("status");
    expect(loaded[0]).not.toHaveProperty("readiness");
    expect(disk.schemaVersion).toBe(3);
    expect(disk.records[0]).not.toHaveProperty("status");
    expect(disk.records[0]).not.toHaveProperty("readiness");
  });

  it("migrates a strict v2 record immediately and preserves package provenance", () => {
    writeRegistry(file, 2, [legacyRecord(2, "2.0.0", "digest-v2", "2026-08-05T11:00:00.000Z", "active", "ready", {
      sourcePackageRef: "packages/example-skill",
      sourceRevision: "v2-revision",
      executionTrust: "approved-host"
    })]);

    expect(repository.list()).toEqual([expect.objectContaining({
      schemaVersion: 3,
      digest: "digest-v2",
      sourcePackageRef: "packages/example-skill",
      sourceRevision: "v2-revision"
    })]);
    const disk = readDisk(file);
    expect(disk.schemaVersion).toBe(3);
    expect(disk.records[0]).not.toHaveProperty("status");
    expect(disk.records[0]).not.toHaveProperty("readiness");
    expect(disk.records[0]).not.toHaveProperty("executionTrust");
  });

  it.each([
    ["malformed record mixed with a valid record", [
      legacyRecord(1, "1.0.0", "digest-valid", "2026-08-05T10:00:00.000Z", "active", "ready"),
      { malformed: true }
    ], /record schema mismatch/],
    ["active without ready", [legacyRecord(1, "1.0.0", "digest-a", "2026-08-05T10:00:00.000Z", "active", "blocked")], /active Skill 必须是 ready/],
    ["multiple active", [
      legacyRecord(1, "1.0.0", "digest-a", "2026-08-05T10:00:00.000Z", "active", "ready"),
      legacyRecord(1, "2.0.0", "digest-b", "2026-08-05T11:00:00.000Z", "active", "ready")
    ], /多个 active/],
    ["multiple previous", [
      legacyRecord(1, "1.0.0", "digest-a", "2026-08-05T10:00:00.000Z", "previous", "ready"),
      legacyRecord(1, "2.0.0", "digest-b", "2026-08-05T11:00:00.000Z", "previous", "ready")
    ], /多个 previous/]
  ] as const)("fails closed on invalid v1 input: %s", (_name, records, error) => {
    writeRegistry(file, 1, records);
    const original = fs.readFileSync(file, "utf8");

    expect(() => repository.list()).toThrow(error);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("fails closed on duplicate keys in v2 and leaves the original file untouched", () => {
    writeRegistry(file, 2, [
      legacyRecord(2, "1.0.0", "digest-a", "2026-08-05T10:00:00.000Z", "quarantined", "installed-not-ready"),
      legacyRecord(2, "2.0.0", "digest-b", "2026-08-05T11:00:00.000Z", "active", "ready")
    ]);
    const original = fs.readFileSync(file, "utf8");

    expect(() => repository.list()).toThrow(/多个记录/);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("rejects v1-only lifecycle states in a v2 registry", () => {
    writeRegistry(file, 2, [legacyRecord(2, "1.0.0", "digest-previous", "2026-08-05T10:00:00.000Z", "previous", "ready")]);
    const original = fs.readFileSync(file, "utf8");

    expect(() => repository.list()).toThrow(/record schema mismatch/);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it.each([1, 2, 3] as const)("validates sourcePackageRef in schema v%s", (schemaVersion) => {
    const invalid = schemaVersion === 3
      ? { ...record("1.0.0", "digest-invalid"), sourcePackageRef: "" }
      : legacyRecord(schemaVersion, "1.0.0", "digest-invalid", "2026-08-05T10:00:00.000Z", "quarantined", "installed-not-ready", {
        sourcePackageRef: ""
      });
    writeRegistry(file, schemaVersion, [invalid]);

    expect(() => repository.list()).toThrow(/sourcePackageRef mismatch/);
  });

  it.each([1, 2, 3] as const)("validates sourceRevision in schema v%s", (schemaVersion) => {
    const invalid = schemaVersion === 3
      ? { ...record("1.0.0", "digest-invalid"), sourceRevision: "" }
      : legacyRecord(schemaVersion, "1.0.0", "digest-invalid", "2026-08-05T10:00:00.000Z", "quarantined", "installed-not-ready", {
        sourceRevision: ""
      });
    writeRegistry(file, schemaVersion, [invalid]);

    expect(() => repository.list()).toThrow(/sourceRevision mismatch/);
  });

  it("projects v3 records explicitly and strips legacy lifecycle and executionTrust fields", () => {
    writeRegistry(file, 3, [{
      ...record("1.0.0", "digest-v3"),
      status: "active",
      readiness: "ready",
      executionTrust: "approved-host"
    }]);

    const loaded = repository.list()[0] as unknown as Record<string, unknown>;
    expect(loaded).not.toHaveProperty("status");
    expect(loaded).not.toHaveProperty("readiness");
    expect(loaded).not.toHaveProperty("executionTrust");
  });

  it("backfills compatible review defaults while projecting a v3 record", () => {
    const compatible = { ...record("1.0.0", "digest-compatible") } as Record<string, unknown>;
    delete compatible.signatureStatus;
    delete compatible.reviewStatus;
    delete compatible.skillUpdatePolicy;
    writeRegistry(file, 3, [compatible]);

    expect(repository.list()[0]).toMatchObject({
      signatureStatus: "unsigned",
      reviewStatus: "unreviewed",
      skillUpdatePolicy: "manual"
    });
  });
});

function record(version: string, digest: string, installedAt = new Date().toISOString()): InstalledSkillRecord {
  return {
    schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
    key: "cctools/example-skill",
    id: "example-skill",
    publisherId: "cctools",
    version,
    digest,
    sourcePath: "/tmp/source",
    packagePath: `/tmp/package/${version}`,
    signatureStatus: "unsigned",
    reviewStatus: "unreviewed",
    skillUpdatePolicy: "manual",
    installedAt
  };
}

function legacyRecord(
  schemaVersion: 1 | 2,
  version: string,
  digest: string,
  installedAt: string,
  status: LegacyStatus,
  readiness: LegacyReadiness,
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...record(version, digest, installedAt),
    schemaVersion,
    status,
    readiness,
    ...extras
  };
}

function writeRegistry(file: string, schemaVersion: number, records: readonly unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion, records }, null, 2)}\n`, "utf8");
}

function readDisk(file: string): { schemaVersion: number; records: Array<Record<string, unknown>> } {
  return JSON.parse(fs.readFileSync(file, "utf8")) as { schemaVersion: number; records: Array<Record<string, unknown>> };
}
