/**
 * Phase 1 (ADR-001) settings v2 tests — mymindRoot / workspaceRoot resolution,
 * atomic writes, and the guarantee that no hard-coded dev-machine WSL/Windows
 * paths remain.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-settings-v2-"));
process.env.CCTOOLS_USER_DATA_DIR = userDataDir;

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir
  }
}));

import {
  SETTINGS_SCHEMA_VERSION,
  setMymindRoot,
  setWorkspaceRoot,
  resolveMymindRoot,
  resolveWorkspaceRoot,
  isValidMymindRoot,
  findRepoRoot,
  ensureInsideRepo,
  resolveMymindPath,
  relativeToMymind,
  previewMymindRoot,
  loadSettings,
  getPreferences,
  settingsFile,
  appPrivateStatePath
} from "./settings";

afterEach(() => {
  try { fs.rmSync(settingsFile(), { force: true }); } catch { /* ignore */ }
  delete process.env.CCTOOLS_MYMIND_ROOT;
  delete process.env.CCTOOLS_WORKSPACE_ROOT;
});

describe("ADR-001 settings v2 — schemaVersion", () => {
  it("schema version is 2", () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(2);
  });
});

describe("ADR-001 isValidMymindRoot", () => {
  it("accepts a readable+writable directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-valid-"));
    try { expect(isValidMymindRoot(dir)).toBe(true); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects a non-existent path", () => {
    expect(isValidMymindRoot(path.join(os.tmpdir(), "definitely-not-here-" + Date.now()))).toBe(false);
  });

  it("rejects a file (not a directory)", () => {
    const file = path.join(os.tmpdir(), `cctools-file-${Date.now()}`);
    fs.writeFileSync(file, "x");
    try { expect(isValidMymindRoot(file)).toBe(false); }
    finally { fs.rmSync(file, { force: true }); }
  });

  it("rejects empty / non-string input", () => {
    expect(isValidMymindRoot("")).toBe(false);
    expect(isValidMymindRoot(null)).toBe(false);
    expect(isValidMymindRoot(undefined)).toBe(false);
    expect(isValidMymindRoot(123)).toBe(false);
  });
});

describe("ADR-001 resolveMymindRoot", () => {
  it("returns the v2 mymindRoot setting when valid", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-mymind-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      setMymindRoot(dir);
      expect(resolveMymindRoot()).toBe(path.resolve(dir));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("honours CCTOOLS_MYMIND_ROOT env", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-env-mymind-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      process.env.CCTOOLS_MYMIND_ROOT = dir;
      expect(resolveMymindRoot()).toBe(path.resolve(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty string when nothing resolves", () => {
    // A sibling checkout must not count as an explicit save-directory binding.
    fs.writeFileSync(settingsFile(), "{}", "utf8");
    delete process.env.CCTOOLS_MYMIND_ROOT;
    expect(resolveMymindRoot()).toBe("");
  });
});

describe("ADR-001 setMymindRoot", () => {
  it("persists mymindRoot and drops a stale v1 repoRoot key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-set-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      fs.writeFileSync(settingsFile(), JSON.stringify({ repoRoot: "/stale/legacy" }), "utf8");
      setMymindRoot(dir);
      const raw = loadSettings();
      expect(raw.mymindRoot).toBe(path.resolve(dir));
      expect("repoRoot" in raw).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects a non-directory", () => {
    expect(() => setMymindRoot(path.join(os.tmpdir(), "no-such-" + Date.now()))).toThrow();
  });
});

describe("ADR-001 mymind root dry-run", () => {
  it("previews a valid root without writing settings or content", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-preview-root-"));
    fs.mkdirSync(path.join(dir, "private-notes"));
    try {
      fs.rmSync(settingsFile(), { force: true });
      const preview = previewMymindRoot(dir);
      expect(preview.canBind).toBe(true);
      expect(preview.canonicalRoot).toBe(path.resolve(dir));
      expect(preview.health.unknownPreservedEntries).toEqual(["private-notes"]);
      expect(fs.existsSync(settingsFile())).toBe(false);
      expect(fs.existsSync(path.join(dir, "article"))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("reports app-private conflicts and active-run blocking without changing settings", () => {
    const preview = previewMymindRoot(userDataDir, 1);
    expect(preview.canBind).toBe(false);
    expect(preview.blockingReasons.join("；")).toContain("路径冲突");
    expect(preview.blockingReasons.join("；")).toContain("运行中的任务");
  });
});

describe("ADR-001 private state migration window", () => {
  it("moves the old implicit browser evidence default to a user-owned workspace output", () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ schemaVersion: 2, browserEvidenceDir: ".cctools/browser-evidence" }), "utf8");

    expect(getPreferences().browserEvidenceDir).toBe("assets/browser-evidence");
    expect(JSON.parse(fs.readFileSync(settingsFile(), "utf8")).browserEvidenceDir).toBe("assets/browser-evidence");
  });

  it("never resolves private state inside a repo workspace; unbound writes use an app-private bucket", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-private-state-ws-"));
    fs.mkdirSync(path.join(workspace, ".cctools"), { recursive: true });
    try {
      // No mymind root bound; workspace is set. State must stay app-private.
      fs.writeFileSync(settingsFile(), JSON.stringify({ schemaVersion: 2, mymindRoot: "", workspaceRoot: workspace }), "utf8");
      const statePath = appPrivateStatePath("creative-topic-state.json");
      expect(statePath).toContain(path.join(userDataDir, "state"));
      expect(statePath).not.toContain(path.join(workspace, ".cctools"));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("ADR-001 workspaceRoot", () => {
  it("setWorkspaceRoot persists and resolveWorkspaceRoot reads it back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-ws-"));
    try {
      setWorkspaceRoot(dir);
      expect(resolveWorkspaceRoot()).toBe(path.resolve(dir));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("workspaceRoot is independent of mymindRoot", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-ws2-"));
    const mm = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-mm2-"));
    fs.mkdirSync(path.join(mm, "article"), { recursive: true });
    try {
      setMymindRoot(mm);
      setWorkspaceRoot(ws);
      expect(resolveMymindRoot()).toBe(path.resolve(mm));
      expect(resolveWorkspaceRoot()).toBe(path.resolve(ws));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
      fs.rmSync(mm, { recursive: true, force: true });
    }
  });
});

describe("ADR-001 findRepoRoot back-compat", () => {
  it("returns the parent of mymindRoot so legacy path.join(root, 'mymind', x) still works", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-parent-"));
    const mm = path.join(parent, "mymind");
    fs.mkdirSync(path.join(mm, "article"), { recursive: true });
    try {
      setMymindRoot(mm);
      const repoRoot = findRepoRoot();
      // Legacy callers do path.join(repoRoot, "mymind", x); that must equal mm/x.
      const joined = path.join(repoRoot, "mymind", "article");
      expect(joined).toBe(path.join(mm, "article"));
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });

  it("ensureInsideRepo still rejects traversal outside the root", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-parent2-"));
    const mm = path.join(parent, "mymind");
    fs.mkdirSync(mm, { recursive: true });
    try {
      setMymindRoot(mm);
      expect(() => ensureInsideRepo("../../etc/passwd")).toThrow();
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
});

describe("ADR-001 arbitrary mymind roots", () => {
  it("maps content paths to a selected root that is not named mymind", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-content-root-"));
    const file = path.join(root, "daily-summary", "20260805_daily_summary.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# summary");
    try {
      setMymindRoot(root);
      expect(resolveMymindPath("mymind/daily-summary/20260805_daily_summary.md")).toBe(file);
      expect(relativeToMymind(file)).toBe("mymind/daily-summary/20260805_daily_summary.md");
      expect(() => resolveMymindPath("mymind/.app-private/state.json", "write")).toThrow("non-writable top-level");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe("ADR-001 no hard-coded dev-machine paths", () => {
  // The refactor removed hard-coded WSL `\\wsl.localhost\Ubuntu\home\say\...`
  // and `D:\work\cctools` candidates from auto-detection. This test enforces
  // that regression by reading the source and asserting those literals are gone
  // from the candidate lists (they may still appear in parseWslRepoPath tests).
  it("settings.ts contains no hard-coded WSL/Windows dev paths in candidate lists", () => {
    const src = fs.readFileSync(path.join(__dirname, "settings.ts"), "utf8");
    // parseWslRepoPath legitimately matches \\wsl patterns — that's fine.
    // The forbidden pattern is a hard-coded *candidate path* like the dev's
    // home directory. Assert the specific dev paths are absent.
    expect(src).not.toContain("\\\\wsl.localhost\\Ubuntu\\home\\say");
    expect(src).not.toContain("\\\\wsl$\\Ubuntu\\home\\say");
    expect(src).not.toContain("D:\\\\work\\\\cctools");
    expect(src).not.toContain('"D:\\work\\cctools"');
  });
});

describe("ADR-001 atomic settings write", () => {
  it("does not leave a .tmp file after a successful save", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-atomic-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      setMymindRoot(dir);
      const dirOfSettings = path.dirname(settingsFile());
      const tmps = fs.readdirSync(dirOfSettings).filter((f) => f.includes(".tmp-"));
      expect(tmps).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
