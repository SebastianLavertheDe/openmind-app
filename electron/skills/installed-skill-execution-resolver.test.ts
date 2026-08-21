import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { SkillRunRequestSchema } from "../../shared/execution-contracts";
import { RuntimePackMetadataSchema } from "../../shared/runtime-targets";
import { buildAppPaths, ensureAppPaths, resolveSkillStoreRoot } from "../paths/app-paths-service";
import { ExecutionBroker } from "../execution/execution-broker";
import { RuntimeManager } from "../runtime/runtime-manager";
import { canonicalRuntimePackPayload } from "../runtime/runtime-pack-verifier";
import { RuntimePackService } from "../runtime/runtime-pack-service";
import { SkillPackageService } from "./skill-package-service";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";

const roots: string[] = [];
const EXTERNAL_SKILLS_ROOT = path.resolve(
  process.env.OPENMIND_SKILLS_REPO_ROOT || path.resolve(__dirname, "../../../cctools-skills")
);
const HAS_EXTERNAL_SKILLS = fs.existsSync(path.join(EXTERNAL_SKILLS_ROOT, "rss-article-saver", "cctools.skill.yaml"));
const realSkillIt = HAS_EXTERNAL_SKILLS ? it : it.skip;
const linuxRealSkillIt = it.skipIf(process.platform !== "linux" || !HAS_EXTERNAL_SKILLS);
const ORIGINAL_WORKSPACE_ROOT = process.env.OPENMIND_WORKSPACE_ROOT;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  if (ORIGINAL_WORKSPACE_ROOT === undefined) delete process.env.OPENMIND_WORKSPACE_ROOT;
  else process.env.OPENMIND_WORKSPACE_ROOT = ORIGINAL_WORKSPACE_ROOT;
});

describe("InstalledSkillExecutionResolver", () => {
  it("builds an execution plan from an intact installed package", async () => {
    const fixture = createFixture();
    const resolver = fixture.resolver;
    const request = runRequest(fixture.digest);
    const plan = await resolver.resolve(request, "run-1");
    expect(plan).toBeTruthy();
  });

  it("lists only usable Installed Skill metadata without exposing executable paths", () => {
    const fixture = createFixture(false, "python", { agent: true });
    expect(fixture.resolver.listDefinitions()).toEqual([
      expect.objectContaining({
        id: "resolver-fixture",
        title: "Resolver Fixture",
        command: "managed-runtime",
        runner: "managed-runtime",
        cwd: "installed/openmind/resolver-fixture/1.0.0",
        envFile: null
      })
    ]);
    expect(fixture.resolver.listDefinitions()[0]?.command).not.toContain(process.execPath);

    const installed = fixture.packages.getInstalledById("resolver-fixture")!;
    fs.appendFileSync(path.join(installed.packagePath, "main.py"), "\nchanged = True\n");
    expect(fixture.resolver.listDefinitions()).toEqual([]);
  });

  it("filters disabled packages for current catalogs but includes them in legacy backfill", () => {
    const fixture = createFixture(false, "python", { agent: true });
    const enabledSnapshot = fixture.resolver.captureSessionSnapshot();
    expect(enabledSnapshot).toHaveLength(1);
    expect(enabledSnapshot[0]).toMatchObject({
      definition: { id: "resolver-fixture" },
      installed: { key: fixture.key, version: "1.0.0", digest: fixture.digest }
    });

    fixture.packages.setEnabled(fixture.key, fixture.digest, false);

    expect(fixture.resolver.listDefinitions()).toEqual([]);
    expect(fixture.resolver.captureSessionSnapshot()).toEqual([]);
    expect(fixture.resolver.captureSessionSnapshot(true)).toEqual(enabledSnapshot);
  });

  it("fails the current catalog closed on corrupt preferences without blocking legacy capture", () => {
    const fixture = createFixture(false, "python", { agent: true });
    fs.writeFileSync(path.join(fixture.paths.skills!, "skill-preferences.json"), "{broken", "utf8");

    expect(fixture.resolver.listDefinitions()).toEqual([]);
    expect(fixture.resolver.captureSessionSnapshot()).toEqual([]);
    expect(fixture.resolver.captureSessionSnapshot(true)).toEqual([
      expect.objectContaining({ definition: expect.objectContaining({ id: "resolver-fixture" }) })
    ]);
  });

  realSkillIt("bridges a usable Agent from the app-private SkillStore without falling back to workspace paths", () => {
    const fixture = createBatchAFixture("creative-writing", {
      resolveProviderProfile: (profileId) => profileId === "profile-main" ? providerProfile() : null
    });

    const snapshot = fixture.resolver.captureSessionSnapshot()
      .find((entry) => entry.definition.id === "creative-writing")!;
    fixture.packages.setEnabled(snapshot.installed!.key, snapshot.installed!.digest, false);
    const bridge = fixture.resolver.providerSkillBridge(snapshot);
    expect(bridge).toMatchObject({
      id: "creative-writing",
      version: "1.0.0",
      digest: fixture.digest,
      openmindRoot: fixture.openmindRoot
    });
    expect(bridge?.packageRoot).not.toContain(".claude/skills");
    expect(bridge?.skillPath).toBe(path.join(bridge!.packageRoot, "SKILL.md"));
    expect(bridge?.referencePaths).toEqual(expect.arrayContaining([
      "references/cover-image-preferences.md",
      "references/wechat-methodology.md"
    ]));

    expect(fixture.resolver.listDefinitions()).toEqual([]);

  });

  it("rejects a non-Agent snapshot instead of falling back to a same-name workspace Skill", () => {
    const fixture = createFixture();
    const record = fixture.packages.getInstalled(fixture.key, fixture.digest)!;
    const snapshot = {
      definition: {
        id: record.id,
        title: "Resolver Fixture",
        description: "Process packages are not provider-native Skills",
        cwd: `installed/${record.publisherId}/${record.id}/${record.version}`,
        command: "managed-runtime"
      },
      installed: { key: record.key, version: record.version, digest: record.digest }
    };

    expect(fixture.resolver.captureSessionSnapshot()).toEqual([]);
    expect(() => fixture.resolver.providerSkillBridge(snapshot)).toThrow(/不是 Agent 类型/);
    expect(() => fixture.resolver.providerSkillBridge({
      ...snapshot,
      installed: null
    })).toThrow(/provenance/);
    expect(() => fixture.resolver.providerSkillBridge({
      ...snapshot,
      installed: { ...snapshot.installed!, digest: "f".repeat(64) }
    })).toThrow(/替换或删除/);
    expect(() => fixture.resolver.providerSkillBridge({
      ...snapshot,
      installed: { ...snapshot.installed!, key: "other/resolver-fixture" }
    })).toThrow(/替换或删除/);
    expect(() => fixture.resolver.providerSkillBridge({
      ...snapshot,
      installed: { ...snapshot.installed!, version: "2.0.0" }
    })).toThrow(/替换或删除/);

    fs.appendFileSync(path.join(fixture.packages.getInstalled(fixture.key)!.packagePath, "main.py"), "\ntampered = True\n");
    expect(() => fixture.resolver.providerSkillBridge(snapshot)).toThrow(/digest/);
  });

  it("checks enabled only before queue admission, not during asynchronous plan resolution", async () => {
    const fixture = createFixture();
    const request = runRequest(fixture.digest);
    fixture.packages.setEnabled(fixture.key, fixture.digest, false);

    expect(() => fixture.resolver.assertBrokerRunnable(request)).toThrow(/停用/);
    await expect(fixture.resolver.resolve(request, "already-queued")).resolves.toMatchObject({
      skillId: "resolver-fixture",
      digest: fixture.digest
    });
  });

  realSkillIt("rejects a disabled Workflow at the new-workflow admission boundary", () => {
    const fixture = createBatchAFixture("rss-to-summary-workflow");
    expect(fixture.resolver.workflowManifest("rss-to-summary-workflow")).toMatchObject({
      id: "rss-to-summary-workflow",
      kind: "workflow"
    });

    fixture.packages.setEnabled(fixture.key, fixture.digest, false);

    expect(() => fixture.resolver.workflowManifest("rss-to-summary-workflow")).toThrow(/停用/);
  });

  it("admits a Workflow only after pinning every enabled and usable Process Step", () => {
    const fixture = createWorkflowAdmissionFixture();

    expect(fixture.resolver.admitWorkflow("resolver-workflow")).toEqual({
      manifest: expect.objectContaining({ id: "resolver-workflow", kind: "workflow" }),
      steps: [
        {
          stepId: "first",
          skillId: "resolver-fixture",
          version: "1.0.0",
          digest: fixture.first.digest
        },
        {
          stepId: "second",
          skillId: "resolver-step-two",
          version: "1.0.0",
          digest: fixture.second.digest
        }
      ]
    });
  });

  it("rejects Workflow admission when the body or any downstream Step is disabled", () => {
    const bodyDisabled = createWorkflowAdmissionFixture();
    bodyDisabled.packages.setEnabled(bodyDisabled.workflow.key, bodyDisabled.workflow.digest, false);
    expect(() => bodyDisabled.resolver.admitWorkflow("resolver-workflow")).toThrow(/停用/);

    const stepDisabled = createWorkflowAdmissionFixture();
    stepDisabled.packages.setEnabled(stepDisabled.second.key, stepDisabled.second.digest, false);
    expect(() => stepDisabled.resolver.admitWorkflow("resolver-workflow")).toThrow(/resolver-step-two|停用/);
  });

  it("keeps an admitted Workflow Step runnable after disable but rechecks exact package bytes", () => {
    const fixture = createWorkflowAdmissionFixture();
    const pinned = fixture.resolver.admitWorkflow("resolver-workflow").steps[1];
    const request = { skillId: pinned.skillId, version: pinned.version, digest: pinned.digest };

    fixture.packages.setEnabled(fixture.second.key, fixture.second.digest, false);
    expect(() => fixture.resolver.assertBrokerRunnable(request)).toThrow(/停用/);
    expect(() => fixture.resolver.assertAdmittedBrokerRunnable(request)).not.toThrow();
    expect(() => fixture.resolver.assertAdmittedBrokerRunnable({ ...request, digest: "f".repeat(64) })).toThrow(/identity/);

    fs.appendFileSync(path.join(fixture.second.packagePath, "main.py"), "\ntampered = True\n");
    expect(() => fixture.resolver.assertAdmittedBrokerRunnable(request)).toThrow(/digest/);
  });

  realSkillIt("rejects Broker execution for Agent Skills", async () => {
    const fixture = createBatchAFixture("creative-writing");

    await expect(fixture.resolver.resolve(SkillRunRequestSchema.parse({
      skillId: "creative-writing",
      version: "1.0.0",
      digest: fixture.digest,
      inputs: {},
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }), "run-agent")).rejects.toThrow(/Claude Code CLI.*Codex CLI/);
  });

  it("pins package digest, manifest input templates and managed Runtime executable", async () => {
    const fixture = createFixture();

    const plan = await fixture.resolver.resolve(runRequest(fixture.digest), "run-3");
    expect(plan.version).toBe("1.0.0");
    expect(plan.digest).toBe(fixture.digest);
    expect(plan.process.executable).toBe(fs.realpathSync(process.execPath));
    expect(plan.process.args.at(-1)).toBe("20260805");
    expect(plan.process.cwd).toBe(path.join(fixture.paths.skills!, "openmind", "resolver-fixture"));
    expect(plan.maxInstances).toBe(1);
    expect(plan.artifacts?.[0]).toMatchObject({ logicalPath: "daily-summary/20260805.md", type: "markdown" });
    await plan.prepareRuntime?.();
  });

  it("pins provider configuration to the openmind snapshot and exposes both env namespaces", async () => {
    const fixture = createFixture();
    const dataRepositoryRoot = path.dirname(fixture.openmindRoot);
    bindTestProvider(dataRepositoryRoot, 41234, "snapshot-provider-key");
    process.env.OPENMIND_WORKSPACE_ROOT = path.join(fixture.paths.userData, "unrelated-workspace");

    const plan = await fixture.resolver.resolve(runRequest(fixture.digest), "run-provider-snapshot");
    expect(plan.process.env).toMatchObject({
      CCTOOLS_PROVIDER_API_KEY: "snapshot-provider-key",
      CCTOOLS_PROVIDER_BASE_URL: "http://127.0.0.1:41234/chat/completions",
      CCTOOLS_PROVIDER_MODEL: "local-test-model",
      OPENMIND_PROVIDER_API_KEY: "snapshot-provider-key",
      OPENMIND_PROVIDER_BASE_URL: "http://127.0.0.1:41234/chat/completions",
      OPENMIND_PROVIDER_MODEL: "local-test-model"
    });
    expect(plan.process.env).not.toHaveProperty("CCTOOLS_PROVIDERS_FILE");
    expect(plan.process.env).not.toHaveProperty("OPENMIND_PROVIDERS_FILE");
  });

  it("applies declared input defaults before resolving args and artifacts", async () => {
    const fixture = createFixture();

    const plan = await fixture.resolver.resolve(runRequest(fixture.digest), "run-default-input");

    expect(plan.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalPath: "daily-summary/fallback.md" })
    ]));
  });

  it("resolves an Export Location template only from the declared binding", async () => {
    const fixture = createFixture(false, "python", { externalExport: true });

    const plan = await fixture.resolver.resolve({
      ...runRequest(fixture.digest),
      externalExportBindingIds: ["exportDir"]
    }, "run-export-template");

    expect(plan.process.args).toContain(fixture.externalRoot);
    expect(plan.externalBindings?.exportDir).toMatchObject({
      bindingId: "exportDir",
      canonicalPath: fixture.externalRoot
    });
  });

  it("passes bounded source trigger context through the minimal installed-process environment", async () => {
    const fixture = createFixture();

    const plan = await fixture.resolver.resolve({
      ...runRequest(fixture.digest),
      inputs: {
        date: "20260805",
        sourceId: "source-1",
        sourceUrl: "https://example.com/feed",
        sourceName: "Example Feed"
      }
    }, "run-source-context");

    expect(plan.process.env).toMatchObject({
      CCTOOLS_SOURCE_ID: "source-1",
      CCTOOLS_SOURCE_URL: "https://example.com/feed",
      CCTOOLS_SOURCE_NAME: "Example Feed",
      OPENMIND_SOURCE_ID: "source-1",
      OPENMIND_SOURCE_URL: "https://example.com/feed",
      OPENMIND_SOURCE_NAME: "Example Feed"
    });
  });

  it("accepts a compatible Workflow-style caret version reference", async () => {
    const fixture = createFixture();

    const request = { ...runRequest(fixture.digest), version: "^1.0.0" };
    const plan = await fixture.resolver.resolve(request, "run-range");
    expect(plan.version).toBe("1.0.0");
  });

  it("rejects package content changes after installation", async () => {
    const fixture = createFixture();
    const installed = fixture.packages.getInstalledById("resolver-fixture")!;
    fs.appendFileSync(path.join(installed.packagePath, "main.py"), "\nchanged = True\n");
    await expect(fixture.resolver.resolve(runRequest(fixture.digest), "run-4")).rejects.toThrow(/digest/);
  });

  it("executes a formal installed Skill through RuntimeManager and ExecutionBroker", async () => {
    const fixture = createFixture(false, "node");

    const broker = new ExecutionBroker(
      fixture.paths,
      (request, runId) => fixture.resolver.resolve(request, runId),
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const run = broker.submit(runRequest(fixture.digest));
    await waitFor(() => broker.get(run.id).state === "succeeded");

    const completed = broker.get(run.id);
    expect(completed.terminalState).toBe("succeeded");
    expect(completed.runtime?.packId).toBe("node-22");
    expect(completed.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalPath: "openmind/daily-summary/20260805.md", type: "markdown", declared: true })
    ]));
    expect(fs.readFileSync(path.join(fixture.openmindRoot, "daily-summary", "20260805.md"), "utf8")).toContain("20260805");
    const leasesPath = path.join(fixture.paths.runtimePacks, "leases");
    expect(!fs.existsSync(leasesPath) || fs.readdirSync(leasesPath).length === 0).toBe(true);
  });

  it.skipIf(process.platform !== "linux")("runs an installed Skill with only the absolute executable extracted from a managed Runtime Pack", async () => {
    const fixture = createFixture(false, "node", { managedRuntime: true });

    const broker = new ExecutionBroker(
      fixture.paths,
      (request, runId) => fixture.resolver.resolve(request, runId),
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const run = broker.submit(runRequest(fixture.digest));
    await waitFor(() => broker.get(run.id).state === "succeeded");

    const output = fs.readFileSync(path.join(fixture.openmindRoot, "daily-summary", "20260805.md"), "utf8");
    const managedExecutable = path.join(
      fixture.paths.runtimeEnvironments,
      ".packs",
      "node-22",
      "linux-x64",
      fixture.runtimePack.digest,
      "bin",
      "node"
    );
    expect(output).toContain(`runtime=${managedExecutable}`);
    expect(output).toContain("PATH=<unset>");
    expect(broker.get(run.id).runtime).toMatchObject({ packId: "node-22", packDigest: fixture.runtimePack.digest });
  }, 15_000);

  linuxRealSkillIt("executes the real Batch A skill-run-reporter package", async () => {
    const fixture = createBatchAFixture();
    const python = resolvePythonExecutable();
    expect(python).toBeTruthy();

    const broker = new ExecutionBroker(
      fixture.paths,
      (request, runId) => fixture.resolver.resolve(request, runId),
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const run = broker.submit(SkillRunRequestSchema.parse({
      skillId: "skill-run-reporter",
      version: "1.0.0",
      digest: fixture.digest,
      inputs: { date: "20260805" },
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }));
    await waitFor(() => broker.get(run.id).state === "succeeded");

    const events = broker.events(run.id).map((event) => event.text || "").join("\n");
    expect(events).toContain("# Skill Run Report: 2026-08-05");
    expect(broker.get(run.id).artifacts).toHaveLength(0);
  });

  linuxRealSkillIt("executes the real Batch A asset-collector package and persists a declared Artifact", async () => {
    const fixture = createBatchAFixture("asset-collector");
    const python = resolvePythonExecutable();
    expect(python).toBeTruthy();

    // asset-collector reads a writing-package draft and emits assets/manifest.json.
    // Seed a draft package under creative/ so the script has real input to process.
    const draftDir = path.join(fixture.openmindRoot, "creative", "01-内容生产", "文稿库", "02-制作中", "demo-pkg");
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(
      path.join(draftDir, "topic-brief.md"),
      [
        "# Demo topic",
        "",
        "Reference: [OpenAI blog](https://openai.com/blog/example) — a source URL.",
        "",
        "Need cover: [封面：demo card]",
        ""
      ].join("\n")
    );


    const broker = new ExecutionBroker(
      fixture.paths,
      (request, runId) => fixture.resolver.resolve(request, runId),
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const run = broker.submit(SkillRunRequestSchema.parse({
      skillId: "asset-collector",
      version: "1.0.0",
      digest: fixture.digest,
      inputs: {
        // draftDir is a logical openmind path; the resolver/Broker binds OPENMIND_ROOT.
        draftDir: "creative/01-内容生产/文稿库/02-制作中/demo-pkg",
        date: "20260805"
      },
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }));
    await waitFor(() => broker.get(run.id).state === "succeeded", 30_000);

    const completed = broker.get(run.id);
    expect(completed.terminalState).toBe("succeeded");
    // Declared Artifact: assets/manifest.json under the draft package.
    const manifestPath = path.join(draftDir, "assets", "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    // The collector must have captured the source URL from the draft.
    const serialized = JSON.stringify(manifest);
    expect(serialized).toContain("openai.com/blog/example");
    // The Broker must have registered at least one declared Artifact for the run.
    expect(completed.artifacts.some((a) => a.declared && /\.json$/.test(a.logicalPath || ""))).toBe(true);
    expect(completed.runtime?.packId).toBe("python-core");
    // Runtime Pack lease released after the run.
    const leasesPath = path.join(fixture.paths.runtimePacks, "leases");
    expect(!fs.existsSync(leasesPath) || fs.readdirSync(leasesPath).length === 0).toBe(true);
  });

  linuxRealSkillIt("executes the real Batch A collect-interest-markers package", async () => {
    const fixture = createBatchAFixture("collect-interest-markers");
    const summaryPath = path.join(fixture.openmindRoot, "daily-summary", "20260805_daily_summary.md");
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(
      summaryPath,
      [
        "# Daily Summary",
        "",
        "## AI",
        "",
        "[i] 关注本地 Provider Profile 的运行时边界",
        "来源：[示例文章](https://example.com/provider-boundary)",
        "",
        "[t] 深入研究安装后 Skill 的恢复流程",
        "来源：https://example.com/skill-recovery",
        ""
      ].join("\n")
    );

    const broker = new ExecutionBroker(
      fixture.paths,
      (request, runId) => fixture.resolver.resolve(request, runId),
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const run = broker.submit(SkillRunRequestSchema.parse({
      skillId: "collect-interest-markers",
      version: "1.0.0",
      digest: fixture.digest,
      inputs: { source: "daily-summary/20260805_daily_summary.md" },
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }));
    await waitFor(() => broker.get(run.id).state === "succeeded", 30_000);

    const inboxPath = path.join(fixture.openmindRoot, "creative", "01-内容生产", "选题管理", "00-兴趣收集箱.md");
    expect(fs.existsSync(inboxPath)).toBe(true);
    const inbox = fs.readFileSync(inboxPath, "utf8");
    expect(inbox).toContain("关注本地 Provider Profile");
    expect(inbox).toContain("深入研究安装后 Skill");
    expect(inbox).toContain("example.com/provider-boundary");
    expect(broker.get(run.id).artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ declared: true, logicalPath: expect.stringContaining("00-兴趣收集箱.md") })
    ]));
    expect(broker.get(run.id).runtime?.packId).toBe("python-core");
  });

  linuxRealSkillIt("executes the real Batch A daily-writing-orchestrator package", async () => {
    const fixture = createBatchAFixture("daily-writing-orchestrator");
    const topicPath = path.join(
      fixture.openmindRoot,
      "creative",
      "01-内容生产",
      "选题管理",
      "ai_topic_2026-08-05.md"
    );
    fs.mkdirSync(path.dirname(topicPath), { recursive: true });
    fs.writeFileSync(
      topicPath,
      [
        "# AI Topic",
        "",
        "## 1. 今日最终推荐",
        "",
        "### 今日最值得优先写的主题",
        "",
        "**安装后 Skill 如何在断电后安全恢复**",
        "",
        "### 主编判断",
        "",
        "恢复证据比一次成功运行更能说明工程质量。",
        "",
        "### 首发平台建议",
        "",
        "先做一篇面向开发者的解释。",
        "",
        "### 风险控制",
        "",
        "不要把本地测试描述成跨平台发布保证。",
        ""
      ].join("\n")
    );

    const broker = new ExecutionBroker(
      fixture.paths,
      (request, runId) => fixture.resolver.resolve(request, runId),
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const run = broker.submit(SkillRunRequestSchema.parse({
      skillId: "daily-writing-orchestrator",
      version: "1.0.0",
      digest: fixture.digest,
      inputs: { date: "20260805", topic: "auto", platform: "xiaohongshu" },
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }));
    await waitFor(() => broker.get(run.id).state === "succeeded", 30_000);

    const packagesRoot = path.join(fixture.openmindRoot, "creative", "01-内容生产", "文稿库", "02-制作中");
    const packageDirs = fs.readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("20260805-"))
      .map((entry) => path.join(packagesRoot, entry.name));
    expect(packageDirs).toHaveLength(1);
    expect(fs.readFileSync(path.join(packageDirs[0], "topic-brief.md"), "utf8")).toContain("安装后 Skill 如何在断电后安全恢复");
    expect(fs.existsSync(path.join(packageDirs[0], "xiaohongshu-draft.md"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(packageDirs[0], "manifest.json"), "utf8"))).toMatchObject({
      status: "tasks_ready",
      platforms: { xiaohongshu: "task_ready" }
    });
    expect(broker.get(run.id).artifacts.some(
      (artifact) => artifact.declared && (artifact.logicalPath || "").includes("topic-brief.md")
    )).toBe(true);
    expect(broker.get(run.id).runtime?.packId).toBe("python-core");
  });

  linuxRealSkillIt("executes the real Batch B reddit-fetcher package against a local feed and persists the declared Artifact", async () => {
    const python = resolvePythonExecutable();
    expect(python).toBeTruthy();

    // reddit-fetcher declares network.required. Drive it deterministically by
    // serving a tiny Atom feed from a localhost HTTP server and pointing the
    // package's config.yaml at it — no real Reddit, no retries, fast.
    const atomFeed = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<feed xmlns=\"http://www.w3.org/2005/Atom\">",
      "  <entry>",
      "    <title>Local test post</title>",
      "    <link href=\"https://www.reddit.com/r/artificial/comments/local/test/\"/>",
      "    <updated>2026-08-05T00:00:00Z</updated>",
      "    <id>t3_local</id>",
      "  </entry>",
      "</feed>"
    ].join("\n");
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/atom+xml" });
      res.end(atomFeed);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);
    try {
      // Prepare a source copy with the localhost config BEFORE install, so the
      // recorded package digest matches what actually runs (the resolver
      // rejects post-install content changes).
      const fixture = createBatchAFixture("reddit-fetcher");
      const sourceCopy = path.join(fixture.paths.staging, "reddit-source-overlay");
      copyTree(skillSourcePath("reddit-fetcher"), sourceCopy);
      fs.writeFileSync(
        path.join(sourceCopy, "config.yaml"),
        [
          "fetch:",
          "  timeout_seconds: 5",
          "  user_agent: \"openmind-test/1.0\"",
          "  rss_only: true",
          "  listing_retry_count: 0",
          "  comment_retry_count: 0",
          "  request_delay_seconds: 0",
          "  sources:",
          `    - "http://127.0.0.1:${port}/r/artificial/hot/.rss"`,
          "storage:",
          "  output_dir: \"\"",
          "  cache_file: \"\""
        ].join("\n")
      );
      const installed = fixture.packages.install(sourceCopy);


      const broker = new ExecutionBroker(
        fixture.paths,
        (request, runId) => fixture.resolver.resolve(request, runId),
        undefined,
        { maxConcurrentRuns: 1 }
      );
      const run = broker.submit(SkillRunRequestSchema.parse({
        skillId: "reddit-fetcher",
        version: "1.0.0",
        digest: installed.digest,
        inputs: { date: "20260805" },
        providerBindings: {},
        trigger: { type: "manual" },
        externalExportBindingIds: [],
        rootGeneration: 1
      }));
      await waitFor(() => broker.get(run.id).state === "succeeded", 30_000);

      const completed = broker.get(run.id);
      expect(completed.terminalState).toBe("succeeded");
      // The package writes reddit/<date>/<subreddit>.md per its contract.
      const written = path.join(fixture.openmindRoot, "reddit", "20260805", "artificial.md");
      expect(fs.existsSync(written)).toBe(true);
      expect(fs.readFileSync(written, "utf8")).toContain("Local test post");
      // Declared directory Artifact (reddit/**) collected. The collector
      // reports logical paths with the `openmind/` prefix per the openmind layout.
      const redditArtifacts = completed.artifacts.filter(
        (a) => a.declared && (a.logicalPath || "").startsWith("openmind/reddit/20260805")
      );
      expect(redditArtifacts.length).toBeGreaterThan(0);
      expect(redditArtifacts.some((a) => /\.md$/.test(a.logicalPath || ""))).toBe(true);
      expect(completed.runtime?.packId).toBe("python-core");
    } finally {
      server.close();
    }
  });

  linuxRealSkillIt("executes the real Batch B rss-article-saver package against a local RSS source", async () => {
    // The RSS package has native/content-extraction dependencies. Use its
    // checked-in development venv for this focused package-contract test;
    // clean-machine dependency installation remains a separate Runtime Pack
    // gate and is deliberately not hidden by a system-Python fallback.
    const python = resolveSkillPython("rss-article-saver");
    expect(python).toBeTruthy();

    const feed = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<rss version=\"2.0\"><channel>",
      "<title>Local openmind feed</title>",
      "<item>",
      "<title>Local RSS article</title>",
      "<link>http://127.0.0.1/article.html</link>",
      "<pubDate>Wed, 05 Aug 2026 00:00:00 GMT</pubDate>",
      "<description>Local RSS description</description>",
      "</item>",
      "</channel></rss>"
    ].join("");
    const articleHtml = [
      "<!doctype html><html><head><title>Local RSS article</title></head><body>",
      "<article><h1>Local RSS article</h1>",
      "<p>This local article validates RSS discovery, content extraction, and the bound openmind output contract.</p>",
      "<p>The installed Skill must write the article below the Broker-provided root and keep its cache in app-private Skill data.</p>",
      "</article></body></html>"
    ].join("");
    const server = http.createServer((req, res) => {
      if (req.url === "/article.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(articleHtml);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8" });
      res.end(feed.replace("http://127.0.0.1/article.html", `http://127.0.0.1:${port}/article.html`));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    try {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-rss-installed-"));
      roots.push(fixtureRoot);
      const paths = buildAppPaths(path.join(fixtureRoot, "user-data"), resolveSkillStoreRoot(path.join(fixtureRoot, "openmind")));
      ensureAppPaths(paths);
      const openmindRoot = path.join(fixtureRoot, "openmind");
      fs.mkdirSync(openmindRoot, { recursive: true });
      bindEmptyProviderWorkspace(fixtureRoot);
      // RuntimeManager canonicalizes the executable path. Keep the venv
      // context through a managed wrapper so canonicalization does not turn
      // the venv's python symlink into the system interpreter.
      const pythonWrapper = path.join(paths.staging, "rss-python-wrapper");
      fs.writeFileSync(pythonWrapper, `#!/bin/sh\nexec ${JSON.stringify(python)} "$@"\n`);
      fs.chmodSync(pythonWrapper, 0o755);
      const packages = new SkillPackageService(paths);
      const runtimePacks = installSignedRuntimePack(paths, "python-core", "3.12.1");
      const runtime = new RuntimeManager(paths, {
        target: "linux-x64",
        getActivePack: (packId, target) => runtimePacks.getActive(packId, target),
        resolveExecutable: () => pythonWrapper,
        prepareEnvironment: async () => undefined
      });
      const resolver = new InstalledSkillExecutionResolver(packages, runtime, openmindRoot, 1);

      const sourceCopy = path.join(paths.staging, "rss-source-overlay");
      copyTree(skillSourcePath("rss-article-saver"), sourceCopy);
      fs.writeFileSync(
        path.join(sourceCopy, "subscriptions.opml"),
        [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<opml version=\"2.0\"><head><title>Test</title></head><body>",
          `<outline text=\"Local\" type=\"rss\" xmlUrl=\"http://127.0.0.1:${port}/feed.xml\"/>`,
          "</body></opml>"
        ].join("")
      );
      fs.writeFileSync(
        path.join(sourceCopy, "config.yaml"),
        [
          "article_base_dir: \"\"",
          "opml_file: \"subscriptions.opml\"",
          "max_articles_per_feed: 1",
          "max_article_age_days: 3650",
          "content:",
          "  extractor: trafilatura",
          "  include_images: false",
          "  max_content_length: 50000",
          "  wechat:",
          "    enabled: false",
          "ai:",
          "  enabled: false",
          "translation:",
          "  enabled: false"
        ].join("\n")
      );
      const installed = packages.install(sourceCopy);

      const broker = new ExecutionBroker(
        paths,
        (request, runId) => resolver.resolve(request, runId),
        undefined,
        { maxConcurrentRuns: 1 }
      );
      const run = broker.submit(SkillRunRequestSchema.parse({
        skillId: "rss-article-saver",
        version: "1.0.0",
        digest: installed.digest,
        inputs: { date: "20260805" },
        providerBindings: { default: "profile-main" },
        trigger: { type: "manual" },
        externalExportBindingIds: [],
        rootGeneration: 1
      }));
      await waitFor(
        () => ["succeeded", "failed", "cancelled", "timed_out"].includes(broker.get(run.id).state),
        60_000
      );

      const completed = broker.get(run.id);
      if (completed.state !== "succeeded") {
        throw new Error([
          `rss-article-saver ended in ${completed.state}`,
          `error: ${completed.error || ""}`,
          ...broker.events(run.id).map((event) => `${event.stream || event.state || "event"}: ${event.text || ""}`)
        ].join("\n"));
      }
      expect(completed.terminalState).toBe("succeeded");
      const articleFiles = findMarkdownFiles(path.join(openmindRoot, "article"));
      expect(articleFiles).toHaveLength(1);
      expect(fs.readFileSync(articleFiles[0], "utf8")).toContain("Local RSS article");
      expect(completed.artifacts.some(
        (artifact) => artifact.declared && (artifact.logicalPath || "").startsWith("openmind/article/")
      )).toBe(true);
      expect(completed.runtime?.packId).toBe("python-core");
      expect(fs.existsSync(path.join(openmindRoot, ".agent", "skills"))).toBe(true);
    } finally {
      server.close();
    }
  }, 120_000);

  linuxRealSkillIt("executes the real Batch B knowledge-wiki-compiler package under the bound root", async () => {
    // Production uses the app-wide shared interpreter; this resolver contract
    // test must not require the Skill source to own a private .venv.
    const python = resolveSkillPython("knowledge-wiki-compiler") || resolvePythonExecutable();
    expect(python).toBeTruthy();

    const providerRequests: Array<{ authorization: string; body: string }> = [];
    const server = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        providerRequests.push({
          authorization: String(req.headers.authorization || ""),
          body: Buffer.concat(chunks).toString("utf8")
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    try {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-wiki-installed-"));
      roots.push(fixtureRoot);
      const paths = buildAppPaths(path.join(fixtureRoot, "user-data"), resolveSkillStoreRoot(path.join(fixtureRoot, "openmind")));
      ensureAppPaths(paths);
      const openmindRoot = path.join(fixtureRoot, "openmind");
      const articleDir = path.join(openmindRoot, "article", "20260805");
      bindTestProvider(fixtureRoot, port, "wiki-test-credential");
      fs.mkdirSync(articleDir, { recursive: true });
      fs.writeFileSync(
        path.join(articleDir, "wiki-test.md"),
        [
          "# Wiki chain article",
          "",
          "## 元数据",
          "",
          "- **链接**: https://example.test/wiki-chain",
          "- **发布时间**: 2026-08-05",
          "",
          "## 正文",
          "",
          "AI agent workflow uses explicit context and repeatable evaluation steps.",
          "The article is seeded to verify source scanning, private compiler state, and wiki output placement."
        ].join("\n")
      );
      const packages = new SkillPackageService(paths);
      const runtimePacks = installSignedRuntimePack(paths, "python-core", "3.12.1");
      const pythonWrapper = path.join(paths.staging, "wiki-python-wrapper");
      fs.writeFileSync(pythonWrapper, `#!/bin/sh\nexec ${JSON.stringify(python)} "$@"\n`);
      fs.chmodSync(pythonWrapper, 0o755);
      const runtime = new RuntimeManager(paths, {
        target: "linux-x64",
        getActivePack: (packId, target) => runtimePacks.getActive(packId, target),
        resolveExecutable: () => pythonWrapper,
        prepareEnvironment: async () => undefined
      });
      const resolver = new InstalledSkillExecutionResolver(packages, runtime, openmindRoot, 1);
      const installed = packages.install(skillSourcePath("knowledge-wiki-compiler"));

      const broker = new ExecutionBroker(
        paths,
        (request, runId) => resolver.resolve(request, runId),
        undefined,
        { maxConcurrentRuns: 1 }
      );
      const run = broker.submit(SkillRunRequestSchema.parse({
        skillId: "knowledge-wiki-compiler",
        version: "1.0.0",
        digest: installed.digest,
        inputs: { date: "20260805" },
        providerBindings: { default: "default" },
        trigger: { type: "manual" },
        externalExportBindingIds: [],
        rootGeneration: 1
      }));
      await waitFor(
        () => ["succeeded", "failed", "cancelled", "timed_out"].includes(broker.get(run.id).state),
        60_000
      );
      const completed = broker.get(run.id);
      if (completed.state !== "succeeded") {
        throw new Error([
          `knowledge-wiki-compiler ended in ${completed.state}`,
          ...broker.events(run.id).map((event) => `${event.stream || event.state || "event"}: ${event.text || ""}`)
        ].join("\n"));
      }
      expect(findMarkdownFiles(path.join(openmindRoot, "wiki")).length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(openmindRoot, "wiki-state"))).toBe(false);
      expect(fs.existsSync(path.join(openmindRoot, ".agent", "skill-data", "knowledge-wiki-compiler", "wiki-state"))).toBe(true);
      // AI generation is optional in the current Skill config. If enabled,
      // every request must still receive the scoped credential.
      expect(providerRequests.every((request) => request.authorization === "Bearer wiki-test-credential")).toBe(true);
      expect(completed.artifacts.some(
        (artifact) => artifact.declared && (artifact.logicalPath || "").startsWith("openmind/wiki/")
      )).toBe(true);
      expect(completed.runtime?.packId).toBe("python-core");
    } finally {
      server.close();
    }
  }, 120_000);

  linuxRealSkillIt("executes the real x-following-fetcher package with managed JSON credentials", async () => {
    const python = resolveSkillPython("x-following-fetcher");
    expect(python).toBeTruthy();

    const timelinePayload = {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [{
              type: "TimelineAddEntries",
              entries: [{
                content: {
                  __typename: "TimelineTimelineItem",
                  itemContent: {
                    __typename: "TimelineTimelineItemContent",
                    tweet_results: {
                      result: {
                        __typename: "Tweet",
                        core: {
                          user_results: {
                            result: { core: { name: "Managed User", screen_name: "managed_user" } }
                          }
                        },
                        legacy: {
                          id_str: "9001",
                          created_at: "Wed Aug 05 00:00:00 +0000 2026",
                          full_text: "Managed credential X post",
                          lang: "en",
                          favorite_count: 1,
                          retweet_count: 2,
                          reply_count: 0,
                          quote_count: 0,
                          bookmark_count: 0,
                          entities: { urls: [] }
                        }
                      }
                    }
                  }
                }
              }]
            }]
          }
        }
      }
    };
    const requests: Array<{ authorization: string; body: string }> = [];
    const server = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push({
          authorization: String(req.headers.authorization || ""),
          body: Buffer.concat(chunks).toString("utf8")
        });
        const body = JSON.stringify(timelinePayload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    try {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-x-installed-"));
      roots.push(fixtureRoot);
      const paths = buildAppPaths(path.join(fixtureRoot, "user-data"), resolveSkillStoreRoot(path.join(fixtureRoot, "openmind")));
      ensureAppPaths(paths);
      const openmindRoot = path.join(fixtureRoot, "openmind");
      fs.mkdirSync(openmindRoot, { recursive: true });
      bindEmptyProviderWorkspace(fixtureRoot);
      const pythonWrapper = path.join(paths.staging, "x-python-wrapper");
      fs.writeFileSync(pythonWrapper, `#!/bin/sh\nexec ${JSON.stringify(python)} "$@"\n`);
      fs.chmodSync(pythonWrapper, 0o755);
      const packages = new SkillPackageService(paths);
      const runtimePacks = installSignedRuntimePack(paths, "python-core", "3.12.1");
      const runtime = new RuntimeManager(paths, {
        target: "linux-x64",
        getActivePack: (packId, target) => runtimePacks.getActive(packId, target),
        resolveExecutable: () => pythonWrapper,
        prepareEnvironment: async () => undefined
      });
      const credential = JSON.stringify({
        requests: [{
          label: "following",
          method: "POST",
          url: `http://127.0.0.1:${port}/graphql`,
          headers: { Authorization: "Bearer managed-x-token" },
          json: { variables: { count: 1 } }
        }]
      });
      const resolver = new InstalledSkillExecutionResolver(packages, runtime, openmindRoot, 1);
      const sourceCopy = path.join(paths.staging, "x-source-overlay");
      copyTree(skillSourcePath("x-following-fetcher"), sourceCopy);
      const sourceManifest = path.join(sourceCopy, "cctools.skill.yaml");
      fs.writeFileSync(
        sourceManifest,
        fs.readFileSync(sourceManifest, "utf8").replace(
          'X_FETCHER_CREDENTIAL_JSON: "{{ secrets.session }}"',
          `X_FETCHER_CREDENTIAL_JSON: '${credential}'`
        )
      );
      const installed = packages.install(sourceCopy);

      const broker = new ExecutionBroker(
        paths,
        (request, runId) => resolver.resolve(request, runId),
        undefined,
        { maxConcurrentRuns: 1 }
      );
      const run = broker.submit(SkillRunRequestSchema.parse({
        skillId: "x-following-fetcher",
        version: "1.0.0",
        digest: installed.digest,
        inputs: {},
        providerBindings: {},
        trigger: { type: "manual" },
        externalExportBindingIds: [],
        rootGeneration: 1
      }));
      await waitFor(
        () => ["succeeded", "failed", "cancelled", "timed_out"].includes(broker.get(run.id).state),
        60_000
      );
      const completed = broker.get(run.id);
      if (completed.state !== "succeeded") {
        throw new Error([
          `x-following-fetcher ended in ${completed.state}`,
          `error: ${completed.error || ""}`,
          ...broker.events(run.id).map((event) => `${event.stream || event.state || "event"}: ${event.text || ""}`)
        ].join("\n"));
      }
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const postFile = path.join(openmindRoot, "post", today, "posts.json");
      expect(fs.existsSync(postFile)).toBe(true);
      expect(fs.readFileSync(postFile, "utf8")).toContain("Managed credential X post");
      expect(requests.length).toBe(1);
      expect(requests[0].authorization).toBe("Bearer managed-x-token");
      expect(JSON.parse(requests[0].body).variables.count).toBe(20);
      expect(completed.artifacts.some(
        (artifact) => artifact.declared && (artifact.logicalPath || "").startsWith("openmind/post/")
      )).toBe(true);
      expect(completed.runtime?.packId).toBe("python-core");
    } finally {
      server.close();
    }
  }, 120_000);

  linuxRealSkillIt("chains reddit-fetcher → daily-article-summarizer → daily-topic-selector under one shared root snapshot", async () => {
    // This is the first multi-Skill link of the RSS → Summary → Topic chain
    // (plan §17.7): the summarizer reads the fetcher's reddit/** output and
    // produces the daily-summary Artifact under the SAME openmind root snapshot.
    const python = resolvePythonExecutable();
    expect(python).toBeTruthy();

    // --- Stage 1: reddit-fetcher writes reddit/20260805/<subreddit>.md ---
    const atomFeed = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<feed xmlns=\"http://www.w3.org/2005/Atom\">",
      "  <entry>",
      "    <title>Chained test post</title>",
      "    <link href=\"https://www.reddit.com/r/artificial/comments/chain/test/\"/>",
      "    <updated>2026-08-05T00:00:00Z</updated>",
      "    <id>t3_chain</id>",
      "  </entry>",
      "</feed>"
    ].join("\n");
    const providerRequests: Array<{ authorization: string; body: string }> = [];
    const server = http.createServer((req, res) => {
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          providerRequests.push({
            authorization: String(req.headers.authorization || ""),
            body: Buffer.concat(chunks).toString("utf8")
          });
          const response = {
            translated_title: "链路测试文章",
            summary: "本地 Provider 用固定 JSON 响应验证 RSS、总结和选题之间的运行时交接。",
            key_points: ["三个 Skill 共享同一个 openmindRoot 和 rootGeneration"],
            category: "AI",
            score: 90,
            wechat: [1],
            reddit: [{ index: 1, reason: "本地链路测试条目" }],
            overview: "本地 Provider 已完成帖子摘要测试。",
            themes: ["Provider Profile 连接"],
            highlights: []
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(response) } }]
          }));
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "application/atom+xml" });
      res.end(atomFeed);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    try {
      // Build ONE shared fixture and install all three packages into it. The
      // skills share the same openmindRoot + rootGeneration (same snapshot).
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-chain-"));
      roots.push(fixtureRoot);
      const paths = buildAppPaths(path.join(fixtureRoot, "user-data"), resolveSkillStoreRoot(path.join(fixtureRoot, "openmind")));
      ensureAppPaths(paths);
      const openmindRoot = path.join(fixtureRoot, "openmind");
      fs.mkdirSync(openmindRoot, { recursive: true });
      bindTestProvider(fixtureRoot, port, "mock-credential-for-credential-token");
      // Seed an article so the summarizer has content to process and reaches
      // the _write_full_summary_file path. Without AI keys the per-article
      // summarization no-ops (returns None), but the summary file is still
      // written with whatever cached/reddit content exists.
      fs.mkdirSync(path.join(openmindRoot, "article", "20260805"), { recursive: true });
      fs.writeFileSync(
        path.join(openmindRoot, "article", "20260805", "chained-article.md"),
        "# Chained article\n\n- 来源: Test\n\n正文内容用于链路验证。\n"
      );
      const packages = new SkillPackageService(paths);
      const runtimePacks = installSignedRuntimePack(paths, "python-core", "3.12.1");
      const runtime = new RuntimeManager(paths, {
        target: "linux-x64",
        getActivePack: (packId, target) => runtimePacks.getActive(packId, target),
        resolveExecutable: () => resolvePythonExecutable() || process.execPath,
        prepareEnvironment: async () => undefined
      });

      // Both AI-backed packages require a Provider Profile + bound credential.
      // Point them at the same local OpenAI-compatible endpoint so the chain
      // verifies actual environment injection and JSON response handling
      // without contacting an external provider.
      const resolver = new InstalledSkillExecutionResolver(packages, runtime, openmindRoot, 1);

      // Install reddit-fetcher with the localhost config overlay.
      const redditSourceCopy = path.join(paths.staging, "reddit-source-overlay");
      copyTree(skillSourcePath("reddit-fetcher"), redditSourceCopy);
      fs.writeFileSync(
        path.join(redditSourceCopy, "config.yaml"),
        [
          "fetch:",
          "  timeout_seconds: 5",
          "  user_agent: \"openmind-test/1.0\"",
          "  rss_only: true",
          "  listing_retry_count: 0",
          "  comment_retry_count: 0",
          "  request_delay_seconds: 0",
          "  sources:",
          `    - "http://127.0.0.1:${port}/r/artificial/hot/.rss"`,
          "storage:",
          "  output_dir: \"\"",
          "  cache_file: \"\""
        ].join("\n")
      );
      const redditInstalled = packages.install(redditSourceCopy);

      // Install daily-article-summarizer (no overlay; uses bundled config).
      const summarizerSource = path.join(paths.staging, "summarizer-source");
      copyTree(skillSourcePath("daily-article-summarizer"), summarizerSource);
      const summarizerInstalled = packages.install(summarizerSource);

      // Install the third link against the exact same root and Runtime Pack.
      const topicSource = skillSourcePath("daily-topic-selector");
      const topicInstalled = packages.install(topicSource);

      const broker = new ExecutionBroker(
        paths,
        (request, runId) => resolver.resolve(request, runId),
        undefined,
        { maxConcurrentRuns: 1 }
      );

      // --- Stage 1 run: reddit-fetcher ---
      const fetchRun = broker.submit(SkillRunRequestSchema.parse({
        skillId: "reddit-fetcher",
        version: "1.0.0",
        digest: redditInstalled.digest,
        inputs: { date: "20260805" },
        providerBindings: {},
        trigger: { type: "manual" },
        externalExportBindingIds: [],
        rootGeneration: 1
      }));
      await waitFor(() => broker.get(fetchRun.id).state === "succeeded", 30_000);
      const redditFile = path.join(openmindRoot, "reddit", "20260805", "artificial.md");
      expect(fs.existsSync(redditFile)).toBe(true);
      expect(fs.readFileSync(redditFile, "utf8")).toContain("Chained test post");

      // --- Stage 2 run: daily-article-summarizer (reads reddit/**, writes daily-summary) ---
      const summaryRun = broker.submit(SkillRunRequestSchema.parse({
        skillId: "daily-article-summarizer",
        version: "1.0.0",
        digest: summarizerInstalled.digest,
        inputs: { date: "20260805" },
        providerBindings: { default: "default" },
        trigger: { type: "manual" },
        externalExportBindingIds: [],
        rootGeneration: 1
      }));
      await waitFor(() => broker.get(summaryRun.id).state === "succeeded", 60_000);

      const summaryCompleted = broker.get(summaryRun.id);
      expect(summaryCompleted.terminalState).toBe("succeeded");
      // Declared Artifact: daily-summary/20260805_daily_summary.md
      const summaryFile = path.join(openmindRoot, "daily-summary", "20260805_daily_summary.md");
      expect(fs.existsSync(summaryFile)).toBe(true);
      const summaryText = fs.readFileSync(summaryFile, "utf8");
      if (!summaryText.includes("链路测试文章")) {
        throw new Error([
          "daily-article-summarizer did not render the deterministic article summary",
          summaryText,
          `provider requests: ${JSON.stringify(providerRequests)}`,
          ...broker.events(summaryRun.id).map((event) => `${event.stream || event.state || "event"}: ${event.text || ""}`)
        ].join("\n"));
      }
      expect(summaryCompleted.artifacts.some(
        (a) => a.declared && (a.logicalPath || "").includes("daily-summary/20260805_daily_summary.md")
      )).toBe(true);

      // --- Stage 3 run: daily-topic-selector (reads daily-summary, writes daily-topic) ---
      const topicRun = broker.submit(SkillRunRequestSchema.parse({
        skillId: "daily-topic-selector",
        version: "1.0.0",
        digest: topicInstalled.digest,
        inputs: { date: "20260805" },
        providerBindings: { default: "default" },
        trigger: { type: "manual" },
        externalExportBindingIds: [],
        rootGeneration: 1
      }));
      await waitFor(
        () => ["succeeded", "failed", "cancelled"].includes(broker.get(topicRun.id).state),
        60_000
      );

      const topicCompleted = broker.get(topicRun.id);
      if (topicCompleted.state !== "succeeded") {
        throw new Error([
          `daily-topic-selector ended in ${topicCompleted.state}`,
          ...broker.events(topicRun.id).map((event) => event.text || "")
        ].join("\n"));
      }
      expect(topicCompleted.terminalState).toBe("succeeded");
      const topicFile = path.join(openmindRoot, "daily-topic", "20260805_daily_topic.md");
      expect(fs.existsSync(topicFile)).toBe(true);
      expect(fs.readFileSync(topicFile, "utf8")).toContain("链路测试文章");
      expect(topicCompleted.artifacts.some(
        (a) => a.declared && (a.logicalPath || "").includes("daily-topic/20260805_daily_topic.md")
      )).toBe(true);

      // Both AI stages used the injected scoped credential, and all three
      // stages stayed on the same managed Runtime Pack.
      expect(providerRequests.length).toBeGreaterThan(0);
      expect(providerRequests.every((request) => request.authorization === "Bearer mock-credential-for-credential-token")).toBe(true);
      expect(providerRequests.every((request) => request.body.includes("local-test-model"))).toBe(true);
      // All three runs shared the same root snapshot (same openmindRoot + generation).
      expect(broker.get(fetchRun.id).runtime?.packId).toBe("python-core");
      expect(summaryCompleted.runtime?.packId).toBe("python-core");
      expect(topicCompleted.runtime?.packId).toBe("python-core");
    } finally {
      server.close();
    }
  }, 120_000);
});

function createFixture(
  withProvider = false,
  runtimeKind: "python" | "node" = "python",
  options: { managedRuntime?: boolean; credentialFile?: boolean; externalExport?: boolean; agent?: boolean } = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-installed-resolver-"));
  roots.push(root);
  const paths = buildAppPaths(path.join(root, "user-data"), resolveSkillStoreRoot(path.join(root, "openmind")));
  ensureAppPaths(paths);
  const source = path.join(root, "source");
  const openmindRoot = path.join(root, "openmind");
  const externalRoot = path.join(root, "export");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(openmindRoot, { recursive: true });
  if (options.externalExport) fs.mkdirSync(externalRoot, { recursive: true });
  if (runtimeKind === "node") {
    fs.writeFileSync(path.join(source, "main.js"), [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const dateIndex = process.argv.indexOf('--date');",
      "const date = dateIndex >= 0 ? process.argv[dateIndex + 1] : 'missing';",
      "const output = path.join(process.env.OPENMIND_ROOT, 'daily-summary', `${date}.md`);",
      "fs.mkdirSync(path.dirname(output), { recursive: true });",
      "fs.writeFileSync(output, `# ${date}\\nruntime=${process.execPath}\\nPATH=${process.env.PATH || '<unset>'}\\n`);",
      "console.log(`created ${date}`);",
      ""
    ].join("\n"));
    fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "resolver-fixture", version: "1.0.0" }));
  } else {
    fs.writeFileSync(path.join(source, "main.py"), "print('ok')\n");
    fs.writeFileSync(path.join(source, "pyproject.toml"), "[project]\nname='resolver-fixture'\nversion='1.0.0'\n");
  }
  if (options.agent) {
    fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: resolver-fixture\ndescription: Test Agent Skill\n---\n\n# Resolver Fixture\n");
  }
  fs.writeFileSync(
    path.join(source, "openmind.skill.yaml"),
    options.agent ? agentManifestYaml() : manifestYaml(withProvider, runtimeKind, options.externalExport)
  );
  const packages = new SkillPackageService(paths);
  const installed = packages.install(source);
  const key = installed.key;
  const digest = installed.digest;
  const packId: "python-core" | "node-22" = runtimeKind === "node" ? "node-22" : "python-core";
  const runtimeBytes = options.managedRuntime && runtimeKind === "node"
    ? Buffer.from(zipSync({ "bin/node": new Uint8Array(fs.readFileSync(process.execPath)) }, { level: 0 }))
    : undefined;
  const runtimePacks = installSignedRuntimePack(paths, packId, runtimeKind === "node" ? "22.0.0" : "3.12.1", runtimeBytes);
  const runtime = new RuntimeManager(paths, {
    target: "linux-x64",
    getActivePack: (requestedPackId, target) => runtimePacks.getActive(requestedPackId, target),
    // The signed test pack contains no platform binary; use the injected resolver
    // to keep this test focused on the package → Manager → Broker execution chain.
    ...(options.managedRuntime ? {} : {
      resolveExecutable: () => process.execPath,
      prepareEnvironment: async () => undefined
    })
  });
  const runtimePack = runtimePacks.getActive(packId, "linux-x64");
  if (!runtimePack) throw new Error(`test Runtime Pack 未激活：${packId}`);
  return {
    packages,
    paths,
    source,
    resolver: new InstalledSkillExecutionResolver(
      packages,
      runtime,
      openmindRoot,
      1,
      options.externalExport ? (bindingId) => bindingId === "exportDir" ? { bindingId, canonicalPath: externalRoot } : undefined : undefined
    ),
    key,
    digest,
    openmindRoot,
    externalRoot,
    runtimePack
  };
}

function createWorkflowAdmissionFixture() {
  const fixture = createFixture();
  const first = fixture.packages.getInstalledById("resolver-fixture")!;
  const secondSource = path.join(fixture.paths.staging, "resolver-step-two-source");
  fs.mkdirSync(secondSource, { recursive: true });
  fs.writeFileSync(path.join(secondSource, "main.py"), "print('second')\n");
  fs.writeFileSync(path.join(secondSource, "pyproject.toml"), "[project]\nname='resolver-step-two'\nversion='1.0.0'\n");
  fs.writeFileSync(
    path.join(secondSource, "openmind.skill.yaml"),
    manifestYaml().replaceAll("resolver-fixture", "resolver-step-two").replace("Resolver Fixture", "Resolver Step Two")
  );
  const second = fixture.packages.install(secondSource);

  const workflowSource = path.join(fixture.paths.staging, "resolver-workflow-source");
  fs.mkdirSync(workflowSource, { recursive: true });
  fs.writeFileSync(path.join(workflowSource, "openmind.skill.yaml"), workflowManifestYaml());
  const workflow = fixture.packages.install(workflowSource);
  return { ...fixture, first, second, workflow };
}

function createBatchAFixture(packageName = "skill-run-reporter") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-batch-a-installed-"));
  roots.push(root);
  const paths = buildAppPaths(path.join(root, "user-data"), resolveSkillStoreRoot(path.join(root, "openmind")));
  ensureAppPaths(paths);
  const openmindRoot = path.join(root, "openmind");
  fs.mkdirSync(path.join(openmindRoot, "article", "20260805"), { recursive: true });
  fs.writeFileSync(path.join(openmindRoot, "article", "20260805", "one.md"), "article\n");
  const source = skillSourcePath(packageName);
  const packages = new SkillPackageService(paths);
  const installed = packages.install(source);
  const runtimePacks = installSignedRuntimePack(paths, "python-core", "3.12.1");
  const runtime = new RuntimeManager(paths, {
    target: "linux-x64",
    getActivePack: (packId, target) => runtimePacks.getActive(packId, target),
    resolveExecutable: () => resolvePythonExecutable() || process.execPath,
    prepareEnvironment: async () => undefined
  });
  return {
    paths,
    packages,
    resolver: new InstalledSkillExecutionResolver(packages, runtime, openmindRoot, 1),
    key: installed.key,
    digest: installed.digest,
    openmindRoot,
    source
  };
}

function installSignedRuntimePack(
  paths: ReturnType<typeof buildAppPaths>,
  packId: "python-core" | "node-22",
  version: string,
  packBytes?: Buffer
): RuntimePackService {
  const bytes = packBytes || Buffer.from(`signed-runtime-pack:${packId}:${version}`);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const unsigned = RuntimePackMetadataSchema.parse({
    schemaVersion: 1,
    packId,
    version,
    target: "linux-x64",
    filename: `${packId}.pack`,
    size: bytes.byteLength,
    sha256,
    publisherKeyId: "runtimeRoot",
    signatureAlgorithm: "ed25519",
    signature: "placeholder",
    expiresAt: "2027-01-01T00:00:00.000Z",
    license: "Apache-2.0",
    sbom: { format: "spdx", digest: sha256 }
  });
  const signingKeys = crypto.generateKeyPairSync("ed25519");
  const service = new RuntimePackService(paths, {
    runtimeRoot: signingKeys.publicKey.export({ type: "spki", format: "pem" }).toString()
  });
  service.install({
    ...unsigned,
    signature: crypto.sign(null, Buffer.from(canonicalRuntimePackPayload(unsigned)), signingKeys.privateKey).toString("base64")
  }, bytes);
  service.activate(packId, "linux-x64", sha256);
  return service;
}

function resolvePythonExecutable(): string | undefined {
  for (const command of ["python3", "python"]) {
    try {
      const executable = execFileSync(command, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
      if (executable && path.isAbsolute(executable) && fs.statSync(executable).isFile()) return executable;
    } catch { /* Try the next interpreter name. */ }
  }
  return undefined;
}

function resolveSkillPython(skillId: string): string | undefined {
  const candidate = path.join(skillSourcePath(skillId), ".venv", "bin", "python");
  try {
    return fs.statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function skillSourcePath(skillId: string): string {
  return path.join(EXTERNAL_SKILLS_ROOT, skillId);
}

function bindEmptyProviderWorkspace(workspaceRoot: string): void {
  process.env.OPENMIND_WORKSPACE_ROOT = workspaceRoot;
}

function bindTestProvider(workspaceRoot: string, port: number, apiKey: string): void {
  const configRoot = path.join(workspaceRoot, "config");
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(path.join(configRoot, "providers.yaml"), JSON.stringify({
    schemaVersion: 1,
    default: "local-test",
    cli: { claude: null, codex: null },
    providers: [{
      id: "local-test",
      name: "Local test provider",
      enabled: true,
      protocol: "openai-chat",
      authMode: "bearer",
      apiKey,
      baseUrl: `http://127.0.0.1:${port}`,
      model: "local-test-model",
      proxyUrl: "",
      proxyPolicy: "disabled",
      tlsPolicy: "verify"
    }]
  }, null, 2));
  process.env.OPENMIND_WORKSPACE_ROOT = workspaceRoot;
}

/** Recursively copy a directory tree (used to overlay test config before install).
 *  Skips `.env`/`.venv`/`__pycache__`/`.git` (the installer excludes them anyway, and
 *  they may contain symlinks that break a naive recursive copy). */
function copyTree(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".env" || entry.name === ".venv" || entry.name === "__pycache__" || entry.name === ".git") continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      // Preserve symlinks as-is; the installer handles/realpath them.
      fs.symlinkSync(fs.readlinkSync(from), to);
    } else if (entry.isDirectory()) {
      copyTree(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function findMarkdownFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...findMarkdownFiles(candidate));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(candidate);
  }
  return files.sort();
}

function runRequest(digest: string, providerBindings: Record<string, string> = {}) {
  return SkillRunRequestSchema.parse({
    skillId: "resolver-fixture",
    version: "1.0.0",
    digest,
    inputs: { date: "20260805" },
    providerBindings,
    trigger: { type: "manual" },
    externalExportBindingIds: [],
    rootGeneration: 1
  });
}

function manifestYaml(withProvider = false, runtimeKind: "python" | "node" = "python", externalExport = false): string {
  const isNode = runtimeKind === "node";
  return [
    "apiVersion: openmind.dev/skill/v1",
    "id: resolver-fixture",
    "version: 1.0.0",
    "publisher:",
    "  id: openmind",
    "  displayName: openmind",
    "kind: process",
    "display:",
    "  name: Resolver Fixture",
    "  description: test",
    "entrypoint:",
    `  runtime: ${runtimeKind}`,
    `  script: ${isNode ? "main.js" : "main.py"}`,
    "  args:",
    "    - --date",
    "    - '{{ inputs.date }}'",
    ...(externalExport ? [
      "    - --export",
      "    - '{{ exports.exportDir }}'"
    ] : []),
    "runtime:",
    `  version: '${isNode ? ">=22.0,<23.0" : ">=3.11,<3.13"}'`,
    `  dependencyFile: ${isNode ? "package.json" : "pyproject.toml"}`,
    "  packs:",
    `    - ${isNode ? "node-22" : "python-core"}`,
    "inputs:",
    "  type: object",
    "  properties:",
    "    optionalName:",
    "      type: string",
    "      default: fallback",
    "capabilities:",
    "  openmind:",
    "    read: []",
    "    write:",
    "      - daily-summary/**",
    "  network:",
    "    required: false",
    "    hosts: []",
    "artifacts:",
    "  - id: summary",
    "    type: markdown",
    "    path: daily-summary/{{ inputs.date }}.md",
    "  - id: defaulted",
    "    type: markdown",
    "    path: daily-summary/{{ inputs.optionalName }}.md",
    ...(externalExport ? [
      "  - id: export",
      "    type: directory",
      "    externalExportId: exportDir"
    ] : []),
    "execution:",
    "  concurrency:",
    "    maxInstances: 1",
    "    mutexes:",
    "      - openmind:daily-summary",
    "  timeoutSeconds: 60",
    "  gracefulStopSeconds: 1",
    "platforms:",
    "  - linux-x64",
    "compatibility:",
    "  minAppVersion: 1.0.0",
    ""
  ].join("\n");
}

function agentManifestYaml(): string {
  return [
    "apiVersion: openmind.dev/skill/v1",
    "id: resolver-fixture",
    "version: 1.0.0",
    "publisher:",
    "  id: openmind",
    "  displayName: openmind",
    "kind: agent",
    "display:",
    "  name: Resolver Fixture",
    "  description: test agent",
    "  group: test",
    "capabilities:",
    "  openmind:",
    "    read: []",
    "    write: []",
    "  network:",
    "    required: false",
    "    hosts: []",
    "  subprocess:",
    "    allowed: false",
    "  browser: false",
    "artifacts: []",
    "execution:",
    "  concurrency:",
    "    maxInstances: 1",
    "    mutexes: []",
    "  timeoutSeconds: 1800",
    "  gracefulStopSeconds: 10",
    "  retry:",
    "    maxAttempts: 0",
    "platforms: [windows-x64, macos-arm64, linux-x64, wsl-linux-x64]",
    "compatibility:",
    "  minAppVersion: 1.0.0",
    ""
  ].join("\n");
}

function workflowManifestYaml(): string {
  return [
    "apiVersion: openmind.dev/skill/v1",
    "id: resolver-workflow",
    "version: 1.0.0",
    "publisher:",
    "  id: openmind",
    "  displayName: openmind",
    "kind: workflow",
    "display:",
    "  name: Resolver Workflow",
    "  description: workflow admission fixture",
    "capabilities:",
    "  openmind:",
    "    read: []",
    "    write: []",
    "  network:",
    "    required: false",
    "    hosts: []",
    "artifacts: []",
    "execution:",
    "  concurrency:",
    "    maxInstances: 1",
    "    mutexes: []",
    "  timeoutSeconds: 60",
    "  gracefulStopSeconds: 1",
    "platforms: [linux-x64]",
    "compatibility:",
    "  minAppVersion: 1.0.0",
    "workflow:",
    "  steps:",
    "    - id: first",
    "      skill: resolver-fixture",
    "      version: ^1.0.0",
    "      with: {}",
    "    - id: second",
    "      skill: resolver-step-two",
    "      version: ^1.0.0",
    "      needs: [first]",
    "      with: {}",
    ""
  ].join("\n");
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("test wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
