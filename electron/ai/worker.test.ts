import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * worker.ts 是 side-effect 入口(import 即执行):构造 RunScheduler、
 * 注册 parentPort.on("message")。要测它的 dispatch switch,必须:
 * 1. mock ./scheduler 的 RunScheduler(避免 SessionStore.initialize 等重逻辑)
 * 2. 注入假的 process.parentPort(jsdom 下不存在)
 * 然后通过 parentPort.emit("message", { data }) 触发 dispatch。
 */

const hoisted = vi.hoisted(() => ({
  schedulerMethods: {
    snapshot: vi.fn(() => ({ projectRoot: "/r", providers: [], sessions: [], runs: [], pendingApprovals: [] })),
    refreshProviders: vi.fn(async () => []),
    getEvents: vi.fn(() => []),
    getTurns: vi.fn(() => ({ items: [], nextCursor: null })),
    searchSessions: vi.fn(() => []),
    listSkills: vi.fn(() => []),
    activeTaskCount: vi.fn(() => 0),
    prewarmClaude: vi.fn(async () => true),
    startRun: vi.fn(async () => "run-1"),
    cancelRun: vi.fn(async () => undefined),
    updateSession: vi.fn(() => ({})),
    forkSession: vi.fn(() => ({})),
    resolveApproval: vi.fn(async () => undefined),
    revokeCredential: vi.fn(async () => 1),
    restoreCredential: vi.fn(() => 1),
    rotateCredential: vi.fn(async () => 1)
  } as unknown as Record<string, ReturnType<typeof vi.fn>>,
  posted: [] as unknown[],
  parentPort: null as null | EventEmitter
}));

vi.mock(import("./scheduler"), () => ({
  RunScheduler: vi.fn().mockImplementation(() => hoisted.schedulerMethods)
}));

// 在 import worker 之前注入假 parentPort —— worker.ts 在 import 时(line 6-7)就读 process.parentPort,
// 必须在模块加载前注入,否则立即抛 "must run as Electron utility process"。
const ee = new EventEmitter();
(ee as unknown as { postMessage: (m: unknown) => void }).postMessage = (m: unknown) => { hoisted.posted.push(m); };
hoisted.parentPort = ee;
vi.stubEnv("OPENMIND_REPO_ROOT", "/test-repo");
vi.stubEnv("OPENMIND_STATE_ROOT", "/test-state");
Object.defineProperty(process, "parentPort", {
  value: ee,
  configurable: true,
  writable: true
});

// worker.ts import 即执行(注册 parentPort listener)。放在 mock + parentPort 注入之后。
await import("./worker");

beforeEach(() => {
  hoisted.posted.length = 0;
  // 重置所有 scheduler 方法的调用记录(保留实现)
  for (const fn of Object.values(hoisted.schedulerMethods)) {
    if (typeof fn?.mockClear === "function") fn.mockClear();
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function sendMessage(method: string, args: unknown[] = [], id = "1"): Promise<unknown> {
  return new Promise((resolve) => {
    hoisted.parentPort!.emit("message", { data: { id, method, args } });
    // 等 dispatch 的 then 回调执行
    setTimeout(resolve, 10);
  });
}

describe("worker dispatch", () => {
  it("snapshot 方法转发到 scheduler.snapshot", async () => {
    await sendMessage("snapshot");
    expect(hoisted.schedulerMethods.snapshot).toHaveBeenCalled();
    expect(hoisted.posted).toContainEqual({ type: "response", id: "1", result: expect.any(Object) });
  });

  it("events 方法转发 sessionId", async () => {
    await sendMessage("events", ["sess-1"]);
    expect(hoisted.schedulerMethods.getEvents).toHaveBeenCalledWith("sess-1");
  });

  it("search 方法转发 query(空串兜底)", async () => {
    await sendMessage("search", [null]);
    expect(hoisted.schedulerMethods.searchSessions).toHaveBeenCalledWith("");
  });

  it("active-count 返回 scheduler 的根切换保护计数", async () => {
    hoisted.schedulerMethods.activeTaskCount.mockReturnValue(2);
    await sendMessage("active-count");
    expect(hoisted.schedulerMethods.activeTaskCount).toHaveBeenCalled();
    expect(hoisted.posted).toContainEqual({ type: "response", id: "1", result: 2 });
  });

  it("credential revoke/replace 状态转发到 scheduler", async () => {
    await sendMessage("credential-revoked", ["credential-1"]);
    await sendMessage("credential-available", ["credential-1"]);
    await sendMessage("credential-replaced", ["credential-1"]);
    expect(hoisted.schedulerMethods.revokeCredential).toHaveBeenCalledWith("credential-1");
    expect(hoisted.schedulerMethods.restoreCredential).toHaveBeenCalledWith("credential-1");
    expect(hoisted.schedulerMethods.rotateCredential).toHaveBeenCalledWith("credential-1");
  });

  it("start 方法转发 StartRunInput", async () => {
    await sendMessage("start", [{ sessionId: "s1", prompt: "hi" }]);
    expect(hoisted.schedulerMethods.startRun).toHaveBeenCalledWith({ sessionId: "s1", prompt: "hi" });
  });

  it("cancel 方法转发 runId", async () => {
    await sendMessage("cancel", ["run-1"]);
    expect(hoisted.schedulerMethods.cancelRun).toHaveBeenCalledWith("run-1");
  });

  it("prewarm 转发 sessionId(string 时)", async () => {
    await sendMessage("prewarm", ["sess-1"]);
    expect(hoisted.schedulerMethods.prewarmClaude).toHaveBeenCalledWith("sess-1");
  });

  it("prewarm 非 string 时传 undefined", async () => {
    await sendMessage("prewarm", [null]);
    expect(hoisted.schedulerMethods.prewarmClaude).toHaveBeenCalledWith(undefined);
  });

  it("未知 method 返回 error response", async () => {
    await sendMessage("nonexistent", []);
    const errorResponse = hoisted.posted.find(
      (m) => (m as { type?: string; id?: string }).type === "response" && (m as { id?: string }).id === "1" && "error" in (m as object)
    );
    expect(errorResponse).toBeDefined();
    expect((errorResponse as { error: string }).error).toContain("Unknown AI worker method");
  });

  it("scheduler 抛错时返回 error response", async () => {
    hoisted.schedulerMethods.startRun.mockRejectedValueOnce(new Error("boom"));
    await sendMessage("start", [{ sessionId: "s1" }]);
    const errorResponse = hoisted.posted.find(
      (m) => (m as { type?: string }).type === "response" && "error" in (m as object)
    );
    expect(errorResponse).toBeDefined();
    expect((errorResponse as { error: string }).error).toBe("boom");
  });

  it("scheduler 抛非 Error 时 String() 化", async () => {
    hoisted.schedulerMethods.cancelRun.mockRejectedValueOnce("plain string");
    await sendMessage("cancel", ["run-1"]);
    const errorResponse = hoisted.posted.find(
      (m) => (m as { type?: string }).type === "response" && "error" in (m as object)
    );
    expect(errorResponse).toBeDefined();
    expect((errorResponse as { error: string }).error).toBe("plain string");
  });

  it("refresh-providers 转发", async () => {
    await sendMessage("refresh-providers");
    expect(hoisted.schedulerMethods.refreshProviders).toHaveBeenCalled();
  });

  it("events 转发 sessionId", async () => {
    await sendMessage("events", ["sess-1"]);
    expect(hoisted.schedulerMethods.getEvents).toHaveBeenCalledWith("sess-1");
  });

  it("turns 转发 sessionId + params", async () => {
    await sendMessage("turns", ["sess-1", { limit: 10 }]);
    expect(hoisted.schedulerMethods.getTurns).toHaveBeenCalledWith("sess-1", { limit: 10 });
  });

  it("turns params 缺省时传 {}", async () => {
    await sendMessage("turns", ["sess-1"]);
    expect(hoisted.schedulerMethods.getTurns).toHaveBeenCalledWith("sess-1", {});
  });

  it("skills 转发", async () => {
    await sendMessage("skills");
    expect(hoisted.schedulerMethods.listSkills).toHaveBeenCalled();
  });

  it("update-session 转发 sessionId + patch", async () => {
    await sendMessage("update-session", ["sess-1", { title: "t" }]);
    expect(hoisted.schedulerMethods.updateSession).toHaveBeenCalledWith("sess-1", { title: "t" });
  });

  it("fork-session 转发 sessionId + throughRunId(string)", async () => {
    await sendMessage("fork-session", ["sess-1", "run-1"]);
    expect(hoisted.schedulerMethods.forkSession).toHaveBeenCalledWith("sess-1", "run-1");
  });

  it("fork-session 非 string throughRunId 传 undefined", async () => {
    await sendMessage("fork-session", ["sess-1", null]);
    expect(hoisted.schedulerMethods.forkSession).toHaveBeenCalledWith("sess-1", undefined);
  });

  it("resolve-approval 转发 approvalId + decision", async () => {
    await sendMessage("resolve-approval", ["apr-1", "accept"]);
    expect(hoisted.schedulerMethods.resolveApproval).toHaveBeenCalledWith("apr-1", "accept");
  });

  it("成功 response 带正确的 id", async () => {
    await sendMessage("snapshot", [], "req-42");
    const okResponse = hoisted.posted.find(
      (m) => (m as { type?: string; id?: string }).type === "response" && (m as { id?: string }).id === "req-42" && "result" in (m as object)
    );
    expect(okResponse).toBeDefined();
  });
});
