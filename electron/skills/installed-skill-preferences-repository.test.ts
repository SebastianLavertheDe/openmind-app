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
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-skill-preferences-"));
    repository = new InstalledSkillPreferencesRepository(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("defaults missing preferences to enabled without creating a file", () => {
    expect(repository.isEnabled("openmind/example-skill")).toBe(true);
    expect(repository.listDisabledKeys()).toEqual([]);
    expect(fs.existsSync(repository.filePath!)).toBe(false);
  });

  it("persists sorted disabled keys and enabling removes only that override", () => {
    repository.setEnabled("openmind/z-skill", false);
    repository.setEnabled("openmind/a-skill", false);

    expect(readPreferences(repository.filePath!)).toEqual({
      schemaVersion: INSTALLED_SKILL_PREFERENCES_SCHEMA_VERSION,
      disabledKeys: ["openmind/a-skill", "openmind/z-skill"]
    });
    expect(new InstalledSkillPreferencesRepository(root).isEnabled("openmind/a-skill")).toBe(false);

    repository.setEnabled("openmind/a-skill", true);

    expect(repository.isEnabled("openmind/a-skill")).toBe(true);
    expect(repository.isEnabled("openmind/z-skill")).toBe(false);
    expect(readPreferences(repository.filePath!).disabledKeys).toEqual(["openmind/z-skill"]);
  });

  it("does not rewrite an idempotent preference", () => {
    repository.setEnabled("openmind/example-skill", false);
    const write = vi.spyOn(fs, "writeFileSync");

    repository.setEnabled("openmind/example-skill", false);

    expect(write).not.toHaveBeenCalled();
  });

  it("keeps the previous file intact when atomic replacement fails", () => {
    repository.setEnabled("openmind/first-skill", false);
    const before = fs.readFileSync(repository.filePath!, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("replace failed"), { code: "EIO" });
    });

    expect(() => repository.setEnabled("openmind/second-skill", false)).toThrow("replace failed");
    expect(fs.readFileSync(repository.filePath!, "utf8")).toBe(before);
    expect(fs.readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  it("fails closed on corrupt input and never overwrites it", () => {
    fs.writeFileSync(repository.filePath!, "{corrupt", "utf8");
    const before = fs.readFileSync(repository.filePath!, "utf8");

    expect(() => repository.isEnabled("openmind/example-skill")).toThrow("拒绝覆盖现有配置");
    expect(() => repository.setEnabled("openmind/example-skill", false)).toThrow("拒绝覆盖现有配置");
    expect(fs.readFileSync(repository.filePath!, "utf8")).toBe(before);
  });

  it("rejects duplicate, invalid and unsupported preference records", () => {
    for (const value of [
      { schemaVersion: 2, disabledKeys: [] },
      { schemaVersion: 1, disabledKeys: ["openmind/same", "openmind/same"] },
      { schemaVersion: 1, disabledKeys: ["../escape"] }
    ]) {
      fs.writeFileSync(repository.filePath!, JSON.stringify(value), "utf8");
      expect(() => repository.listDisabledKeys()).toThrow("Skill 偏好");
    }
  });

  it("allows unbound reads but rejects writes", () => {
    const unbound = new InstalledSkillPreferencesRepository(null);

    expect(unbound.isEnabled("openmind/example-skill")).toBe(true);
    expect(() => unbound.setEnabled("openmind/example-skill", false)).toThrow("尚未绑定 openmind");
  });
});

function readPreferences(file: string): { schemaVersion: number; disabledKeys: string[] } {
  return JSON.parse(fs.readFileSync(file, "utf8")) as { schemaVersion: number; disabledKeys: string[] };
}
