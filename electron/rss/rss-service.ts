import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { RssDetectionSchema, type RssCatalog, type RssSourceInput, type RssSourcePatch } from "../../shared/rss-contracts";
import { SkillPackageService } from "../skills/skill-package-service";
import { installBuiltinDefault } from "../skills/builtin-default-packages";
import { resolveSkillLibraryBundleRoot } from "../skills/skill-library-catalog";
import { RuntimeManager } from "../runtime/runtime-manager";
import type { SharedPythonRuntimeService } from "../runtime/shared-python-runtime";
import { RssRepository } from "./rss-repository";

export function readRssCatalog(bundleRoot = resolveSkillLibraryBundleRoot()): RssCatalog {
  return JSON.parse(fs.readFileSync(path.join(bundleRoot, "rss-article-saver", "rss-catalog.json"), "utf8"));
}

/** Shared by IPC and the non-interactive command; never accesses an AI provider. */
export class RssService {
  readonly repository: RssRepository;
  constructor(root: string, private packages: SkillPackageService, private python: SharedPythonRuntimeService,
    private bundleRoot = resolveSkillLibraryBundleRoot(), legacyStateRoots: string[] = []) {
    this.repository = new RssRepository(root, readRssCatalog(bundleRoot), legacyStateRoots);
  }
  async detect(inputUrl: string, selectedFeedUrl?: string) {
    this.repository.read();
    const record = installBuiltinDefault(this.packages, "rss-article-saver", this.bundleRoot);
    const inspection = this.packages.inspectInstalledCopy(record);
    if (!inspection.valid || !inspection.manifest) throw new Error("RSS package integrity check failed.");
    const runtime = new RuntimeManager(this.packages.appPaths, { sharedPython: this.python }).resolve(inspection.manifest, record.packagePath, record.digest);
    await runtime.prepare();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(runtime.executable, [path.join(record.packagePath, "pipeline.py"), "--mode", "detect"], {
        cwd: record.packagePath, windowsHide: true, shell: false,
        env: { ...runtime.env, PLAYWRIGHT_BROWSERS_PATH: path.join(this.packages.appPaths.runtimes, "browser-playwright"), PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, PYTHONIOENCODING: "utf-8" }
      });
      let stdout = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("[timeout] 暂时无法访问该网站，可稍后重试。")); }, 65_000);
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.stdout.on("data", data => { stdout += data; if (stdout.length > 1024 * 1024) child.kill(); });
      child.stderr.resume();
      child.on("close", () => { clearTimeout(timer); resolve(stdout); });
      child.stdin.end(JSON.stringify({ url: inputUrl, selectedFeedUrl }));
    });
    let response;
    try { response = JSON.parse(output); } catch { throw new Error("[runtime-failed] RSS runtime returned no usable result; check runtime setup and retry."); }
    if (response.error) throw new Error(`[${response.error.code}] ${response.error.message}`);
    return RssDetectionSchema.parse(response);
  }
  async add(input: RssSourceInput) {
    const detected = await this.detect(input.inputUrl, input.selectedFeedUrl);
    if (detected.candidates.length > 1 && !detected.resolvedFeedUrl) throw new Error("Select a feed before saving.");
    return this.repository.add(input, detected);
  }
  async update(input: RssSourcePatch) {
    const current = this.repository.read().sources.find(row => row.id === input.id);
    const url = input.inputUrl || (input.selectedFeedUrl ? current?.inputUrl : undefined);
    const detected = url ? await this.detect(url, input.selectedFeedUrl) : undefined;
    if (detected && detected.candidates.length > 1 && !detected.resolvedFeedUrl) throw new Error("Select a feed before saving.");
    return this.repository.update(input, detected);
  }
}
