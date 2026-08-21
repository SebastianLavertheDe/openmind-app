import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAppPaths, ensureAppPaths, type AppPaths } from "../paths/app-paths-service";
import {
  SkillPackageError,
  SkillPackageService
} from "./skill-package-service";

const EXTERNAL_SKILLS_ROOT = path.resolve(
  process.env.OPENMIND_SKILLS_REPO_ROOT || path.resolve(__dirname, "../../../cctools-skills")
);
const realSkillIt = fs.existsSync(path.join(EXTERNAL_SKILLS_ROOT, "rss-article-saver", "cctools.skill.yaml")) ? it : it.skip;

const MANIFEST = `apiVersion: openmind.dev/skill/v1
id: example-skill
version: 1.0.0
publisher:
  id: openmind
  displayName: openmind
kind: process
display:
  name: Example Skill
  description: Static package fixture
  group: test
entrypoint:
  runtime: shell
  script: run.sh
  args: []
runtime:
  version: ">=3.11"
  dependencyFile: pyproject.toml
capabilities:
  openmind:
    read: [article/**]
    write: [daily-summary/**]
  network:
    required: false
    hosts: []
  subprocess:
    allowed: false
platforms: [linux-x64]
compatibility:
  minAppVersion: 1.0.0
`;

const CCTOOLS_MANIFEST = MANIFEST
  .replace("apiVersion: openmind.dev/skill/v1", "apiVersion: cctools.dev/skill/v1")
  .replace("  id: openmind\n  displayName: openmind", "  id: cctools\n  displayName: cctools")
  .replace("  openmind:\n", "  mymind:\n");

const AGENT_MANIFEST = `apiVersion: openmind.dev/skill/v1
id: catalog-agent
version: 1.0.0
publisher:
  id: openmind
  displayName: openmind
kind: agent
display:
  name: Catalog Agent
  description: Conversation-only fixture
  group: assistant
capabilities:
  openmind:
    read: []
    write: []
  network:
    required: false
    hosts: []
  subprocess:
    allowed: false
  browser: false
platforms: [linux-x64]
compatibility:
  minAppVersion: 1.0.0
`;

const WORKFLOW_MANIFEST = `apiVersion: openmind.dev/skill/v1
id: catalog-workflow
version: 2.0.0
publisher:
  id: openmind
  displayName: openmind
kind: workflow
display:
  name: Catalog Workflow
  description: Automation workflow fixture
  group: workflow
capabilities:
  openmind:
    read: []
    write: []
  network:
    required: false
    hosts: []
platforms: [linux-x64]
compatibility:
  minAppVersion: 1.0.0
workflow:
  steps:
    - id: run
      skill: example-skill
      version: "*"
      needs: []
      with: {}
`;

describe("SkillPackageService", () => {
  let tempRoot = "";
  let paths: AppPaths;
  let service: SkillPackageService;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-skill-package-"));
    paths = buildAppPaths(path.join(tempRoot, "user-data"), path.join(tempRoot, "openmind", ".agent", "skills"));
    ensureAppPaths(paths);
    service = new SkillPackageService(paths);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("inspects a directory, excludes user data, and produces a stable digest", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "#!/bin/sh\necho ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    fs.writeFileSync(path.join(source, ".env"), "NVIDIA_API_KEY=nvapi-secret\n");
    fs.mkdirSync(path.join(source, "venv"));
    fs.writeFileSync(path.join(source, "venv", "python"), "not-package-content");
    fs.mkdirSync(path.join(source, "openmind", "article"), { recursive: true });
    fs.writeFileSync(path.join(source, "openmind", "article", "user.md"), "must stay out");

    const first = service.inspect(source);
    const second = service.inspect(source);

    expect(first.valid).toBe(true);
    expect(first.digest).toBe(second.digest);
    expect(first.excludedPaths).toEqual(expect.arrayContaining([".env", "venv/", "openmind/", "openmind/article/", "openmind/article/user.md"]));
    expect(first.files.map((file) => file.path)).not.toContain(".env");
    expect(first.files.map((file) => file.path)).not.toContain("openmind/article/user.md");
  });

  it("normalizes the formal cctools manifest vocabulary at the read boundary", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(
      path.join(source, "cctools.skill.yaml"),
      CCTOOLS_MANIFEST.replace(
        "capabilities:\n",
        "config:\n  inputRoot:\n    type: path-mymind\n    required: false\ncapabilities:\n"
      )
    );
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(true);
    expect(inspection.manifest).toMatchObject({
      apiVersion: "openmind.dev/skill/v1",
      publisher: { id: "cctools" },
      config: { inputRoot: { type: "path-openmind" } },
      capabilities: { openmind: { read: ["article/**"], write: ["daily-summary/**"] } }
    });
    expect(inspection.manifest?.capabilities).not.toHaveProperty("mymind");
  });

  it("deterministically prefers cctools.skill.yaml when both manifest names exist", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(
      path.join(source, "cctools.skill.yaml"),
      CCTOOLS_MANIFEST.replace("id: example-skill", "id: preferred-skill")
    );
    fs.writeFileSync(
      path.join(source, "openmind.skill.yaml"),
      MANIFEST.replace("id: example-skill", "id: fallback-skill")
    );
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(true);
    expect(inspection.manifest?.id).toBe("preferred-skill");
    expect(inspection.manifest?.publisher.id).toBe("cctools");
    expect(inspection.warnings).toContain(
      "同时检测到 cctools.skill.yaml 与 openmind.skill.yaml；已确定性使用 cctools.skill.yaml。"
    );
  });

  it("does not hide an invalid cctools manifest behind a valid compatibility manifest", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(
      path.join(source, "cctools.skill.yaml"),
      CCTOOLS_MANIFEST.replace("apiVersion: cctools.dev/skill/v1", "apiVersion: cctools.dev/skill/v2")
    );
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(false);
    expect(inspection.manifest).toBeUndefined();
    expect(inspection.issues).toContainEqual(expect.objectContaining({
      code: "manifest-invalid",
      path: "cctools.skill.yaml"
    }));
  });

  it("installs only a clean managed copy", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    fs.writeFileSync(path.join(source, ".env.local"), "API_KEY=secret\n");

    const installed = service.install(source);

    expect(installed).not.toHaveProperty("status");
    expect(installed).not.toHaveProperty("readiness");
    expect(service.isInstalledCopyUsable(installed)).toBe(true);
    expect(service.listInstalled()).toHaveLength(1);
    expect(fs.existsSync(path.join(installed.packagePath, "run.sh"))).toBe(true);
    expect(fs.existsSync(path.join(installed.packagePath, ".env.local"))).toBe(false);
    expect(fs.existsSync(path.join(installed.packagePath, "openmind"))).toBe(false);
  });

  it("inspects and installs a safe ZIP source without executing archive content", () => {
    const archivePath = path.join(tempRoot, "example-skill.zip");
    fs.writeFileSync(archivePath, zipSync({
      "openmind.skill.yaml": strToU8(MANIFEST),
      "run.sh": strToU8("echo archive\n"),
      "pyproject.toml": strToU8("[project]\nname='archive'\n"),
      ".env": strToU8("SECRET=do-not-copy\n")
    }));

    const inspection = service.inspect(archivePath);
    const installed = service.install(archivePath);

    expect(inspection.sourceKind).toBe("zip");
    expect(inspection.valid).toBe(true);
    expect(service.isInstalledCopyUsable(installed)).toBe(true);
    expect(fs.existsSync(path.join(installed.packagePath, "run.sh"))).toBe(true);
    expect(fs.existsSync(path.join(installed.packagePath, ".env"))).toBe(false);
  });

  it("rejects ZIP path traversal before extraction", () => {
    const archivePath = path.join(tempRoot, "unsafe.zip");
    fs.writeFileSync(archivePath, zipSync({
      "../outside.txt": strToU8("must not escape")
    }));

    expect(() => service.inspect(archivePath)).toThrowError(SkillPackageError);
    try { service.inspect(archivePath); }
    catch (error) { expect((error as SkillPackageError).code).toBe("archive-entry-forbidden"); }
  });

  it("accepts an Agent Skills standard SKILL.md without an app manifest", () => {
    const source = createPackage(tempRoot, "native-skill");
    fs.writeFileSync(path.join(source, "SKILL.md"), `---\nname: native-skill\ndescription: Prompt-only Agent Skill\n---\n# Native\n`);

    const inspection = service.inspect(source);
    const installed = service.install(source);

    expect(inspection.valid).toBe(true);
    expect(inspection.sourceKind).toBe("directory");
    expect(inspection.manifest).toMatchObject({ id: "native-skill", kind: "agent" });
    expect(installed.packagePath).toBe(path.join(paths.skills!, "native-skill"));
  });

  realSkillIt("recognizes the formal packages from the independent Skills repository", () => {
    const skillsRoot = EXTERNAL_SKILLS_ROOT;
    const expected = [
      "asset-collector",
      "collect-interest-markers",
      "daily-writing-orchestrator",
      "skill-run-reporter",
      "reddit-fetcher",
      "daily-article-summarizer",
      "daily-topic-selector",
      "knowledge-wiki-compiler",
      "rss-article-saver",
      "x-following-fetcher",
      "rss-to-summary-workflow",
      "ai-media-topic-selector",
      "creative-writing"
    ];

    const inspections = expected.map((id) => service.inspect(path.join(skillsRoot, id)));

    expect(inspections.every((inspection) => inspection.valid)).toBe(true);
    expect(inspections.map((inspection) => inspection.manifest?.id)).toEqual(expected);
    expect(inspections.every((inspection) => inspection.legacy === undefined)).toBe(true);
    const xInspection = inspections.find((inspection) => inspection.manifest?.id === "x-following-fetcher");
    expect(xInspection?.excludedPaths).toEqual(expect.arrayContaining(["curl.txt", "curl_foryou.txt", "x_curl.txt"]));
    expect(xInspection?.files.some((file) => ["curl.txt", "curl_foryou.txt", "x_curl.txt"].includes(file.path))).toBe(false);
    const packagedAiFiles: Record<string, string> = {
      "daily-article-summarizer": "src/ai_client.py",
      "rss-article-saver": "src/ai_client.py",
      "knowledge-wiki-compiler": "src/knowledge_wiki_compiler/ai_client.py",
      "daily-topic-selector": "scripts/ai_client.py"
    };
    for (const [id, file] of Object.entries(packagedAiFiles)) {
      const inspection = inspections.find((item) => item.manifest?.id === id);
      expect(inspection?.files.map((entry) => entry.path)).toContain(file);
    }
    const video = service.inspect(path.join(skillsRoot, "video-burnin-subtitles"));
    expect(video?.manifest?.entrypoint.runtime).toBe("python");
    expect(video?.manifest?.entrypoint.script).toBe("scripts/burnin_subtitles.py");
    expect(video?.manifest?.entrypoint.args).toEqual([
      "--input", "{{ inputs.source }}",
      "--lang", "{{ inputs.language }}",
      "--subtitle", "{{ inputs.subtitleFile }}",
      "--output-name", "{{ inputs.outputName }}"
    ]);
    // Provider config moved to config/providers.yaml; the manifest no longer
    // carries the OPENMIND_PROVIDER_* env templates.
    expect(video?.manifest?.entrypoint.env).toBeFalsy();
    expect(video?.manifest?.runtime.lockFile).toBe("uv.lock");
    expect(video?.manifest?.artifacts[0]).toMatchObject({ path: "video/**" });
    const videoScript = fs.readFileSync(path.join(skillsRoot, "video-burnin-subtitles", "scripts", "burnin_subtitles.py"), "utf8");
    expect(videoScript).toContain('os.environ.get("CCTOOLS_MYMIND_ROOT")');
    expect(videoScript).toContain('os.environ.get("MYMIND_ROOT")');
    expect(videoScript).not.toContain("load_dotenv");
    expect(videoScript).not.toContain("--env-file");

    const videoDownload = service.inspect(path.join(skillsRoot, "VideoDownload"));
    expect(videoDownload?.manifest?.entrypoint.args).toEqual([
      "{{ inputs.url }}",
      "--output",
      "{{ exports.videoExportDir }}",
      "--output-name",
      "{{ inputs.outputName }}"
    ]);
    const videoDownloadScript = fs.readFileSync(path.join(skillsRoot, "VideoDownload", "main.py"), "utf8");
    expect(videoDownloadScript).not.toContain("Path.cwd()");
    expect(videoDownloadScript).toContain("--output must be an absolute Export Location path");

    const workflow = service.inspect(path.join(skillsRoot, "rss-to-summary-workflow"));
    expect(workflow?.manifest?.kind).toBe("workflow");
    expect(workflow?.manifest?.workflow.steps.map((step) => [step.id, step.skill, step.version])).toEqual([
      ["fetch", "rss-article-saver", "^1.0.0"],
      ["summarize", "daily-article-summarizer", "^1.0.0"],
      ["select-topic", "daily-topic-selector", "^1.0.0"]
    ]);
    // Local/cron launcher coexists with the desktop Workflow Engine manifest.
    // Desktop scheduling comes from the preferred cctools.skill.yaml above.
    expect(workflow?.files.map((file) => file.path)).toContain("scripts/run_workflow.py");
    expect(workflow?.files.map((file) => file.path)).toContain("workflows.yaml");
    expect(workflow?.files.map((file) => file.path)).toContain("cctools.skill.yaml");
  });

  realSkillIt("installs all formal packages from the independent Skills repository", () => {
    const packageDirectories = fs.readdirSync(EXTERNAL_SKILLS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(EXTERNAL_SKILLS_ROOT, entry.name, "cctools.skill.yaml")))
      .map((entry) => path.join(EXTERNAL_SKILLS_ROOT, entry.name));
    const installed = packageDirectories.map((source) => service.install(source));

    // All 16 skills now have formal cctools.skill.yaml manifests
    // (12 process / 1 workflow / 3 agent). `_shared` has no manifest and is
    // therefore not an install candidate.
    expect(installed.map((record) => record.id).sort()).toEqual([
      "agent-browser",
      "ai-media-topic-selector",
      "asset-collector",
      "collect-interest-markers",
      "creative-writing",
      "daily-article-summarizer",
      "daily-topic-selector",
      "daily-writing-orchestrator",
      "knowledge-wiki-compiler",
      "reddit-fetcher",
      "rss-article-saver",
      "rss-to-summary-workflow",
      "skill-run-reporter",
      "video-burnin-subtitles",
      "video-download",
      "x-following-fetcher"
    ]);
    expect(installed.length).toBe(16);
    expect(installed.every((record) => service.isInstalledCopyUsable(record))).toBe(true);

    const sharedRoot = path.join(EXTERNAL_SKILLS_ROOT, "_shared");
    const sharedProject = fs.readFileSync(path.join(sharedRoot, "pyproject.toml"), "utf8");
    expect(sharedProject).toContain('name = "cctools-skill-shared"');
    expect(sharedProject).toContain('version = "1.0.0"');
    expect(fs.existsSync(path.join(sharedRoot, "cctools.skill.yaml"))).toBe(false);
    expect(installed.some((record) => record.id === "_shared")).toBe(false);
  });

  it("rejects writes to an unknown openmind top-level", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), CCTOOLS_MANIFEST.replace("write: [daily-summary/**]", "write: [private-data/**]"));
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(false);
    expect(inspection.issues.some((issue) => issue.code === "openmind-write-forbidden")).toBe(true);
  });

  it("does not apply an app-specific Secret heuristic to Skill package text", () => {
    const source = createPackage(tempRoot);
    const manifest = MANIFEST.replace(
      "args: []",
      "args: []\n  env:\n    API_KEY: nvapi-12345678901234567890"
    );
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), manifest);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(true);
    expect(inspection.issues.some((issue) => issue.code === "secret-in-package")).toBe(false);
  });

  it("rejects a symlink escaping the package root", () => {
    const source = createPackage(tempRoot);
    const outside = path.join(tempRoot, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "private.txt"), "private\n");
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    // Directory junctions exercise the same escape boundary on Windows
    // without requiring Developer Mode or administrator privileges.
    fs.symlinkSync(outside, path.join(source, "leak"), process.platform === "win32" ? "junction" : "dir");

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(false);
    expect(inspection.issues.some((issue) => issue.code === "escaping-symlink")).toBe(true);
  });

  it("uninstalls the skill's only installed copy", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);
    expect(service.uninstall(installed.key, installed.digest)).toBe(true);
    expect(service.getInstalled(installed.key)).toBeUndefined();
    expect(fs.existsSync(installed.packagePath)).toBe(false);
  });

  it("replaces the single directory when different content is installed", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo v1\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const first = service.install(source);
    expect(first.packagePath).toBe(path.join(paths.skills!, "example-skill"));
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST.replace("version: 1.0.0", "version: 2.0.0"));
    fs.writeFileSync(path.join(source, "run.sh"), "echo v2\n");
    const second = service.install(source);

    expect(second.digest).not.toBe(first.digest);
    expect(service.isInstalledCopyUsable(second)).toBe(true);
    expect(second.packagePath).toBe(first.packagePath);
    // One record, one directory: the v1 copy is gone entirely.
    expect(service.listInstalled()).toHaveLength(1);
    expect(fs.readFileSync(path.join(second.packagePath, "run.sh"), "utf8")).toBe("echo v2\n");

    expect(service.getInstalled(second.key)?.digest).toBe(second.digest);
  });

  it("migrates the official installed identity from openmind to cctools", () => {
    const legacySource = createPackage(tempRoot, "legacy-identity-source");
    fs.writeFileSync(path.join(legacySource, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(legacySource, "run.sh"), "echo legacy\n");
    fs.writeFileSync(path.join(legacySource, "pyproject.toml"), "[project]\nname='example'\n");
    const legacy = service.install(legacySource);
    service.setEnabled(legacy.key, legacy.digest, false);

    const formalSource = createPackage(tempRoot, "formal-identity-source");
    fs.writeFileSync(path.join(formalSource, "cctools.skill.yaml"), CCTOOLS_MANIFEST);
    fs.writeFileSync(path.join(formalSource, "run.sh"), "echo formal\n");
    fs.writeFileSync(path.join(formalSource, "pyproject.toml"), "[project]\nname='example'\n");
    const formal = service.install(formalSource);

    expect(formal.key).toBe("cctools/example-skill");
    expect(formal.packagePath).toBe(path.join(paths.skills!, "example-skill"));
    expect(service.listInstalled()).toEqual([expect.objectContaining({ key: formal.key })]);
    expect(service.toInstalledView(formal).enabled).toBe(false);
    expect(formal.packagePath).toBe(legacy.packagePath);
    expect(fs.existsSync(path.join(paths.skills!, "openmind", "example-skill"))).toBe(false);
    expect(fs.readFileSync(path.join(formal.packagePath, "run.sh"), "utf8")).toBe("echo formal\n");
    expect(service.toInstalledView(service.setEnabled(formal.key, formal.digest, true)).enabled).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(paths.skills!, "skill-preferences.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      disabledKeys: []
    });
  });

  it("re-refreshes source provenance when identical content is reinstalled", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const first = service.install(source);
    const installedAt = first.installedAt;

    const again = service.install(source, { sourceType: "git", sourceLocator: "https://github.com/example/skills" });

    expect(again.digest).toBe(first.digest);
    expect(service.isInstalledCopyUsable(again)).toBe(true);
    expect(again.installedAt).toBe(installedAt);
    expect(again.sourceType).toBe("git");
    expect(service.listInstalled()).toHaveLength(1);
  });

  it("derives installed-copy usability from the current package digest", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo original\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);
    expect(service.toInstalledView(installed).usable).toBe(true);
    fs.writeFileSync(path.join(installed.packagePath, "run.sh"), "echo tampered\n");

    const refreshed = service.getInstalledById(installed.id)!;
    expect(service.toInstalledView(refreshed)).toMatchObject({
      usable: false,
      signatureStatus: "unsigned",
      reviewStatus: "unreviewed",
      skillUpdatePolicy: "manual"
    });
    expect(() => service.inspectInstalledCopy(refreshed)).toThrow(/digest/);
  });

  it("defaults installed Skills to enabled and persists an independent disable override", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);

    expect(service.toInstalledView(installed)).toMatchObject({ enabled: true, usable: true });
    expect(service.toInstalledView(service.setEnabled(installed.key, installed.digest, false))).toMatchObject({ enabled: false, usable: true });

    const preferencesFile = path.join(paths.skills!, "skill-preferences.json");
    expect(JSON.parse(fs.readFileSync(preferencesFile, "utf8"))).toEqual({
      schemaVersion: 1,
      disabledKeys: [installed.key]
    });
    expect(new SkillPackageService(paths).listInstalledViews()).toEqual([
      expect.objectContaining({ key: installed.key, digest: installed.digest, enabled: false, usable: true })
    ]);

    expect(service.toInstalledView(service.setEnabled(installed.key, installed.digest, true)).enabled).toBe(true);
    expect(JSON.parse(fs.readFileSync(preferencesFile, "utf8"))).toEqual({ schemaVersion: 1, disabledKeys: [] });
  });

  it("lists formal Process/Workflow metadata for Automation and excludes Agent packages", () => {
    const processSource = createPackage(tempRoot, "catalog-process-source");
    fs.writeFileSync(path.join(processSource, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(processSource, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(processSource, "pyproject.toml"), "[project]\nname='example'\n");
    service.install(processSource);

    const agentSource = createPackage(tempRoot, "catalog-agent");
    fs.writeFileSync(path.join(agentSource, "openmind.skill.yaml"), AGENT_MANIFEST);
    fs.writeFileSync(path.join(agentSource, "SKILL.md"), "---\nname: catalog-agent\ndescription: Conversation-only fixture\n---\n# Catalog Agent\n");
    service.install(agentSource);

    const workflowSource = createPackage(tempRoot, "catalog-workflow-source");
    fs.writeFileSync(path.join(workflowSource, "openmind.skill.yaml"), WORKFLOW_MANIFEST);
    const workflow = service.install(workflowSource);
    service.setEnabled(workflow.key, workflow.digest, false);

    const catalog = service.listInstalledRunnableViews();

    expect(catalog).toHaveLength(2);
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "example-skill",
        kind: "process",
        title: "Example Skill",
        description: "Static package fixture",
        group: "test",
        enabled: true
      }),
      expect.objectContaining({
        id: "catalog-workflow",
        kind: "workflow",
        title: "Catalog Workflow",
        description: "Automation workflow fixture",
        group: "workflow",
        version: "2.0.0",
        enabled: false
      })
    ]));
    expect(catalog.some((entry) => entry.id === "catalog-agent")).toBe(false);
  });

  it("preserves a logical Skill disable override across package replacement", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo v1\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const first = service.install(source);
    service.setEnabled(first.key, first.digest, false);

    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST.replace("version: 1.0.0", "version: 2.0.0"));
    fs.writeFileSync(path.join(source, "run.sh"), "echo v2\n");
    const replacement = service.install(source);

    expect(replacement.digest).not.toBe(first.digest);
    expect(service.toInstalledView(replacement)).toMatchObject({ enabled: false, usable: true });
  });

  it("rejects stale or unknown enablement targets without creating preferences", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);
    const preferencesFile = path.join(paths.skills!, "skill-preferences.json");

    expect(() => service.setEnabled("openmind/missing", installed.digest, false)).toThrow(/不存在或已被替换/);
    expect(() => service.setEnabled(installed.key, "0".repeat(64), false)).toThrow(/不存在或已被替换/);
    expect(fs.existsSync(preferencesFile)).toBe(false);
    expect(service.toInstalledView(installed).enabled).toBe(true);
  });

  it("fails closed when the independent enablement preferences are corrupt", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);
    const preferencesFile = path.join(paths.skills!, "skill-preferences.json");
    fs.writeFileSync(preferencesFile, "{corrupt", "utf8");

    expect(() => service.listInstalledViews()).toThrow("拒绝覆盖现有配置");
    expect(() => service.setEnabled(installed.key, installed.digest, false)).toThrow("拒绝覆盖现有配置");
    expect(fs.readFileSync(preferencesFile, "utf8")).toBe("{corrupt");
  });

  it("uninstalls an installed package through a staging rename", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);

    expect(service.uninstall(installed.key, installed.digest)).toBe(true);
    expect(service.getInstalled(installed.key, installed.digest)).toBeUndefined();
    expect(fs.existsSync(installed.packagePath)).toBe(false);
  });

  it("restores the previous package directory when the swap is interrupted", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo v1\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);

    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST.replace("version: 1.0.0", "version: 2.0.0"));
    fs.writeFileSync(path.join(source, "run.sh"), "echo v2\n");
    const originalRename = fs.renameSync;
    let renameCount = 0;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      renameCount += 1;
      if (renameCount === 2) throw new Error("simulated swap interruption");
      return originalRename(from, to);
    }) as typeof fs.renameSync);

    try {
      expect(() => service.install(source)).toThrow("simulated swap interruption");
    } finally {
      rename.mockRestore();
    }

    // The v1 directory was restored and the registry still points at v1.
    expect(service.listInstalled()).toEqual([expect.objectContaining({ digest: installed.digest })]);
    expect(service.isInstalledCopyUsable(service.listInstalled()[0]!)).toBe(true);
    expect(fs.readFileSync(path.join(installed.packagePath, "run.sh"), "utf8")).toBe("echo v1\n");
    expect(fs.readdirSync(paths.staging).filter((entry) => entry.startsWith("skill-package-") || entry.startsWith("skill-replaced-") || entry.startsWith("skill-archive-install-"))).toEqual([]);
  });

  it("installs into the openmind-rooted .agent/skills store, not userData", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "#!/bin/sh\necho ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");

    const record = service.install(source);

    expect(record.packagePath.startsWith(path.join(tempRoot, "openmind", ".agent", "skills") + path.sep)).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, "openmind", ".agent", "skills", "example-skill"))).toBe(true);
    expect(fs.existsSync(path.join(paths.userData, "skills"))).toBe(false);
  });

  it("fails closed without a openmind root: install throws and reads stay empty", () => {
    const unbound = new SkillPackageService(buildAppPaths(path.join(tempRoot, "unbound-user-data")));
    expect(unbound.listInstalled()).toEqual([]);

    const source = createPackage(tempRoot, "unbound-skill");
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), MANIFEST.replace("id: example-skill", "id: unbound-skill"));
    fs.writeFileSync(path.join(source, "run.sh"), "#!/bin/sh\necho ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    expect(() => unbound.install(source)).toThrow(/尚未绑定 openmind 根目录/);
    expect(fs.existsSync(path.join(tempRoot, "unbound-user-data", "skills"))).toBe(false);
  });
});

function createPackage(root: string, name = "example-skill"): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
