import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INSTALLED_SKILL_PREFERENCES_SCHEMA_VERSION,
  InstalledSkillPreferencesRepository
} from "./installed-skill-preferences-repository";

describe("InstalledSkillPreferencesRepository", () => {
  let root = "";
  let repository: InstalledSkillPreferencesRepository;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skill-preferences-"));
    repository = new InstalledSkillPreferencesRepository(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("defaults missing preferences to enabled without creating a file", () => {
    expect(repository.isEnabled("cctools/example-skill")).toBe(true);
    expect(repository.listDisabledKeys()).toEqual([]);
    expect(fs.existsSync(repository.filePath!)).toBe(false);
  });

  it("persists sorted disabled keys and enabling removes only that override", () => {
    repository.setEnabled("cctools/z-skill", false);
    repository.setEnabled("cctools/a-skill", false);

    expect(readPreferences(repository.filePath!)).toEqual({
      schemaVersion: INSTALLED_SKILL_PREFERENCES_SCHEMA_VERSION,
      disabledKeys: ["cctools/a-skill", "cctools/z-skill"]
    });
    expect(new InstalledSkillPreferencesRepository(root).isEnabled("cctools/a-skill")).toBe(false);

    repository.setEnabled("cctools/a-skill", true);

    expect(repository.isEnabled("cctools/a-skill")).toBe(true);
    expect(repository.isEnabled("cctools/z-skill")).toBe(false);
    expect(readPreferences(repository.filePath!).disabledKeys).toEqual(["cctools/z-skill"]);
  });

  it("does not rewrite an idempotent preference", () => {
    repository.setEnabled("cctools/example-skill", false);
    const write = vi.spyOn(fs, "writeFileSync");

    repository.setEnabled("cctools/example-skill", false);

    expect(write).not.toHaveBeenCalled();
  });

  it("keeps the previous file intact when atomic replacement fails", () => {
    repository.setEnabled("cctools/first-skill", false);
    const before = fs.readFileSync(repository.filePath!, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("replace failed"), { code: "EIO" });
    });

    expect(() => repository.setEnabled("cctools/second-skill", false)).toThrow("replace failed");
    expect(fs.readFileSync(repository.filePath!, "utf8")).toBe(before);
    expect(fs.readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  it("fails closed on corrupt input and never overwrites it", () => {
    fs.writeFileSync(repository.filePath!, "{corrupt", "utf8");
    const before = fs.readFileSync(repository.filePath!, "utf8");

    expect(() => repository.isEnabled("cctools/example-skill")).toThrow("拒绝覆盖现有配置");
    expect(() => repository.setEnabled("cctools/example-skill", false)).toThrow("拒绝覆盖现有配置");
    expect(fs.readFileSync(repository.filePath!, "utf8")).toBe(before);
  });

  it("rejects duplicate, invalid and unsupported preference records", () => {
    for (const value of [
      { schemaVersion: 2, disabledKeys: [] },
      { schemaVersion: 1, disabledKeys: ["cctools/same", "cctools/same"] },
      { schemaVersion: 1, disabledKeys: ["../escape"] }
    ]) {
      fs.writeFileSync(repository.filePath!, JSON.stringify(value), "utf8");
      expect(() => repository.listDisabledKeys()).toThrow("Skill 偏好");
    }
  });

  it("allows unbound reads but rejects writes", () => {
    const unbound = new InstalledSkillPreferencesRepository(null);

    expect(unbound.isEnabled("cctools/example-skill")).toBe(true);
    expect(() => unbound.setEnabled("cctools/example-skill", false)).toThrow("尚未绑定 mymind");
  });
});

function readPreferences(file: string): { schemaVersion: number; disabledKeys: string[] } {
  return JSON.parse(fs.readFileSync(file, "utf8")) as { schemaVersion: number; disabledKeys: string[] };
}
