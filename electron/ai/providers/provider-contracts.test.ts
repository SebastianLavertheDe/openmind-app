import { describe, expect, it } from "vitest";
import type { ProviderRunContext } from "./types";
import { canAutoApprove, classifyApproval } from "./types";
import { buildCodexTurnInput, buildCodexAppServerArgs, normalizeCodexNotification, resolveCodexNativeSkill } from "./codex-app-server";
import { CLAUDE_SETTING_SOURCES, CLAUDE_SKILL_SELECTION, decideClaudePermission, normalizeClaudeMessage, orderClaudeEvents, toAsarUnpackedPath } from "./claude-agent-sdk";
import { parseClaudeAuthStatus } from "../provider-registry";

const context = {
  session: { permissionProfile: "edit" },
  cwd: "/project"
} as ProviderRunContext;

describe("provider contracts", () => {
  it("normalizes Codex semantic events", () => {
    expect(normalizeCodexNotification({ method: "item/agentMessage/delta", params: { delta: "hello" } })[0]).toMatchObject({
      kind: "assistant-delta",
      payload: { text: "hello" }
    });
    expect(normalizeCodexNotification({ method: "item/reasoning/summaryTextDelta", params: { delta: "checking" } })[0]).toMatchObject({
      kind: "reasoning-delta",
      payload: { text: "checking", source: "codex-summary" }
    });
    expect(normalizeCodexNotification({ method: "item/completed", params: { item: { id: "1", type: "commandExecution", command: "npm test" } } })[0].kind).toBe("tool-complete");
    expect(normalizeCodexNotification({ method: "thread/compacted", params: { threadId: "thread-1" } })[0]).toMatchObject({
      kind: "system",
      payload: { subtype: "context_compacted", threadId: "thread-1" }
    });
  });

  it("normalizes Claude semantic events", () => {
    const normalized = normalizeClaudeMessage({
      type: "assistant",
      session_id: "session-1",
      message: { content: [{ type: "text", text: "done" }, { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a" } }] }
    });
    expect(normalized.sessionId).toBe("session-1");
    expect(normalized.events.map((event) => event.kind)).toEqual(["assistant-message", "tool-start"]);
    expect(normalized.events[0]).toEqual({ kind: "assistant-message", payload: { text: "done", phase: "commentary" } });
    expect(normalizeClaudeMessage({ type: "system", subtype: "thinking_tokens", estimated_tokens: 10 }).events).toEqual([]);
    expect(normalizeClaudeMessage({ type: "system", subtype: "status", status: "requesting" }).events).toEqual([]);
    expect(normalizeClaudeMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "stream" } }
    }).events).toEqual([{ kind: "assistant-delta", payload: { text: "stream" } }]);
    expect(normalizeClaudeMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private" } }
    }).events).toEqual([{ kind: "reasoning-delta", payload: { text: "private", source: "claude-thinking" } }]);
    expect(normalizeClaudeMessage({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "inspect first" }, { type: "text", text: "done" }] }
    }).events).toEqual([
      { kind: "reasoning-summary", payload: { text: "inspect first", source: "claude-thinking" } },
      { kind: "assistant-message", payload: { text: "done", phase: "commentary" } }
    ]);
    expect(normalizeClaudeMessage({
      type: "result",
      subtype: "success",
      result: "authoritative final",
      usage: { input_tokens: 10 },
      total_cost_usd: 0.01,
      duration_ms: 200
    }).events).toEqual([
      { kind: "assistant-message", payload: { text: "authoritative final", phase: "final" } },
      { kind: "usage", payload: { usage: { input_tokens: 10 }, cost: 0.01, duration: 200 } }
    ]);
    expect(normalizeClaudeMessage({ type: "system", subtype: "init", model: "glm-5.1", claude_code_version: "2.1.177" }).events).toEqual([{
      kind: "system",
      payload: {
        text: "Claude Code 已初始化",
        subtype: "init",
        model: "glm-5.1",
        version: "2.1.177",
        permissionMode: undefined
      }
    }]);
    expect(normalizeClaudeMessage({ type: "system", subtype: "compact_boundary" }).events[0]).toMatchObject({
      kind: "system",
      payload: { subtype: "compact_boundary" }
    });
  });

  it("does not expose Claude private status deltas as semantic conversation events", () => {
    expect(normalizeClaudeMessage({ type: "system", subtype: "thinking_tokens", estimated_tokens: 1 }).events).toEqual([]);
    expect(normalizeClaudeMessage({ type: "system", subtype: "status", status: "requesting" }).events).toEqual([]);
  });

  it("persists Claude reasoning before the tool event that follows it", () => {
    const reasoning = orderClaudeEvents([
      { kind: "reasoning-delta", payload: { text: "先检查目录" } }
    ]);
    const tool = orderClaudeEvents([
      { kind: "tool-start", payload: { tool: "Bash", input: { command: "ls -la .claude/" } } }
    ], reasoning.pendingReasoning);

    expect(tool.events.map((event) => event.kind)).toEqual(["reasoning-summary", "tool-start"]);
    expect(tool.events[0].payload.text).toBe("先检查目录");
  });

  it.each([
    ["matching", "inspect the repository", "inspect the repository", "inspect the repository"],
    ["durable-prefix", "inspect", "inspect the repository", "inspect the repository"],
    ["streamed-prefix", "inspect the repository", "inspect", "inspect the repository"]
  ])("coalesces Claude %s streamed thinking with its durable block", (_, streamedText, durableText, expected) => {
    const streamed = orderClaudeEvents([
      { kind: "reasoning-delta", payload: { text: streamedText } }
    ]);
    const durable = orderClaudeEvents([
      { kind: "reasoning-summary", payload: { text: durableText, source: "claude-thinking" } },
      { kind: "tool-start", payload: { tool: "Read", input: { file_path: "src/app.ts" } } }
    ], streamed.pendingReasoning);

    expect(durable.events.map((event) => event.kind)).toEqual(["reasoning-summary", "tool-start"]);
    expect(durable.events[0].payload.text).toBe(expected);
    expect(durable.pendingReasoning).toBe("");
  });

  it("loads user settings so local Claude credentials and provider environment are inherited", () => {
    expect(CLAUDE_SETTING_SOURCES).toEqual(["user", "project"]);
    expect(CLAUDE_SKILL_SELECTION).toBe("all");
    expect(normalizeClaudeMessage({ type: "result", is_error: true, result: "Not logged in" }).events.map((event) => event.kind))
      .toEqual(["usage"]);
  });

  it("detects Claude authentication status", () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"oauth_token"}')).toBe(true);
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toBe(false);
    expect(parseClaudeAuthStatus("Not logged in · Please run /login")).toBe(false);
  });

  it("maps Electron asar binaries to their executable unpacked path", () => {
    expect(toAsarUnpackedPath("C:\\CC Tools\\resources\\app.asar\\node_modules\\claude.exe"))
      .toBe("C:\\CC Tools\\resources\\app.asar.unpacked\\node_modules\\claude.exe");
  });

  it("allows safe direct-project edits but never auto-approves destructive actions", () => {
    expect(canAutoApprove(context, "file-change", "", ["/project/a.ts"])).toBe(true);
    expect(canAutoApprove(context, "delete", "rm a.ts", ["/project/a.ts"])).toBe(false);
    expect(canAutoApprove(context, "file-change", "", ["/outside/a.ts"])).toBe(false);
    expect(classifyApproval("git push").category).toBe("network");
  });

  it("returns updatedInput on auto-approved Claude tool calls so the SDK schema accepts the result", () => {
    const decision = decideClaudePermission(context, "Bash", { command: "ls" });
    expect(decision.behavior).toBe("allow");
    if (decision.behavior !== "allow") throw new Error("expected allow");
    expect(decision.updatedInput).toEqual({ command: "ls" });
  });

  it("denies mutating tools in read-only Claude sessions", () => {
    const readOnly = { session: { permissionProfile: "read-only" }, cwd: "/project" } as ProviderRunContext;
    const decision = decideClaudePermission(readOnly, "Write", { file_path: "/project/a.ts" });
    expect(decision.behavior).toBe("deny");
  });

  it("builds Codex native skill input from skills/list metadata", () => {
    const nativeSkill = resolveCodexNativeSkill({
      data: [{
        cwd: "/project",
        skills: [{ name: "rss-article-saver", path: "/project/.claude/skills/rss-article-saver/SKILL.md", enabled: true }]
      }]
    }, "rss-article-saver");
    expect(nativeSkill).toEqual({
      name: "rss-article-saver",
      path: "/project/.claude/skills/rss-article-saver/SKILL.md",
      enabled: true
    });
    expect(buildCodexTurnInput({
      prompt: "/rss-article-saver today",
      skillInvocation: {
        name: "rss-article-saver",
        argument: "today",
        raw: "/rss-article-saver today",
        prompt: "today"
      }
    }, nativeSkill)).toEqual([
      { type: "skill", name: "rss-article-saver", path: "/project/.claude/skills/rss-article-saver/SKILL.md" },
      { type: "text", text: "today", text_elements: [] }
    ]);
    expect(resolveCodexNativeSkill({
      data: [{ cwd: "/project", skills: [{ name: "rss-article-saver", path: "/skill/SKILL.md", enabled: false }] }]
    }, "rss-article-saver")).toMatchObject({ enabled: false });
  });

  it("builds codex app-server args with model override only when not auto", () => {
    expect(buildCodexAppServerArgs("auto")).toEqual(["app-server"]);
    expect(buildCodexAppServerArgs(undefined)).toEqual(["app-server"]);
    expect(buildCodexAppServerArgs(null)).toEqual(["app-server"]);
    expect(buildCodexAppServerArgs("gpt-5")).toEqual(["app-server", "-c", "model=gpt-5"]);
    // 含特殊字符的模型 id（如 GLM 的 [1m]）原样透传。
    expect(buildCodexAppServerArgs("glm-5.2[1m]")).toEqual(["app-server", "-c", "model=glm-5.2[1m]"]);
  });
});
