import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-settings-"));
process.env.OPENMIND_USER_DATA_DIR = userDataDir;

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir
  }
}));

import {
  normalizeRepoRoot,
  parseWslRepoPath,
  ensureInsideRepo,
  findRepoRoot,
  getPreferences,
  setOpenmindRoot,
  setWorkspaceRoot,
  updatePreferences,
  resetPreferences,
  settingsFile,
  getOnboardingState,
  updateOnboardingState
} from "./settings";

describe("settings path handling", () => {
  afterEach(() => {
    try { fs.rmSync(path.join(userDataDir, "settings.json"), { force: true }); } catch { /* ignore */ }
  });
  let repo = "";

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-repo-"));
    fs.mkdirSync(path.join(repo, "article"), { recursive: true });
    process.env.OPENMIND_ROOT = repo;
  });

  afterEach(() => {
    delete process.env.OPENMIND_ROOT;
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("converts WSL UNC and Windows paths to a linux path", () => {
    expect(parseWslRepoPath("\\\\wsl.localhost\\Ubuntu\\home\\say\\work\\openmind")).toEqual({
      distro: "Ubuntu",
      linuxPath: "/home/say/work/openmind"
    });
    expect(parseWslRepoPath("\\\\wsl$\\Debian\\root\\repo")).toEqual({
      distro: "Debian",
      linuxPath: "/root/repo"
    });
    expect(parseWslRepoPath("/home/say/work/openmind")).toBeNull();
    expect(parseWslRepoPath("D:\\work\\openmind")).toBeNull();
  });

  it("normalizes and trims repo roots with quotes", () => {
    expect(normalizeRepoRoot('  "/home/say/repo"  ')).toBe("/home/say/repo");
    expect(normalizeRepoRoot("/home/say/repo/../repo/")).toBe(path.posix.normalize("/home/say/repo/../repo/"));
  });

  it("keeps resolved paths inside the repo", () => {
    expect(ensureInsideRepo("openmind/article/x.md")).toBe(path.resolve(repo, "article/x.md"));
    expect(() => ensureInsideRepo("../../etc/passwd")).toThrow("超出项目目录");
  });

  it("uses the bound flat data root as the display repo root", () => {
    expect(findRepoRoot()).toBe(repo);
  });

  it("preferences API surfaces are callable and return valid defaults", () => {
    const prefs = getPreferences();
    expect(prefs.themeMode).toBe("light");
    expect(prefs.destructiveOpsRequireApproval).toBe(true);
    expect(prefs.riskScanEnabled).toBe(true);
    expect(prefs.notesDir).toBe("openmind");
    expect(prefs.defaultPlatform).toBe("公众号");
    expect(Array.isArray(prefs.userTags)).toBe(true);
    expect(prefs.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid preference updates before writing them", () => {
    expect(() => updatePreferences({ themeMode: "sepia" })).toThrow("themeMode");
    expect(getPreferences().themeMode).toBe("light");
    const updated = updatePreferences({ themeMode: "light", userTags: ["AI", "AI"] });
    expect(updated.themeMode).toBe("light");
    expect(updated.userTags).toEqual(["AI"]);
  });

  it("never lets an ordinary preference update clear bound directories", () => {
    const canonical = fs.realpathSync(repo);
    setOpenmindRoot(repo);
    setWorkspaceRoot(repo);

    const updated = updatePreferences({ browserAutomationEnabled: true });
    const persisted = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));

    expect(updated.openmindRoot).toBe(canonical);
    expect(updated.workspaceRoot).toBe(canonical);
    expect(persisted.openmindRoot).toBe(canonical);
    expect(persisted.workspaceRoot).toBe(canonical);
    expect(() => updatePreferences({ openmindRoot: "" } as never)).toThrow("保存目录只能通过专用的目录选择操作修改");
  });

  it("validates, persists and resets workflow preferences as one group", () => {
    const updated = updatePreferences({ autoSaveIntervalMs: 15_000, archiveAfterDays: 30, workflowReviewRequiredForReady: false });
    expect(updated.workflowReviewRequiredForReady).toBe(false);
    expect(() => updatePreferences({ workflowAutoSaveDraft: "yes" as never })).toThrow("workflowAutoSaveDraft");
    const reset = resetPreferences("workflow");
    expect(reset.autoSaveIntervalMs).toBe(30_000);
    expect(reset.archiveAfterDays).toBe(90);
    expect(reset.workflowReviewRequiredForReady).toBe(true);
  });

  it("persists the first-run onboarding state in app-private settings", () => {
    expect(getOnboardingState()).toEqual({ completed: false, skill: "pending", provider: "pending" });
    const updated = updateOnboardingState({ skill: "skipped", provider: "complete" });
    expect(updated).toEqual({ completed: false, skill: "skipped", provider: "complete" });
    expect(getOnboardingState()).toEqual(updated);
    expect(JSON.parse(fs.readFileSync(settingsFile(), "utf8")).onboarding).toEqual(updated);
  });
});
