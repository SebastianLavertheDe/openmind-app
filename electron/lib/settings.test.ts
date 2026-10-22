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
  ensureInsideRepoReadable,
  findRepoRoot,
  getPreferences,
  saveSettings,
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
    try { fs.rmSync(settingsFile(), { force: true }); } catch { /* ignore */ }
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

  it("keeps generic path entry points out of app-managed projects and symlink aliases", () => {
    const materialDir = path.join(repo, "projects", "Research", "materials");
    fs.mkdirSync(materialDir, { recursive: true });
    fs.writeFileSync(path.join(materialDir, "note.md"), "private");
    fs.symlinkSync(materialDir, path.join(repo, "project-alias"), process.platform === "win32" ? "junction" : "dir");

    expect(() => ensureInsideRepo("openmind/projects/Research/materials/note.md"))
      .toThrow(/Project 专用接口/);
    expect(() => ensureInsideRepo("projects/Research/materials/note.md"))
      .toThrow(/Project 专用接口/);
    expect(() => ensureInsideRepo("project-alias/note.md"))
      .toThrow(/Project 专用接口/);
  });

  it("allows read-only Workspace entry points to access app-managed projects", () => {
    const material = path.join(repo, "projects", "Research", "materials", "note.md");
    fs.mkdirSync(path.dirname(material), { recursive: true });
    fs.writeFileSync(material, "private");

    expect(ensureInsideRepoReadable("projects/Research/materials/note.md")).toBe(material);
    expect(ensureInsideRepoReadable("openmind/projects/Research/materials/note.md")).toBe(material);
  });

  it("rejects external symlink files, directories, and prospective writes", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-settings-outside-"));
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    fs.symlinkSync(
      path.join(outside, "secret.md"),
      path.join(repo, "secret-link.md"),
      process.platform === "win32" ? "file" : undefined
    );
    fs.symlinkSync(outside, path.join(repo, "escape"), process.platform === "win32" ? "junction" : "dir");
    try {
      expect(() => ensureInsideRepo("secret-link.md")).toThrow("超出项目目录");
      expect(() => ensureInsideRepo("escape/secret.md")).toThrow("超出项目目录");
      expect(() => ensureInsideRepo("escape/new.md")).toThrow("超出项目目录");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects broken symlink leaves and prospective children", () => {
    const broken = path.join(repo, "broken-link");
    fs.symlinkSync(path.join(repo, "missing-target"), broken, process.platform === "win32" ? "junction" : "dir");
    expect(() => ensureInsideRepo("broken-link")).toThrow("超出项目目录");
    expect(() => ensureInsideRepo("broken-link/new.md")).toThrow("超出项目目录");
  });

  it("uses the bound flat data root as the display repo root", () => {
    expect(findRepoRoot()).toBe(repo);
  });

  it("migrates and persists UI language independently of content language", () => {
    saveSettings({ defaultLanguage: "zh-CN" });
    expect(getPreferences().uiLanguage).toBe("zh-CN");
    updatePreferences({ uiLanguage: "en" });
    expect(getPreferences().uiLanguage).toBe("en");
    expect(getPreferences().defaultLanguage).toBe("zh-CN");
    expect(JSON.parse(fs.readFileSync(settingsFile(), "utf8")).uiLanguage).toBe("en");
    expect(() => updatePreferences({ uiLanguage: "fr" as "en" })).toThrow();
    expect(getPreferences().uiLanguage).toBe("en");
    resetPreferences("theme");
    expect(getPreferences().uiLanguage).toBe("zh-CN");
  });

  it("keeps YouTube browser selection opt-in, persists it, and rejects arbitrary profile or shell values", () => {
    saveSettings({ defaultLanguage: "zh-CN" });
    expect(getPreferences().youtubeBrowser).toBe("");
    updatePreferences({ youtubeBrowser: "firefox" });
    expect(getPreferences().youtubeBrowser).toBe("firefox");
    expect(JSON.parse(fs.readFileSync(settingsFile(), "utf8")).youtubeBrowser).toBe("firefox");
    expect(() => updatePreferences({ youtubeBrowser: "chrome:/private/profile" as "chrome" })).toThrow();
    expect(getPreferences().youtubeBrowser).toBe("firefox");
    updatePreferences({ youtubeBrowser: "" });
    expect(getPreferences().youtubeBrowser).toBe("");
    saveSettings({ youtubeBrowser: "unrecognized-legacy-browser" });
    expect(getPreferences().youtubeBrowser).toBe("");
  });

  it("ignores retired Bilibili browser preferences without changing the YouTube selection", () => {
    saveSettings({ youtubeBrowser: "chrome", bilibiliBrowser: "firefox" });
    expect(getPreferences().youtubeBrowser).toBe("chrome");
    expect(getPreferences()).not.toHaveProperty("bilibiliBrowser");
    updatePreferences({ youtubeBrowser: "firefox" });
    expect(getPreferences().youtubeBrowser).toBe("firefox");
    expect(getPreferences()).not.toHaveProperty("bilibiliBrowser");
  });

  it("preferences API surfaces are callable and return valid defaults", () => {
    const prefs = getPreferences();
    expect(prefs.themeMode).toBe("light");
    expect(prefs.defaultPermissionProfile).toBe("auto");
    expect(prefs.destructiveOpsRequireApproval).toBe(true);
    expect(prefs.riskScanEnabled).toBe(true);
    expect(prefs.notesDir).toBe("openmind");
    expect(prefs.defaultPlatform).toBe("公众号");
    expect(Array.isArray(prefs.userTags)).toBe(true);
    expect(prefs.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it("migrates the old edit default to auto exactly once", () => {
    saveSettings({ schemaVersion: 2, defaultPermissionProfile: "edit" });

    const migrated = getPreferences();
    expect(migrated.defaultPermissionProfile).toBe("auto");
    expect(JSON.parse(fs.readFileSync(settingsFile(), "utf8"))).toMatchObject({
      schemaVersion: 3,
      defaultPermissionProfile: "auto"
    });

    expect(updatePreferences({ defaultPermissionProfile: "edit" }).defaultPermissionProfile).toBe("edit");
    expect(getPreferences().defaultPermissionProfile).toBe("edit");
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

    const updated = updatePreferences({ riskScanEnabled: false });
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
