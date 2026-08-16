import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BROWSER_EVIDENCE_DIR, OnboardingStateSchema, type MymindRootPreview, type OnboardingState, type UserPreferences } from "../../shared/contracts";
import { messages } from "../../shared/messages";
import { buildAppPaths, detectPathConflicts, type AppPaths } from "../paths/app-paths-service";
import { computeRootId, MymindPathResolver } from "../paths/mymind-path-resolver";
import { MymindLocationService, type MymindRootHealth } from "../paths/mymind-location-service";
import { readLegacyStateMigrationReport } from "../paths/legacy-state-migration";

const electronApp = app;

const APP_ROOT = path.resolve(__dirname, "..", "..");

type WslRepoPath = { distro: string; linuxPath: string };
type RawSettings = Record<string, unknown>;

/**
 * Settings schema version.
 *
 * v1: legacy `repoRoot` (a cctools checkout containing both `.claude/skills`
 *     and `mymind`).
 * v2: ADR-001 — split into `mymindRoot` (the actual mymind dir) and an
 *     optional `workspaceRoot`. `repoRoot` is kept only as a one-shot
 *     migration input; new code MUST NOT read it.
 */
export const SETTINGS_SCHEMA_VERSION = 2;

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  completed: false,
  skill: "pending",
  provider: "pending"
};

/**
 * Cached AppPaths (singleton from AppPathsService). Computed once and reused
 * so settings.json resolution matches the rest of the app. Resolved lazily so
 * unit tests that set CCTOOLS_USER_DATA_DIR before importing this module
 * still get the right path.
 */
let cachedAppPaths: AppPaths | null = null;
function appPaths(): AppPaths {
  if (!cachedAppPaths) cachedAppPaths = buildAppPaths();
  return cachedAppPaths;
}

// 进程内缓存的 root，按指纹（settings.json mtime + root env + cwd）失效，
// 避免每个 IPC、甚至每个文件都重新读 settings.json + 多次 existsSync。
let cachedRepoRoot: string | null = null;
let cachedMymindRoot: string | null = null;
let cachedFingerprint: string | null = null;

function repoCacheFingerprint(): string {
  let mtime = 0;
  try { mtime = fs.statSync(settingsFile()).mtimeMs; } catch { /* settings.json 尚不存在 */ }
  return `${process.env.CCTOOLS_REPO_ROOT || ""}\0${process.env.CCTOOLS_MYMIND_ROOT || ""}\0${process.cwd()}\0${mtime}`;
}

function settingsFile(): string {
  // Delegate to AppPathsService (ADR-001): settings.json lives under
  // userData/settings. The old userData/settings.json location is read once
  // by loadSettings() for rollback compatibility, but is never written.
  return appPaths().settingsFile;
}

function legacySettingsFile(): string {
  const userData = electronApp?.getPath
    ? electronApp.getPath("userData")
    : process.env.CCTOOLS_USER_DATA_DIR || path.join(os.tmpdir(), "cctools-desktop");
  return path.join(userData, "settings.json");
}

function loadSettings(): RawSettings {
  for (const file of [settingsFile(), legacySettingsFile()]) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as RawSettings;
    } catch {
      // Try the compatibility location before returning empty settings.
    }
  }
  return {};
}

export function getOnboardingState(): OnboardingState {
  const raw = loadSettings().onboarding;
  const parsed = OnboardingStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_ONBOARDING_STATE };
}

export function updateOnboardingState(patch: Partial<OnboardingState>): OnboardingState {
  const current = getOnboardingState();
  const next = OnboardingStateSchema.parse({ ...current, ...patch });
  saveSettings({ ...loadSettings(), onboarding: next });
  return next;
}

/**
 * Atomic settings write: temp file + rename. Guards against half-written
 * settings on crash (ADR-001 §1.3 / data-migration.md §2).
 */
function saveSettings(next: RawSettings): RawSettings {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, file);
  return next;
}

/**
 * Whether a directory is a valid mymind root per ADR-001/002.
 *
 * A valid mymind root is a readable, writable directory. It does NOT require
 * `.claude/skills` (that was the legacy repo-coupling this refactor removes).
 * Existing content-contract subdirs (article/, creative/, ...) may be absent
 * — they are create-if-needed (ADR-002), not bind prerequisites.
 */
function isValidMymindRoot(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "string") return false;
  try {
    const resolved = path.resolve(String(candidate));
    const st = fs.statSync(resolved);
    if (!st.isDirectory()) return false;
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function canonicalDirectory(candidate: unknown): string | null {
  if (!isValidMymindRoot(candidate)) return null;
  try { return fs.realpathSync(path.resolve(String(candidate))); }
  catch { return null; }
}

function assertRootDoesNotConflict(root: string, workspaceRoot?: string): void {
  const conflicts = detectPathConflicts(appPaths(), root, workspaceRoot);
  if (conflicts.length) {
    throw new Error("mymind 或工作区不能位于应用私有数据目录内。");
  }
}

/**
 * Legacy compatibility shim (ADR-001 §16.7). Accepts BOTH:
 *   - a cctools repo containing `.claude/skills` + `mymind` (legacy shape),
 *   - a bare `mymind` directory (the new ADR-001 shape).
 *
 * Kept so existing callers and tests keep working while product services are
 * migrated to {@link resolveMymindRoot} / `isValidMymindRoot`. New code MUST
 * NOT call this; it conflates repo and content (ADR-001 §1.1).
 */
function looksLikeRepo(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "string") return false;
  // New shape: a bare mymind directory.
  if (isValidMymindRoot(candidate) && fs.existsSync(path.join(candidate, "article"))) {
    return true;
  }
  // Legacy shape: .claude/skills + mymind.
  return Boolean(
    fs.existsSync(path.join(candidate, ".claude", "skills")) &&
      fs.existsSync(path.join(candidate, "mymind"))
  );
}

function normalizeRepoRoot(candidate: unknown): string {
  const value = String(candidate || "").trim().replace(/^["']|["']$/g, "");
  // A leading slash without a drive is a POSIX/WSL logical path, even when
  // the desktop process itself runs on Windows. Do not turn `/home/...` into
  // `\home\...`, which loses the path's meaning at the WSL boundary.
  if (process.platform === "win32" && value.startsWith("/") && !value.startsWith("//") && !/^\/[A-Za-z]:/.test(value)) {
    return path.posix.normalize(value);
  }
  return path.normalize(value);
}

function parseWslRepoPath(repoRoot: unknown): WslRepoPath | null {
  const normalized = String(repoRoot || "").replaceAll("/", "\\");
  const match = normalized.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)$/i);
  if (!match) return null;
  return {
    distro: match[1],
    linuxPath: `/${match[2].replaceAll("\\", "/")}`
  };
}

/**
 * Resolve the actual `mymind` directory from the v2 `mymindRoot` setting,
 * falling back through legacy `repoRoot`/`CCTOOLS_REPO_ROOT` for migration.
 *
 * Resolution order (ADR-001 §16.1):
 *   1. explicit v2 `mymindRoot` setting
 *   2. `CCTOOLS_MYMIND_ROOT` env
 *   3. legacy `repoRoot` setting + `/mymind` (migration)
 *   4. `CCTOOLS_REPO_ROOT` env + `/mymind` (migration)
 *   5. heuristic: `APP_ROOT/../mymind` (dev checkout)
 *
 * Returns the empty string if nothing resolves to a real directory so callers
 * can surface a "select mymind root" prompt rather than crash.
 */
function resolveMymindRoot(): string {
  const fingerprint = repoCacheFingerprint();
  if (cachedMymindRoot !== null && cachedFingerprint === fingerprint) return cachedMymindRoot;
  const settings = loadSettings();
  const candidates: unknown[] = [
    settings.mymindRoot,
    process.env.CCTOOLS_MYMIND_ROOT,
    legacyMymindFromRepo(settings.repoRoot),
    legacyMymindFromRepo(process.env.CCTOOLS_REPO_ROOT),
    path.resolve(APP_ROOT, "..", "mymind")
  ];
  for (const candidate of candidates) {
    const canonical = canonicalDirectory(candidate);
    if (canonical) {
      cachedMymindRoot = canonical;
      cachedFingerprint = fingerprint;
      return cachedMymindRoot;
    }
  }
  cachedMymindRoot = "";
  cachedFingerprint = fingerprint;
  return cachedMymindRoot;
}

/** If `repoRoot` is a legacy cctools checkout, return its `mymind` subdir. */
function legacyMymindFromRepo(repoRoot: unknown): string | null {
  if (!repoRoot || typeof repoRoot !== "string") return null;
  const mymind = path.join(path.resolve(repoRoot), "mymind");
  return isValidMymindRoot(mymind) ? mymind : null;
}

/**
 * Set the mymind root (v2). Persists `mymindRoot` and clears the legacy
 * `repoRoot` field so future reads are unambiguous. Accepts either a bare
 * mymind directory or a legacy repo (in which case it stores `<repo>/mymind`).
 */
function setMymindRoot(candidate: string): string {
  const normalised = normalizeRepoRoot(candidate);
  const canonical = resolveMymindCandidate(normalised);
  if (!canonical) {
    throw new Error(messages.errors.repo.invalidDirectory);
  }
  assertRootDoesNotConflict(canonical, resolveWorkspaceRoot());
  const current = loadSettings();
  const previous = typeof current.mymindRoot === "string" ? canonicalDirectory(current.mymindRoot) : null;
  const generation = Number.isInteger(current.mymindRootGeneration) && Number(current.mymindRootGeneration) > 0
    ? Number(current.mymindRootGeneration) + (previous === canonical ? 0 : 1)
    : 1;
  saveSettings({ ...current, mymindRoot: canonical, mymindRootGeneration: generation, repoRoot: "" });
  invalidateRootCache();
  return canonical;
}

/** Resolve both the v2 bare root and the one-shot legacy repository shape. */
function resolveMymindCandidate(candidate: unknown): string | null {
  const normalised = normalizeRepoRoot(candidate);
  const resolvedAsMymind =
    isValidMymindRoot(normalised)
      && fs.existsSync(path.join(normalised, ".claude", "skills"))
      && isValidMymindRoot(path.join(normalised, "mymind"))
      ? path.join(normalised, "mymind")
      : normalised;
  return canonicalDirectory(resolvedAsMymind);
}

/** Optional ADR-001 workspace root (AI/code workspace), independent of mymind. */
function resolveWorkspaceRoot(): string {
  const settings = loadSettings();
  const candidates: unknown[] = [
    settings.workspaceRoot,
    process.env.CCTOOLS_WORKSPACE_ROOT,
    settings.repoRoot, // legacy: workspace was the repo
    process.env.CCTOOLS_REPO_ROOT
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "string" && fs.existsSync(path.resolve(candidate))) {
      return path.resolve(candidate);
    }
  }
  return "";
}

function setWorkspaceRoot(candidate: string): string {
  const normalised = normalizeRepoRoot(candidate);
  const canonical = canonicalDirectory(normalised) || (fs.existsSync(normalised) ? fs.realpathSync(normalised) : null);
  if (!canonical) {
    throw new Error(messages.errors.repo.invalidDirectory);
  }
  assertRootDoesNotConflict(resolveMymindRoot() || path.join(os.tmpdir(), "cctools-no-mymind"), canonical);
  const current = loadSettings();
  saveSettings({ ...current, workspaceRoot: canonical });
  invalidateRootCache();
  return canonical;
}

function invalidateRootCache(): void {
  cachedRepoRoot = null;
  cachedMymindRoot = null;
  cachedFingerprint = null;
}

function getMymindRootHealth(): MymindRootHealth {
  return new MymindLocationService({ paths: appPaths() }).inspect(resolveMymindRoot());
}

/**
 * Read-only root binding dry-run. It intentionally shares the same inspection
 * and conflict rules as bind/set, but does not write settings or content.
 */
function previewMymindRoot(candidate: string, activeRunCount = 0): MymindRootPreview {
  const normalized = normalizeRepoRoot(candidate);
  const canonicalRoot = resolveMymindCandidate(normalized);
  const inspected = new MymindLocationService({ paths: appPaths(), activeRunCount: () => activeRunCount })
    .inspect(canonicalRoot || normalized);
  const blockingReasons = [...inspected.warnings];
  if (!canonicalRoot) blockingReasons.unshift("候选路径不存在、不可访问或不是目录。");
  if (!inspected.readable && !blockingReasons.includes("mymind 根目录不可读。")) blockingReasons.push("mymind 根目录不可读。");
  if (!inspected.writable && !blockingReasons.includes("mymind 根目录不可写。")) blockingReasons.push("mymind 根目录不可写。");
  if (activeRunCount > 0) blockingReasons.push("有运行中的任务，暂时不能切换 mymind 根目录。");
  return {
    candidate: normalized,
    canonicalRoot,
    health: inspected,
    canBind: Boolean(canonicalRoot && inspected.accessible && inspected.readable && inspected.writable && blockingReasons.length === 0),
    blockingReasons: [...new Set(blockingReasons)]
  };
}

function getMymindRootSnapshot(): { rootPath: string; rootId: string; rootGeneration: number } | null {
  const root = resolveMymindRoot();
  if (!root) return null;
  return {
    rootPath: root,
    rootId: computeRootId(root),
    rootGeneration: Number(loadSettings().mymindRootGeneration) || 1
  };
}

/**
 * Read-only migration health for Diagnostics. The marker is app-private and
 * the returned shape intentionally contains no source/target paths.
 */
function getLegacyStateMigrationStatus(): {
  state: "not-needed" | "pending" | "skipped" | "committed" | "invalid";
  legacyStatePresent: boolean;
  markerPresent: boolean;
  copiedFileCount: number;
  sourcePreserved: boolean;
} {
  const workspaceRoot = resolveWorkspaceRoot();
  const mymindRoot = resolveMymindRoot();
  if (!workspaceRoot || !mymindRoot) {
    return { state: "not-needed", legacyStatePresent: false, markerPresent: false, copiedFileCount: 0, sourcePreserved: true };
  }
  const legacyStateDirectory = path.join(workspaceRoot, ".cctools");
  const targetStateRoot = path.join(appPaths().state, computeRootId(mymindRoot));
  const marker = path.join(targetStateRoot, "legacy-state-migration.json");
  const legacyStatePresent = (() => {
    try { return fs.statSync(legacyStateDirectory).isDirectory(); }
    catch { return false; }
  })();
  const markerPresent = fs.existsSync(marker);
  const report = readLegacyStateMigrationReport(marker);
  if (report) {
    return {
      state: report.status,
      legacyStatePresent,
      markerPresent: true,
      copiedFileCount: report.copiedFiles.length,
      sourcePreserved: report.preservedSource
    };
  }
  return {
    state: markerPresent ? "invalid" : legacyStatePresent ? "pending" : "not-needed",
    legacyStatePresent,
    markerPresent,
    copiedFileCount: 0,
    sourcePreserved: true
  };
}

/** Resolve a private state file, with a read-only legacy fallback. */
function appPrivateStatePath(name: string, forWrite = false): string {
  const root = resolveMymindRoot();
  const raw = loadSettings();
  const configuredRoot = typeof raw.mymindRoot === "string" ? canonicalDirectory(raw.mymindRoot) : null;
  const hasV2Binding = Boolean(root && configuredRoot && configuredRoot === root);
  const legacyRoot = resolveWorkspaceRoot() || findRepoRoot();
  const legacy = path.join(legacyRoot, ".cctools", name);
  // Legacy state is a read-only migration input. Before a valid mymind
  // binding exists, use an app-private workspace bucket for new writes rather
  // than recreating the old repo-coupled `<repo>/.cctools` state surface.
  const stateScope = hasV2Binding
    ? computeRootId(root!)
    : computeRootId(resolveWorkspaceRoot() || "workspace");
  const current = path.join(appPaths().state, stateScope, ".cctools", name);
  if (!forWrite && !fs.existsSync(current) && fs.existsSync(legacy)) return legacy;
  return current;
}

/**
 * Legacy: set the repo root. Kept as a migration shim (ADR-001 §16.7) —
 * derives `mymindRoot` from `<candidate>/mymind` and stores v2 settings.
 */
function setRepoRoot(candidate: string): string {
  const normalised = normalizeRepoRoot(candidate);
  // If given a bare mymind dir, treat it as the mymind root directly.
  if (isValidMymindRoot(normalised) && !looksLikeLegacyRepo(normalised)) {
    return setMymindRoot(normalised);
  }
  if (!looksLikeRepo(normalised)) {
    throw new Error(messages.errors.repo.invalidDirectory);
  }
  // Legacy repo: store mymindRoot=<repo>/mymind, remember repoRoot for workspace.
  const mymind = path.join(normalised, "mymind");
  const current = loadSettings();
  saveSettings({ ...current, mymindRoot: mymind, repoRoot: normalised });
  invalidateRootCache();
  return normalised;
}

function looksLikeLegacyRepo(candidate: string): boolean {
  return fs.existsSync(path.join(candidate, ".claude", "skills"))
    && isValidMymindRoot(path.join(candidate, "mymind"));
}

/**
 * Auto-detect a mymind root. Per ADR-001 §16.1 the hard-coded WSL/Windows
 * dev-machine paths are REMOVED — only env-derived and checkout-relative
 * candidates are considered.
 */
function detectMymindRoot(): string {
  const candidates: unknown[] = [
    process.env.CCTOOLS_MYMIND_ROOT,
    legacyMymindFromRepo(process.env.CCTOOLS_REPO_ROOT),
    path.resolve(APP_ROOT, "..", "mymind")
  ];
  const found = candidates.find(isValidMymindRoot);
  if (!found) throw new Error(messages.errors.repo.notAutoDetected);
  return setMymindRoot(String(found));
}

/**
 * Legacy auto-detect. Removed hard-coded dev paths (ADR-001 §16.1); env and
 * checkout-relative only. Returns the legacy repo root if a checkout is
 * detected, else throws.
 */
function detectRepoRoot(): string {
  const candidates = [
    process.env.CCTOOLS_REPO_ROOT,
    path.resolve(APP_ROOT, "..")
  ];
  const repoRoot = candidates.map(normalizeRepoRoot).find(looksLikeRepo);
  if (!repoRoot) throw new Error(messages.errors.repo.notAutoDetected);
  // Persist as v2 mymindRoot for future calls, but return the repo path
  // for legacy callers.
  const current = loadSettings();
  saveSettings({ ...current, mymindRoot: path.join(repoRoot, "mymind"), repoRoot });
  invalidateRootCache();
  return repoRoot;
}

/**
 * Legacy: return a directory `R` such that `path.join(R, "mymind", ...)` lands
 * inside the current mymind root. For a legacy cctools checkout this is the
 * repo dir; for a bare mymind selection (ADR-001) this is the mymind dir's
 * parent. Migrated callers should use {@link resolveMymindRoot} instead and
 * join paths directly against the mymind root.
 */
function findRepoRoot(): string {
  const fingerprint = repoCacheFingerprint();
  if (cachedRepoRoot && cachedFingerprint === fingerprint) return cachedRepoRoot;
  const settings = loadSettings();
  // 1. ADR-001 explicit mymindRoot selection takes precedence — the user
  //    chose this dir, so honour it before any dev-checkout heuristic.
  //    Its parent is returned so legacy `path.join(findRepoRoot(), "mymind", x)`
  //    resolves correctly.
  const mymind = resolveMymindRoot();
  if (mymind) {
    cachedRepoRoot = normalizeRepoRoot(path.dirname(mymind));
    cachedFingerprint = fingerprint;
    return cachedRepoRoot;
  }
  // 2. Legacy repo setting / env (contains .claude/skills + mymind).
  const legacyCandidates = [
    settings.repoRoot,
    process.env.CCTOOLS_REPO_ROOT,
    path.resolve(APP_ROOT, "..")
  ];
  for (const candidate of legacyCandidates) {
    if (candidate && looksLikeRepo(candidate)) {
      cachedRepoRoot = normalizeRepoRoot(candidate);
      cachedFingerprint = fingerprint;
      return cachedRepoRoot;
    }
  }
  // 3. Last resort (will likely fail downstream): preserve old behaviour.
  cachedRepoRoot = normalizeRepoRoot(settings.repoRoot || path.resolve(APP_ROOT, ".."));
  cachedFingerprint = fingerprint;
  return cachedRepoRoot;
}

function ensureInsideRepo(relativeOrAbsolute: string): string {
  const raw = String(relativeOrAbsolute || "");
  const logical = raw.replaceAll("\\", "/");
  const mymind = resolveMymindRoot();
  const isMymindPath = logical === "mymind" || logical.startsWith("mymind/");
  if (isMymindPath && mymind) return resolveMymindPath(logical);
  const base = resolveWorkspaceRoot() || findRepoRoot();
  const candidate = raw;
  const resolved = path.resolve(base, candidate);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(messages.errors.repo.pathOutsideProject);
  }
  return resolved;
}

/** Resolve a logical mymind path without exposing the physical root to callers. */
function resolveMymindPath(logicalPath: string, mode: "read" | "write" = "read"): string {
  const mymind = resolveMymindRoot();
  if (!mymind) throw new Error(messages.errors.repo.selectValidFirst);
  const snapshot = {
    rootPath: mymind,
    rootId: computeRootId(mymind),
    rootGeneration: 1
  } as const;
  return new MymindPathResolver(snapshot).resolve(logicalPath, mode).physicalPath;
}

/** Convert a physical path inside the active mymind root to a logical path. */
function relativeToMymind(absolutePath: string): string {
  const mymind = resolveMymindRoot();
  if (!mymind) throw new Error(messages.errors.repo.selectValidFirst);
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(mymind, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(messages.errors.repo.pathOutsideProject);
  }
  return `mymind/${relative.split(path.sep).join("/")}`;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  repoRoot: "",
  mymindRoot: "",
  workspaceRoot: "",
  themeMode: "light",
  accentColor: "#2563eb",
  density: "default",
  fontSize: "default",
  autoSaveIntervalMs: 30000,
  maxVersions: 50,
  archiveAfterDays: 90,
  defaultReadFilter: "all",
  contentPreviewMode: "sidebar",
  markReadOnOpen: true,
  defaultProvider: "",
  providerModels: { codex: "auto", claude: "auto" },
  defaultPermissionProfile: "edit",
  defaultWorkDir: "",
  notesDir: "mymind",
  browserAutomationEnabled: false,
  browserReuseExistingTabs: true,
  browserEvidenceDir: DEFAULT_BROWSER_EVIDENCE_DIR,
  destructiveOpsRequireApproval: true,
  riskScanEnabled: true,
  defaultPlatform: messages.settings.defaultPlatform,
  defaultLanguage: "zh-CN",
  defaultContentLength: "medium",
  defaultTemplate: "",
  userTags: [],
  notificationsEnabled: true,
  dndStartHour: 22,
  dndEndHour: 8,
  maxNotificationHistory: 100,
  cacheMaxSizeMB: 500,
  logRetentionDays: 30,
  workflowAutoSaveDraft: true,
  workflowAutoVersionOnStageChange: true,
  workflowReviewRequiredForReady: true,
  workflowPublishChecklistEnabled: true,
  workflowAutoArchiveEnabled: false,
  workflowAutoBriefOnSourceComplete: false
};

function getPreferences(): UserPreferences {
  const raw = loadSettings();
  const migrated = normalizePreferences(raw, false);
  const persisted = { ...raw, ...migrated };
  if (JSON.stringify(persisted) !== JSON.stringify(raw)) {
    saveSettings({ ...raw, ...migrated });
  }
  return migrated;
}

function updatePreferences(patch: Partial<UserPreferences>): UserPreferences {
  const current = loadSettings();
  const preferences = getPreferences();
  // Preserve root settings across a partial update: a preference patch must
  // not wipe mymindRoot/workspaceRoot/repoRoot. Explicit root changes go
  // through setMymindRoot/setWorkspaceRoot/setRepoRoot, not updatePreferences.
  const preserveRoots = {
    repoRoot: patch?.repoRoot ?? current.repoRoot ?? preferences.repoRoot ?? "",
    mymindRoot: patch?.mymindRoot ?? current.mymindRoot ?? preferences.mymindRoot ?? "",
    workspaceRoot: patch?.workspaceRoot ?? current.workspaceRoot ?? preferences.workspaceRoot ?? ""
  };
  const next = normalizePreferences({ ...preferences, ...patch, ...preserveRoots }, true);
  saveSettings({ ...current, ...next });
  return getPreferences();
}

function resetPreferences(section?: string): UserPreferences {
  const current = loadSettings();
  if (!section) {
    // Full reset preserves only the root bindings (ADR-001: never lose the
    // user's mymind selection on a settings reset).
    saveSettings({
      repoRoot: current.repoRoot || "",
      mymindRoot: current.mymindRoot || "",
      workspaceRoot: current.workspaceRoot || ""
    });
    return getPreferences();
  }
  const defaults: RawSettings = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    if (startsWithPrefix(key, section)) defaults[key] = DEFAULT_PREFERENCES[key as keyof UserPreferences];
  }
  saveSettings({
    ...current,
    ...defaults,
    repoRoot: current.repoRoot || "",
    mymindRoot: current.mymindRoot || "",
    workspaceRoot: current.workspaceRoot || ""
  });
  return getPreferences();
}

function importPreferences(filePath: string): { imported: true; preferences: UserPreferences } {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as RawSettings;
  const current = loadSettings();
  // Imported mymindRoot must be a real directory, else keep the current one.
  const importedMymind = typeof raw.mymindRoot === "string" && (!raw.mymindRoot || isValidMymindRoot(raw.mymindRoot))
    ? raw.mymindRoot
    : current.mymindRoot || "";
  const importedWorkspace = typeof raw.workspaceRoot === "string" && (!raw.workspaceRoot || fs.existsSync(raw.workspaceRoot))
    ? raw.workspaceRoot
    : current.workspaceRoot || "";
  const next = normalizePreferences({
    ...raw,
    mymindRoot: importedMymind,
    workspaceRoot: importedWorkspace,
    repoRoot: typeof raw.repoRoot === "string" && (!raw.repoRoot || looksLikeRepo(raw.repoRoot))
      ? raw.repoRoot
      : current.repoRoot || ""
  }, true);
  saveSettings({ ...current, ...next });
  invalidateRootCache();
  return { imported: true, preferences: getPreferences() };
}

function normalizePreferences(raw: unknown, strict: boolean): UserPreferences {
  const source = raw && typeof raw === "object" ? raw as RawSettings : {};
  const legacyRepo = typeof source.repoRoot === "string" ? source.repoRoot : "";
  const migratedMymind = typeof source.mymindRoot === "string" && source.mymindRoot
    ? source.mymindRoot
    : legacyMymindFromRepo(legacyRepo) || "";
  const migratedWorkspace = typeof source.workspaceRoot === "string" && source.workspaceRoot
    ? source.workspaceRoot
    : (legacyRepo && fs.existsSync(legacyRepo) ? legacyRepo : "");
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    repoRoot: stringPref(source.repoRoot, DEFAULT_PREFERENCES.repoRoot, strict, "repoRoot", 4096),
    mymindRoot: stringPref(migratedMymind, DEFAULT_PREFERENCES.mymindRoot, strict, "mymindRoot", 4096),
    workspaceRoot: stringPref(migratedWorkspace, DEFAULT_PREFERENCES.workspaceRoot, strict, "workspaceRoot", 4096),
    themeMode: enumPref(source.themeMode, ["dark", "light"], DEFAULT_PREFERENCES.themeMode, strict, "themeMode"),
    accentColor: colorPref(source.accentColor, DEFAULT_PREFERENCES.accentColor, strict),
    density: enumPref(source.density, ["compact", "default", "comfortable"], DEFAULT_PREFERENCES.density, strict, "density"),
    fontSize: enumPref(source.fontSize, ["small", "default", "large"], DEFAULT_PREFERENCES.fontSize, strict, "fontSize"),
    autoSaveIntervalMs: intPref(source.autoSaveIntervalMs, 5000, 600000, DEFAULT_PREFERENCES.autoSaveIntervalMs, strict, "autoSaveIntervalMs"),
    maxVersions: intPref(source.maxVersions, 3, 200, DEFAULT_PREFERENCES.maxVersions, strict, "maxVersions"),
    archiveAfterDays: intPref(source.archiveAfterDays, 7, 365, DEFAULT_PREFERENCES.archiveAfterDays, strict, "archiveAfterDays"),
    defaultReadFilter: enumPref(source.defaultReadFilter, ["all", "unread", "read"], DEFAULT_PREFERENCES.defaultReadFilter, strict, "defaultReadFilter"),
    contentPreviewMode: enumPref(source.contentPreviewMode, ["inline", "sidebar"], DEFAULT_PREFERENCES.contentPreviewMode, strict, "contentPreviewMode"),
    markReadOnOpen: boolPref(source.markReadOnOpen, DEFAULT_PREFERENCES.markReadOnOpen, strict, "markReadOnOpen"),
    defaultProvider: stringPref(source.defaultProvider, DEFAULT_PREFERENCES.defaultProvider, strict, "defaultProvider", 200),
    providerModels: normalizeProviderModels(source.providerModels),
    defaultPermissionProfile: enumPref(source.defaultPermissionProfile, ["read-only", "edit", "auto"], DEFAULT_PREFERENCES.defaultPermissionProfile, strict, "defaultPermissionProfile"),
    defaultWorkDir: stringPref(source.defaultWorkDir, DEFAULT_PREFERENCES.defaultWorkDir, strict, "defaultWorkDir", 4096),
    notesDir: stringPref(source.notesDir, DEFAULT_PREFERENCES.notesDir, strict, "notesDir", 4096),
    browserAutomationEnabled: boolPref(source.browserAutomationEnabled, DEFAULT_PREFERENCES.browserAutomationEnabled, strict, "browserAutomationEnabled"),
    browserReuseExistingTabs: boolPref(source.browserReuseExistingTabs, DEFAULT_PREFERENCES.browserReuseExistingTabs, strict, "browserReuseExistingTabs"),
    // Migrate the old implicit `.cctools` default to an explicit user-owned
    // workspace output. A deliberately customized path remains untouched.
    browserEvidenceDir: safeRelativePathPref(
      source.browserEvidenceDir === ".cctools/browser-evidence" ? DEFAULT_BROWSER_EVIDENCE_DIR : source.browserEvidenceDir,
      DEFAULT_PREFERENCES.browserEvidenceDir,
      strict,
      "browserEvidenceDir"
    ),
    destructiveOpsRequireApproval: boolPref(source.destructiveOpsRequireApproval, DEFAULT_PREFERENCES.destructiveOpsRequireApproval, strict, "destructiveOpsRequireApproval"),
    riskScanEnabled: boolPref(source.riskScanEnabled, DEFAULT_PREFERENCES.riskScanEnabled, strict, "riskScanEnabled"),
    defaultPlatform: stringPref(source.defaultPlatform, DEFAULT_PREFERENCES.defaultPlatform, strict, "defaultPlatform", 80),
    defaultLanguage: enumPref(source.defaultLanguage, ["zh-CN", "en"], DEFAULT_PREFERENCES.defaultLanguage, strict, "defaultLanguage"),
    defaultContentLength: enumPref(source.defaultContentLength, ["short", "medium", "long"], DEFAULT_PREFERENCES.defaultContentLength, strict, "defaultContentLength"),
    defaultTemplate: stringPref(source.defaultTemplate, DEFAULT_PREFERENCES.defaultTemplate, strict, "defaultTemplate", 4096),
    userTags: tagsPref(source.userTags, strict),
    notificationsEnabled: boolPref(source.notificationsEnabled, DEFAULT_PREFERENCES.notificationsEnabled, strict, "notificationsEnabled"),
    dndStartHour: intPref(source.dndStartHour, 0, 23, DEFAULT_PREFERENCES.dndStartHour, strict, "dndStartHour"),
    dndEndHour: intPref(source.dndEndHour, 0, 23, DEFAULT_PREFERENCES.dndEndHour, strict, "dndEndHour"),
    maxNotificationHistory: intPref(source.maxNotificationHistory, 10, 500, DEFAULT_PREFERENCES.maxNotificationHistory, strict, "maxNotificationHistory"),
    cacheMaxSizeMB: intPref(source.cacheMaxSizeMB, 50, 5000, DEFAULT_PREFERENCES.cacheMaxSizeMB, strict, "cacheMaxSizeMB"),
    logRetentionDays: intPref(source.logRetentionDays, 1, 90, DEFAULT_PREFERENCES.logRetentionDays, strict, "logRetentionDays"),
    workflowAutoSaveDraft: boolPref(source.workflowAutoSaveDraft, DEFAULT_PREFERENCES.workflowAutoSaveDraft, strict, "workflowAutoSaveDraft"),
    workflowAutoVersionOnStageChange: boolPref(source.workflowAutoVersionOnStageChange, DEFAULT_PREFERENCES.workflowAutoVersionOnStageChange, strict, "workflowAutoVersionOnStageChange"),
    workflowReviewRequiredForReady: boolPref(source.workflowReviewRequiredForReady, DEFAULT_PREFERENCES.workflowReviewRequiredForReady, strict, "workflowReviewRequiredForReady"),
    workflowPublishChecklistEnabled: boolPref(source.workflowPublishChecklistEnabled, DEFAULT_PREFERENCES.workflowPublishChecklistEnabled, strict, "workflowPublishChecklistEnabled"),
    workflowAutoArchiveEnabled: boolPref(source.workflowAutoArchiveEnabled, DEFAULT_PREFERENCES.workflowAutoArchiveEnabled, strict, "workflowAutoArchiveEnabled"),
    workflowAutoBriefOnSourceComplete: boolPref(source.workflowAutoBriefOnSourceComplete, DEFAULT_PREFERENCES.workflowAutoBriefOnSourceComplete, strict, "workflowAutoBriefOnSourceComplete")
  };
}

function normalizeProviderModels(value: unknown): { codex: string; claude: string } {
  const record = value && typeof value === "object" ? value as RawSettings : {};
  return {
    codex: typeof record.codex === "string" && record.codex ? record.codex : "auto",
    claude: typeof record.claude === "string" && record.claude ? record.claude : "auto"
  };
}

function stringPref(value: unknown, fallback: string, strict: boolean, key: string, max: number): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" && value.length <= max) return value;
  if (strict) throw new Error(messages.errors.preferences.invalidSetting(key));
  return fallback;
}

function safeRelativePathPref(value: unknown, fallback: string, strict: boolean, key: string): string {
  const candidate = stringPref(value, fallback, strict, key, 4096).trim().replaceAll("\\", "/");
  const unsafe = !candidate || path.isAbsolute(candidate) || candidate.split("/").some((part) => part === "..");
  if (!unsafe) return candidate;
  if (strict) throw new Error(messages.errors.preferences.invalidSetting(key));
  return fallback;
}

function enumPref<T extends string>(value: unknown, allowed: readonly T[], fallback: T, strict: boolean, key: string): T {
  if (value === undefined || value === null) return fallback;
  if (allowed.includes(value as T)) return value as T;
  if (strict) throw new Error(messages.errors.preferences.invalidSetting(key));
  return fallback;
}

function boolPref(value: unknown, fallback: boolean, strict: boolean, key: string): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (strict) throw new Error(messages.errors.preferences.invalidSetting(key));
  return fallback;
}

function intPref(value: unknown, min: number, max: number, fallback: number, strict: boolean, key: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) return value;
  if (strict) throw new Error(messages.errors.preferences.invalidSetting(key));
  return fallback;
}

function colorPref(value: unknown, fallback: string, strict: boolean): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return fallback;
  if (strict) throw new Error(messages.errors.preferences.invalidAccentColor);
  return fallback;
}

function tagsPref(value: unknown, strict: boolean): string[] {
  if (value === undefined || value === null) return DEFAULT_PREFERENCES.userTags;
  if (Array.isArray(value) && value.every((tag) => typeof tag === "string" && tag.trim() && tag.length <= 40)) {
    return [...new Set(value.map((tag) => tag.trim()))].slice(0, 60);
  }
  if (strict) throw new Error(messages.errors.preferences.invalidUserTags);
  return DEFAULT_PREFERENCES.userTags;
}

function startsWithPrefix(key: string, prefix: string): boolean {
  const groups: Record<string, string[]> = {
    theme: ["themeMode", "accentColor", "density", "fontSize"],
    save: ["autoSaveIntervalMs", "maxVersions", "archiveAfterDays"],
    content: ["defaultReadFilter", "contentPreviewMode", "markReadOnOpen"],
    ai: ["defaultProvider", "defaultPermissionProfile", "defaultWorkDir", "destructiveOpsRequireApproval", "riskScanEnabled"],
    project: ["defaultWorkDir", "notesDir"],
    creative: ["defaultPlatform", "defaultLanguage", "defaultContentLength", "defaultTemplate"],
    tags: ["userTags"],
    notifications: ["notificationsEnabled", "dndStartHour", "dndEndHour", "maxNotificationHistory"],
    data: ["cacheMaxSizeMB", "logRetentionDays"],
    workflow: ["autoSaveIntervalMs", "archiveAfterDays", "workflowAutoSaveDraft", "workflowAutoVersionOnStageChange", "workflowReviewRequiredForReady", "workflowPublishChecklistEnabled", "workflowAutoArchiveEnabled", "workflowAutoBriefOnSourceComplete"]
  };
  const keys = groups[prefix] || [];
  return keys.includes(key);
}

export {
  APP_ROOT,
  settingsFile,
  loadSettings,
  saveSettings,
  looksLikeRepo,
  isValidMymindRoot,
  normalizeRepoRoot,
  parseWslRepoPath,
  setRepoRoot,
  setMymindRoot,
  previewMymindRoot,
  setWorkspaceRoot,
  detectRepoRoot,
  detectMymindRoot,
  findRepoRoot,
  resolveMymindRoot,
  resolveWorkspaceRoot,
  getMymindRootHealth,
  getMymindRootSnapshot,
  getLegacyStateMigrationStatus,
  appPrivateStatePath,
  ensureInsideRepo,
  resolveMymindPath,
  relativeToMymind,
  getPreferences,
  updatePreferences,
  resetPreferences,
  importPreferences
};
