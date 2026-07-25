import { describe, expect, it } from "vitest";
import type { AiRun, ContextReference, SkillDefinition } from "../../shared/contracts";
import {
  composeNativeSkillProviderPrompt,
  composeNativeSkillTaskPrompt,
  composePrompt,
  titleFromPrompt
} from "./scheduler-prompts";

function makeRun(overrides: Partial<AiRun>): AiRun {
  return {
    id: "run-1",
    sessionId: "sess-1",
    projectId: "proj-1",
    provider: "claude",
    providerId: "legacy",
    permissionProfile: "edit",
    status: "queued",
    prompt: "hello",
    contexts: [],
    turnContext: null,
    workspacePath: null,
    baseCommit: null,
    startedAt: "2026-07-07T00:00:00.000Z",
    completedAt: null,
    error: null,
    changeSet: null,
    risks: [],
    ...overrides
  } as AiRun;
}

function ctx(overrides: Partial<ContextReference>): ContextReference {
  return { id: "c1", kind: "file", label: "L", path: "a.md", content: "BODY", ...overrides } as ContextReference;
}

describe("titleFromPrompt", () => {
  it("collapses whitespace and trims to 48 chars", () => {
    expect(titleFromPrompt("   hello    world   ")).toBe("hello world");
    const long = "x".repeat(60);
    expect(titleFromPrompt(long)).toHaveLength(48);
  });

  it("falls back to 新会话 for empty prompts", () => {
    expect(titleFromPrompt("   ")).toBe("新会话");
    expect(titleFromPrompt("")).toBe("新会话");
  });
});

describe("composePrompt", () => {
  it("returns just the (expanded) prompt when there are no contexts", () => {
    expect(composePrompt(makeRun({ prompt: "plain prompt" }))).toBe("plain prompt");
  });

  it("appends a context block when contexts are present", () => {
    const out = composePrompt(makeRun({ prompt: "p", contexts: [ctx({ label: "Notes", path: "notes.md", content: "keep me" })] }));
    expect(out).toContain("p");
    expect(out).toContain("<context_from_cc_tools>");
    expect(out).toContain("Notes");
    expect(out).toContain("notes.md");
    expect(out).toContain("keep me");
    expect(out).toContain("</context_from_cc_tools>");
  });

  it("passes the complete selected text to the provider", () => {
    const selectedText = "第一行完整内容\n第二行完整内容\n第三行完整内容";
    const out = composePrompt(makeRun({
      prompt: "总结这段内容",
      contexts: [ctx({
        kind: "selection",
        label: "引用 · 2026-07-24 每日简报 · 3 行",
        path: "mymind/daily-summary/20260724_daily_summary.md",
        content: selectedText
      })]
    }));

    expect(out).toContain("总结这段内容");
    expect(out).toContain("引用 · 2026-07-24 每日简报 · 3 行");
    expect(out).toContain(selectedText);
  });

  it("emits a context block with '无' path when context has none, and skips image contexts", () => {
    const out = composePrompt(makeRun({
      prompt: "p",
      contexts: [
        ctx({ kind: "image", label: "Pic", path: undefined, content: undefined }),
        ctx({ kind: "file", label: "NoPath", path: undefined, content: undefined })
      ]
    }));
    // image filtered out of text block, NoPath present with 无
    expect(out).not.toContain("Pic");
    expect(out).toContain("NoPath");
    expect(out).toContain("路径: 无");
  });
});

describe("composeNativeSkillProviderPrompt / composeNativeSkillTaskPrompt", () => {
  const skill: SkillDefinition = { id: "rss", title: "RSS", description: "d", group: "g" } as SkillDefinition;
  const invocation = { skill, argument: "do thing", raw: "/rss do thing" };

  it("provider prompt = raw invocation + context block", () => {
    const out = composeNativeSkillProviderPrompt(makeRun({ prompt: "ignored", contexts: [ctx({ label: "C" })] }), invocation);
    expect(out.startsWith("/rss do thing")).toBe(true);
    expect(out).toContain("<context_from_cc_tools>");
  });

  it("task prompt = argument + context block, trimmed", () => {
    const out = composeNativeSkillTaskPrompt(makeRun({ prompt: "ignored", contexts: [ctx({ label: "C" })] }), invocation);
    expect(out.startsWith("do thing")).toBe(true);
    expect(out).toContain("<context_from_cc_tools>");
  });

  it("task prompt is trimmed when there are no contexts", () => {
    const out = composeNativeSkillTaskPrompt(makeRun({ prompt: "ignored", contexts: [] }), invocation);
    expect(out).toBe("do thing");
  });
});
