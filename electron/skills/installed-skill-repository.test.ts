import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
  InstalledSkillRepository,
  type InstalledSkillRecord
} from "./installed-skill-repository";

describe("InstalledSkillRepository", () => {
  let root = "";
  let repository: InstalledSkillRepository;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-installed-skills-"));
    repository = new InstalledSkillRepository(path.join(root, "skills", "registry.json"));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("persists versions independently and is idempotent for key plus digest", () => {
    const first = record("1.0.0", "digest-1");
    const second = record("2.0.0", "digest-2");

    repository.upsert(first);
    repository.upsert(second);
    repository.upsert({ ...first, installedAt: "later" });

    expect(repository.list()).toHaveLength(2);
    expect(repository.get(first.key, first.digest)?.installedAt).toBe("later");
    expect(JSON.parse(fs.readFileSync(path.join(root, "skills", "registry.json"), "utf8")).schemaVersion)
      .toBe(INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION);
  });

  it("fails closed on a corrupt registry", () => {
    const file = path.join(root, "skills", "registry.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{broken", "utf8");

    expect(() => repository.list()).toThrow(/拒绝覆盖现有安装状态/);
  });

  it("supports status updates without reading package source files", () => {
    const candidate = record("1.0.0", "digest-1");
    repository.upsert(candidate);

    repository.markReadiness(candidate.key, candidate.digest, "ready");
    expect(repository.replaceStatus(candidate.key, candidate.digest, "previous").status).toBe("previous");
    expect(repository.remove(candidate.key, candidate.digest)?.digest).toBe(candidate.digest);
    expect(repository.list()).toEqual([]);
  });

  it("requires a ready candidate and atomically swaps active plus previous", () => {
    const first = record("1.0.0", "digest-1", "2026-08-05T10:00:00.000Z");
    const second = record("2.0.0", "digest-2", "2026-08-05T11:00:00.000Z");
    repository.upsert(first);
    repository.upsert(second);
    repository.markReadiness(first.key, first.digest, "ready");
    repository.markReadiness(second.key, second.digest, "ready");
    repository.activate(first.key, first.digest);

    expect(() => repository.activate(second.key, second.digest)).not.toThrow();
    expect(repository.get(first.key, first.digest)?.status).toBe("previous");
    expect(repository.get(second.key, second.digest)?.status).toBe("active");
    expect(repository.get(second.key, second.digest)?.executionTrust).toBe("inspect-only");
    expect(repository.list().filter((item) => item.status === "active")).toHaveLength(1);
    expect(repository.list().filter((item) => item.status === "previous")).toHaveLength(1);
  });

  it("rolls back only to the ready previous version", () => {
    const first = record("1.0.0", "digest-1", "2026-08-05T10:00:00.000Z");
    const second = record("2.0.0", "digest-2", "2026-08-05T11:00:00.000Z");
    repository.upsert(first);
    repository.upsert(second);
    repository.markReadiness(first.key, first.digest, "ready");
    repository.markReadiness(second.key, second.digest, "ready");
    repository.activate(first.key, first.digest);
    repository.activate(second.key, second.digest);

    const result = repository.rollback(first.key);

    expect(result.active.digest).toBe(first.digest);
    expect(result.previous.digest).toBe(second.digest);
    expect(repository.get(first.key, first.digest)?.status).toBe("active");
    expect(repository.get(second.key, second.digest)?.status).toBe("previous");
  });

  it("rejects an invalid active record instead of trusting a corrupt registry", () => {
    const file = path.join(root, "skills", "registry.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
      records: [{ ...record("1.0.0", "digest-1"), status: "active" }]
    }));

    expect(() => repository.list()).toThrow(/active Skill 必须是 ready/);
  });

  it("grants host execution trust to an exact ready active digest", () => {
    const candidate = record("1.0.0", "digest-1");
    repository.upsert(candidate);
    repository.markReadiness(candidate.key, candidate.digest, "ready");
    repository.activate(candidate.key, candidate.digest);

    expect(repository.approveHostExecution(candidate.key, candidate.digest).executionTrust).toBe("approved-host");
    expect(() => repository.approveHostExecution(candidate.key, "digest-missing")).toThrow(/不存在/);
  });

  it("resets review and host trust independently when an installed digest is modified", () => {
    const candidate = {
      ...record("1.0.0", "digest-1"),
      signatureStatus: "valid" as const,
      reviewStatus: "manually-reviewed" as const,
      skillUpdatePolicy: "download-only" as const
    };
    repository.upsert(candidate);
    repository.markReadiness(candidate.key, candidate.digest, "ready");
    repository.activate(candidate.key, candidate.digest);
    repository.approveHostExecution(candidate.key, candidate.digest);

    const modified = repository.markModified(candidate.key, candidate.digest);

    expect(modified).toMatchObject({
      signatureStatus: "invalid",
      reviewStatus: "unreviewed",
      executionTrust: "inspect-only",
      skillUpdatePolicy: "download-only",
      status: "active",
      readiness: "ready"
    });
  });

  it("backfills the update policy for a v1 registry record", () => {
    const file = path.join(root, "skills", "registry.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const legacy = { ...record("1.0.0", "digest-legacy") } as Record<string, unknown>;
    delete legacy.skillUpdatePolicy;
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION, records: [legacy] }));

    expect(repository.list()[0]?.skillUpdatePolicy).toBe("manual");
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
    status: "quarantined",
    readiness: "installed-not-ready",
    signatureStatus: "unsigned",
    reviewStatus: "unreviewed",
    executionTrust: "inspect-only",
    skillUpdatePolicy: "manual",
    installedAt
  };
}
