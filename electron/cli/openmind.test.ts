import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandInputs, parseCommand, SCHEDULED_SKILLS } from "./command-options";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), get: vi.fn(), resolve: vi.fn(), install: vi.fn(), prepare: vi.fn() }));
vi.mock("../skills/skill-package-service", () => ({ SkillPackageService: class { isEnabled() { return true; } } }));
vi.mock("../skills/builtin-default-packages", () => ({ installBuiltinDefault: mocks.install }));
vi.mock("../runtime/shared-python-runtime", () => ({ SharedPythonRuntimeService: class { setEnabled = mocks.prepare; } }));
vi.mock("../runtime/runtime-manager", () => ({ RuntimeManager: class {} }));
vi.mock("../skills/installed-skill-execution-resolver", () => ({ InstalledSkillExecutionResolver: class { resolve = mocks.resolve; } }));
vi.mock("../rss/rss-service", () => ({ readRssCatalog: () => ({ sources: [] }) }));
vi.mock("../ai/skill-tool-registry", () => ({ SkillToolRegistry: class {
  submitRun = mocks.submit; getRun = mocks.get; getRunEvents() { return []; } cancelRun = vi.fn();
} }));
import { runCommand } from "./openmind";

let directory: string;
let args: string[];
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ["OPENMIND_USER_DATA_DIR", "OPENMIND_SKILL_LIBRARY_BUNDLE", "OPENMIND_PYTHON_RUNTIME_ASSET_ROOT"]) vi.stubEnv(key, process.env[key]);
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-cli-"));
  fs.mkdirSync(path.join(directory, "content"));
  args = ["--root", path.join(directory, "content"), "--user-data", path.join(directory, "app")];
  mocks.submit.mockImplementation(request => ({ id: request.skillId }));
  mocks.get.mockReturnValue({ terminalState: "succeeded", artifacts: [] });
  mocks.resolve.mockResolvedValue({ process: { executable: "/fixture/python" }, skillHome: "/fixture/package", prepareRuntime: mocks.prepare });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); });

function writeResult(skillId: string, result: unknown) {
  const work = path.join(directory, "app", "runs", skillId, "work");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "result.json"), JSON.stringify(result));
}

const partialRssResult = { status: "partial", results: [
  { sourceId: "healthy", status: "succeeded", collected: 0 },
  { sourceId: "unavailable", status: "failed", error: { code: "http-error" } }
] };

describe("scheduled CLI commands", () => {
  it("runs RSS then summary with the same date and isolated inputs", async () => {
    expect(await runCommand(["rss", "pipeline", "--summarize", "--date", "20261030", ...args])).toBe(0);
    expect(mocks.submit.mock.calls.map(([r]) => [r.skillId, r.inputs])).toEqual([
      ["rss-article-saver", { date: "20261030", mode: "pipeline", sourceId: "" }],
      ["daily-article-summarizer", { date: "20261030" }]
    ]);
  });
  it("summarizes saved content after partial RSS failure and preserves the failed exit status", async () => {
    writeResult("rss-article-saver", partialRssResult);
    mocks.get.mockReturnValueOnce({ terminalState: "failed", error: "exit code 1", artifacts: [] });
    expect(await runCommand(["rss", "pipeline", "--summarize", "--date", "20261102", ...args])).toBe(1);
    expect(mocks.submit.mock.calls.map(([r]) => [r.skillId, r.inputs.date])).toEqual([
      ["rss-article-saver", "20261102"], ["daily-article-summarizer", "20261102"]
    ]);
    const output = vi.mocked(process.stdout.write).mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(output).toEqual([
      expect.objectContaining({ skillId: "rss-article-saver", status: "failed", result: partialRssResult }),
      expect.objectContaining({ skillId: "daily-article-summarizer", status: "succeeded" })
    ]);
  });
  it.each([
    undefined,
    { status: "failed", results: [{ status: "failed" }] },
    { status: "partial" },
    { status: "partial", results: [null, { status: "failed" }] }
  ])("stops the hourly chain without a usable partial collection result: %j", async result => {
    if (result !== undefined) writeResult("rss-article-saver", result);
    mocks.get.mockReturnValue({ terminalState: "failed", error: "collection failed", artifacts: [] });
    expect(await runCommand(["rss", "pipeline", "--summarize", ...args])).toBe(1);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it.each(["cancelled", "timed_out"])("stops after %s even if RSS wrote a partial result", async terminalState => {
    writeResult("rss-article-saver", partialRssResult);
    mocks.get.mockReturnValue({ terminalState, artifacts: [] });
    expect(await runCommand(["rss", "pipeline", "--summarize", ...args])).toBe(1);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("does not run a summary after SIGTERM at the end of a partial collection", async () => {
    writeResult("rss-article-saver", partialRssResult);
    mocks.get.mockImplementationOnce(() => {
      process.emit("SIGTERM");
      return { terminalState: "failed", artifacts: [] };
    });
    expect(await runCommand(["rss", "pipeline", "--summarize", ...args])).toBe(1);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("keeps standalone partial RSS collection failed", async () => {
    writeResult("rss-article-saver", partialRssResult);
    mocks.get.mockReturnValue({ terminalState: "failed", artifacts: [] });
    expect(await runCommand(["rss", "pipeline", ...args])).toBe(1);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("reports summary failure after continuing from partial collection", async () => {
    writeResult("rss-article-saver", partialRssResult);
    mocks.get.mockReturnValue({ terminalState: "failed", artifacts: [] });
    expect(await runCommand(["rss", "pipeline", "--summarize", ...args])).toBe(1);
    expect(mocks.submit.mock.calls.map(([r]) => r.skillId)).toEqual(["rss-article-saver", "daily-article-summarizer"]);
  });
  it("checks all stages without submitting or fetching content", async () => {
    expect(await runCommand(["rss", "pipeline", "--summarize", "--check", ...args])).toBe(0);
    expect(mocks.resolve.mock.calls.map(([r]) => r.skillId)).toEqual(["rss-article-saver", "daily-article-summarizer"]);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("prepares all scheduled dependencies together", async () => {
    mocks.prepare.mockResolvedValue({ ready: true });
    expect(await runCommand(["runtime", "prepare", "--scheduled", ...args])).toBe(0);
    expect(mocks.install.mock.calls.map(([, id]) => id)).toEqual(SCHEDULED_SKILLS);
  });
  it.each(["x", "reddit"])("routes %s collection to its own installed Skill", async area => {
    expect(await runCommand([area, "collect", ...args])).toBe(0);
    const request = mocks.submit.mock.calls[0][0];
    expect(request.skillId).toBe(area === "x" ? "x-following-fetcher" : "reddit-fetcher");
    expect(Object.keys(request.inputs)).toEqual(area === "x" ? [] : ["date"]);
  });
  it.each([
    ["x", "collect", "--topics"], ["reddit", "collect", "--source-id", "abc"],
    ["rss", "sync", "--summarize"], ["brief", "generate", "--date", "20260230"],
    ["runtime", "prepare", "--check"], ["x", "collect", "--check", "--check"]
  ])("rejects incompatible or invalid arguments: %s %s %s", (...argv) => {
    expect(() => parseCommand(argv)).toThrow();
    expect(mocks.install).not.toHaveBeenCalled();
  });
  it("keeps source filtering out of summary inputs", () => {
    expect(commandInputs("daily-article-summarizer", "pipeline", new Map([["--source-id", "one"]]), "20261030")).toEqual({ date: "20261030" });
  });
});
