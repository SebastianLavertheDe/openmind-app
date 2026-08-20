import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION,
  InstalledSkillSourceRepository,
  normalizeGitSourceLocator,
  type InstalledSkillSourceReceipt
} from "./installed-skill-source-repository";

describe("InstalledSkillSourceRepository", () => {
  let root = "";
  let repository: InstalledSkillSourceRepository;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-skill-source-receipt-"));
    repository = new InstalledSkillSourceRepository(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("normalizes a Git locator and persists a sorted complete snapshot", () => {
    repository.replace(receipt("https://GitHub.com/Example/Skills.git/", [
      pkg("two", "two", "b"),
      pkg("one", "one", "a")
    ]));

    expect(repository.filePath).toBe(path.join(root, "source-installations.json"));
    expect(repository.get("https://github.com/example/skills")).toEqual(expect.objectContaining({
      sourceLocator: "https://github.com/example/skills",
      sourceRef: "main",
      sourceRevision: "c".repeat(40),
      packages: [pkg("one", "one", "a"), pkg("two", "two", "b")]
    }));
    expect(JSON.parse(fs.readFileSync(repository.filePath!, "utf8"))).toMatchObject({
      schemaVersion: 1,
      installations: [{ sourceLocator: "https://github.com/example/skills" }]
    });
  });

  it("fails closed on corruption and a later explicit replacement repairs the file", () => {
    fs.writeFileSync(repository.filePath!, "{not-json", "utf8");
    expect(repository.list()).toEqual([]);
    expect(repository.get("https://github.com/example/skills")).toBeUndefined();
    expect(repository.isCorrupt()).toBe(true);

    repository.replace(receipt("https://github.com/example/skills", [pkg("one", "one", "a")]));

    expect(repository.get("https://github.com/example/skills")?.packages).toEqual([pkg("one", "one", "a")]);
    expect(repository.isCorrupt()).toBe(false);
    expect(() => JSON.parse(fs.readFileSync(repository.filePath!, "utf8"))).not.toThrow();
  });

  it("rejects duplicate, unsafe, or malformed package snapshots before overwriting", () => {
    repository.replace(receipt("https://github.com/example/skills", [pkg("one", "one", "a")]));
    expect(() => repository.replace(receipt("https://github.com/example/skills", [
      pkg("one", "one", "a"),
      pkg("one", "two", "b")
    ]))).toThrow(/重复包/);
    expect(() => repository.replace(receipt("https://github.com/example/skills", [
      pkg("../escape", "escape", "a")
    ]))).toThrow(/格式错误/);
    expect(repository.get("https://github.com/example/skills")?.packages).toEqual([pkg("one", "one", "a")]);
  });

  it("returns no receipts without a bound skill store", () => {
    const unbound = new InstalledSkillSourceRepository(null);
    expect(unbound.list()).toEqual([]);
    expect(() => unbound.replace(receipt("https://github.com/example/skills", [pkg("one", "one", "a")]))).toThrow(/尚未绑定/);
  });

  it("rejects non-HTTPS or credential-bearing Git locators", () => {
    expect(normalizeGitSourceLocator("https://example.com/org/repo.git/")).toBe("https://example.com/org/repo");
    expect(() => normalizeGitSourceLocator("http://example.com/org/repo")).toThrow();
    expect(() => normalizeGitSourceLocator("https://user:secret@example.com/org/repo")).toThrow();
  });
});

function receipt(sourceLocator: string, packages: InstalledSkillSourceReceipt["packages"]): InstalledSkillSourceReceipt {
  return {
    schemaVersion: INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION,
    sourceType: "git",
    sourceLocator,
    sourceRef: "main",
    sourceRevision: "c".repeat(40),
    packages,
    installedAt: "2026-08-19T00:00:00.000Z"
  };
}

function pkg(packageRef: string, id: string, digestChar: string): InstalledSkillSourceReceipt["packages"][number] {
  return { packageRef, key: `openmind/${id}`, id, version: "1.0.0", digest: digestChar.repeat(64) };
}
