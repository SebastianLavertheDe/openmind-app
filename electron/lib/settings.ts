import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OnboardingStateSchema, type OpenmindRootPreview, type OnboardingState, type UserPreferences, type UserPreferencesPatch } from "../../shared/contracts";
import { YOUTUBE_COOKIE_BROWSERS } from "../../shared/youtube-import";
import { messages, zhCN } from "../../shared/messages";
import { buildAppPaths, detectPathConflicts, type AppPaths } from "../paths/app-paths-service";
import { assertOutsideAppManagedProjects, computeRootId, OpenmindPathResolver, resolvePathInsideCanonicalRoot } from "../paths/openmind-path-resolver";
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
 * v3: New AI conversations default to automatic execution. Migrate the old
 *     v2 product default (`edit`) once; choices saved after this migration
 *     remain explicit and are preserved.
 */
export const SETTINGS_SCHEMA_VERSION = 3;

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

// settings.json 的解析结果同样按 mtime 指纹缓存：getPreferences 被
// 多个高频 IPC 间接调用，readFileSync+JSON.parse 不应每次都发生。进程内
// 写入（saveSettings）后立即同步缓存；外部编辑依赖指纹变化失效。
let cachedSettings: RawSettings | null = null;
let cachedSettingsMtime = 0;

function settingsCacheFingerprint(): number {
  try { return fs.statSync(settingsFile()).mtimeMs; } catch { /* settings.json 尚不存在 */ }
  return 0;
}

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
  const mtime = settingsCacheFingerprint();
  if (cachedSettings && cachedSettingsMtime === mtime) return cachedSettings;
  const loaded = readSettingsFromDisk();
  cachedSettings = loaded;
  cachedSettingsMtime = mtime;
  return loaded;
}

function readSettingsFromDisk(): RawSettings {
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
  // 写入的内容即最新解析结果，直接同步缓存，避免同毫秒内的下一次读取
  // 命中旧 mtime 指纹而拿到过期值。
  cachedSettings = next;
  cachedSettingsMtime = settingsCacheFingerprint();
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
    throw new Error(messages.desktopErrors.root.privateConflict);
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
 * Set the openmind root. Persists `openmindRoot`. Unknown legacy keys (such
 * as the pre-release v1 `repoRoot`) are ignored on read and left as-is.
 */
function setOpenmindRoot(candidate: string): string {
  const canonical = canonicalDirectory(normalizeRepoRoot(candidate));
  if (!canonical) {
    throw new Error(messages.errors.repo.invalidDirectory);
  }
  assertRootDoesNotConflict(canonical, resolveWorkspaceRoot());
  const current = loadSettings();
  const previous = typeof current.openmindRoot === "string" ? canonicalDirectory(current.openmindRoot) : null;
  const generation = Number.isInteger(current.openmindRootGeneration) && Number(current.openmindRootGeneration) > 0
    ? Number(current.openmindRootGeneration) + (previous === canonical ? 0 : 1)
    : 1;
  saveSettings({ ...current, openmindRoot: canonical, openmindRootGeneration: generation });
  invalidateRootCache();
  return canonical;
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
 * Legacy code-workspace resolver. Provider execution no longer uses this as a
 * filesystem authority: Main roots AI sessions exclusively at openmindRoot.
 * Keep the fallback and stored preference for wire/settings migration.
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
  const canonicalRoot = canonicalDirectory(normalized);
  const inspected = new OpenmindLocationService({ paths: appPaths(), activeRunCount: () => activeRunCount })
    .inspect(canonicalRoot || normalized);
  const blockingReasons = [...inspected.warnings];
  if (!canonicalRoot) {
    blockingReasons.unshift(messages.desktopErrors.root.candidateInvalid);
  } else if (
    canonicalDirectory(path.join(canonicalRoot, "openmind"))
    || (path.basename(canonicalRoot).toLowerCase() === "openmind"
      && (fs.existsSync(path.join(path.dirname(canonicalRoot), "config")) || fs.existsSync(path.join(path.dirname(canonicalRoot), ".git"))))
  ) {
    blockingReasons.unshift(messages.desktopErrors.root.legacyLayout);
  }
  if (!inspected.readable && !blockingReasons.includes(messages.desktopErrors.root.unreadable)) blockingReasons.push(messages.desktopErrors.root.unreadable);
  if (!inspected.writable && !blockingReasons.includes(messages.desktopErrors.root.unwritable)) blockingReasons.push(messages.desktopErrors.root.unwritable);
  if (activeRunCount > 0) blockingReasons.push(messages.desktopErrors.root.activeTasks);
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
 * Return the selected private data repository/content root. With no explicit
 * binding this falls back to the dev checkout parent for legacy diagnostics.
 */
function findRepoRoot(): string {
  const openmind = resolveOpenmindRoot();
  if (openmind) return normalizeRepoRoot(openmind);
  return normalizeRepoRoot(path.resolve(APP_ROOT, ".."));
}

function ensureInsideRepo(relativeOrAbsolute: string): string {
  const raw = String(relativeOrAbsolute || "");
  const logical = raw.replaceAll("\\", "/");
  const openmind = resolveOpenmindRoot();
  const isOpenmindPath = logical === "openmind" || logical.startsWith("openmind/");
  if (isOpenmindPath && openmind) {
    const resolved = resolveOpenmindPath(logical);
    assertOutsideAppManagedProjects(openmind, resolved, logical);
    return resolved;
  }
  const base = resolveWorkspaceRoot() || findRepoRoot();
  const candidate = raw;
  const resolved = path.resolve(base, candidate);
  const canonical = resolvePathInsideCanonicalRoot(base, resolved, messages.errors.repo.pathOutsideProject);
  if (openmind) assertOutsideAppManagedProjects(openmind, canonical, logical);
  return canonical;
}

/** Resolve a read-only Workspace/Context path without hiding Project data. */
function ensureInsideRepoReadable(relativeOrAbsolute: string): string {
  const raw = String(relativeOrAbsolute || "");
  const logical = raw.replaceAll("\\", "/");
  const openmind = resolveOpenmindRoot();
  const isOpenmindPath = logical === "openmind" || logical.startsWith("openmind/");
  if (isOpenmindPath && openmind) return resolveOpenmindPath(logical, "read");
  const base = resolveWorkspaceRoot() || findRepoRoot();
  const resolved = path.resolve(base, raw);
  return resolvePathInsideCanonicalRoot(base, resolved, messages.errors.repo.pathOutsideProject);
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
  assertOutsideAppManagedProjects(openmind, resolved);
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
  uiLanguage: "zh-CN",
  density: "default",
  fontSize: "default",
  autoSaveIntervalMs: 30000,
  maxVersions: 50,
  archiveAfterDays: 90,
  defaultReadFilter: "all",
  contentPreviewMode: "sidebar",
  markReadOnOpen: true,
  defaultProvider: "",
  youtubeBrowser: "",
  defaultPermissionProfile: "auto",
  notesDir: "openmind",
  destructiveOpsRequireApproval: true,
  riskScanEnabled: true,
  defaultPlatform: zhCN.settings.defaultPlatform,
  defaultLanguage: "zh-CN",
  defaultContentLength: "medium",
  defaultTemplate: "",
  userTags: [],
  workflowAutoSaveDraft: true,
  workflowAutoVersionOnStageChange: true,
  workflowReviewRequiredForReady: true,
  workflowPublishChecklistEnabled: true,
  workflowAutoArchiveEnabled: false
};

// normalizePreferences 的结果与 loadSettings 返回的对象一一对应；对象引用
// 不变（缓存命中）时直接复用，迁移写回只在首次或外部改动后发生一次。
let cachedPreferences: { source: RawSettings; value: UserPreferences } | null = null;

function getPreferences(): UserPreferences {
  const raw = loadSettings();
  if (cachedPreferences?.source === raw) return cachedPreferences.value;
  const migrated = normalizePreferences(raw, false);
  const persisted: RawSettings = { ...raw, ...migrated };
  delete persisted.browserAutomationEnabled;
  delete persisted.browserReuseExistingTabs;
  delete persisted.browserEvidenceDir;
  if (JSON.stringify(persisted) !== JSON.stringify(raw)) {
    saveSettings(persisted);
    // 一次性迁移写回后不建立缓存：下一次调用以写回后的最新内容重建基准。
    cachedPreferences = null;
    return migrated;
  }
  cachedPreferences = { source: raw, value: migrated };
  return migrated;
}

function updatePreferences(patch: UserPreferencesPatch): UserPreferences {
  if ("openmindRoot" in patch || "workspaceRoot" in patch || "schemaVersion" in patch) {
    throw new Error(messages.desktopErrors.root.dedicatedPicker);
  }
  const current = loadSettings();
  const preferences = getPreferences();
  // Preserve root settings across a partial update: a preference patch must
  // not wipe openmindRoot/workspaceRoot. Explicit root changes go through
  // setOpenmindRoot/setWorkspaceRoot, not updatePreferences.
  const preserveRoots = {
    openmindRoot: current.openmindRoot ?? preferences.openmindRoot ?? "",
    workspaceRoot: current.workspaceRoot ?? preferences.workspaceRoot ?? ""
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

function normalizePreferences(raw: unknown, strict: boolean): UserPreferences {
  const source = raw && typeof raw === "object" ? raw as RawSettings : {};
  const storedSchemaVersion = typeof source.schemaVersion === "number" && Number.isInteger(source.schemaVersion)
    ? source.schemaVersion
    : 0;
  const storedPermissionProfile = storedSchemaVersion < 3 && source.defaultPermissionProfile === "edit"
    ? undefined
    : source.defaultPermissionProfile;
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    openmindRoot: stringPref(source.openmindRoot, DEFAULT_PREFERENCES.openmindRoot, strict, "openmindRoot", 4096),
    workspaceRoot: stringPref(source.workspaceRoot, DEFAULT_PREFERENCES.workspaceRoot, strict, "workspaceRoot", 4096),
    themeMode: enumPref(source.themeMode, ["dark", "light"], DEFAULT_PREFERENCES.themeMode, strict, "themeMode"),
    uiLanguage: enumPref(source.uiLanguage, ["zh-CN", "en"], DEFAULT_PREFERENCES.uiLanguage, strict, "uiLanguage"),
    density: enumPref(source.density, ["compact", "default", "comfortable"], DEFAULT_PREFERENCES.density, strict, "density"),
    fontSize: enumPref(source.fontSize, ["small", "default", "large"], DEFAULT_PREFERENCES.fontSize, strict, "fontSize"),
    autoSaveIntervalMs: intPref(source.autoSaveIntervalMs, 5000, 600000, DEFAULT_PREFERENCES.autoSaveIntervalMs, strict, "autoSaveIntervalMs"),
    maxVersions: intPref(source.maxVersions, 3, 200, DEFAULT_PREFERENCES.maxVersions, strict, "maxVersions"),
    archiveAfterDays: intPref(source.archiveAfterDays, 7, 365, DEFAULT_PREFERENCES.archiveAfterDays, strict, "archiveAfterDays"),
    defaultReadFilter: enumPref(source.defaultReadFilter, ["all", "unread", "read"], DEFAULT_PREFERENCES.defaultReadFilter, strict, "defaultReadFilter"),
    contentPreviewMode: enumPref(source.contentPreviewMode, ["inline", "sidebar"], DEFAULT_PREFERENCES.contentPreviewMode, strict, "contentPreviewMode"),
    markReadOnOpen: boolPref(source.markReadOnOpen, DEFAULT_PREFERENCES.markReadOnOpen, strict, "markReadOnOpen"),
    defaultProvider: stringPref(source.defaultProvider, DEFAULT_PREFERENCES.defaultProvider, strict, "defaultProvider", 200),
    youtubeBrowser: enumPref(source.youtubeBrowser, ["", ...YOUTUBE_COOKIE_BROWSERS], DEFAULT_PREFERENCES.youtubeBrowser, strict, "youtubeBrowser"),
    defaultPermissionProfile: enumPref(storedPermissionProfile, ["read-only", "edit", "auto"], DEFAULT_PREFERENCES.defaultPermissionProfile, strict, "defaultPermissionProfile"),
    notesDir: stringPref(source.notesDir, DEFAULT_PREFERENCES.notesDir, strict, "notesDir", 4096),
    destructiveOpsRequireApproval: boolPref(source.destructiveOpsRequireApproval, DEFAULT_PREFERENCES.destructiveOpsRequireApproval, strict, "destructiveOpsRequireApproval"),
    riskScanEnabled: boolPref(source.riskScanEnabled, DEFAULT_PREFERENCES.riskScanEnabled, strict, "riskScanEnabled"),
    defaultPlatform: stringPref(source.defaultPlatform, DEFAULT_PREFERENCES.defaultPlatform, strict, "defaultPlatform", 80),
    defaultLanguage: enumPref(source.defaultLanguage, ["zh-CN", "en"], DEFAULT_PREFERENCES.defaultLanguage, strict, "defaultLanguage"),
    defaultContentLength: enumPref(source.defaultContentLength, ["short", "medium", "long"], DEFAULT_PREFERENCES.defaultContentLength, strict, "defaultContentLength"),
    defaultTemplate: stringPref(source.defaultTemplate, DEFAULT_PREFERENCES.defaultTemplate, strict, "defaultTemplate", 4096),
    userTags: tagsPref(source.userTags, strict),
    workflowAutoSaveDraft: boolPref(source.workflowAutoSaveDraft, DEFAULT_PREFERENCES.workflowAutoSaveDraft, strict, "workflowAutoSaveDraft"),
    workflowAutoVersionOnStageChange: boolPref(source.workflowAutoVersionOnStageChange, DEFAULT_PREFERENCES.workflowAutoVersionOnStageChange, strict, "workflowAutoVersionOnStageChange"),
    workflowReviewRequiredForReady: boolPref(source.workflowReviewRequiredForReady, DEFAULT_PREFERENCES.workflowReviewRequiredForReady, strict, "workflowReviewRequiredForReady"),
    workflowPublishChecklistEnabled: boolPref(source.workflowPublishChecklistEnabled, DEFAULT_PREFERENCES.workflowPublishChecklistEnabled, strict, "workflowPublishChecklistEnabled"),
    workflowAutoArchiveEnabled: boolPref(source.workflowAutoArchiveEnabled, DEFAULT_PREFERENCES.workflowAutoArchiveEnabled, strict, "workflowAutoArchiveEnabled")
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
    theme: ["themeMode", "uiLanguage", "density", "fontSize"],
    save: ["autoSaveIntervalMs", "maxVersions", "archiveAfterDays"],
    content: ["defaultReadFilter", "contentPreviewMode", "markReadOnOpen"],
    ai: ["defaultProvider", "defaultPermissionProfile", "destructiveOpsRequireApproval", "riskScanEnabled"],
    project: ["notesDir"],
    creative: ["defaultPlatform", "defaultLanguage", "defaultContentLength", "defaultTemplate"],
    tags: ["userTags"],
    workflow: ["autoSaveIntervalMs", "archiveAfterDays", "workflowAutoSaveDraft", "workflowAutoVersionOnStageChange", "workflowReviewRequiredForReady", "workflowPublishChecklistEnabled", "workflowAutoArchiveEnabled"]
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
  ensureInsideRepoReadable,
  resolveOpenmindPath,
  relativeToOpenmind,
  getPreferences,
  updatePreferences,
  resetPreferences,
};
