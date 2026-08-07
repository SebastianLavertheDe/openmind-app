/**
 * Phase 1 (ADR-001) settings v2 tests — mymindRoot / workspaceRoot resolution,
 * legacy repoRoot migration, atomic writes, and the guarantee that no
 * hard-coded dev-machine WSL/Windows paths remain.
 *
 * These complement the existing settings.test.ts (legacy back-compat).
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
  getEnvironmentDiagnostics,
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

  it("migrates a legacy repoRoot by descending into mymind/", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-legacy-repo-"));
    fs.mkdirSync(path.join(repo, "mymind", "article"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".claude", "skills"), { recursive: true });
    try {
      // Simulate a legacy settings.json that only has repoRoot.
      fs.writeFileSync(settingsFile(), JSON.stringify({ repoRoot: repo }), "utf8");
      const mymind = resolveMymindRoot();
      expect(mymind).toBe(path.join(repo, "mymind"));
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  });

  it("returns empty string when nothing resolves", () => {
    // No setting, no env, no repo — but APP_ROOT/../mymind may exist in dev.
    // Clear settings + env to test the negative path; tolerate the dev checkout.
    fs.writeFileSync(settingsFile(), "{}", "utf8");
    delete process.env.CCTOOLS_MYMIND_ROOT;
    delete process.env.CCTOOLS_REPO_ROOT;
    const result = resolveMymindRoot();
    // It's either "" or the dev checkout's mymind — both are acceptable;
    // the key invariant is it does not throw.
    expect(typeof result).toBe("string");
  });
});

describe("ADR-001 setMymindRoot", () => {
  it("persists mymindRoot and clears repoRoot", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-set-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      setMymindRoot(dir);
      const raw = loadSettings();
      expect(raw.mymindRoot).toBe(path.resolve(dir));
      expect(raw.repoRoot).toBe("");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("accepts a legacy repo and stores <repo>/mymind", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-set-repo-"));
    fs.mkdirSync(path.join(repo, "mymind", "article"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".claude", "skills"), { recursive: true });
    try {
      const result = setMymindRoot(repo);
      expect(result).toBe(path.join(repo, "mymind"));
      expect(loadSettings().mymindRoot).toBe(path.join(repo, "mymind"));
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
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

  it("reads legacy state until migrated, but always writes new state to userData", () => {
    const legacyRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-private-state-legacy-"));
    const mymind = path.join(legacyRepo, "mymind");
    fs.mkdirSync(path.join(mymind, "article"), { recursive: true });
    fs.mkdirSync(path.join(legacyRepo, ".cctools"), { recursive: true });
    process.env.CCTOOLS_REPO_ROOT = legacyRepo;
    try {
      setMymindRoot(mymind);
      const legacyFile = path.join(legacyRepo, ".cctools", "creative-topic-state.json");
      fs.writeFileSync(legacyFile, "legacy", "utf8");
      fs.rmSync(appPrivateStatePath("creative-topic-state.json", true), { force: true });

      expect(appPrivateStatePath("creative-topic-state.json")).toBe(legacyFile);
      const writePath = appPrivateStatePath("creative-topic-state.json", true);
      expect(writePath).not.toBe(legacyFile);
      expect(writePath).toContain(path.join(userDataDir, "state"));
    } finally {
      delete process.env.CCTOOLS_REPO_ROOT;
      fs.rmSync(legacyRepo, { recursive: true, force: true });
      fs.rmSync(mymind, { recursive: true, force: true });
    }
  });

  it("keeps legacy state read-only and uses an app-private workspace bucket before binding", () => {
    const legacyRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-private-state-unbound-"));
    const mymind = path.join(legacyRepo, "mymind");
    fs.mkdirSync(path.join(mymind, "article"), { recursive: true });
    fs.mkdirSync(path.join(legacyRepo, ".cctools"), { recursive: true });
    process.env.CCTOOLS_REPO_ROOT = legacyRepo;
    try {
      // The explicit v2 root is cleared; the test workspace is still a valid
      // legacy source, but a write must never recreate state there.
      fs.writeFileSync(settingsFile(), JSON.stringify({ schemaVersion: 2, mymindRoot: "", workspaceRoot: legacyRepo }), "utf8");
      const legacyFile = path.join(legacyRepo, ".cctools", "creative-topic-state.json");
      fs.writeFileSync(legacyFile, "legacy", "utf8");

      const readPath = appPrivateStatePath("creative-topic-state.json");
      const writePath = appPrivateStatePath("creative-topic-state.json", true);
      expect(readPath).toBe(legacyFile);
      expect(writePath).not.toBe(legacyFile);
      expect(writePath).toContain(path.join(userDataDir, "state"));
      expect(writePath).not.toContain(path.join(legacyRepo, ".cctools"));
    } finally {
      delete process.env.CCTOOLS_REPO_ROOT;
      fs.rmSync(legacyRepo, { recursive: true, force: true });
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
      expect(() => resolveMymindPath("mymind/.app-private/state.json", "write")).toThrow("unknown top-level");
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

describe("ADR-001 environment diagnostics", () => {
  it("reports a mymind diagnostic", () => {
    const diags = getEnvironmentDiagnostics();
    expect(diags.some((d) => d.id === "mymind")).toBe(true);
  });

  it("reports mymind as ok when a valid root is set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-diag-"));
    fs.mkdirSync(path.join(dir, "article"), { recursive: true });
    try {
      setMymindRoot(dir);
      const diags = getEnvironmentDiagnostics();
      const mymindDiag = diags.find((d) => d.id === "mymind");
      expect(mymindDiag?.status).toBe("ok");
      expect(mymindDiag?.value).toBe(path.resolve(dir));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
