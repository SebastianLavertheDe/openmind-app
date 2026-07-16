import { EventEmitter, PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderRunContext } from "./types";

/**
 * CodexAppServerAdapter.run() 测试。
 * mock process-utils 返回可控的 fake child(stdin/stdout 是 PassThrough),
 * 向 stdout 写 JSON-RPC 响应驱动协议。
 */
const hoisted = vi.hoisted(() => ({
  fakeChild: null as null | FakeChild,
  killCalls: 0
}));
vi.mock(import("../process-utils"), () => ({
  spawnInDirectory: vi.fn(() => hoisted.fakeChild),
  spawnNativeInDirectory: vi.fn(() => hoisted.fakeChild),
  killProcessTree: vi.fn(async () => { hoisted.killCalls++; }),
  parseWslPath: vi.fn(() => null),
  toWslPath: vi.fn((v: string) => v)
}));

import { CodexAppServerAdapter, normalizeCodexNotification } from "./codex-app-server";

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  writtenLines: string[];
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(),
    writtenLines: [] as string[]
  }) as FakeChild;
  (stdin as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    child.writtenLines.push(String(chunk));
    return true;
  };
  (stdin as unknown as { end: () => void }).end = () => undefined;
  hoisted.fakeChild = child;
  return child;
}

function sendLine(child: FakeChild, message: unknown): void {
  child.stdout.write(`${JSON.stringify(message)}\n`);
}

const wait = (ms = 15) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.restoreAllMocks();
  hoisted.fakeChild = null;
  hoisted.killCalls = 0;
});

function makeContext(overrides: Partial<ProviderRunContext> = {}): ProviderRunContext {
  return {
    session: {
      id: "sess-1", provider: "codex", providerId: "codex-native",
      providerSessionId: null, title: "测试", cwd: "/project",
      permissionProfile: "edit", projectId: "p1", projectRoot: "/project"
    },
    run: { id: "run-1", sessionId: "sess-1", prompt: "你好", status: "running", startedAt: "now", cwd: "/project" } as never,
    provider: { runtime: "native", id: "codex-native", provider: "codex", label: "Codex", available: true } as never,
    providerModel: "auto",
    cwd: "/project",
    prompt: "你好",
    contextState: { contexts: [] } as never,
    images: [],
    signal: new AbortController().signal,
    emit: vi.fn(async () => undefined),
    updateProviderSession: vi.fn(),
    requestApproval: vi.fn(async () => "accept"),
    skillInvocation: null,
    ...overrides
  } as unknown as ProviderRunContext;
}

/** 驱动一个成功的完整 run 流程。 */
async function driveSuccessfulRun(ctx: ProviderRunContext): Promise<FakeChild> {
  const adapter = new CodexAppServerAdapter();
  const child = makeFakeChild();
  const runPromise = adapter.run(ctx);
  // 捕获 reject 避免污染其他测试(unhandled rejection)
  runPromise.catch(() => undefined);

  await wait();
  sendLine(child, { id: 1, result: {} }); // initialize
  await wait();
  sendLine(child, { id: 2, result: { thread: { id: "thread-abc" } } }); // thread/start
  await wait();
  sendLine(child, { id: 3, result: {} }); // turn/start
  await wait();
  sendLine(child, {
    method: "turn/completed",
    params: { threadId: "thread-abc", turn: { id: "turn-1", status: "completed", error: null } }
  });
  await runPromise;
  return child;
}

describe("CodexAppServerAdapter.run()", () => {
  it("Plan 模式通过真实 collaborationMode 字段传给 turn/start", async () => {
    const ctx = makeContext({
      session: { ...makeContext().session, interactionMode: "plan" },
      providerModel: "gpt-5.4"
    });
    const child = await driveSuccessfulRun(ctx);
    const turn = child.writtenLines.map((line) => JSON.parse(line)).find((message) => message.method === "turn/start");
    expect(turn.params.collaborationMode).toEqual({
      mode: "plan",
      settings: { model: "gpt-5.4", reasoning_effort: null, developer_instructions: null }
    });
  });

  it("只把 Codex 真实 Plan/Todo 通知归一化为工作状态事件", () => {
    expect(normalizeCodexNotification({
      method: "item/completed",
      params: { turnId: "turn-1", item: { id: "plan-1", type: "plan", text: "1. 先审查\n2. 再实现" } }
    })[0]).toMatchObject({ kind: "plan", payload: { sourceEvent: "item/completed", providerItemType: "plan" } });
    expect(normalizeCodexNotification({
      method: "turn/plan/updated",
      params: { threadId: "thread-1", turnId: "turn-1", plan: [{ step: "先审查", status: "inProgress" }] }
    })[0]).toMatchObject({
      kind: "todo",
      payload: { sourceEvent: "turn/plan/updated", items: [{ text: "先审查", status: "in-progress" }] }
    });
  });

  it("将流式 agentMessage 保持为 commentary，只有 final_answer 完成项才成为最终候选", () => {
    expect(normalizeCodexNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "msg-1", delta: "正在检查" }
    })[0]).toMatchObject({
      kind: "assistant-delta",
      payload: { text: "正在检查", phase: "commentary", itemId: "msg-1", turnId: "turn-1" }
    });
    expect(normalizeCodexNotification({
      method: "item/completed",
      params: { turnId: "turn-1", item: { id: "msg-1", type: "agentMessage", text: "处理中", phase: "commentary" } }
    })[0]).toMatchObject({ kind: "assistant-message", payload: { text: "处理中", phase: "commentary", providerPhase: "commentary" } });
    expect(normalizeCodexNotification({
      method: "item/completed",
      params: { turnId: "turn-1", item: { id: "msg-2", type: "agentMessage", text: "完成", phase: "final_answer" } }
    })[0]).toMatchObject({ kind: "assistant-message", payload: { text: "完成", phase: "final", providerPhase: "final_answer" } });
    expect(normalizeCodexNotification({
      method: "item/completed",
      params: { turnId: "turn-1", item: { id: "legacy", type: "agentMessage", text: "未知阶段", phase: null } }
    })[0]).toMatchObject({ kind: "assistant-message", payload: { phase: "unknown", providerPhase: null } });
  });

  it("不把 reasoning 或 collab agent 生命周期伪装成工具/Todo", () => {
    expect(normalizeCodexNotification({
      method: "item/started",
      params: { item: { id: "reason-1", type: "reasoning", summary: [] } }
    })).toEqual([]);
    expect(normalizeCodexNotification({
      method: "item/completed",
      params: { turnId: "turn-1", item: { id: "reason-1", type: "reasoning", summary: ["先检查", "再验证"] } }
    })[0]).toMatchObject({
      kind: "reasoning-summary",
      payload: { text: "先检查\n\n再验证", source: "codex-summary" }
    });

    expect(normalizeCodexNotification({
      method: "item/started",
      params: {
        threadId: "root", turnId: "turn-1",
        item: { id: "collab-1", type: "collabAgentToolCall", tool: "spawnAgent", status: "inProgress", receiverThreadIds: ["child"] }
      }
    })[0]).toMatchObject({
      kind: "system",
      payload: { semanticType: "subtask", subtype: "subtask_started", receiverThreadIds: ["child"] }
    });
    expect(normalizeCodexNotification({
      method: "item/completed",
      params: {
        threadId: "root", turnId: "turn-1",
        item: {
          id: "collab-2", type: "collabAgentToolCall", tool: "wait", status: "completed",
          receiverThreadIds: ["child"], agentsStates: { child: { status: "completed", message: null } }
        }
      }
    })[0]).toMatchObject({
      kind: "system",
      payload: { semanticType: "subtask", subtype: "subtask_completed" }
    });
  });

  it("把 usage 和 turn diff 标记为可替换快照", () => {
    expect(normalizeCodexNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1", turnId: "turn-1",
        tokenUsage: {
          last: { totalTokens: 12, inputTokens: 8, outputTokens: 4 },
          total: { totalTokens: 32, inputTokens: 20, outputTokens: 12 },
          modelContextWindow: 128000
        }
      }
    })[0]).toMatchObject({
      kind: "usage",
      payload: {
        usage: { totalTokens: 12 }, totalUsage: { totalTokens: 32 }, modelContextWindow: 128000,
        snapshot: true, snapshotKey: "codex-token-usage:turn-1"
      }
    });
    expect(normalizeCodexNotification({
      method: "turn/diff/updated",
      params: { threadId: "thread-1", turnId: "turn-1", diff: "diff --git a/a b/a" }
    })[0]).toMatchObject({
      kind: "changes",
      payload: { patch: "diff --git a/a b/a", snapshot: true, snapshotKey: "codex-turn-diff:turn-1" }
    });
  });

  it("willRetry 错误是非终态 retrying status，耗尽重试才是 error", () => {
    expect(normalizeCodexNotification({
      method: "error",
      params: { threadId: "thread-1", turnId: "turn-1", error: { message: "temporary" }, willRetry: true }
    })[0]).toMatchObject({ kind: "status", payload: { state: "retrying", text: "temporary", willRetry: true } });
    expect(normalizeCodexNotification({
      method: "error",
      params: { threadId: "thread-1", turnId: "turn-1", error: { message: "terminal" }, willRetry: false }
    })[0]).toMatchObject({ kind: "error", payload: { text: "terminal", willRetry: false } });
  });

  it("完成 initialize → thread/start → turn/start → turn/completed 全流程", async () => {
    const ctx = makeContext();
    const child = await driveSuccessfulRun(ctx);

    expect(ctx.updateProviderSession).toHaveBeenCalledWith("thread-abc");
    const requests = child.writtenLines.map((line) => JSON.parse(line));
    expect(requests.find((r) => r.method === "initialize")).toBeDefined();
    expect(requests.find((r) => r.method === "thread/start")).toBeDefined();
    expect(requests.find((r) => r.method === "turn/start")).toBeDefined();
  });

  it.each([
    ["failed", "provider failed"],
    ["interrupted", "Codex turn was interrupted"]
  ])("turn/completed=%s 不会被误标为成功", async (status, expectedError) => {
    const ctx = makeContext();
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    const rejection = expect(runPromise).rejects.toThrow(expectedError);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, {
      method: "turn/completed",
      params: {
        threadId: "t1",
        turn: { id: "turn-1", status, error: status === "failed" ? { message: "provider failed" } : null }
      }
    });

    await rejection;
  });

  it("等待最后一个 notification 持久化后才解析 turn/completed", async () => {
    let releaseFinal!: () => void;
    const finalGate = new Promise<void>((resolve) => { releaseFinal = resolve; });
    const emit = vi.fn(async (kind: string) => {
      if (kind === "assistant-message") await finalGate;
    });
    const ctx = makeContext({ emit: emit as ProviderRunContext["emit"] });
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);
    let settled = false;
    void runPromise.then(() => { settled = true; });

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, {
      method: "item/completed",
      params: { threadId: "t1", turnId: "turn-1", item: { id: "msg", type: "agentMessage", phase: "final_answer", text: "最终回复" } }
    });
    sendLine(child, {
      method: "turn/completed",
      params: { threadId: "t1", turn: { id: "turn-1", status: "completed", error: null } }
    });
    await wait();

    expect(settled).toBe(false);
    releaseFinal();
    await runPromise;
    expect(emit).toHaveBeenCalledWith("assistant-message", expect.objectContaining({ text: "最终回复", phase: "final" }));
  });

  it("旧版缺失 MessagePhase 时持久化单条 unknown，留给成功终态 selector 原位提升", async () => {
    const ctx = makeContext();
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, {
      method: "item/completed",
      params: { threadId: "t1", turnId: "turn-1", item: { id: "legacy-msg", type: "agentMessage", phase: null, text: "旧版最终回复" } }
    });
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("assistant-message", expect.objectContaining({
      itemId: "legacy-msg", phase: "unknown"
    }));
  });

  it("有 providerSessionId 时走 thread/resume", async () => {
    const ctx = makeContext();
    // 直接设 providerSessionId,保留其余 session 字段
    (ctx.session as { providerSessionId: string | null }).providerSessionId = "existing";
    const child = await driveSuccessfulRun(ctx);

    const requests = child.writtenLines.map((line) => JSON.parse(line));
    expect(requests.find((r) => r.method === "thread/resume")).toBeDefined();
    expect(requests.find((r) => r.method === "thread/start")).toBeUndefined();
  });

  it("notification(item/agentMessage/delta)转发为 assistant-delta emit", async () => {
    const ctx = makeContext();
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "item/agentMessage/delta", params: { delta: "你好" } });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    expect(ctx.emit).toHaveBeenCalledWith("assistant-delta", expect.objectContaining({ text: "你好" }));
  });

  it("stderr 输出转发为 emit(不崩溃)", async () => {
    const ctx = makeContext();
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    // 发 stderr,不应崩溃
    child.stderr.write("some warning\n");
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    // stderr 被 trim 后非空 → 至少触发了一次 emit(warning notification)
    expect(ctx.emit).toHaveBeenCalled();
  });

  it("abort signal 触发 rpc.close(killProcessTree)", async () => {
    const controller = new AbortController();
    const ctx = makeContext({ signal: controller.signal } as Partial<ProviderRunContext>);
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    controller.abort();
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    expect(hoisted.killCalls).toBeGreaterThan(0);
  });

  it("server request(fileChange)触发 requestApproval,accept 返回 accept decision", async () => {
    const ctx = makeContext({ requestApproval: vi.fn(async () => "accept") } as Partial<ProviderRunContext>);
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    // rm 命令不会 autoApprove → 走 requestApproval
    sendLine(child, { id: 100, method: "fileChange", params: { command: "rm some-file", grantRoot: "/project" } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    expect(ctx.requestApproval).toHaveBeenCalled();
    const responses = child.writtenLines.map((l) => JSON.parse(l)).filter((m) => m.id === 100);
    expect(responses.length).toBeGreaterThan(0);
    expect(responses[0].result.decision).toBe("accept");
  });

  it("server request accept-session 映射为 acceptForSession", async () => {
    const ctx = makeContext({ requestApproval: vi.fn(async () => "accept-session") } as Partial<ProviderRunContext>);
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 100, method: "fileChange", params: { command: "rm -rf", grantRoot: "/x" } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    const responses = child.writtenLines.map((l) => JSON.parse(l)).filter((m) => m.id === 100);
    expect(responses[0].result.decision).toBe("acceptForSession");
  });

  it("server request decline 映射为 decline", async () => {
    const ctx = makeContext({ requestApproval: vi.fn(async () => "decline") } as Partial<ProviderRunContext>);
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 100, method: "fileChange", params: { command: "rm dangerous" } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    const responses = child.writtenLines.map((l) => JSON.parse(l)).filter((m) => m.id === 100);
    expect(responses[0].result.decision).toBe("decline");
  });

  it("现代 command approval 展示协议提供的命令字段并尊重 availableDecisions", async () => {
    const requestApproval = vi.fn(async () => "accept-session" as const);
    const ctx = makeContext({ requestApproval } as Partial<ProviderRunContext>);
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, {
      id: 100,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "t1", turnId: "turn-1", itemId: "cmd-1", cwd: "/project",
        command: "git push", reason: "需要网络", availableDecisions: ["accept", "decline"]
      }
    });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: "network",
      cwd: "/project",
      command: "git push",
      detail: expect.stringContaining("Available decisions: accept, decline")
    }));
    const response = child.writtenLines.map((line) => JSON.parse(line)).find((message) => message.id === 100);
    // The user requested session approval, but this request only offers one-shot
    // accept; safely narrow the scope instead of inventing an unavailable enum.
    expect(response.result.decision).toBe("accept");
  });

  it("旧版 exec approval 使用 ReviewDecision 枚举", async () => {
    const ctx = makeContext({ requestApproval: vi.fn(async () => "decline") } as Partial<ProviderRunContext>);
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, {
      id: 100, method: "execCommandApproval",
      params: { conversationId: "t1", callId: "cmd-1", command: ["rm", "file"], cwd: "/project", reason: null }
    });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    const response = child.writtenLines.map((line) => JSON.parse(line)).find((message) => message.id === 100);
    expect(response.result.decision).toBe("denied");
  });

  it("不会用 generic decision 假响应不兼容的 server request", async () => {
    const ctx = makeContext();
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    const rejection = expect(runPromise).rejects.toThrow("Unsupported Codex app-server request: item/permissions/requestApproval");

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, {
      id: 100,
      method: "item/permissions/requestApproval",
      params: { threadId: "t1", turnId: "turn-1", itemId: "p1", cwd: "/project", permissions: {} }
    });

    await rejection;
    const response = child.writtenLines.map((line) => JSON.parse(line)).find((message) => message.id === 100);
    expect(response.error.message).toContain("Unsupported Codex app-server request");
    expect(response.result).toBeUndefined();
  });

  it("read-only 权限走 sandbox read-only", async () => {
    const ctx = makeContext({
      session: { providerSessionId: null, permissionProfile: "read-only", cwd: "/project", projectRoot: "/project" } as never
    } as Partial<ProviderRunContext>);
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    const threadReq = child.writtenLines.map((l) => JSON.parse(l)).find((m) => m.method === "thread/start");
    expect(threadReq.params.sandbox).toBe("read-only");
  });

  it("notification(item/completed agentMessage)转发 assistant-message", async () => {
    const ctx = makeContext();
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "item/completed", params: { item: { type: "agentMessage", text: "完成", id: "i1" }, turnId: "t1" } });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    expect(ctx.emit).toHaveBeenCalledWith("assistant-message", expect.objectContaining({ text: "完成" }));
  });

  it("notification(item/completed reasoning)转发 reasoning-summary", async () => {
    const ctx = makeContext();
    const adapter = new CodexAppServerAdapter();
    const child = makeFakeChild();
    const runPromise = adapter.run(ctx);
    runPromise.catch(() => undefined);

    await wait();
    sendLine(child, { id: 1, result: {} });
    await wait();
    sendLine(child, { id: 2, result: { thread: { id: "t1" } } });
    await wait();
    sendLine(child, { id: 3, result: {} });
    await wait();
    sendLine(child, { method: "item/completed", params: { item: { type: "reasoning", summary: "思考", id: "i1" }, turnId: "t1" } });
    await wait();
    sendLine(child, { method: "turn/completed" });
    await runPromise;

    expect(ctx.emit).toHaveBeenCalledWith("reasoning-summary", expect.objectContaining({ text: "思考" }));
  });
});
