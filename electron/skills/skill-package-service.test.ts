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
  process.env.CCTOOLS_SKILLS_REPO_ROOT || path.resolve(__dirname, "../../../../cctools-skills")
);
const realSkillIt = fs.existsSync(path.join(EXTERNAL_SKILLS_ROOT, "rss-article-saver", "cctools.skill.yaml")) ? it : it.skip;

const MANIFEST = `apiVersion: cctools.dev/skill/v1
id: example-skill
version: 1.0.0
publisher:
  id: cctools
  displayName: cctools
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
  mymind:
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

describe("SkillPackageService", () => {
  let tempRoot = "";
  let paths: AppPaths;
  let service: SkillPackageService;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skill-package-"));
    paths = buildAppPaths(path.join(tempRoot, "user-data"), path.join(tempRoot, "mymind", ".agent", "skills"));
    ensureAppPaths(paths);
    service = new SkillPackageService(paths);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("inspects a directory, excludes user data, and produces a stable digest", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "#!/bin/sh\necho ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    fs.writeFileSync(path.join(source, ".env"), "NVIDIA_API_KEY=nvapi-secret\n");
    fs.mkdirSync(path.join(source, "venv"));
    fs.writeFileSync(path.join(source, "venv", "python"), "not-package-content");
    fs.mkdirSync(path.join(source, "mymind", "article"), { recursive: true });
    fs.writeFileSync(path.join(source, "mymind", "article", "user.md"), "must stay out");

    const first = service.inspect(source);
    const second = service.inspect(source);

    expect(first.valid).toBe(true);
    expect(first.digest).toBe(second.digest);
    expect(first.excludedPaths).toEqual(expect.arrayContaining([".env", "venv/", "mymind/", "mymind/article/", "mymind/article/user.md"]));
    expect(first.files.map((file) => file.path)).not.toContain(".env");
    expect(first.files.map((file) => file.path)).not.toContain("mymind/article/user.md");
  });

  it("installs only a clean quarantined copy and leaves active untouched", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    fs.writeFileSync(path.join(source, ".env.local"), "API_KEY=secret\n");

    const installed = service.install(source);

    expect(installed.status).toBe("quarantined");
    expect(installed.readiness).toBe("installed-not-ready");
    expect(service.listInstalled()).toHaveLength(1);
    expect(fs.existsSync(path.join(installed.packagePath, "run.sh"))).toBe(true);
    expect(fs.existsSync(path.join(installed.packagePath, ".env.local"))).toBe(false);
    expect(fs.existsSync(path.join(installed.packagePath, "mymind"))).toBe(false);
  });

  it("inspects and installs a safe ZIP source without executing archive content", () => {
    const archivePath = path.join(tempRoot, "example-skill.zip");
    fs.writeFileSync(archivePath, zipSync({
      "cctools.skill.yaml": strToU8(MANIFEST),
      "run.sh": strToU8("echo archive\n"),
      "pyproject.toml": strToU8("[project]\nname='archive'\n"),
      ".env": strToU8("SECRET=do-not-copy\n")
    }));

    const inspection = service.inspect(archivePath);
    const installed = service.install(archivePath);

    expect(inspection.sourceKind).toBe("zip");
    expect(inspection.valid).toBe(true);
    expect(installed.status).toBe("quarantined");
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

  it("does not auto-default a legacy SKILL.md to uv", () => {
    const source = createPackage(tempRoot, "legacy-skill");
    fs.writeFileSync(path.join(source, "SKILL.md"), `---\nid: legacy-skill\ntitle: Legacy\ndescription: Prompt only\n---\n# Legacy\n`);

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(false);
    expect(inspection.sourceKind).toBe("legacy-claude");
    expect(inspection.legacy?.kind).toBe("agent");
    expect(inspection.legacy?.suggestedEntrypoint).toBeUndefined();
    expect(inspection.issues.some((issue) => issue.code === "legacy-inspect-only")).toBe(true);
  });

  it("batch-inspects the legacy .claude/skills surface and quarantines only formal packages", () => {
    const workspace = path.join(tempRoot, "workspace");
    const legacy = path.join(workspace, ".claude", "skills", "legacy-skill");
    const formal = path.join(workspace, ".claude", "skills", "formal-skill");
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(formal, { recursive: true });
    fs.writeFileSync(path.join(legacy, "SKILL.md"), "---\nid: legacy-skill\ntitle: Legacy\n---\n# Legacy\n");
    fs.writeFileSync(path.join(formal, "cctools.skill.yaml"), MANIFEST.replace("id: example-skill", "id: formal-skill"));
    fs.writeFileSync(path.join(formal, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(formal, "pyproject.toml"), "[project]\nname='formal'\n");

    const inspected = service.inspectClaudeSkills(workspace);
    const report = service.migrateClaudeSkills(workspace);

    expect(inspected).toHaveLength(2);
    expect(report.installed).toHaveLength(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].sourcePath).toContain("legacy-skill");
    expect(report.installed[0].status).toBe("quarantined");
    expect(service.listInstalled()).toHaveLength(1);
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
    // carries the CCTOOLS_PROVIDER_* env templates.
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
    // Desktop scheduling still comes only from cctools.skill.yaml above.
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
    expect(installed.every((record) => record.status === "quarantined" && record.readiness === "installed-not-ready")).toBe(true);

    const sharedRoot = path.join(EXTERNAL_SKILLS_ROOT, "_shared");
    const sharedProject = fs.readFileSync(path.join(sharedRoot, "pyproject.toml"), "utf8");
    expect(sharedProject).toContain('name = "cctools-skill-shared"');
    expect(sharedProject).toContain('version = "1.0.0"');
    expect(fs.existsSync(path.join(sharedRoot, "cctools.skill.yaml"))).toBe(false);
    expect(installed.some((record) => record.id === "_shared")).toBe(false);
  });

  it("rejects writes to an unknown mymind top-level", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST.replace("write: [daily-summary/**]", "write: [private-data/**]"));
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(false);
    expect(inspection.issues.some((issue) => issue.code === "mymind-write-forbidden")).toBe(true);
  });

  it("rejects Secret values embedded in the manifest", () => {
    const source = createPackage(tempRoot);
    const manifest = MANIFEST.replace(
      "args: []",
      "args: []\n  env:\n    API_KEY: nvapi-12345678901234567890"
    );
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), manifest);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(false);
    expect(inspection.issues.some((issue) => issue.code === "secret-in-package")).toBe(true);
  });

  it("rejects a symlink escaping the package root", () => {
    const source = createPackage(tempRoot);
    const outside = path.join(tempRoot, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "private.txt"), "private\n");
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    // Directory junctions exercise the same escape boundary on Windows
    // without requiring Developer Mode or administrator privileges.
    fs.symlinkSync(outside, path.join(source, "leak"), process.platform === "win32" ? "junction" : "dir");

    const inspection = service.inspect(source);

    expect(inspection.valid).toBe(false);
    expect(inspection.issues.some((issue) => issue.code === "escaping-symlink")).toBe(true);
  });

  it("refuses to uninstall an active record", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);
    service.markReadiness(installed.key, installed.digest, "ready");
    service.activate(installed.key, installed.digest);

    expect(() => service.uninstall(installed.key, installed.digest)).toThrow(SkillPackageError);
    expect(fs.existsSync(installed.packagePath)).toBe(true);
  });

  it("installs a second version into quarantine, then supports readiness-gated activation and rollback", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo v1\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const first = service.install(source);
    service.markReadiness(first.key, first.digest, "ready");
    service.activate(first.key, first.digest);

    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST.replace("version: 1.0.0", "version: 2.0.0"));
    fs.writeFileSync(path.join(source, "run.sh"), "echo v2\n");
    const candidate = service.install(source);

    expect(candidate.digest).not.toBe(first.digest);
    expect(candidate.status).toBe("quarantined");
    expect(service.getInstalled(first.key, first.digest)?.status).toBe("active");

    service.markReadiness(candidate.key, candidate.digest, "ready");
    service.activate(candidate.key, candidate.digest);
    expect(service.getInstalled(candidate.key, candidate.digest)?.status).toBe("active");
    expect(service.getInstalled(first.key, first.digest)?.status).toBe("previous");
    expect(() => service.uninstall(first.key)).toThrowError(/必须指定 digest/);

    service.rollback(first.key);
    expect(service.getInstalled(first.key, first.digest)?.status).toBe("active");
    expect(service.getInstalled(candidate.key, candidate.digest)?.status).toBe("previous");
  });

  it("audits the installed copy and local source after activation", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo original\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);
    service.markReadiness(installed.key, installed.digest, "ready");
    service.activate(installed.key, installed.digest);

    fs.writeFileSync(path.join(installed.packagePath, "run.sh"), "echo tampered\n");

    const refreshed = service.getActiveInstalled(installed.id);
    expect(refreshed).toMatchObject({
      status: "active",
      readiness: "ready",
      signatureStatus: "unsigned",
      reviewStatus: "unreviewed",
      skillUpdatePolicy: "manual"
    });
  });

  it("uninstalls a candidate through a staging rename without touching the active version", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const installed = service.install(source);

    expect(service.uninstall(installed.key, installed.digest)).toBe(true);
    expect(service.getInstalled(installed.key, installed.digest)).toBeUndefined();
    expect(fs.existsSync(installed.packagePath)).toBe(false);
  });

  it("keeps the active registry and removes the candidate when the registry swap is interrupted", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "echo v1\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    const active = service.install(source);
    service.markReadiness(active.key, active.digest, "ready");
    service.activate(active.key, active.digest);

    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST.replace("version: 1.0.0", "version: 2.0.0"));
    fs.writeFileSync(path.join(source, "run.sh"), "echo v2\n");
    const originalRename = fs.renameSync;
    let renameCount = 0;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      renameCount += 1;
      if (renameCount === 2) throw new Error("simulated registry interruption");
      return originalRename(from, to);
    }) as typeof fs.renameSync);

    try {
      expect(() => service.install(source)).toThrow("simulated registry interruption");
    } finally {
      rename.mockRestore();
    }

    expect(service.listInstalled()).toEqual([expect.objectContaining({ digest: active.digest, status: "active" })]);
    expect(fs.readdirSync(paths.staging).filter((entry) => entry.startsWith("skill-package-") || entry.startsWith("skill-archive-install-"))).toEqual([]);
    expect(fs.readdirSync(path.join(paths.skills, "cctools", "example-skill"))).toHaveLength(1);
  });

  it("installs into the mymind-rooted .agent/skills store, not userData", () => {
    const source = createPackage(tempRoot);
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST);
    fs.writeFileSync(path.join(source, "run.sh"), "#!/bin/sh\necho ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");

    const record = service.install(source);

    expect(record.packagePath.startsWith(path.join(tempRoot, "mymind", ".agent", "skills") + path.sep)).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, "mymind", ".agent", "skills", "cctools", "example-skill"))).toBe(true);
    expect(fs.existsSync(path.join(paths.userData, "skills"))).toBe(false);
  });

  it("fails closed without a mymind root: install throws and reads stay empty", () => {
    const unbound = new SkillPackageService(buildAppPaths(path.join(tempRoot, "unbound-user-data")));
    expect(unbound.listInstalled()).toEqual([]);

    const source = createPackage(tempRoot, "unbound-skill");
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), MANIFEST.replace("id: example-skill", "id: unbound-skill"));
    fs.writeFileSync(path.join(source, "run.sh"), "#!/bin/sh\necho ok\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='example'\n");
    expect(() => unbound.install(source)).toThrow(/尚未绑定 mymind 根目录/);
    expect(fs.existsSync(path.join(tempRoot, "unbound-user-data", "skills"))).toBe(false);
  });
});

function createPackage(root: string, name = "example-skill"): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
