import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BROWSER_EVIDENCE_DIR, OnboardingStateSchema, type OpenmindRootPreview, type OnboardingState, type UserPreferences } from "../../shared/contracts";
import { messages } from "../../shared/messages";
import { buildAppPaths, detectPathConflicts, type AppPaths } from "../paths/app-paths-service";
import { computeRootId, OpenmindPathResolver } from "../paths/openmind-path-resolver";
import { OpenmindLocationService, type OpenmindRootHealth } from "../paths/openmind-location-service";

const electronApp = app;

const APP_ROOT = path.resolve(__dirname, "..", "..");

type WslRepoPath = { distro: string; linuxPath: string };
type RawSettings = Record<string, unknown>;

/**
 * Settings schema version.
 *
 * v2: ADR-001 — `openmindRoot` (the actual openmind dir) plus an optional
 *     `workspaceRoot`. The pre-release v1 `repoRoot` field was removed along
 *     with its migration shims; unknown keys in settings.json are ignored.
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
 * unit tests that set OPENMIND_USER_DATA_DIR before importing this module
 * still get the right path.
 */
let cachedAppPaths: AppPaths | null = null;
function appPaths(): AppPaths {
  if (!cachedAppPaths) cachedAppPaths = buildAppPaths();
  return cachedAppPaths;
}

// 进程内缓存的 root，按指纹（settings.json mtime + 显式 root env）失效，
// 避免每个 IPC、甚至每个文件都重新读 settings.json + 多次 existsSync。
let cachedOpenmindRoot: string | null = null;
let cachedFingerprint: string | null = null;

function repoCacheFingerprint(): string {
  let mtime = 0;
  try { mtime = fs.statSync(settingsFile()).mtimeMs; } catch { /* settings.json 尚不存在 */ }
  return `${process.env.OPENMIND_ROOT || ""}\0${mtime}`;
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
    : process.env.OPENMIND_USER_DATA_DIR || path.join(os.tmpdir(), "openmind-desktop");
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
 * Whether a directory is a valid openmind root per ADR-001/002.
 *
 * A valid openmind root is a readable, writable directory. It does NOT require
 * `.claude/skills` (that was the legacy repo-coupling this refactor removes).
 * Existing content-contract subdirs (article/, creative/, ...) may be absent
 * — they are create-if-needed (ADR-002), not bind prerequisites.
 */
function isValidOpenmindRoot(candidate: unknown): boolean {
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
  if (!isValidOpenmindRoot(candidate)) return null;
  try { return fs.realpathSync(path.resolve(String(candidate))); }
  catch { return null; }
}

function assertRootDoesNotConflict(root: string, workspaceRoot?: string): void {
  const conflicts = detectPathConflicts(appPaths(), root, workspaceRoot);
  if (conflicts.length) {
    throw new Error("openmind 或工作区不能位于应用私有数据目录内。");
  }
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
 * Resolve the actual `openmind` directory.
 *
 * Resolution order:
 *   1. explicit `openmindRoot` setting
 *   2. `OPENMIND_ROOT` env
 *
 * Checkout-relative discovery is intentionally excluded here: merely running
 * the app beside a `openmind` directory must not bypass the first-start gate.
 * Returns the empty string when no explicit binding resolves.
 */
function resolveOpenmindRoot(): string {
  const fingerprint = repoCacheFingerprint();
  if (cachedOpenmindRoot !== null && cachedFingerprint === fingerprint) return cachedOpenmindRoot;
  const settings = loadSettings();
  const candidates: unknown[] = [
    settings.openmindRoot,
    process.env.OPENMIND_ROOT
  ];
  for (const candidate of candidates) {
    const canonical = canonicalDirectory(candidate);
    if (canonical) {
      cachedOpenmindRoot = canonical;
      cachedFingerprint = fingerprint;
      return cachedOpenmindRoot;
    }
  }
  cachedOpenmindRoot = "";
  cachedFingerprint = fingerprint;
  return cachedOpenmindRoot;
}

/**
 * Set the openmind root. Persists `openmindRoot`; a stale v1 `repoRoot` key, if
 * present, is dropped so future reads are unambiguous.
 */
function setOpenmindRoot(candidate: string): string {
  const canonical = canonicalDirectory(normalizeRepoRoot(candidate));
  if (!canonical) {
    throw new Error(messages.errors.repo.invalidDirectory);
  }
  assertRootDoesNotConflict(canonical, resolveWorkspaceRoot());
  const { repoRoot: _staleRepoRoot, ...current } = loadSettings();
  const previous = typeof current.openmindRoot === "string" ? canonicalDirectory(current.openmindRoot) : null;
  const generation = Number.isInteger(current.openmindRootGeneration) && Number(current.openmindRootGeneration) > 0
    ? Number(current.openmindRootGeneration) + (previous === canonical ? 0 : 1)
    : 1;
  saveSettings({ ...current, openmindRoot: canonical, openmindRootGeneration: generation });
  invalidateRootCache();
  return canonical;
}

/** Canonicalize a openmind root candidate (bare directory, readable + writable). */
function resolveOpenmindCandidate(candidate: unknown): string | null {
  return canonicalDirectory(normalizeRepoRoot(candidate));
}

/** Explicitly bound workspace root only (setting/env); "" when unbound. */
function resolveExplicitWorkspaceRoot(): string {
  const settings = loadSettings();
  const candidates: unknown[] = [
    settings.workspaceRoot,
    process.env.OPENMIND_WORKSPACE_ROOT
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "string" && fs.existsSync(path.resolve(candidate))) {
      return path.resolve(candidate);
    }
  }
  return "";
}

/**
 * AI session workspace root. Unbound workspaces fall back to the bound
 * openmind content root, so AI sessions work inside the user's content by
 * default; an explicit binding still takes precedence. Provider-config
 * discovery is deliberately separate and follows the openmind root's private
 * data repository instead of an arbitrary AI/code workspace.
 */
function resolveWorkspaceRoot(): string {
  return resolveExplicitWorkspaceRoot() || resolveOpenmindRoot();
}

function setWorkspaceRoot(candidate: string): string {
  const normalised = normalizeRepoRoot(candidate);
  const canonical = canonicalDirectory(normalised) || (fs.existsSync(normalised) ? fs.realpathSync(normalised) : null);
  if (!canonical) {
    throw new Error(messages.errors.repo.invalidDirectory);
  }
  assertRootDoesNotConflict(resolveOpenmindRoot() || path.join(os.tmpdir(), "openmind-no-openmind"), canonical);
  const current = loadSettings();
  saveSettings({ ...current, workspaceRoot: canonical });
  invalidateRootCache();
  return canonical;
}

function invalidateRootCache(): void {
  cachedOpenmindRoot = null;
  cachedFingerprint = null;
}

function getOpenmindRootHealth(): OpenmindRootHealth {
  return new OpenmindLocationService({ paths: appPaths() }).inspect(resolveOpenmindRoot());
}

/**
 * Read-only root binding dry-run. It intentionally shares the same inspection
 * and conflict rules as bind/set, but does not write settings or content.
 */
function previewOpenmindRoot(candidate: string, activeRunCount = 0): OpenmindRootPreview {
  const normalized = normalizeRepoRoot(candidate);
  const canonicalRoot = resolveOpenmindCandidate(normalized);
  const inspected = new OpenmindLocationService({ paths: appPaths(), activeRunCount: () => activeRunCount })
    .inspect(canonicalRoot || normalized);
  const blockingReasons = [...inspected.warnings];
  if (!canonicalRoot) blockingReasons.unshift("候选路径不存在、不可访问或不是目录。");
  if (!inspected.readable && !blockingReasons.includes("openmind 根目录不可读。")) blockingReasons.push("openmind 根目录不可读。");
  if (!inspected.writable && !blockingReasons.includes("openmind 根目录不可写。")) blockingReasons.push("openmind 根目录不可写。");
  if (activeRunCount > 0) blockingReasons.push("有运行中的任务，暂时不能切换 openmind 根目录。");
  return {
    candidate: normalized,
    canonicalRoot,
    health: inspected,
    canBind: Boolean(canonicalRoot && inspected.accessible && inspected.readable && inspected.writable && blockingReasons.length === 0),
    blockingReasons: [...new Set(blockingReasons)]
  };
}

function getOpenmindRootSnapshot(): { rootPath: string; rootId: string; rootGeneration: number } | null {
  const root = resolveOpenmindRoot();
  if (!root) return null;
  return {
    rootPath: root,
    rootId: computeRootId(root),
    rootGeneration: Number(loadSettings().openmindRootGeneration) || 1
  };
}

/** Resolve an app-private state file scoped to the active root binding. */
function appPrivateStatePath(name: string): string {
  const root = resolveOpenmindRoot();
  const raw = loadSettings();
  const configuredRoot = typeof raw.openmindRoot === "string" ? canonicalDirectory(raw.openmindRoot) : null;
  const hasV2Binding = Boolean(root && configuredRoot && configuredRoot === root);
  // Before a valid openmind binding exists, use an app-private workspace bucket
  // rather than a repo-coupled location.
  const stateScope = hasV2Binding
    ? computeRootId(root!)
    : computeRootId(resolveWorkspaceRoot() || "workspace");
  return path.join(appPaths().state, stateScope, ".openmind", name);
}

/**
 * Return a directory `R` such that `path.join(R, "openmind", ...)` lands inside
 * the current openmind root — i.e. the openmind dir's parent. With no openmind root
 * bound this falls back to the dev checkout parent. Display/UI compatibility
 * only; content paths must resolve against {@link resolveOpenmindRoot}.
 */
function findRepoRoot(): string {
  const openmind = resolveOpenmindRoot();
  if (openmind) return normalizeRepoRoot(path.dirname(openmind));
  return normalizeRepoRoot(path.resolve(APP_ROOT, ".."));
}

function ensureInsideRepo(relativeOrAbsolute: string): string {
  const raw = String(relativeOrAbsolute || "");
  const logical = raw.replaceAll("\\", "/");
  const openmind = resolveOpenmindRoot();
  const isOpenmindPath = logical === "openmind" || logical.startsWith("openmind/");
  if (isOpenmindPath && openmind) return resolveOpenmindPath(logical);
  const base = resolveWorkspaceRoot() || findRepoRoot();
  const candidate = raw;
  const resolved = path.resolve(base, candidate);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(messages.errors.repo.pathOutsideProject);
  }
  return resolved;
}

/** Resolve a logical openmind path without exposing the physical root to callers. */
function resolveOpenmindPath(logicalPath: string, mode: "read" | "write" = "read"): string {
  const openmind = resolveOpenmindRoot();
  if (!openmind) throw new Error(messages.errors.repo.selectValidFirst);
  const snapshot = {
    rootPath: openmind,
    rootId: computeRootId(openmind),
    rootGeneration: 1
  } as const;
  return new OpenmindPathResolver(snapshot).resolve(logicalPath, mode).physicalPath;
}

/** Convert a physical path inside the active openmind root to a logical path. */
function relativeToOpenmind(absolutePath: string): string {
  const openmind = resolveOpenmindRoot();
  if (!openmind) throw new Error(messages.errors.repo.selectValidFirst);
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(openmind, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(messages.errors.repo.pathOutsideProject);
  }
  return `openmind/${relative.split(path.sep).join("/")}`;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  openmindRoot: "",
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
  notesDir: "openmind",
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
  // not wipe openmindRoot/workspaceRoot. Explicit root changes go through
  // setOpenmindRoot/setWorkspaceRoot, not updatePreferences.
  const preserveRoots = {
    openmindRoot: patch?.openmindRoot ?? current.openmindRoot ?? preferences.openmindRoot ?? "",
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
    // user's openmind selection on a settings reset).
    saveSettings({
      openmindRoot: current.openmindRoot || "",
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
    openmindRoot: current.openmindRoot || "",
    workspaceRoot: current.workspaceRoot || ""
  });
  return getPreferences();
}

function importPreferences(filePath: string): { imported: true; preferences: UserPreferences } {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as RawSettings;
  const current = loadSettings();
  // Imported openmindRoot must be a real directory, else keep the current one.
  const importedOpenmind = typeof raw.openmindRoot === "string" && (!raw.openmindRoot || isValidOpenmindRoot(raw.openmindRoot))
    ? raw.openmindRoot
    : current.openmindRoot || "";
  const importedWorkspace = typeof raw.workspaceRoot === "string" && (!raw.workspaceRoot || fs.existsSync(raw.workspaceRoot))
    ? raw.workspaceRoot
    : current.workspaceRoot || "";
  const next = normalizePreferences({
    ...raw,
    openmindRoot: importedOpenmind,
    workspaceRoot: importedWorkspace
  }, true);
  saveSettings({ ...current, ...next });
  invalidateRootCache();
  return { imported: true, preferences: getPreferences() };
}

function normalizePreferences(raw: unknown, strict: boolean): UserPreferences {
  const source = raw && typeof raw === "object" ? raw as RawSettings : {};
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    openmindRoot: stringPref(source.openmindRoot, DEFAULT_PREFERENCES.openmindRoot, strict, "openmindRoot", 4096),
    workspaceRoot: stringPref(source.workspaceRoot, DEFAULT_PREFERENCES.workspaceRoot, strict, "workspaceRoot", 4096),
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
    // Migrate the old implicit `.openmind` default to an explicit user-owned
    // workspace output. A deliberately customized path remains untouched.
    browserEvidenceDir: safeRelativePathPref(
      source.browserEvidenceDir === ".openmind/browser-evidence" ? DEFAULT_BROWSER_EVIDENCE_DIR : source.browserEvidenceDir,
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
  isValidOpenmindRoot,
  normalizeRepoRoot,
  parseWslRepoPath,
  setOpenmindRoot,
  previewOpenmindRoot,
  setWorkspaceRoot,
  findRepoRoot,
  resolveOpenmindRoot,
  resolveWorkspaceRoot,
  resolveExplicitWorkspaceRoot,
  getOpenmindRootHealth,
  getOpenmindRootSnapshot,
  appPrivateStatePath,
  ensureInsideRepo,
  resolveOpenmindPath,
  relativeToOpenmind,
  getPreferences,
  updatePreferences,
  resetPreferences,
  importPreferences
};
