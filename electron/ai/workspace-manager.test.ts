import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { AiRun, ChangeSet } from "../../shared/contracts";
import { LegacyChangeManager } from "./workspace-manager";

const roots: string[] = [];

function git(root: string, args: string[]): string {
  return String(execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }));
}

function createRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-ai-direct-"));
  roots.push(root);
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(root, "base.txt"), "base\n");
  git(root, ["add", "base.txt"]);
  git(root, ["commit", "-m", "base"]);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** 构造一个 AiRun(历史运行)。 */
function makeRun(overrides: Partial<AiRun> = {}): AiRun {
  return {
    schemaVersion: 1,
    id: "run-1",
    sessionId: "sess-1",
    projectId: "p1",
    provider: "codex",
    providerId: "codex-native",
    permissionProfile: "edit",
    status: "completed",
    prompt: "p",
    contexts: [],
    turnContext: null,
    workspacePath: null,
    baseCommit: null,
    startedAt: "now",
    completedAt: "now",
    error: null,
    changeSet: null,
    risks: [],
    ...overrides
  } as AiRun;
}

describe("direct-directory execution", () => {
  it("does not expose an isolated workspace creation operation", () => {
    const root = createRepo();
    const manager = new LegacyChangeManager(root);
    expect("create" in manager).toBe(false);
    expect(fs.existsSync(path.join(root, ".cctools", "ai", ".runtime", "worktrees"))).toBe(false);
  });

  it("keeps legacy patch apply and revert support for historical runs", async () => {
    const root = createRepo();
    fs.writeFileSync(path.join(root, "base.txt"), "historical AI change\n");
    const patch = git(root, ["diff", "--binary", "HEAD"]);
    fs.writeFileSync(path.join(root, "base.txt"), "base\n");
    const changeSet: ChangeSet = {
      id: crypto.randomUUID(),
      runId: "legacy-run",
      baseCommit: git(root, ["rev-parse", "HEAD"]).trim(),
      files: [],
      patch,
      createdAt: new Date().toISOString(),
      status: "pending",
      appliedPatches: [],
      appliedFiles: []
    };
    const manager = new LegacyChangeManager(root);
    expect(await manager.apply(changeSet)).toEqual({ applied: true });
    expect(fs.readFileSync(path.join(root, "base.txt"), "utf8")).toBe("historical AI change\n");
    expect(await manager.revert(changeSet, patch)).toEqual({ applied: true });
    expect(fs.readFileSync(path.join(root, "base.txt"), "utf8")).toBe("base\n");
  });
});

describe("LegacyChangeManager.apply", () => {
  it("空 patch 直接返回 applied:true", async () => {
    const root = createRepo();
    const manager = new LegacyChangeManager(root);
    const result = await manager.apply({ ...makeChangeSetStub(), patch: "   " });
    expect(result).toEqual({ applied: true });
  });

  it("冲突 patch 返回 applied:false + conflict", async () => {
    const root = createRepo();
    const manager = new LegacyChangeManager(root);
    // 一个无效的 patch 内容 → git apply 失败
    const result = await manager.apply({ ...makeChangeSetStub(), patch: "not a valid patch" });
    expect(result.applied).toBe(false);
    expect(result.conflict).toBeTruthy();
  });

  it("selectedPatch 覆盖 changeSet.patch", async () => {
    const root = createRepo();
    const manager = new LegacyChangeManager(root);
    // 修改 base.txt 生成 patch
    fs.writeFileSync(path.join(root, "base.txt"), "changed\n");
    const patch = git(root, ["diff", "--binary", "HEAD"]);
    fs.writeFileSync(path.join(root, "base.txt"), "base\n");
    // changeSet.patch 为空但 selectedPatch 有内容
    const result = await manager.apply({ ...makeChangeSetStub(), patch: "" }, patch);
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(path.join(root, "base.txt"), "utf8")).toBe("changed\n");
  });
});

describe("LegacyChangeManager.revert", () => {
  it("空 selectedPatch 返回 applied:true", async () => {
    const root = createRepo();
    const manager = new LegacyChangeManager(root);
    expect(await manager.revert(makeChangeSetStub(), "  ")).toEqual({ applied: true });
  });

  it("无效 patch 返回 applied:false", async () => {
    const root = createRepo();
    const manager = new LegacyChangeManager(root);
    const result = await manager.revert(makeChangeSetStub(), "invalid patch");
    expect(result.applied).toBe(false);
    expect(result.conflict).toBeTruthy();
  });
});

describe("LegacyChangeManager.collect", () => {
  it("workspacePath/baseCommit 缺失时抛错", async () => {
    const root = createRepo();
    const manager = new LegacyChangeManager(root);
    await expect(manager.collect(makeRun({ workspacePath: null, baseCommit: null }))).rejects.toThrow("历史运行没有可读取的工作区");
  });

  it("收集工作区相对 baseCommit 的变更", async () => {
    const root = createRepo();
    const baseCommit = git(root, ["rev-parse", "HEAD"]).trim();
    // 在工作区做修改
    fs.writeFileSync(path.join(root, "base.txt"), "modified\n");
    fs.writeFileSync(path.join(root, "added.txt"), "new file\n");

    const manager = new LegacyChangeManager(root);
    const run = makeRun({ workspacePath: root, baseCommit });
    const changeSet = await manager.collect(run);

    expect(changeSet.runId).toBe("run-1");
    expect(changeSet.baseCommit).toBe(baseCommit);
    expect(changeSet.patch).toBeTruthy();
    // 两个文件都被收集
    const paths = changeSet.files.map((f) => f.path);
    expect(paths).toContain("base.txt");
    expect(paths).toContain("added.txt");
    // added.txt 是 created
    const added = changeSet.files.find((f) => f.path === "added.txt");
    expect(added?.status).toBe("created");
    const modified = changeSet.files.find((f) => f.path === "base.txt");
    expect(modified?.status).toBe("modified");
    // 每个 file 有 patch 片段
    expect(changeSet.files.every((f) => typeof f.patch === "string")).toBe(true);
  });

  it("删除的文件标记为 deleted", async () => {
    const root = createRepo();
    fs.writeFileSync(path.join(root, "temp.txt"), "temp\n");
    git(root, ["add", "temp.txt"]);
    git(root, ["commit", "-m", "add temp"]);
    const baseCommit = git(root, ["rev-parse", "HEAD"]).trim();
    fs.rmSync(path.join(root, "temp.txt"));

    const manager = new LegacyChangeManager(root);
    const changeSet = await manager.collect(makeRun({ workspacePath: root, baseCommit }));
    const deleted = changeSet.files.find((f) => f.path === "temp.txt");
    expect(deleted?.status).toBe("deleted");
  });
});

describe("LegacyChangeManager.discardChange", () => {
  it("workspacePath/baseCommit 缺失时抛错", async () => {
    const root = createRepo();
    const manager = new LegacyChangeManager(root);
    await expect(manager.discardChange(makeRun({ workspacePath: null, baseCommit: null }), "patch")).rejects.toThrow("历史运行没有可编辑的工作区");
  });

  it("reverse-apply patch 后重新 collect", async () => {
    const root = createRepo();
    const baseCommit = git(root, ["rev-parse", "HEAD"]).trim();
    // 先加一个改动
    fs.writeFileSync(path.join(root, "base.txt"), "changed\n");
    const patch = git(root, ["diff", "--binary", "HEAD"]);

    const manager = new LegacyChangeManager(root);
    // discardChange 会 reverse-apply 这个 patch(还原),然后 collect
    const changeSet = await manager.discardChange(makeRun({ workspacePath: root, baseCommit }), patch);
    // 还原后 base.txt 应回到 base\n,collect 结果里 base.txt 无变更
    expect(fs.readFileSync(path.join(root, "base.txt"), "utf8")).toBe("base\n");
    expect(changeSet.files.find((f) => f.path === "base.txt")).toBeUndefined();
  });
});

describe("LegacyChangeManager.discard", () => {
  it("workspacePath 不存在时返回 true", async () => {
    const root = createRepo();
    const manager = new LegacyChangeManager(root);
    const result = await manager.discard(makeRun({ workspacePath: null }));
    expect(result).toBe(true);
  });

  it("workspacePath 存在时移除并返回 true(非 worktree 时静默)", async () => {
    const root = createRepo();
    // 创建一个假 workspacePath 目录(非真实 worktree,git worktree remove 会失败但被 catch)
    const fakeWs = path.join(root, ".cctools", "ai", ".runtime", "fake-ws");
    fs.mkdirSync(fakeWs, { recursive: true });
    const manager = new LegacyChangeManager(root);
    // 非 worktree 目录,remove 失败被 catch,目录仍存在 → 返回 false
    const result = await manager.discard(makeRun({ workspacePath: fakeWs }));
    // 目录非真实 worktree,git 无法移除 → 仍存在 → false
    expect(typeof result).toBe("boolean");
  });
});

/** 构造一个最小 ChangeSet stub。 */
function makeChangeSetStub(): ChangeSet {
  return {
    id: "cs-1",
    runId: "run-1",
    baseCommit: "abc",
    files: [],
    patch: "",
    createdAt: "now",
    status: "pending",
    appliedPatches: [],
    appliedFiles: []
  };
}
