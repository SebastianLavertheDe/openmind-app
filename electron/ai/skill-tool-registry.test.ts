import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import type { InstalledSkillExecutionResolver } from "../skills/installed-skill-execution-resolver";
import { SkillManifestSchema, type WorkflowManifest } from "../../shared/skill-manifest-schema";
import { EXECUTION_SCHEMA_VERSION } from "../../shared/execution-contracts";
import { workflowManifestFingerprint } from "../execution/workflow-engine";

/**
 * mock process-utils 的 spawn 相关函数 —— SkillToolRegistry.run() 内部
 * 直接 import { spawnInDirectory, killProcessTree, decodeProcessOutput },
 * 必须模块级 mock 才能拦截。
 */
const hoisted = vi.hoisted(() => ({
  spawnImpl: null as null | ((cwd: string, runner: string, args: string[], opts: unknown) => ChildProcessWithoutNullStreams),
  killCalls: [] as unknown[][]
}));
vi.mock(import("./process-utils"), () => ({
  spawnInDirectory: (cwd: string, runner: string, args: string[], opts: unknown) => hoisted.spawnImpl!(cwd, runner, args, opts),
  killProcessTree: vi.fn(async (child: unknown) => { hoisted.killCalls.push([child]); }),
  decodeProcessOutput: (chunk: Buffer | string) => (typeof chunk === "string" ? chunk : chunk.toString("utf8"))
}));

import { SkillToolRegistry } from "./skill-tool-registry";

const roots: string[] = [];

/** 创建临时项目根,内含一个可运行的 skill fixture(.claude/skills/test-skill/SKILL.md)。 */
function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skills-"));
  roots.push(root);
  const skillDir = path.join(root, ".claude", "skills", "test-skill");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
    "---",
    "name: test-skill",
    "description: A test skill fixture.",
    "title: 测试 Skill",
    "group: 测试",
    "cwd: .claude/skills/test-skill",
    "runner: uv",
    "args:",
    "  - run",
    "  - python",
    "  - main.py",
    "envFile: .env",
    "permission: edit",
    "outputArtifacts:",
    "  - openmind/article/${date}/",
    "timeoutMs: 60000",
    "---",
    "",
    "# Test Skill",
    ""
  ].join("\n"));
  return root;
}

/** 构造一个 fake child process:可控制 stdout/stderr/close/error。 */
function makeFakeChild(): ChildProcessWithoutNullStreams & { emitClose(code: number | null): void; emitError(err: Error): void; emitStdout(text: string): void; } {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdout = new EventEmitter() as { on: typeof EventEmitter.prototype.on };
  child.stderr = new EventEmitter() as { on: typeof EventEmitter.prototype.on };
  child.stdin = { end: vi.fn() } as unknown as ChildProcessWithoutNullStreams["stdin"];
  child.kill = vi.fn();
  return Object.assign(child, {
    emitClose(code: number | null) { child.emit("close", code); },
    emitError(err: Error) { child.emit("error", err); },
    emitStdout(text: string) { (child.stdout as EventEmitter).emit("data", Buffer.from(text)); }
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  hoisted.spawnImpl = null;
  hoisted.killCalls.length = 0;
});

describe("SkillToolRegistry", () => {
  describe("list / listDefinitions", () => {
    it("list 返回扫描到的 skill 的 SkillTool 结构", () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skills = registry.list();
      expect(skills.length).toBeGreaterThan(0);
      for (const s of skills) {
        expect(s.id).toBeTruthy();
        expect(s.name).toBeTruthy();
        expect(["read-only", "edit", "auto"]).toContain(s.permission);
        expect(s.inputSchema).toBeDefined();
        expect(typeof s.timeoutMs).toBe("number");
      }
    });

    it("listDefinitions 返回 SkillDefinition 结构,含 envFile/group", () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const defs = registry.listDefinitions();
      expect(defs.length).toBeGreaterThan(0);
      expect(defs.every((d) => "envFile" in d && "group" in d)).toBe(true);
      expect(registry.captureSessionSnapshot()).toEqual(defs.map((definition) => ({ definition, installed: null })));
    });

    it("permission 缺省时回退 edit", () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skills = registry.list();
      expect(skills.every((s) => ["read-only", "edit", "auto"].includes(s.permission))).toBe(true);
    });

    it("frontmatter 的 title 用作显示名", () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list().find((s) => s.id === "test-skill");
      expect(skill?.name).toBe("测试 Skill");
    });

    it("Installed Resolver 存在时只暴露正式 Installed Skill 定义", () => {
      const root = createRoot();
      const paths = buildAppPaths(path.join(root, "user-data"));
      ensureAppPaths(paths);
      const installedSnapshot = [{
        definition: {
          id: "installed-skill",
          title: "Installed Skill",
          description: "formal manifest",
          cwd: "installed/openmind/installed-skill/1.0.0",
          command: "managed-runtime"
        },
        installed: { key: "openmind/installed-skill", version: "1.0.0", digest: "a".repeat(64) }
      }];
      const captureSessionSnapshot = vi.fn(() => installedSnapshot);
      const providerSkillBridge = vi.fn(() => null);
      const installedResolver = {
        listDefinitions: () => [{
          id: "installed-skill",
          title: "Installed Skill",
          description: "formal manifest",
          cwd: "installed/openmind/installed-skill/1.0.0",
          command: "managed-runtime",
          runner: "managed-runtime",
          args: [],
          envFile: null,
          group: "general",
          permission: "edit" as const,
          outputArtifacts: [],
          timeoutMs: 1800000
        }],
        captureSessionSnapshot,
        providerSkillBridge,
        installed: () => undefined,
        resolve: vi.fn()
      } as unknown as InstalledSkillExecutionResolver;
      const registry = new SkillToolRegistry(root, root, {
        paths,
        openmindRoot: root,
        rootGeneration: 1,
        installedResolver
      });

      expect(registry.listDefinitions()).toEqual([
        expect.objectContaining({ id: "installed-skill", command: "managed-runtime" })
      ]);
      expect(registry.listDefinitions().some((skill) => skill.id === "test-skill")).toBe(false);
      expect(registry.captureSessionSnapshot(true)).toEqual(installedSnapshot);
      expect(captureSessionSnapshot).toHaveBeenCalledWith(true);
      expect(registry.providerSkillBridge(installedSnapshot[0])).toBeNull();
      expect(providerSkillBridge).toHaveBeenCalledWith(installedSnapshot[0]);
    });
  });

  describe("refresh", () => {
    it("refresh 后能看到新增的 skill 目录", () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      expect(registry.list()).toHaveLength(1);
      expect(registry.list().find((s) => s.id === "test-skill")).toBeTruthy();

      // 新增第二个 skill 目录
      const skillDir = path.join(root, ".claude", "skills", "second-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
        "---",
        "name: second-skill",
        "description: A second skill added after startup.",
        "runner: python",
        "args:",
        "  - main.py",
        "cwd: .claude/skills/second-skill",
        "permission: edit",
        "outputArtifacts: []",
        "timeoutMs: 30000",
        "---"
      ].join("\n"));

      // refresh 前看不到
      expect(registry.list().find((s) => s.id === "second-skill")).toBeFalsy();

      registry.refresh();

      // refresh 后能看到
      const skills = registry.list();
      expect(skills).toHaveLength(2);
      expect(skills.find((s) => s.id === "second-skill")).toBeTruthy();
    });

    it("Installed Resolver 激活时不再重扫 Legacy workspace Skill", () => {
      const root = createRoot();
      const paths = buildAppPaths(path.join(root, "user-data"));
      ensureAppPaths(paths);
      const installedResolver = { resolve: vi.fn() } as unknown as InstalledSkillExecutionResolver;
      const registry = new SkillToolRegistry(root, root, {
        paths,
        openmindRoot: root,
        rootGeneration: 1,
        installedResolver
      });
      expect(registry.list().map((skill) => skill.id)).toEqual(["test-skill"]);
      fs.rmSync(path.join(root, ".claude", "skills", "test-skill"), { recursive: true, force: true });

      registry.refresh();

      expect(registry.list().map((skill) => skill.id)).toEqual(["test-skill"]);
    });
  });

  describe("isRunning", () => {
    it("初始状态没有任何运行中的 invocation", () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      expect(registry.isRunning("any-id")).toBe(false);
    });
  });

  describe("run", () => {
    beforeEach(() => {
      // run() 需要 cwd 存在;fixture 的 cwd 已由 createRoot 创建
      hoisted.spawnImpl = () => makeFakeChild();
    });

    it("未注册的 skill 抛错", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      await expect(registry.run("nonexistent-skill")).rejects.toThrow();
    });

    it("成功执行:emit running → output(system) → success,返回 stdout", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list()[0];
      fs.mkdirSync(path.join(root, skill.cwd), { recursive: true });

      let childRef: ReturnType<typeof makeFakeChild> | null = null;
      hoisted.spawnImpl = () => { childRef = makeFakeChild(); return childRef; };
      const events: Array<{ type: string; state?: string; stream?: string }> = [];
      const runPromise = registry.run(skill.id, {}, root, {
        invocationId: "test-1",
        onEvent: (e) => events.push({ type: e.type, state: e.state, stream: e.stream })
      });

      // 等 status running + system output emit
      await Promise.resolve();
      childRef!.emitStdout("hello world\n");
      childRef!.emitClose(0);

      const output = await runPromise;
      expect(output).toContain("hello world");
      const states = events.filter((e) => e.type === "status").map((e) => e.state);
      expect(states).toContain("running");
      expect(states).toContain("success");
    });

    it("injects provider env from the global providers.yaml (not a per-skill .env)", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list()[0];
      const skillDir = path.join(root, skill.cwd);
      // A per-skill .env is no longer a provider source; the legacy spawn
      // path draws provider config from config/providers.yaml instead.
      fs.writeFileSync(path.join(skillDir, ".env"), [
        "DOUBAO_API_KEY=local-skill-secret",
        "DOUBAO_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3"
      ].join("\n"));
      let childRef: ReturnType<typeof makeFakeChild> | null = null;
      let spawnedEnv: Record<string, string> = {};
      hoisted.spawnImpl = (_cwd, _runner, _args, options) => {
        spawnedEnv = (options as { env?: Record<string, string> }).env || {};
        childRef = makeFakeChild();
        return childRef;
      };

      const runPromise = registry.run(skill.id, {}, root, { invocationId: "env-1" });
      await Promise.resolve();
      childRef!.emitClose(0);
      await runPromise;

      expect(spawnedEnv.OPENMIND_SKILL_ID).toBe(skill.id);
      expect(spawnedEnv.PYTHONIOENCODING).toBe("utf-8");
      // The per-skill .env must NOT leak into the spawn environment anymore.
      expect(spawnedEnv.DOUBAO_API_KEY).toBeUndefined();
    });

    it("非零退出码 emit failed 并抛错,含 output", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list()[0];
      fs.mkdirSync(path.join(root, skill.cwd), { recursive: true });

      let childRef: ReturnType<typeof makeFakeChild> | null = null;
      hoisted.spawnImpl = () => { childRef = makeFakeChild(); return childRef; };

      const runPromise = registry.run(skill.id, {}, root, { invocationId: "fail-1" });
      await Promise.resolve();
      childRef!.emitStdout("partial output\n");
      childRef!.emitClose(1);

      await expect(runPromise).rejects.toThrow();
    });

    it("cwd 不存在时抛 cwdMissing 错", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list()[0];
      // 删除 cwd 目录 → 应抛
      fs.rmSync(path.join(root, skill.cwd), { recursive: true, force: true });
      await expect(registry.run(skill.id)).rejects.toThrow();
    });

    it("date 参数替换 ${date} 占位", async () => {
      const root = createRoot();
      // 覆盖 fixture,用一个 args 含 ${date} 的 skill
      const skillDir = path.join(root, ".claude", "skills", "dated-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
        "---",
        "name: dated-skill",
        "description: skill with ${date} placeholder",
        "runner: python",
        "args:",
        "  - script.py",
        "  - ${date}",
        "cwd: .",
        "permission: edit",
        "outputArtifacts: []",
        "timeoutMs: 60000",
        "---"
      ].join("\n"));
      const registry = new SkillToolRegistry(root);
      const skill = registry.list().find((s) => s.id === "dated-skill")!;
      expect(skill).toBeTruthy();

      const spawnedArgs: string[][] = [];
      let childRef: ReturnType<typeof makeFakeChild> | null = null;
      hoisted.spawnImpl = (_cwd, _runner, args) => {
        spawnedArgs.push(args);
        childRef = makeFakeChild();
        return childRef;
      };

      const runPromise = registry.run(skill.id, { date: "2026-07-08" }, root, { invocationId: "date-1" });
      await Promise.resolve();
      childRef!.emitClose(0);
      await runPromise;

      // date 应被去横杠(20260708)替换 ${date}
      const flat = spawnedArgs[0].join(" ");
      expect(flat).toContain("20260708");
      expect(flat).not.toContain("${date}");
    });

    it("已运行的 invocationId 再次 run 抛 alreadyRunning", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list()[0];
      fs.mkdirSync(path.join(root, skill.cwd), { recursive: true });

      let childRef: ReturnType<typeof makeFakeChild> | null = null;
      hoisted.spawnImpl = () => { childRef = makeFakeChild(); return childRef; };
      const runPromise = registry.run(skill.id, {}, root, { invocationId: "dup-1" });
      await Promise.resolve();
      // 此时 isRunning("dup-1") 应为 true
      expect(registry.isRunning("dup-1")).toBe(true);
      // 再次用同 invocationId 应抛
      await expect(registry.run(skill.id, {}, root, { invocationId: "dup-1" })).rejects.toThrow();
      childRef!.emitClose(0);
      await runPromise;
    });

    it("signal abort 时 emit stopped 并 killProcessTree", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list()[0];
      fs.mkdirSync(path.join(root, skill.cwd), { recursive: true });

      const controller = new AbortController();
      let childRef: ReturnType<typeof makeFakeChild> | null = null;
      hoisted.spawnImpl = () => { childRef = makeFakeChild(); return childRef; };
      const events: string[] = [];
      const runPromise = registry.run(skill.id, {}, root, {
        invocationId: "abort-1",
        signal: controller.signal,
        onEvent: (e) => { if (e.type === "status") events.push(e.state!); }
      });
      await Promise.resolve();
      controller.abort();
      childRef!.emitClose(0);

      await expect(runPromise).rejects.toThrow();
      expect(events).toContain("stopped");
      expect(hoisted.killCalls.length).toBeGreaterThan(0);
    });
  });

  it("生产手动路径只通过 Installed Skill Resolver 进入 ExecutionBroker", async () => {
    const root = createRoot();
    const openmindRoot = path.join(root, "openmind");
    fs.mkdirSync(openmindRoot, { recursive: true });
    const skillDir = path.join(root, ".claude", "skills", "test-skill");
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const digest = "a".repeat(64);
    const installed = { version: "1.0.0", digest };
    const resolve = vi.fn(async (request: { skillId: string; version?: string; digest?: string; inputs: Record<string, unknown> }) => ({
      skillId: request.skillId,
      version: "1.0.0",
      digest,
      rootGeneration: 1,
      skillHome: fs.realpathSync(skillDir),
      openmindRoot: fs.realpathSync(openmindRoot),
      capabilities: { openmind: { read: [], write: [] } },
      process: {
        executable: process.execPath,
        args: ["-e", "console.log(process.env.OPENMIND_SOURCE_URL || '<missing>')"],
        cwd: fs.realpathSync(skillDir),
        env: { OPENMIND_SOURCE_URL: String(request.inputs.sourceUrl || "") },
        timeoutMs: 5_000,
        gracefulStopMs: 1_000
      },
      artifacts: [],
      knownSecrets: []
    }));
    const assertBrokerRunnable = vi.fn(() => installed as never);
    const installedResolver = {
      installed: vi.fn(() => installed),
      assertBrokerRunnable,
      resolve: resolve as unknown as InstalledSkillExecutionResolver["resolve"]
    } as unknown as InstalledSkillExecutionResolver;
    const registry = new SkillToolRegistry(root, root, { paths, openmindRoot, rootGeneration: 1, maxConcurrentRuns: 1, installedResolver });
    const events: SkillExecutionEvent[] = [];
    const output = await registry.run("test-skill", { date: "2026-08-05", sourceId: "source-1", sourceUrl: "https://example.com/feed" }, root, {
      invocationId: "broker:test-skill",
      onEvent: (event) => events.push(event)
    });

    expect(output).toContain("https://example.com/feed");
    expect(events.map((event) => event.state)).toContain("success");
    expect(fs.readdirSync(paths.runs, { withFileTypes: true }).some((entry) => entry.isDirectory())).toBe(true);
    expect(registry.isRunning("broker:test-skill")).toBe(false);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      skillId: "test-skill",
      version: "1.0.0",
      digest,
      inputs: { date: "20260805", sourceId: "source-1", sourceUrl: "https://example.com/feed" }
    }), expect.any(String));

  });

  it("Agent Skill 在创建 Broker Run 前被引导到 Claude Code/Codex CLI", () => {
    const root = createRoot();
    const openmindRoot = path.join(root, "openmind");
    fs.mkdirSync(openmindRoot, { recursive: true });
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const installedResolver = {
      assertBrokerRunnable: vi.fn(() => {
        throw new Error("Agent Skill 仅支持通过 AI 控制台使用 Claude Code CLI 或 Codex CLI 运行。 ");
      }),
      resolve: vi.fn()
    } as unknown as InstalledSkillExecutionResolver;
    const registry = new SkillToolRegistry(root, root, {
      paths,
      openmindRoot,
      rootGeneration: 1,
      installedResolver
    });

    expect(() => registry.submitRun({
      skillId: "creative-writing",
      inputs: {},
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    })).toThrow("Claude Code CLI 或 Codex CLI");
    expect(installedResolver.assertBrokerRunnable).toHaveBeenCalledWith(expect.objectContaining({
      skillId: "creative-writing",
      trigger: { type: "manual" }
    }));
    expect(registry.listRuns()).toEqual([]);
  });

  it("通用 Skill Run 不再把 Legacy workspace Skill 当作可执行 Installed Skill", async () => {
    const root = createRoot();
    const openmindRoot = path.join(root, "openmind");
    fs.mkdirSync(openmindRoot, { recursive: true });
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const registry = new SkillToolRegistry(root, root, { paths, openmindRoot, rootGeneration: 1, maxConcurrentRuns: 1 });

    const run = registry.submitRun({
      skillId: "test-skill",
      inputs: {},
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    });
    await waitFor(() => registry.getRun(run.id).state === "failed");
    expect(registry.getRun(run.id).error).toContain("Installed Skill");
  });

  it("pins a wildcard Process request to the exact admitted version and digest before queueing", async () => {
    const root = createRoot();
    const openmindRoot = path.join(root, "openmind");
    fs.mkdirSync(openmindRoot, { recursive: true });
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const digest = "c".repeat(64);
    const installedResolver = {
      assertBrokerRunnable: vi.fn(() => ({ version: "1.4.2", digest })),
      resolve: vi.fn(async () => { throw new Error("stop after admission"); })
    } as unknown as InstalledSkillExecutionResolver;
    const registry = new SkillToolRegistry(root, root, {
      paths,
      openmindRoot,
      rootGeneration: 1,
      installedResolver
    });

    const run = registry.submitRun({
      skillId: "daily-article-summarizer",
      inputs: {},
      providerBindings: {},
      trigger: { type: "automation", ruleId: "daily-summary" },
      externalExportBindingIds: [],
      rootGeneration: 1
    });

    expect(run.request).toMatchObject({ version: "1.4.2", digest });
    await waitFor(() => registry.getRun(run.id).state === "failed");
  });

  it("Workflow 准入后使用固定 Step identity，运行中停用不会影响后续 Step", async () => {
    const root = createRoot();
    const openmindRoot = path.join(root, "openmind");
    fs.mkdirSync(openmindRoot, { recursive: true });
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const packageRoot = fs.realpathSync(path.join(root, ".claude", "skills", "test-skill"));
    const manifest = workflowManifest();
    const workflowAdmission = {
      manifest,
      steps: [
        { stepId: "first", skillId: "first-step", version: "1.0.0", digest: "a".repeat(64) },
        { stepId: "second", skillId: "second-step", version: "1.0.0", digest: "b".repeat(64) }
      ]
    };
    let enabled = true;
    const assertBrokerRunnable = vi.fn(() => {
      if (!enabled) throw new Error("Skill 已停用");
    });
    const admittedRequests: Array<{ skillId: string; version?: string; digest?: string }> = [];
    const assertAdmittedBrokerRunnable = vi.fn((request: { skillId: string; version?: string; digest?: string }) => {
      admittedRequests.push({ skillId: request.skillId, version: request.version, digest: request.digest });
      if (request.skillId === "first-step") enabled = false;
    });
    const installedResolver = {
      admitWorkflow: vi.fn(() => workflowAdmission),
      assertBrokerRunnable,
      assertAdmittedBrokerRunnable,
      resolve: vi.fn(async (request: { skillId: string; version?: string; digest?: string }) => ({
        skillId: request.skillId,
        version: request.version!,
        digest: request.digest!,
        rootGeneration: 1,
        skillHome: packageRoot,
        openmindRoot: fs.realpathSync(openmindRoot),
        capabilities: { openmind: { read: [], write: [] } },
        process: {
          executable: process.execPath,
          args: ["-e", "process.exit(0)"],
          cwd: packageRoot,
          env: {},
          timeoutMs: 5_000,
          gracefulStopMs: 100
        },
        artifacts: [],
        knownSecrets: []
      }))
    } as unknown as InstalledSkillExecutionResolver;
    const registry = new SkillToolRegistry(root, root, {
      paths,
      openmindRoot,
      rootGeneration: 1,
      maxConcurrentRuns: 1,
      installedResolver,
      workflowRoot: path.join(root, "workflow-runs")
    });

    const run = registry.startWorkflowRun({
      skillId: manifest.id,
      version: manifest.version,
      inputs: {},
      providerBindings: {},
      rootGeneration: 1
    });
    await waitFor(() => registry.getWorkflowRun(run.id).state === "succeeded");

    expect(installedResolver.admitWorkflow).toHaveBeenCalledTimes(1);
    expect(assertBrokerRunnable).not.toHaveBeenCalled();
    expect(admittedRequests).toEqual(workflowAdmission.steps.map(({ skillId, version, digest }) => ({ skillId, version, digest })));
    expect(enabled).toBe(false);
  });

  it("Workflow Step 显式重试会重新执行整条 Workflow admission", async () => {
    const root = createRoot();
    const openmindRoot = path.join(root, "openmind");
    fs.mkdirSync(openmindRoot, { recursive: true });
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const packageRoot = fs.realpathSync(path.join(root, ".claude", "skills", "test-skill"));
    const manifest = workflowManifest();
    const workflowAdmission = {
      manifest,
      steps: [
        { stepId: "first", skillId: "first-step", version: "1.0.0", digest: "a".repeat(64) },
        { stepId: "second", skillId: "second-step", version: "1.0.0", digest: "b".repeat(64) }
      ]
    };
    let enabled = true;
    const admitWorkflow = vi.fn(() => {
      if (!enabled) throw new Error("Workflow Step Skill 已停用");
      return workflowAdmission;
    });
    const installedResolver = {
      admitWorkflow,
      assertAdmittedBrokerRunnable: vi.fn(),
      resolve: vi.fn(async (request: { skillId: string; version?: string; digest?: string }) => ({
        skillId: request.skillId,
        version: request.version!,
        digest: request.digest!,
        rootGeneration: 1,
        skillHome: packageRoot,
        openmindRoot: fs.realpathSync(openmindRoot),
        capabilities: { openmind: { read: [], write: [] } },
        process: {
          executable: process.execPath,
          args: ["-e", "process.exit(1)"],
          cwd: packageRoot,
          env: {},
          timeoutMs: 5_000,
          gracefulStopMs: 100
        },
        artifacts: [],
        knownSecrets: []
      }))
    } as unknown as InstalledSkillExecutionResolver;
    const registry = new SkillToolRegistry(root, root, {
      paths,
      openmindRoot,
      rootGeneration: 1,
      installedResolver,
      workflowRoot: path.join(root, "workflow-runs")
    });
    const run = registry.startWorkflowRun({
      skillId: manifest.id,
      version: manifest.version,
      inputs: {},
      providerBindings: {},
      rootGeneration: 1
    });
    await waitFor(() => registry.getWorkflowRun(run.id).state === "failed");

    enabled = false;
    expect(() => registry.retryWorkflowStep(run.id, "first")).toThrow(/停用/);
    expect(admitWorkflow).toHaveBeenCalledTimes(2);
  });

  it("Workflow 重启恢复会先重新执行整条 Workflow admission", () => {
    const root = createRoot();
    const openmindRoot = path.join(root, "openmind");
    fs.mkdirSync(openmindRoot, { recursive: true });
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const workflowRoot = path.join(root, "workflow-runs");
    fs.mkdirSync(workflowRoot, { recursive: true });
    const manifest = workflowManifest();
    const runId = "interrupted-workflow";
    fs.writeFileSync(path.join(workflowRoot, `${runId}.json`), JSON.stringify({
      schemaVersion: EXECUTION_SCHEMA_VERSION,
      id: runId,
      workflowSkillId: manifest.id,
      workflowVersion: manifest.version,
      workflowFingerprint: workflowManifestFingerprint(manifest),
      state: "running",
      rootGeneration: 1,
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      stepRuns: [
        { stepId: "first", skillId: "first-step", state: "running", attempt: 1, retryAt: null, runId: "old-child", error: null, artifacts: [] },
        { stepId: "second", skillId: "second-step", state: "pending", attempt: 0, retryAt: null, runId: null, error: null, artifacts: [] }
      ]
    }));
    const admitWorkflow = vi.fn(() => {
      throw new Error("Workflow Step Skill 已停用");
    });
    const installedResolver = {
      admitWorkflow,
      resolve: vi.fn()
    } as unknown as InstalledSkillExecutionResolver;
    const registry = new SkillToolRegistry(root, root, {
      paths,
      openmindRoot,
      rootGeneration: 1,
      installedResolver,
      workflowRoot
    });

    expect(registry.getWorkflowRun(runId)).toMatchObject({ state: "failed", error: expect.stringContaining("应用重启") });
    expect(() => registry.resumeWorkflowRun(runId, {}, 1)).toThrow(/停用/);
    expect(admitWorkflow).toHaveBeenCalledWith(manifest.id, manifest.version);
  });

  describe("stop", () => {
    it("不存在的 invocation 返回 false", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      expect(await registry.stop("nonexistent")).toBe(false);
    });

    it("运行中的 invocation 返回 true 并 killProcessTree", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list()[0];
      fs.mkdirSync(path.join(root, skill.cwd), { recursive: true });

      let childRef: ReturnType<typeof makeFakeChild> | null = null;
      hoisted.spawnImpl = () => { childRef = makeFakeChild(); return childRef; };
      const runPromise = registry.run(skill.id, {}, root, { invocationId: "stop-1" });
      await Promise.resolve();

      const result = await registry.stop("stop-1");
      expect(result).toBe(true);
      expect(hoisted.killCalls.length).toBeGreaterThan(0);

      childRef!.emitClose(0);
      await expect(runPromise).rejects.toThrow();
    });
  });

  describe("isSkillDisabled (通过 source-settings.json)", () => {
    it("无 source-settings.json 时 skill 不 disabled → 可运行", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list()[0];
      fs.mkdirSync(path.join(root, skill.cwd), { recursive: true });
      // 不写 source-settings.json,run 应能启动
      let childRef: ReturnType<typeof makeFakeChild> | null = null;
      hoisted.spawnImpl = () => { childRef = makeFakeChild(); return childRef; };
      const runPromise = registry.run(skill.id, {}, root, { invocationId: "enabled-1" });
      await Promise.resolve();
      childRef!.emitClose(0);
      await expect(runPromise).resolves.toBeDefined();
    });

    it("source-settings.json 损坏时不抛(回退非 disabled)", async () => {
      const root = createRoot();
      const registry = new SkillToolRegistry(root);
      const skill = registry.list()[0];
      fs.mkdirSync(path.join(root, skill.cwd), { recursive: true });
      fs.mkdirSync(path.join(root, ".openmind"), { recursive: true });
      fs.writeFileSync(path.join(root, ".openmind", "source-settings.json"), "not-json{");
      // 不应抛解析错,应正常启动
      let childRef: ReturnType<typeof makeFakeChild> | null = null;
      hoisted.spawnImpl = () => { childRef = makeFakeChild(); return childRef; };
      const runPromise = registry.run(skill.id, {}, root, { invocationId: "corrupt-1" });
      await Promise.resolve();
      childRef!.emitClose(0);
      await expect(runPromise).resolves.toBeDefined();
    });
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("skill registry wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function workflowManifest(): WorkflowManifest {
  return SkillManifestSchema.parse({
    apiVersion: "openmind.dev/skill/v1",
    id: "registry-workflow",
    version: "1.0.0",
    publisher: { id: "openmind", displayName: "openmind" },
    kind: "workflow",
    display: { name: "Registry Workflow", description: "" },
    capabilities: { openmind: { read: [], write: [] }, network: { required: false, hosts: [] } },
    artifacts: [],
    execution: { concurrency: { maxInstances: 1, mutexes: [] }, timeoutSeconds: 60, gracefulStopSeconds: 1, retry: { maxAttempts: 0 } },
    platforms: ["linux-x64"],
    compatibility: { minAppVersion: "1.0.0" },
    workflow: {
      steps: [
        { id: "first", skill: "first-step", version: "^1.0.0", needs: [], with: {} },
        { id: "second", skill: "second-step", version: "^1.0.0", needs: ["first"], with: {} }
      ]
    }
  }) as WorkflowManifest;
}
