/**
 * Environment inherited by the App-owned AI Worker.
 *
 * The Worker still needs ordinary OS/runtime context for provider discovery,
 * CLI launches and user configuration lookup. It must not, however, become a
 * copy of the shell that started the App: that shell may contain provider
 * keys, browser tokens or dangerous loader/configuration variables.
 */
export const AI_WORKER_BASE_ENV_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "TMP",
  "TEMP",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR"
] as const;

/**
 * Values that Main may deliberately add for the Worker/browser helper.
 *
 * Keep this list closed.  A generic `explicitOverrides` escape hatch would
 * allow a future caller to re-introduce provider credentials, loader hooks or
 * crash/diagnostic uploader configuration after the inherited environment was
 * filtered.
 */
export const AI_WORKER_EXPLICIT_ENV_KEYS = [
  "PATH",
  "OPENMIND_REPO_ROOT",
  "OPENMIND_USER_DATA_DIR",
  "OPENMIND_UI_LANGUAGE",
  "OPENMIND_STATE_ROOT",
  "OPENMIND_ROOT",
  "OPENMIND_ROOT_GENERATION",
  "OPENMIND_PYTHON_RUNTIME_ASSET_ROOT",
  "OPENMIND_SKILL_LIBRARY_BUNDLE",
  "OPENMIND_BROWSER_SKILL_CLI",
  "BSK_HOME",
  "BSK_AUTO_START",
  "BSK_BROWSER_WAIT_MS",
  "ELECTRON_RUN_AS_NODE",
] as const;

const aiWorkerExplicitEnvKeys = new Set<string>(AI_WORKER_EXPLICIT_ENV_KEYS);

export function buildAiWorkerEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  explicitOverrides: NodeJS.ProcessEnv = {}
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of AI_WORKER_BASE_ENV_KEYS) {
    const value = baseEnvironment[key];
    if (typeof value === "string") environment[key] = value;
  }
  for (const [key, value] of Object.entries(explicitOverrides)) {
    if (value === undefined) continue;
    if (!aiWorkerExplicitEnvKeys.has(key)) {
      throw new Error(`AI Worker 环境变量不在宿主显式白名单中：${key}`);
    }
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}
