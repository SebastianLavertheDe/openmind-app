import { describe, expect, it } from "vitest";
import { captureTurnContext, withRecoveredHistory, withTurnContext } from "./turn-context";

describe("turn context", () => {
  it("captures the calendar date in the selected IANA timezone", () => {
    const instant = new Date("2026-06-30T16:30:00.000Z");

    expect(captureTurnContext("/workspace", instant, "Asia/Shanghai")).toEqual({
      cwd: "/workspace",
      currentDate: "2026-07-01",
      timezone: "Asia/Shanghai",
      capturedAt: "2026-06-30T16:30:00.000Z"
    });
    expect(captureTurnContext("/workspace", instant, "America/Los_Angeles").currentDate).toBe("2026-06-30");
  });

  it("prepends a fresh temporal anchor without changing the user's stored prompt", () => {
    const prompt = withTurnContext("总结下今天的内容", {
      cwd: "/work/a&b",
      currentDate: "2026-07-01",
      timezone: "Asia/Shanghai",
      capturedAt: "2026-07-01T00:00:00.000Z"
    });

    expect(prompt).toContain("<current_date>2026-07-01</current_date>");
    expect(prompt).toContain("<timezone>Asia/Shanghai</timezone>");
    expect(prompt).toContain("<cwd>/work/a&amp;b</cwd>");
    expect(prompt.endsWith("总结下今天的内容")).toBe(true);
  });

  it("replays surviving rollout history when the provider session is unavailable", () => {
    const prompt = withRecoveredHistory("continue", {
      sessionId: "session",
      history: [{
        id: "old",
        turnId: "old-turn",
        kind: "message",
        role: "user",
        name: null,
        callId: null,
        content: "old <message>",
        payload: {}
      }, {
        id: "current",
        turnId: "current-turn",
        kind: "message",
        role: "user",
        name: null,
        callId: null,
        content: "continue",
        payload: {}
      }],
      historyVersion: 0,
      referenceContext: null,
      worldState: null,
      windowNumber: 0,
      windowId: null,
      tokenInfo: null,
      estimatedTokens: 4,
      parseErrors: 0
    }, "current-turn");

    expect(prompt).toContain('source="local_rollout"');
    expect(prompt).toContain("old &lt;message&gt;");
    expect(prompt.match(/continue/g)).toHaveLength(1);
  });
});
