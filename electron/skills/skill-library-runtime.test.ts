import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAppPaths } from "../paths/app-paths-service";
import { resolveSkillLibraryTools } from "./skill-library-runtime";

vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawnSync: vi.fn(() => ({ status: 1, stdout: "" })) }));
vi.mock("../runtime/shared-python-runtime", () => ({ SharedPythonRuntimeService: class { readyExecutable() { return null; } } }));
vi.mock("../install/youtube-tools-service", () => ({ YoutubeToolsService: class { candidateTool() { return null; } } }));
afterEach(() => { vi.unstubAllEnvs(); });

describe("Skill library runtime", () => {
  it("passes the main app executable to Skills even in a utility process", () => {
    const paths = buildAppPaths("/fixture/state", "/fixture/skills");
    vi.stubEnv("OPENMIND_ELECTRON_EXECUTABLE", undefined);
    expect(resolveSkillLibraryTools(paths).electron).toBe(process.execPath);
    vi.stubEnv("OPENMIND_ELECTRON_EXECUTABLE", "/Applications/OpenMind.app/Contents/MacOS/OpenMind");
    expect(resolveSkillLibraryTools(paths).electron).toBe("/Applications/OpenMind.app/Contents/MacOS/OpenMind");
  });
});
