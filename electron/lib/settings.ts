import { app } from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentDiagnostic, UserPreferences } from "../../shared/contracts";
import { messages } from "../../shared/messages";

const electronApp = app;

const APP_ROOT = path.resolve(__dirname, "..", "..");

type WslRepoPath = { distro: string; linuxPath: string };
type RawSettings = Record<string, unknown>;

// 进程内缓存的 repoRoot，按指纹（settings.json mtime + CCTOOLS_REPO_ROOT + cwd）失效，
// 避免每个 IPC、甚至每个文件都重新读 settings.json + 多次 existsSync。
let cachedRepoRoot: string | null = null;
let cachedFingerprint: string | null = null;

function repoCacheFingerprint(): string {
  let mtime = 0;
  try { mtime = fs.statSync(settingsFile()).mtimeMs; } catch { /* settings.json 尚不存在 */ }
  return `${process.env.CCTOOLS_REPO_ROOT || ""}\0${process.cwd()}\0${mtime}`;
}

function settingsFile(): string {
  const userData = electronApp?.getPath ? electronApp.getPath("userData") : process.env.CCTOOLS_USER_DATA_DIR || path.join(os.tmpdir(), "cctools-desktop");
  return path.join(userData, "settings.json");
}

function loadSettings(): RawSettings {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as RawSettings;
  } catch {
    return {};
  }
}

function saveSettings(next: RawSettings): RawSettings {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function looksLikeRepo(candidate: unknown): boolean {
  return Boolean(
    candidate &&
      typeof candidate === "string" &&
      fs.existsSync(path.join(candidate, ".claude", "skills")) &&
      fs.existsSync(path.join(candidate, "mymind"))
  );
}

function normalizeRepoRoot(candidate: unknown): string {
  return path.normalize(String(candidate || "").trim().replace(/^["']|["']$/g, ""));
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

function setRepoRoot(candidate: string): string {
  const repoRoot = normalizeRepoRoot(candidate);
  if (!looksLikeRepo(repoRoot)) {
    throw new Error(messages.errors.repo.invalidDirectory);
  }
  saveSettings({ ...loadSettings(), repoRoot });
  return repoRoot;
}

function detectRepoRoot(): string {
  const candidates = [
    process.env.CCTOOLS_REPO_ROOT,
    path.resolve(APP_ROOT, ".."),
    process.cwd(),
    "\\\\wsl.localhost\\Ubuntu\\home\\say\\work\\github\\cctools",
    "\\\\wsl$\\Ubuntu\\home\\say\\work\\github\\cctools",
    "D:\\work\\cctools"
  ];
  const repoRoot = candidates.map(normalizeRepoRoot).find(looksLikeRepo);
  if (!repoRoot) throw new Error(messages.errors.repo.notAutoDetected);
  return setRepoRoot(repoRoot);
}

function findRepoRoot(): string {
  const fingerprint = repoCacheFingerprint();
  if (cachedRepoRoot && cachedFingerprint === fingerprint) return cachedRepoRoot;
  const settings = loadSettings();
  const candidates = [
    settings.repoRoot,
    process.env.CCTOOLS_REPO_ROOT,
    path.resolve(APP_ROOT, ".."),
    process.cwd(),
    "\\\\wsl.localhost\\Ubuntu\\home\\say\\work\\github\\cctools",
    "\\\\wsl$\\Ubuntu\\home\\say\\work\\github\\cctools",
    "D:\\work\\cctools"
  ];
  for (const candidate of candidates) {
    if (looksLikeRepo(candidate)) {
      cachedRepoRoot = normalizeRepoRoot(candidate);
      cachedFingerprint = fingerprint;
      return cachedRepoRoot;
    }
  }
  cachedRepoRoot = normalizeRepoRoot(settings.repoRoot || path.resolve(APP_ROOT, ".."));
  cachedFingerprint = fingerprint;
  return cachedRepoRoot;
}

function ensureInsideRepo(relativeOrAbsolute: string): string {
  const repoRoot = findRepoRoot();
  const resolved = path.resolve(repoRoot, relativeOrAbsolute);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(messages.errors.repo.pathOutsideProject);
  }
  return resolved;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  schemaVersion: 1,
  repoRoot: "",
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
  browserEvidenceDir: ".cctools/browser-evidence",
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
  if (JSON.stringify(migrated) !== JSON.stringify({ ...raw, schemaVersion: 1, repoRoot: raw.repoRoot || "" })) {
    saveSettings({ ...raw, ...migrated });
  }
  return migrated;
}

function updatePreferences(patch: Partial<UserPreferences>): UserPreferences {
  const current = loadSettings();
  const preferences = getPreferences();
  const next = normalizePreferences({ ...preferences, ...patch, repoRoot: patch?.repoRoot || current.repoRoot || preferences.repoRoot || "" }, true);
  saveSettings({ ...current, ...next });
  return getPreferences();
}

function resetPreferences(section?: string): UserPreferences {
  const current = loadSettings();
  if (!section) {
    saveSettings({ repoRoot: current.repoRoot || "" });
    return getPreferences();
  }
  const defaults: RawSettings = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    if (startsWithPrefix(key, section)) defaults[key] = DEFAULT_PREFERENCES[key as keyof UserPreferences];
  }
  saveSettings({ ...current, ...defaults, repoRoot: current.repoRoot || "" });
  return getPreferences();
}

function importPreferences(filePath: string): { imported: true; preferences: UserPreferences } {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as RawSettings;
  const current = loadSettings();
  const next = normalizePreferences({
    ...raw,
    repoRoot: typeof raw.repoRoot === "string" && (!raw.repoRoot || looksLikeRepo(raw.repoRoot))
      ? raw.repoRoot
      : current.repoRoot || ""
  }, true);
  saveSettings({ ...current, ...next });
  return { imported: true, preferences: getPreferences() };
}

function normalizePreferences(raw: unknown, strict: boolean): UserPreferences {
  const source = raw && typeof raw === "object" ? raw as RawSettings : {};
  return {
    schemaVersion: 1,
    repoRoot: stringPref(source.repoRoot, DEFAULT_PREFERENCES.repoRoot, strict, "repoRoot", 4096),
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
    browserEvidenceDir: safeRelativePathPref(source.browserEvidenceDir, DEFAULT_PREFERENCES.browserEvidenceDir, strict, "browserEvidenceDir"),
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

function getEnvironmentDiagnostics(): EnvironmentDiagnostic[] {
  const repoRoot = findRepoRoot();
  const wsl = parseWslRepoPath(repoRoot);
  const skillsDir = path.join(repoRoot, ".claude", "skills");
  const skillCount = safeList(skillsDir).filter((entry) => fs.existsSync(path.join(skillsDir, entry, "SKILL.md"))).length;
  return [
    diagnostic("repo", messages.diagnostics.repo.label, looksLikeRepo(repoRoot), repoRoot, looksLikeRepo(repoRoot) ? null : messages.diagnostics.repo.missingDetail, repoRoot),
    diagnostic("node", "Node.js", true, process.version, null, null),
    commandDiagnostic("python", "Python", [["python3", ["--version"]], ["python", ["--version"]]]),
    commandDiagnostic("uv", "uv", [["uv", ["--version"]]]),
    commandDiagnostic("git", "Git", [["git", ["--version"]]]),
    diagnostic("wsl", messages.diagnostics.wsl.label, Boolean(wsl) || process.platform !== "win32", wsl ? `${wsl.distro} · ${wsl.linuxPath}` : process.platform === "win32" ? messages.diagnostics.wsl.notConnected : messages.diagnostics.wsl.notWindows, wsl || process.platform !== "win32" ? null : messages.diagnostics.wsl.hint, null),
    diagnostic("skills", messages.diagnostics.skills.label, skillCount > 0, messages.diagnostics.skills.count(skillCount), skillCount > 0 ? null : messages.diagnostics.skills.missingDetail, skillsDir)
  ];
}

function diagnostic(id: string, label: string, ok: boolean, value: unknown, detail: string | null, targetPath: string | null): EnvironmentDiagnostic {
  return { id, label, status: ok ? "ok" : "warning", value: String(value || ""), detail, path: targetPath };
}

function commandDiagnostic(id: string, label: string, commands: ReadonlyArray<readonly [string, readonly string[]]>): EnvironmentDiagnostic {
  for (const [command, args] of commands) {
    try {
      const output = execFileSync(command, args as string[], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }).trim();
      return { id, label, status: "ok", value: output.split(/\r?\n/)[0], detail: null, path: command };
    } catch { /* try next */ }
  }
  return { id, label, status: "warning", value: messages.diagnostics.command.notDetected, detail: messages.diagnostics.command.notInPath(label), path: null };
}

function safeList(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
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
  normalizeRepoRoot,
  parseWslRepoPath,
  setRepoRoot,
  detectRepoRoot,
  findRepoRoot,
  ensureInsideRepo,
  getPreferences,
  updatePreferences,
  resetPreferences,
  importPreferences,
  getEnvironmentDiagnostics
};
