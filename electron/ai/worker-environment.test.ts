import { describe, expect, it } from "vitest";
import { AI_WORKER_BASE_ENV_KEYS, AI_WORKER_EXPLICIT_ENV_KEYS, buildAiWorkerEnvironment } from "./worker-environment";

describe("AI Worker environment", () => {
  it("copies only the platform baseline and explicit host-owned values", () => {
    const environment = buildAiWorkerEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/test",
      USERPROFILE: "C:\\Users\\test",
      TZ: "Asia/Shanghai",
      OPENAI_API_KEY: "should-not-cross",
      PLAYWRIGHT_MCP_EXTENSION_TOKEN: "should-not-cross",
      OPENMIND_STATE_ROOT: "/untrusted/parent-state",
      OPENMIND_ELECTRON_EXECUTABLE: "/untrusted/runtime",
      NODE_OPTIONS: "--require=/tmp/injected.js",
      PYTHONPATH: "/tmp/injected-python",
      LD_PRELOAD: "/tmp/injected.so",
      CUSTOM_ENV: "should-not-cross"
    }, {
      OPENMIND_REPO_ROOT: "/workspace",
      OPENMIND_USER_DATA_DIR: "/app-user-data",
      OPENMIND_SKILL_LIBRARY_BUNDLE: "/app-resources/skill-library",
      OPENMIND_ELECTRON_EXECUTABLE: "/app/OpenMind",
      OPENMIND_BROWSER_SKILL_CLI: "/tools/bsk",
      BSK_HOME: "/browser-runtime"
    });

    expect(environment).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/home/test",
      USERPROFILE: "C:\\Users\\test",
      TZ: "Asia/Shanghai",
      OPENMIND_REPO_ROOT: "/workspace",
      OPENMIND_USER_DATA_DIR: "/app-user-data",
      OPENMIND_SKILL_LIBRARY_BUNDLE: "/app-resources/skill-library",
      OPENMIND_ELECTRON_EXECUTABLE: "/app/OpenMind",
      OPENMIND_BROWSER_SKILL_CLI: "/tools/bsk",
      BSK_HOME: "/browser-runtime"
    });
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("PLAYWRIGHT_MCP_EXTENSION_TOKEN");
    expect(environment).not.toHaveProperty("OPENMIND_STATE_ROOT");
    expect(environment).not.toHaveProperty("CUSTOM_ENV");
    expect(environment).not.toHaveProperty("NODE_OPTIONS");
    expect(environment).not.toHaveProperty("PYTHONPATH");
    expect(environment).not.toHaveProperty("LD_PRELOAD");
  });

  it("preserves the Windows Path spelling when that is the available baseline", () => {
    expect(buildAiWorkerEnvironment({ Path: "C:\\Windows\\System32" })).toEqual({
      Path: "C:\\Windows\\System32"
    });
  });

  it("does not add undefined explicit values", () => {
    expect(buildAiWorkerEnvironment({}, { OPENMIND_STATE_ROOT: undefined })).toEqual({});
  });

  it("rejects explicit provider, loader and crash-diagnostic overrides", () => {
    const forbiddenKeys = [
      "OPENAI_API_KEY",
      "PLAYWRIGHT_MCP_EXTENSION_TOKEN",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "NVIDIA_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "SENTRY_DSN",
      "BUGSNAG_API_KEY",
      "ROLLBAR_ACCESS_TOKEN",
      "NODE_OPTIONS",
      "NODE_PATH",
      "PYTHONPATH",
      "PYTHONHOME",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "ELECTRON_CRASH_REPORTER_UPLOAD_TO_SERVER",
      "DIAGNOSTIC_DIR",
      "HEAPDUMP_DIR"
    ];
    const baseKeys = new Set<string>(AI_WORKER_BASE_ENV_KEYS);
    const explicitKeys = new Set<string>(AI_WORKER_EXPLICIT_ENV_KEYS);
    expect(forbiddenKeys.some((key) => baseKeys.has(key))).toBe(false);
    expect(forbiddenKeys.some((key) => explicitKeys.has(key))).toBe(false);
    for (const key of forbiddenKeys) {
      expect(() => buildAiWorkerEnvironment({}, { [key]: "blocked" })).toThrow(/白名单/);
    }
  });
});
