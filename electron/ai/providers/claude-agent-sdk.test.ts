import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderPrewarmContext, ProviderRunContext } from "./types";

/**
 * mock @anthropic-ai/claude-agent-sdk —— claude-agent-sdk.ts 用动态 await import,
 * vi.mock 对动态 import 同样生效。提供 startup/query 的可控实现。
 */
const sdkMock = vi.hoisted(() => ({
  startup: vi.fn(async () => ({
    close: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined)
  })),
  query: vi.fn(async function* () {
    // 默认空生成器
  }) as unknown as (opts: unknown) => AsyncGenerator<unknown>
}));
vi.mock(import("@anthropic-ai/claude-agent-sdk"), () => ({
  startup: sdkMock.startup,
  query: sdkMock.query,
  Options: class {}
}));

import { ClaudeAgentSdkAdapter, createClaudeNormalizerState, normalizeClaudeMessage } from "./claude-agent-sdk";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function makePrewarmContext(overrides: Partial<ProviderPrewarmContext> = {}): ProviderPrewarmContext {
  return {
    session: { id: "sess-1", provider: "claude", providerId: "claude-native", providerSessionId: null } as never,
    provider: { id: "claude-native", provider: "claude", label: "Claude", runtime: "native", available: true } as never,
    cwd: "/project",
    permissionProfile: "edit",
    providerSessionId: null,
    providerModel: "auto",
    ...overrides
  } as unknown as ProviderPrewarmContext;
}

describe("ClaudeAgentSdkAdapter.prewarm()", () => {
  it("首次 prewarm 调用 sdk.startup 并返回 true", async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    const result = await adapter.prewarm(makePrewarmContext());
    expect(result).toBe(true);
    expect(sdkMock.startup).toHaveBeenCalledTimes(1);
  });

  it("浏览器取证开启时只挂载受控 MCP，并追加写作取证规则", async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.prewarm(makePrewarmContext({
      browserAutomation: {
        enabled: true,
        reuseExistingTabs: true,
        evidenceDir: "assets/browser-evidence",
        extensionToken: "extension-token"
      }
    }));

    const startup = sdkMock.startup.mock.calls[0][0] as {
      options: {
        mcpServers: Record<string, { args: string[]; env: Record<string, string> }>;
        systemPrompt: { append?: string };
      };
    };
    const server = startup.options.mcpServers.cctools_browser;
    expect(server.args[0]).toMatch(/browser-evidence-mcp\.js$/);
    expect(server.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN).toBe("extension-token");
    expect(startup.options.systemPrompt.append).toContain("capture_source_evidence");
    expect(JSON.stringify(startup.options)).not.toContain("browser_run_code_unsafe");
  });

  it("相同 key 重复 prewarm 复用 warm slot,不重复 startup", async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    const ctx = makePrewarmContext();
    await adapter.prewarm(ctx);
    await adapter.prewarm(ctx);
    expect(sdkMock.startup).toHaveBeenCalledTimes(1);
  });

  it("startup reject 时移除 warm slot,可重试", async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    sdkMock.startup.mockRejectedValueOnce(new Error("启动失败"));
    // 第一次 reject
    await adapter.prewarm(makePrewarmContext()).catch(() => undefined);
    // 等 promise.catch 执行(slot 清理是异步的)
    await new Promise((r) => setTimeout(r, 10));
    // 第二次应重新 startup
    await adapter.prewarm(makePrewarmContext());
    expect(sdkMock.startup).toHaveBeenCalledTimes(2);
  });
});

describe("ClaudeAgentSdkAdapter.disposeSession()", () => {
  it("prewarm 后 dispose 对应 session,close 该 warm slot", async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    const ctx = makePrewarmContext();
    await adapter.prewarm(ctx);
    // dispose 该 session
    adapter.disposeSession("sess-1");
    // warm slot 应被移除;再次 prewarm 同 key 会重新 startup
    await new Promise((r) => setTimeout(r, 10));
    await adapter.prewarm(ctx);
    expect(sdkMock.startup).toHaveBeenCalledTimes(2);
  });

  it("dispose 不存在的 sessionId 不抛错", () => {
    const adapter = new ClaudeAgentSdkAdapter();
    expect(() => adapter.disposeSession("nonexistent")).not.toThrow();
  });
});

function makeRunContext(overrides: Partial<ProviderRunContext> = {}): ProviderRunContext {
  return {
    session: {
      id: "sess-1", provider: "claude", providerId: "claude-native",
      providerSessionId: null, title: "t", cwd: "/project",
      permissionProfile: "edit", projectId: "p1", projectRoot: "/project"
    },
    run: { id: "run-1", sessionId: "sess-1", prompt: "hi", status: "running", startedAt: "now", cwd: "/project" } as never,
    provider: { id: "claude-native", provider: "claude", label: "Claude", runtime: "native", available: true } as never,
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

/** 构造一个带 interrupt/close 的假 query(async generator)。 */
function makeQuery(messages: unknown[] = []) {
  const gen = async function* () {
    for (const msg of messages) yield msg;
  }();
  return Object.assign(gen, {
    interrupt: vi.fn(async () => undefined),
    close: vi.fn()
  });
}

describe("ClaudeAgentSdkAdapter.run()", () => {
  it("遍历 query 消息并 emit 事件(assistant-message)", async () => {
    const query = makeQuery([
      { type: "assistant", message: { content: [{ type: "text", text: "你好" }] } }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);
    expect(ctx.emit).toHaveBeenCalledWith("assistant-message", expect.objectContaining({ text: "你好" }));
  });

  it("system init 消息 emit system 事件 + 更新 providerSessionId", async () => {
    const query = makeQuery([
      { type: "system", subtype: "init", session_id: "real-session", model: "claude-4", claude_code_version: "1.0" }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);
    expect(ctx.updateProviderSession).toHaveBeenCalledWith("real-session");
    expect(ctx.emit).toHaveBeenCalledWith("system", expect.objectContaining({ subtype: "init" }));
  });

  it("stream_event text_delta emit assistant-delta", async () => {
    const query = makeQuery([
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "片段" } } }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);
    expect(ctx.emit).toHaveBeenCalledWith("assistant-delta", expect.objectContaining({ text: "片段" }));
  });

  it("tool_use 消息 emit tool-start", async () => {
    const query = makeQuery([
      { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }] } }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);
    expect(ctx.emit).toHaveBeenCalledWith("tool-start", expect.objectContaining({ tool: "Bash" }));
  });

  it("tool_result 消息 emit tool-complete", async () => {
    const query = makeQuery([
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "done", is_error: false }] } }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);
    expect(ctx.emit).toHaveBeenCalledWith("tool-complete", expect.objectContaining({ itemId: "tu1" }));
  });

  it("result 消息 emit usage", async () => {
    const query = makeQuery([
      { type: "result", usage: { input_tokens: 100 }, total_cost_usd: 0.01, duration_ms: 5000 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);
    expect(ctx.emit).toHaveBeenCalledWith("usage", expect.objectContaining({ cost: 0.01 }));
  });

  it("result/success emits the authoritative final reply", async () => {
    const query = makeQuery([
      { type: "assistant", message: { content: [{ type: "text", text: "先检查文件" }] } },
      { type: "result", subtype: "success", result: "最终结论", usage: {}, total_cost_usd: 0, duration_ms: 10 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);

    expect(ctx.emit).toHaveBeenCalledWith("assistant-message", { text: "先检查文件", phase: "commentary" });
    expect(ctx.emit).toHaveBeenCalledWith("assistant-message", { text: "最终结论", phase: "final" });
  });

  it("emits only the authoritative final when it repeats the buffered assistant frame", async () => {
    const query = makeQuery([
      { type: "assistant", message: { content: [{ type: "text", text: "same answer\r\n" }] } },
      { type: "result", subtype: "success", result: "same answer\n", usage: {}, total_cost_usd: 0, duration_ms: 10 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await adapter.run(ctx);

    expect(ctx.emit).toHaveBeenCalledTimes(2);
    expect(ctx.emit).toHaveBeenNthCalledWith(1, "assistant-message", { text: "same answer\n", phase: "final" });
    expect(ctx.emit).toHaveBeenNthCalledWith(2, "usage", expect.objectContaining({ duration: 10 }));
  });

  it("flushes buffered assistant text as commentary before a later tool frame", async () => {
    const query = makeQuery([
      { type: "assistant", message: { content: [{ type: "text", text: "I will inspect first." }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "src/app.ts" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "Inspection complete." }] } },
      { type: "result", subtype: "success", result: "Inspection complete.", usage: {}, total_cost_usd: 0, duration_ms: 10 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await adapter.run(ctx);

    expect(ctx.emit).toHaveBeenCalledTimes(5);
    expect(ctx.emit).toHaveBeenNthCalledWith(1, "assistant-message", { text: "I will inspect first.", phase: "commentary" });
    expect(ctx.emit).toHaveBeenNthCalledWith(2, "tool-start", expect.objectContaining({ itemId: "tool-1" }));
    expect(ctx.emit).toHaveBeenNthCalledWith(3, "tool-complete", expect.objectContaining({ itemId: "tool-1" }));
    expect(ctx.emit).toHaveBeenNthCalledWith(4, "assistant-message", { text: "Inspection complete.", phase: "final" });
    expect(ctx.emit).toHaveBeenNthCalledWith(5, "usage", expect.any(Object));
  });

  it("bridges a completed TaskUpdate into one authoritative final reply", async () => {
    const query = makeQuery([
      {
        type: "assistant",
        message: { id: "answer-message", content: [{ type: "text", text: "完整正文" }] }
      },
      {
        type: "assistant",
        message: {
          id: "answer-message",
          content: [{ type: "tool_use", id: "task-update-1", name: "TaskUpdate", input: { taskId: "1", status: "completed" } }]
        }
      },
      { type: "tool_progress", tool_use_id: "task-update-1", tool_name: "TaskUpdate", elapsed_time_seconds: 0.1 },
      {
        type: "user",
        tool_use_result: { success: true, taskId: "1", updatedFields: ["status"] },
        message: { content: [{ type: "tool_result", tool_use_id: "task-update-1", content: "ok", is_error: false }] }
      },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "request " } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "短" } } },
      { type: "assistant", message: { id: "final-message", content: [{ type: "thinking", thinking: "request fulfilled" }] } },
      { type: "assistant", message: { id: "final-message", content: [{ type: "text", text: "短收尾" }] } },
      { type: "result", subtype: "success", result: "短收尾", usage: {}, total_cost_usd: 0, duration_ms: 10 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await adapter.run(ctx);

    const assistantMessages = vi.mocked(ctx.emit).mock.calls
      .filter(([kind]) => kind === "assistant-message")
      .map(([, payload]) => payload);
    expect(assistantMessages).toEqual([{ text: "完整正文\n\n短收尾", phase: "final" }]);
    expect(ctx.emit).toHaveBeenCalledWith("tool-start", expect.objectContaining({ tool: "TaskUpdate", itemId: "task-update-1" }));
    expect(ctx.emit).toHaveBeenCalledWith("tool-output", expect.objectContaining({ tool: "TaskUpdate", itemId: "task-update-1" }));
    expect(ctx.emit).toHaveBeenCalledWith("tool-complete", expect.objectContaining({ tool: "TaskUpdate", itemId: "task-update-1", isError: false }));
    expect(ctx.emit).toHaveBeenCalledWith("reasoning-summary", expect.objectContaining({ text: "request fulfilled" }));
  });

  it("appends a distinct terminal result when a completed bookkeeping bridge has no durable tail frame", async () => {
    const query = makeQuery([
      { type: "assistant", message: { content: [{ type: "text", text: "第一行  \n第二行" }] } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "task-update-1", name: "TaskUpdate", input: { taskId: "1", status: "completed" } }] }
      },
      {
        type: "user",
        tool_use_result: { success: true },
        message: { content: [{ type: "tool_result", tool_use_id: "task-update-1", content: "ok", is_error: false }] }
      },
      { type: "result", subtype: "success", result: "短收尾", usage: {}, total_cost_usd: 0, duration_ms: 10 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await adapter.run(ctx);

    const assistantMessages = vi.mocked(ctx.emit).mock.calls
      .filter(([kind]) => kind === "assistant-message")
      .map(([, payload]) => payload);
    expect(assistantMessages).toEqual([{ text: "第一行  \n第二行\n\n短收尾", phase: "final" }]);
  });

  it("keeps TodoWrite trace events while treating it as final-transparent", async () => {
    const query = makeQuery([
      {
        type: "assistant",
        message: { content: [
          { type: "text", text: "完整正文" },
          {
            type: "tool_use",
            id: "todo-write-1",
            name: "TodoWrite",
            input: { todos: [{ content: "完成总结", status: "completed" }] }
          }
        ] }
      },
      {
        type: "user",
        tool_use_result: { newTodos: [{ content: "完成总结", status: "completed" }] },
        message: { content: [{ type: "tool_result", tool_use_id: "todo-write-1", content: "ok", is_error: false }] }
      },
      { type: "result", subtype: "success", result: "完整正文", usage: {}, total_cost_usd: 0, duration_ms: 10 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await adapter.run(ctx);

    const assistantMessages = vi.mocked(ctx.emit).mock.calls
      .filter(([kind]) => kind === "assistant-message")
      .map(([, payload]) => payload);
    expect(assistantMessages).toEqual([{ text: "完整正文", phase: "final" }]);
    expect(ctx.emit).toHaveBeenCalledWith("todo", expect.objectContaining({
      sourceTool: "TodoWrite",
      itemId: "todo-write-1",
      items: [expect.objectContaining({ text: "完成总结", status: "completed" })]
    }));
  });

  it("ends the bookkeeping bridge before a real tool call", async () => {
    const query = makeQuery([
      {
        type: "assistant",
        message: { content: [
          { type: "text", text: "工具前说明" },
          { type: "tool_use", id: "task-update-1", name: "TaskUpdate", input: { taskId: "1", status: "completed" } }
        ] }
      },
      {
        type: "user",
        tool_use_result: { success: true },
        message: { content: [{ type: "tool_result", tool_use_id: "task-update-1", content: "ok", is_error: false }] }
      },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "src/app.ts" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "done", is_error: false }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "最终结论" }] } },
      { type: "result", subtype: "success", result: "最终结论", usage: {}, total_cost_usd: 0, duration_ms: 10 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await adapter.run(ctx);

    const assistantMessages = vi.mocked(ctx.emit).mock.calls
      .filter(([kind]) => kind === "assistant-message")
      .map(([, payload]) => payload);
    expect(assistantMessages).toEqual([
      { text: "工具前说明", phase: "commentary" },
      { text: "最终结论", phase: "final" }
    ]);
  });

  it("fails closed when a bookkeeping tool reports an error", async () => {
    const query = makeQuery([
      {
        type: "assistant",
        message: { content: [
          { type: "text", text: "错误前正文" },
          { type: "tool_use", id: "task-update-1", name: "TaskUpdate", input: { taskId: "1", status: "completed" } }
        ] }
      },
      {
        type: "user",
        tool_use_result: { success: false },
        message: { content: [{ type: "tool_result", tool_use_id: "task-update-1", content: "failed", is_error: true }] }
      },
      { type: "assistant", message: { content: [{ type: "text", text: "短 final" }] } },
      { type: "result", subtype: "success", result: "短 final", usage: {}, total_cost_usd: 0, duration_ms: 10 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await adapter.run(ctx);

    const assistantMessages = vi.mocked(ctx.emit).mock.calls
      .filter(([kind]) => kind === "assistant-message")
      .map(([, payload]) => payload);
    expect(assistantMessages).toEqual([
      { text: "错误前正文", phase: "commentary" },
      { text: "短 final", phase: "final" }
    ]);
  });

  it("fails closed when a bookkeeping tool never returns a matching result", async () => {
    const query = makeQuery([
      {
        type: "assistant",
        message: { content: [
          { type: "text", text: "悬空正文" },
          { type: "tool_use", id: "todo-write-1", name: "TodoWrite", input: { todos: [] } }
        ] }
      },
      { type: "result", subtype: "success", result: "短 final", usage: {}, total_cost_usd: 0, duration_ms: 10 }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await adapter.run(ctx);

    const assistantMessages = vi.mocked(ctx.emit).mock.calls
      .filter(([kind]) => kind === "assistant-message")
      .map(([, payload]) => payload);
    expect(assistantMessages).toEqual([
      { text: "悬空正文", phase: "commentary" },
      { text: "短 final", phase: "final" }
    ]);
  });

  it("rejects terminal Claude error results instead of completing without a final reply", async () => {
    const query = makeQuery([
      { type: "assistant", message: { content: [{ type: "text", text: "继续检查" }] } },
      { type: "result", subtype: "error_max_turns", is_error: true, errors: ["maximum turns reached"], usage: {} }
    ]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await expect(adapter.run(ctx)).rejects.toThrow("maximum turns reached");
    expect(ctx.emit).toHaveBeenCalledWith("assistant-message", expect.objectContaining({ phase: "commentary" }));
    expect(ctx.emit).not.toHaveBeenCalledWith("assistant-message", expect.objectContaining({ phase: "final" }));
  });

  it("abort signal 触发 query.interrupt + close", async () => {
    // 用一个永不自然结束的 query,确保 abort 发生在迭代中
    let resolveNext: ((val: { done: boolean; value: undefined }) => void) | null = null;
    const hangingQuery = {
      async next() { return new Promise<{ done: boolean; value: undefined }>((resolve) => { resolveNext = resolve; }); },
      [Symbol.asyncIterator]() { return this; },
      interrupt: vi.fn(async () => { resolveNext?.({ done: true, value: undefined }); }),
      close: vi.fn()
    };
    sdkMock.query.mockReturnValueOnce(hangingQuery as never);
    const controller = new AbortController();
    const ctx = makeRunContext({ signal: controller.signal });
    const adapter = new ClaudeAgentSdkAdapter();
    const runPromise = adapter.run(ctx);
    // 让 run 进入 for-await 循环
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await runPromise;
    expect(hangingQuery.interrupt).toHaveBeenCalled();
    expect(hangingQuery.close).toHaveBeenCalled();
  });

  it("query 抛错时 run reject 含 stderr", async () => {
    const query = makeQuery([]);
    query.next = async () => { throw new Error("stream broken"); };
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();
    await expect(adapter.run(ctx)).rejects.toThrow("stream broken");
  });

  it("preserves a buffered assistant frame when the SDK iterator fails", async () => {
    let yielded = false;
    const query = {
      async next() {
        if (!yielded) {
          yielded = true;
          return { done: false as const, value: { type: "assistant", message: { content: [{ type: "text", text: "partial answer" }] } } };
        }
        throw new Error("stream broken after assistant frame");
      },
      [Symbol.asyncIterator]() { return this; },
      interrupt: vi.fn(async () => undefined),
      close: vi.fn()
    };
    sdkMock.query.mockReturnValueOnce(query as never);
    const ctx = makeRunContext();
    const adapter = new ClaudeAgentSdkAdapter();

    await expect(adapter.run(ctx)).rejects.toThrow("stream broken after assistant frame");
    expect(ctx.emit).toHaveBeenCalledWith("assistant-message", { text: "partial answer", phase: "commentary" });
  });

  it("有图片附件时走 claudeImageMessageStream", async () => {
    // 写一个临时图片文件
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-img-"));
    const imgPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(imgPath, Buffer.from("iVBORw0KGgo=", "base64"));
    try {
      const query = makeQuery([
        { type: "assistant", message: { content: [{ type: "text", text: "看到图了" }] } }
      ]);
      sdkMock.query.mockReturnValueOnce(query);
      const ctx = makeRunContext({
        images: [{ id: "img1", path: imgPath, mediaType: "image/png" }],
        prompt: "描述这张图"
      });
      const adapter = new ClaudeAgentSdkAdapter();
      await adapter.run(ctx);
      // query 收到的 prompt 应是 AsyncGenerator(图片消息流)
      expect(sdkMock.query).toHaveBeenCalled();
      expect(ctx.emit).toHaveBeenCalledWith("assistant-message", expect.objectContaining({ text: "看到图了" }));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("只读权限与 Plan 模式解耦", async () => {
    const query = makeQuery([]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext({
      session: { id: "s1", provider: "claude", providerId: "claude-native", providerSessionId: null, permissionProfile: "read-only", cwd: "/project", projectRoot: "/project" } as never
    });
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);
    const opts = sdkMock.query.mock.calls[0][0] as { options: { permissionMode: string } };
    expect(opts.options.permissionMode).toBe("default");
  });

  it("Plan 模式走 Claude SDK 原生 permissionMode plan", async () => {
    const query = makeQuery([]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext({ session: { ...makeRunContext().session, interactionMode: "plan" } });
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);
    const opts = sdkMock.query.mock.calls[0][0] as { options: { permissionMode: string; tools: string[] } };
    expect(opts.options.permissionMode).toBe("plan");
    expect(opts.options.tools).toEqual(expect.arrayContaining(["EnterPlanMode", "ExitPlanMode", "TodoWrite", "TaskList"]));
  });

  it("providerModel 非 auto 时传 model 到 options", async () => {
    const query = makeQuery([]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext({ providerModel: "claude-opus-4" });
    const adapter = new ClaudeAgentSdkAdapter();
    await adapter.run(ctx);
    const opts = sdkMock.query.mock.calls[0][0] as { options: { model?: string } };
    expect(opts.options.model).toBe("claude-opus-4");
  });

  it("从 SkillStore 注入 Agent instructions，并禁用 project-local skill discovery", async () => {
    const tmpDir = fs.mkdtempSync("/tmp/cctools-claude-bridge-");
    fs.mkdirSync(`${tmpDir}/references`, { recursive: true });
    fs.writeFileSync(`${tmpDir}/SKILL.md`, "# Installed Agent\n执行受控任务。\n");
    fs.writeFileSync(`${tmpDir}/references/rules.md`, "只写入声明的 Artifact。\n");
    try {
      sdkMock.query.mockReturnValueOnce(makeQuery([]));
      const ctx = makeRunContext({
        prompt: "执行受控任务",
        skillInvocation: { name: "installed-agent", argument: "执行受控任务", raw: "/installed-agent 执行受控任务", prompt: "执行受控任务" },
        skillBridge: {
          id: "installed-agent",
          version: "1.0.0",
          digest: "a".repeat(64),
          packageRoot: tmpDir,
          skillPath: `${tmpDir}/SKILL.md`,
          referencePaths: ["references/rules.md"],
          mymindRoot: `${tmpDir}/mymind`,
          capabilities: {
            mymind: { read: ["article/**"], write: ["creative/**"] },
            network: { required: false, hosts: [] },
            subprocess: { allowed: false },
            browser: false
          }
        }
      });
      await new ClaudeAgentSdkAdapter().run(ctx);
      const opts = sdkMock.query.mock.calls[0][0] as { options: { settingSources: string[]; skills: string[]; systemPrompt: { append?: string } } };
      expect(opts.options.settingSources).toEqual(["user"]);
      expect(opts.options.skills).toEqual([]);
      expect(opts.options.systemPrompt.append).toContain("Installed Agent");
      expect(opts.options.systemPrompt.append).toContain("references/rules.md");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("prewarm 后 run 复用 warm slot", async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    // 先 prewarm
    await adapter.prewarm({
      session: { id: "sess-1" } as never,
      provider: { id: "claude-native", provider: "claude", label: "Claude", runtime: "native", available: true } as never,
      cwd: "/project", permissionProfile: "edit", providerSessionId: null, providerModel: "auto"
    } as unknown as ProviderPrewarmContext);

    const query = makeQuery([]);
    sdkMock.query.mockReturnValueOnce(query);
    const ctx = makeRunContext();
    await adapter.run(ctx);
    // query 来自 warm slot(不应调 sdkMock.query 直接)
    // warm slot 成功时 query 通过 slot.promise.then(w => w.query(prompt))
    expect(sdkMock.startup).toHaveBeenCalledTimes(1);
  });
});

describe("normalizeClaudeMessage tool lifecycle", () => {
  it("keeps tool_progress associated with its tool call", () => {
    const state = createClaudeNormalizerState();
    normalizeClaudeMessage({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } }] }
    }, state);

    const normalized = normalizeClaudeMessage({
      type: "tool_progress",
      tool_use_id: "tool-1",
      tool_name: "Bash",
      elapsed_time_seconds: 3,
      task_id: "task-1"
    }, state);

    expect(normalized.events).toEqual([expect.objectContaining({
      kind: "tool-output",
      payload: expect.objectContaining({
        itemId: "tool-1",
        tool: "Bash",
        input: { command: "npm test" },
        elapsedTimeSeconds: 3,
        taskId: "task-1"
      })
    })]);
  });

  it("associates tool_use_summary after tool_result with the preceding tool", () => {
    const state = createClaudeNormalizerState();
    normalizeClaudeMessage({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "src/app.ts" } }] }
    }, state);
    normalizeClaudeMessage({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }] }
    }, state);

    const normalized = normalizeClaudeMessage({
      type: "tool_use_summary",
      summary: "Read the application entry point",
      preceding_tool_use_ids: ["tool-1"]
    }, state);

    expect(normalized.events).toEqual([expect.objectContaining({
      kind: "tool-output",
      payload: expect.objectContaining({
        itemId: "tool-1",
        tool: "Read",
        input: { file_path: "src/app.ts" },
        text: "Read the application entry point",
        precedingItemIds: ["tool-1"]
      })
    })]);
  });
});

describe("normalizeClaudeMessage Plan/Todo", () => {
  it("从 TodoWrite 的真实 tool_result 输出生成 Todo 快照", () => {
    const state = createClaudeNormalizerState();
    normalizeClaudeMessage({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tool-1", name: "TodoWrite", input: { todos: [] } }] }
    }, state);
    const normalized = normalizeClaudeMessage({
      type: "user",
      tool_use_result: { oldTodos: [], newTodos: [{ content: "补测试", activeForm: "正在补测试", status: "in_progress" }] },
      message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }] }
    }, state);
    expect(normalized.events).toContainEqual(expect.objectContaining({
      kind: "todo",
      payload: expect.objectContaining({ sourceTool: "TodoWrite", items: [expect.objectContaining({ text: "补测试", status: "in-progress" })] })
    }));
  });

  it.each([
    {
      tool: "TaskCreate",
      input: { subject: "运行技能", description: "运行 daily-topic-selector" },
      output: { task: { id: "task-1", subject: "运行技能" } }
    },
    {
      tool: "TaskUpdate",
      input: { taskId: "task-1", status: "in_progress" },
      output: { success: true, taskId: "task-1", updatedFields: ["status"] }
    },
    {
      tool: "TaskList",
      input: {},
      output: { tasks: [{ id: "task-1", subject: "运行技能", status: "in_progress" }] }
    }
  ])("不把 $tool 的 tool_result 推断成 Todo", ({ tool, input, output }) => {
    const state = createClaudeNormalizerState();
    normalizeClaudeMessage({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "task-tool", name: tool, input }] }
    }, state);
    const normalized = normalizeClaudeMessage({
      type: "user",
      tool_use_result: output,
      message: { content: [{ type: "tool_result", tool_use_id: "task-tool", content: "ok" }] }
    }, state);

    expect(normalized.events).toContainEqual(expect.objectContaining({
      kind: "tool-complete",
      payload: expect.objectContaining({ tool })
    }));
    expect(normalized.events.some((event) => event.kind === "todo")).toBe(false);
  });

  it.each([
    { subtype: "task_started", task_id: "background-1", description: "运行后台命令" },
    { subtype: "task_updated", task_id: "background-1", patch: { status: "running" } },
    { subtype: "task_notification", task_id: "background-1", status: "completed", summary: "后台命令完成" }
  ])("把 system/$subtype 保留为独立子任务过程事件而不是 Todo", (message) => {
    const normalized = normalizeClaudeMessage({ type: "system", ...message });

    expect(normalized.events.some((event) => event.kind === "todo")).toBe(false);
    expect(normalized.events).toContainEqual({
      kind: "system",
      payload: expect.objectContaining({
        subtype: message.subtype,
        semanticType: "subtask",
        sourceEvent: `system/${message.subtype}`,
        taskId: "background-1"
      })
    });
  });

  it("只从 ExitPlanMode 的真实输出生成 Plan 正文，不推断 SDK 未报告的模式变化", () => {
    const state = createClaudeNormalizerState();
    normalizeClaudeMessage({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tool-2", name: "ExitPlanMode", input: {} }] }
    }, state);
    const normalized = normalizeClaudeMessage({
      type: "user",
      tool_use_result: { plan: "## 实施计划\n1. 修改契约", isAgent: false },
      message: { content: [{ type: "tool_result", tool_use_id: "tool-2", content: "ok" }] }
    }, state);
    expect(normalized.events).toContainEqual(expect.objectContaining({ kind: "plan", payload: expect.objectContaining({ sourceTool: "ExitPlanMode" }) }));
    expect(normalized.events.some((event) => event.kind === "system" && event.payload.subtype === "interaction_mode")).toBe(false);
  });
});

// resolveNativeClaudeExecutable / resolveClaudeExecutable 依赖 require.resolve + 真实
// 安装的 @anthropic-ai/claude-agent-sdk-<platform>-<arch> 二进制包,难以在单测里稳定 mock,
// 跳过这两个函数(它们是打包/部署路径,非核心逻辑)。
