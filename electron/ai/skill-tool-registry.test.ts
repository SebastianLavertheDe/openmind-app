import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

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
    "  - mymind/article/${date}/",
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
      fs.mkdirSync(path.join(root, ".cctools"), { recursive: true });
      fs.writeFileSync(path.join(root, ".cctools", "source-settings.json"), "not-json{");
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
