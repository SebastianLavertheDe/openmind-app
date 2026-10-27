import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildAppPaths, resolveSkillStoreRoot } from "../paths/app-paths-service";
import { SkillPackageService } from "../skills/skill-package-service";
import { installBuiltinDefault } from "../skills/builtin-default-packages";
import { SharedPythonRuntimeService } from "../runtime/shared-python-runtime";
import { listInstalledPythonProjects } from "../runtime/installed-python-projects";
import { RuntimeManager } from "../runtime/runtime-manager";
import { InstalledSkillExecutionResolver } from "../skills/installed-skill-execution-resolver";
import { SkillToolRegistry } from "../ai/skill-tool-registry";
import { RssRepository } from "../rss/rss-repository";
import { readRssCatalog } from "../rss/rss-service";
import { computeRootId } from "../paths/openmind-path-resolver";
import { waitForRssMutation } from "../rss/file-lock";
import { readCommandResult } from "./command-result";

/** Run with Node or Electron's RUN_AS_NODE launcher: no app/window/display initialization. */
export async function runCommand(argv: string[]): Promise<number> {
  const [area, command, ...rest] = argv;
  if (area === "--help" || !area) {
    process.stdout.write("openmind rss sync|collect|pipeline --root ABSOLUTE --user-data ABSOLUTE [--date YYYYMMDD] [--source-id ID]\nopenmind brief generate --root ABSOLUTE --user-data ABSOLUTE [--date YYYYMMDD] [--topics]\nopenmind runtime prepare --root ABSOLUTE --user-data ABSOLUTE [--browser]\n");
    return 0;
  }
  if (!(area === "rss" && ["sync", "collect", "pipeline"].includes(command) || area === "brief" && command === "generate" || area === "runtime" && command === "prepare")) throw new Error("Unknown command. Use --help.");
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key === "--topics" || key === "--browser") { options.set(key, "true"); continue; }
    if (!["--root", "--user-data", "--date", "--source-id"].includes(key) || !rest[i + 1] || rest[i + 1].startsWith("--")) throw new Error(`Invalid argument: ${key}`);
    options.set(key, rest[++i]);
  }
  const rootArgument = options.get("--root") || "", dataArgument = options.get("--user-data") || "";
  if (!path.isAbsolute(rootArgument) || !path.isAbsolute(dataArgument)) throw new Error("--root and --user-data must be explicit absolute paths.");
  const root = fs.realpathSync(rootArgument);
  let userData = path.resolve(dataArgument);
  if (!fs.statSync(root).isDirectory() || userData === root || userData.startsWith(root + path.sep) || root.startsWith(userData + path.sep)) throw new Error("Content and application data directories must be separate.");
  fs.mkdirSync(userData, { recursive: true });
  userData = fs.realpathSync(userData);
  if (userData === root || userData.startsWith(root + path.sep) || root.startsWith(userData + path.sep)) throw new Error("Content and application data directories must be separate.");
  process.env.OPENMIND_USER_DATA_DIR = userData;
  // Resources are adjacent to app.asar in packaged distributions.
  const resources = __dirname.includes("app.asar") ? __dirname.slice(0, __dirname.indexOf("app.asar")) : path.resolve(__dirname, "../../../../resources");
  process.env.OPENMIND_SKILL_LIBRARY_BUNDLE ||= __dirname.includes("app.asar") ? path.join(resources, "skill-library") : path.resolve(__dirname, "../../../skill-library");
  process.env.OPENMIND_PYTHON_RUNTIME_ASSET_ROOT ||= path.join(resources, "python-runtime");
  const paths = buildAppPaths(userData, resolveSkillStoreRoot(root));
  const packages = new SkillPackageService(paths);
  const repository = new RssRepository(root, readRssCatalog(), [path.join(paths.state, computeRootId(root), ".openmind")]);
  if (area === "rss") await waitForRssMutation(() => repository.read());
  const id = area === "rss" || area === "runtime" ? "rss-article-saver" : options.has("--topics") ? "daily-topic-selector" : "daily-article-summarizer";
  const record = await waitForRssMutation(() => installBuiltinDefault(packages, id));
  if (!packages.isEnabled(record)) throw new Error(`Skill ${id} is disabled. Enable it in Skill settings.`);
  const python = new SharedPythonRuntimeService(paths, { projects: () => listInstalledPythonProjects(packages) });
  if (area === "runtime") {
    const status = await python.setEnabled(true);
    if (options.has("--browser")) await new Promise<void>((resolve, reject) => {
      const child = spawn(python.readyExecutable()!, ["-m", "playwright", "install", "chromium"], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(paths.runtimes, "browser-playwright") }, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
      child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error("Browser runtime installation failed.")));
    });
    process.stdout.write(JSON.stringify(status) + "\n"); return status.ready ? 0 : 1;
  }
  const resolver = new InstalledSkillExecutionResolver(packages, new RuntimeManager(paths, { sharedPython: python }), root, 1);
  const registry = new SkillToolRegistry(root, { paths, openmindRoot: root, rootGeneration: 1, installedResolver: resolver });
  const date = options.get("--date") || new Date().toLocaleDateString("sv-SE").replace(/-/g, "");
  const run = registry.submitRun({ skillId: id, inputs: { date, ...(area === "rss" ? { mode: command, sourceId: options.get("--source-id") || "" } : {}) }, trigger: { type: "manual" }, providerBindings: {}, externalExportBindingIds: [], rootGeneration: 1 });
  const stop = () => { void registry.cancelRun(run.id); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    for (;;) {
      const current = registry.getRun(run.id);
      if (current.terminalState) {
        const result = readCommandResult(path.join(paths.runs, run.id, "work"), registry.getRunEvents(run.id));
        process.stdout.write(JSON.stringify({ runId: run.id, status: current.terminalState, error: current.error, result, artifacts: current.artifacts }) + "\n");
        return current.terminalState === "succeeded" ? 0 : 1;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally { process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}

if (require.main === module) void runCommand(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n"); process.exitCode = 1;
});
