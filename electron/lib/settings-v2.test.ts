/**
 * Phase 1 (ADR-001) settings v2 tests — openmindRoot / workspaceRoot resolution,
 * atomic writes, and the guarantee that no hard-coded dev-machine WSL/Windows
 * paths remain.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-settings-v2-"));
process.env.OPENMIND_USER_DATA_DIR = userDataDir;

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir
  }
}));

import {
  SETTINGS_SCHEMA_VERSION,
  setOpenmindRoot,
  setWorkspaceRoot,
  resolveOpenmindRoot,
  resolveWorkspaceRoot,
  isValidOpenmindRoot,
  findRepoRoot,
  ensureInsideRepo,
  resolveOpenmindPath,
  relativeToOpenmind,
  previewOpenmindRoot,
  loadSettings,
  getPreferences,
  settingsFile,
  appPrivateStatePath
} from "./settings";

afterEach(() => {
  try { fs.rmSync(settingsFile(), { force: true }); } catch { /* ignore */ }
  delete process.env.OPENMIND_ROOT;
  delete process.env.OPENMIND_WORKSPACE_ROOT;
});

describe("ADR-001 settings v2 — schemaVersion", () => {
  it("schema version is 2", () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(2);
  });
});

describe("ADR-001 isValidOpenmindRoot", () => {
  it("accepts a readable+writable directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-valid-"));
    try { expect(isValidOpenmindRoot(dir)).toBe(true); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects a non-existent path", () => {
    expect(isValidOpenmindRoot(path.join(os.tmpdir(), "definitely-not-here-" + Date.now()))).toBe(false);
  });

  it("rejects a file (not a directory)", () => {
    const file = path.join(os.tmpdir(), `openmind-file-${Date.now()}`);
    fs.writeFileSync(file, "x");
    try { expect(isValidOpenmindRoot(file)).toBe(false); }
    finally { fs.rmSync(file, { force: true }); }
  });

  it("rejects empty / non-string input", () => {
    expect(isValidOpenmindRoot("")).toBe(false);
    expect(isValidOpenmindRoot(null)).toBe(false);
    expect(isValidOpenmindRoot(undefined)).toBe(false);
    expect(isValidOpenmindRoot(123)).toBe(false);
  });
});

describe("ADR-001 resolveOpenmindRoot", () => {
  it("returns the v2 openmindRoot setting when valid", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-openmind-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      setOpenmindRoot(dir);
      expect(resolveOpenmindRoot()).toBe(path.resolve(dir));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("honours OPENMIND_ROOT env", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-env-openmind-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      process.env.OPENMIND_ROOT = dir;
      expect(resolveOpenmindRoot()).toBe(path.resolve(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty string when nothing resolves", () => {
    // A sibling checkout must not count as an explicit save-directory binding.
    fs.writeFileSync(settingsFile(), "{}", "utf8");
    delete process.env.OPENMIND_ROOT;
    expect(resolveOpenmindRoot()).toBe("");
  });
});

describe("ADR-001 setOpenmindRoot", () => {
  it("uses the selected private data repository itself as the content root", () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-repository-"));
    fs.mkdirSync(path.join(repository, "article"), { recursive: true });
    try {
      expect(setOpenmindRoot(repository)).toBe(repository);
      expect(resolveOpenmindRoot()).toBe(repository);
      expect(findRepoRoot()).toBe(repository);
    } finally { fs.rmSync(repository, { recursive: true, force: true }); }
  });

  it("persists openmindRoot and drops a stale v1 repoRoot key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-set-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      fs.writeFileSync(settingsFile(), JSON.stringify({ repoRoot: "/stale/legacy" }), "utf8");
      setOpenmindRoot(dir);
      const raw = loadSettings();
      expect(raw.openmindRoot).toBe(path.resolve(dir));
      expect("repoRoot" in raw).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects a non-directory", () => {
    expect(() => setOpenmindRoot(path.join(os.tmpdir(), "no-such-" + Date.now()))).toThrow();
  });
});

describe("ADR-001 openmind root dry-run", () => {
  it("previews the selected repository itself as the content root", () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-preview-repository-"));
    fs.mkdirSync(path.join(repository, "article"), { recursive: true });
    try {
      const preview = previewOpenmindRoot(repository);
      expect(preview.candidate).toBe(repository);
      expect(preview.canonicalRoot).toBe(repository);
      expect(preview.canBind).toBe(true);
    } finally { fs.rmSync(repository, { recursive: true, force: true }); }
  });

  it("previews a valid root without writing settings or content", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-preview-root-"));
    fs.mkdirSync(path.join(dir, "private-notes"), { recursive: true });
    try {
      fs.rmSync(settingsFile(), { force: true });
      const preview = previewOpenmindRoot(dir);
      expect(preview.canBind).toBe(true);
      expect(preview.canonicalRoot).toBe(path.resolve(dir));
      expect(preview.health.unknownPreservedEntries).toEqual(["private-notes"]);
      expect(fs.existsSync(settingsFile())).toBe(false);
      expect(fs.existsSync(path.join(dir, "article"))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects the old nested openmind layout until it is flattened", () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-preview-legacy-root-"));
    fs.mkdirSync(path.join(repository, "openmind", "article"), { recursive: true });
    fs.mkdirSync(path.join(repository, "config"), { recursive: true });
    try {
      const preview = previewOpenmindRoot(repository);
      expect(preview.canBind).toBe(false);
      expect(preview.blockingReasons.join("；")).toContain("旧版嵌套布局");
      const nestedPreview = previewOpenmindRoot(path.join(repository, "openmind"));
      expect(nestedPreview.canBind).toBe(false);
      expect(nestedPreview.blockingReasons.join("；")).toContain("旧版嵌套布局");
    } finally { fs.rmSync(repository, { recursive: true, force: true }); }
  });

  it("reports app-private conflicts and active-run blocking without changing settings", () => {
    const preview = previewOpenmindRoot(userDataDir, 1);
    expect(preview.canBind).toBe(false);
    expect(preview.blockingReasons.join("；")).toContain("路径冲突");
    expect(preview.blockingReasons.join("；")).toContain("运行中的任务");
  });
});

describe("ADR-001 private state migration window", () => {
  it("moves the old implicit browser evidence default to a user-owned workspace output", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ schemaVersion: 2, browserEvidenceDir: ".openmind/browser-evidence" }), "utf8");

    expect(getPreferences().browserEvidenceDir).toBe("assets/browser-evidence");
    expect(JSON.parse(fs.readFileSync(settingsFile(), "utf8")).browserEvidenceDir).toBe("assets/browser-evidence");
  });

  it("never resolves private state inside a repo workspace; unbound writes use an app-private bucket", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-private-state-ws-"));
    fs.mkdirSync(path.join(workspace, ".openmind"), { recursive: true });
    try {
      // No openmind root bound; workspace is set. State must stay app-private.
      fs.writeFileSync(settingsFile(), JSON.stringify({ schemaVersion: 2, openmindRoot: "", workspaceRoot: workspace }), "utf8");
      const statePath = appPrivateStatePath("creative-topic-state.json");
      expect(statePath).toContain(path.join(userDataDir, "state"));
      expect(statePath).not.toContain(path.join(workspace, ".openmind"));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("ADR-001 workspaceRoot", () => {
  it("setWorkspaceRoot persists and resolveWorkspaceRoot reads it back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-ws-"));
    try {
      setWorkspaceRoot(dir);
      expect(resolveWorkspaceRoot()).toBe(path.resolve(dir));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("workspaceRoot is independent of openmindRoot", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-ws2-"));
    const mm = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-mm2-"));
    fs.mkdirSync(path.join(mm, "article"), { recursive: true });
    try {
      setOpenmindRoot(mm);
      setWorkspaceRoot(ws);
      expect(resolveOpenmindRoot()).toBe(path.resolve(mm));
      expect(resolveWorkspaceRoot()).toBe(path.resolve(ws));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
      fs.rmSync(mm, { recursive: true, force: true });
    }
  });
});

describe("ADR-001 findRepoRoot compatibility", () => {
  it("returns the selected flat data root while logical openmind paths still resolve inside it", () => {
    const mm = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-flat-root-"));
    fs.mkdirSync(path.join(mm, "article"), { recursive: true });
    try {
      setOpenmindRoot(mm);
      const repoRoot = findRepoRoot();
      expect(repoRoot).toBe(mm);
      expect(resolveOpenmindPath("openmind/article")).toBe(path.join(mm, "article"));
    } finally { fs.rmSync(mm, { recursive: true, force: true }); }
  });

  it("ensureInsideRepo still rejects traversal outside the root", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-parent2-"));
    const mm = path.join(parent, "openmind");
    fs.mkdirSync(mm, { recursive: true });
    try {
      setOpenmindRoot(mm);
      expect(() => ensureInsideRepo("../../etc/passwd")).toThrow();
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
});

describe("ADR-001 arbitrary openmind roots", () => {
  it("maps content paths to a selected root that is not named openmind", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-content-root-"));
    const file = path.join(root, "daily-summary", "20260805_daily_summary.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# summary");
    try {
      setOpenmindRoot(root);
      expect(resolveOpenmindPath("openmind/daily-summary/20260805_daily_summary.md")).toBe(file);
      expect(relativeToOpenmind(file)).toBe("openmind/daily-summary/20260805_daily_summary.md");
      expect(() => resolveOpenmindPath("openmind/.app-private/state.json", "write")).toThrow("non-writable top-level");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe("ADR-001 no hard-coded dev-machine paths", () => {
  // The refactor removed hard-coded WSL `\\wsl.localhost\Ubuntu\home\say\...`
  // and `D:\work\openmind` candidates from auto-detection. This test enforces
  // that regression by reading the source and asserting those literals are gone
  // from the candidate lists (they may still appear in parseWslRepoPath tests).
  it("settings.ts contains no hard-coded WSL/Windows dev paths in candidate lists", () => {
    const src = fs.readFileSync(path.join(__dirname, "settings.ts"), "utf8");
    // parseWslRepoPath legitimately matches \\wsl patterns — that's fine.
    // The forbidden pattern is a hard-coded *candidate path* like the dev's
    // home directory. Assert the specific dev paths are absent.
    expect(src).not.toContain("\\\\wsl.localhost\\Ubuntu\\home\\say");
    expect(src).not.toContain("\\\\wsl$\\Ubuntu\\home\\say");
    expect(src).not.toContain("D:\\\\work\\\\openmind");
    expect(src).not.toContain('"D:\\work\\openmind"');
  });
});

describe("ADR-001 atomic settings write", () => {
  it("does not leave a .tmp file after a successful save", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-atomic-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      setOpenmindRoot(dir);
      const dirOfSettings = path.dirname(settingsFile());
      const tmps = fs.readdirSync(dirOfSettings).filter((f) => f.includes(".tmp-"));
      expect(tmps).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
