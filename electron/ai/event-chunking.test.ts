import { describe, expect, it } from "vitest";
import type { AiEvent } from "../../shared/contracts";
import {
  chunkPayload,
  isContextCompaction,
  isProviderPrivateDelta,
  normalizeLoadedEvent,
  reassembleEvents
} from "./event-chunking";

function makeEvent(overrides: Partial<AiEvent> & { payload: Record<string, unknown> }): AiEvent {
  return {
    id: "evt-1",
    seq: 1,
    timestamp: "2026-07-07T00:00:00.000Z",
    projectId: "p",
    sessionId: "s",
    runId: "r",
    provider: "claude" as const,
    kind: "assistant-message",
    risks: [],
    ...overrides
  };
}

describe("chunkPayload", () => {
  it("returns the payload as-is when under the byte budget", () => {
    const payload = { text: "hello" };
    expect(chunkPayload(payload)).toEqual([payload]);
  });

  it("splits a large text payload into ordered chunks carrying chunk metadata", () => {
    // Build a payload large enough to exceed MAX_EVENT_PAYLOAD_BYTES (256 KiB).
    const big = "x".repeat(300 * 1024);
    const chunks = chunkPayload({ text: big });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.chunk && typeof c.chunk.id === "string")).toBe(true);
    expect(chunks.map((c) => (c.chunk as { index: number }).index)).toEqual(chunks.map((_, i) => i));
    expect((chunks[0].chunk as { total: number }).total).toBe(chunks.length);
    expect((chunks[0].chunk as { field: string }).field).toBe("text");
    // reassembled text equals the original
    expect(chunks.map((c) => c.text).join("")).toBe(big);
  });

  it("preserves non-text fields on text chunks and drops the original text key from base", () => {
    const big = "y".repeat(300 * 1024);
    const chunks = chunkPayload({ text: big, model: "claude-x", extra: 1 });
    expect(chunks.every((c) => c.model === "claude-x" && c.extra === 1)).toBe(true);
  });

  it("falls back to $json chunking for non-text payloads", () => {
    const big = { data: "z".repeat(300 * 1024) };
    const chunks = chunkPayload(big);
    expect(chunks.length).toBeGreaterThan(1);
    expect((chunks[0].chunk as { field: string }).field).toBe("$json");
    expect(chunks.every((c) => typeof c.chunkData === "string")).toBe(true);
  });
});

describe("reassembleEvents", () => {
  it("rejoins chunked text events into a single event and concatenates their risks", () => {
    const big = "a".repeat(300 * 1024);
    const payload = { text: big };
    const chunks = chunkPayload(payload);
    const events = chunks.map((c, i) => makeEvent({
      id: `evt-${i}`,
      seq: i,
      payload: c,
      risks: [{ id: `risk-${i}`, kind: "token", severity: "warning", summary: "s" }]
    }));
    const reassembled = reassembleEvents(events);
    expect(reassembled).toHaveLength(1);
    expect(reassembled[0].payload.text).toBe(big);
    expect(reassembled[0].payload.chunk).toBeUndefined();
    expect(reassembled[0].risks).toHaveLength(chunks.length);
  });

  it("rejoins $json chunks by JSON.parsing the concatenated payload", () => {
    const big = { data: "b".repeat(300 * 1024), n: 7 };
    const chunks = chunkPayload(big);
    const events = chunks.map((c, i) => makeEvent({ id: `e-${i}`, seq: i, payload: c }));
    const [reassembled] = reassembleEvents(events);
    expect(reassembled.payload).toEqual(big);
  });

  it("passes through non-chunked events untouched", () => {
    const e = makeEvent({ payload: { text: "hi" } });
    expect(reassembleEvents([e])).toEqual([e]);
  });

  it("emits partial chunk events in place when the group is incomplete", () => {
    const big = "c".repeat(300 * 1024);
    const chunks = chunkPayload({ text: big });
    // drop the last chunk to simulate an incomplete group
    const incomplete = chunks.slice(0, -1).map((c, i) => makeEvent({ id: `e-${i}`, seq: i, payload: c }));
    const reassembled = reassembleEvents(incomplete);
    // incomplete group → each surviving chunk emitted as-is, in original order
    expect(reassembled).toHaveLength(incomplete.length);
  });
});

describe("isProviderPrivateDelta", () => {
  it("is true only for system events whose message.subtype is thinking_tokens or status", () => {
    expect(isProviderPrivateDelta("system", { message: { subtype: "thinking_tokens" } })).toBe(true);
    expect(isProviderPrivateDelta("system", { message: { subtype: "status" } })).toBe(true);
    expect(isProviderPrivateDelta("system", { message: { subtype: "other" } })).toBe(false);
    expect(isProviderPrivateDelta("system", { message: {} })).toBe(false);
    expect(isProviderPrivateDelta("assistant-message", { message: { subtype: "status" } })).toBe(false);
    expect(isProviderPrivateDelta("system", {})).toBe(false);
  });
});

describe("isContextCompaction", () => {
  it("detects compact_boundary / context_compacted system subtypes", () => {
    expect(isContextCompaction("system", { subtype: "compact_boundary" })).toBe(true);
    expect(isContextCompaction("system", { subtype: "context_compacted" })).toBe(true);
    expect(isContextCompaction("system", { subtype: "init" })).toBe(false);
    expect(isContextCompaction("assistant-message", { subtype: "compact_boundary" })).toBe(false);
  });
});

describe("normalizeLoadedEvent", () => {
  it("drops provider-private deltas", () => {
    expect(normalizeLoadedEvent(makeEvent({
      kind: "system",
      payload: { message: { subtype: "thinking_tokens" } }
    }))).toBeNull();
  });

  it("rewrites a Claude init message into a normalized init payload", () => {
    const out = normalizeLoadedEvent(makeEvent({
      kind: "system",
      payload: { message: { subtype: "init", model: "claude-x", claude_code_version: "1.2", permissionMode: "edit" } }
    }));
    expect(out?.payload).toMatchObject({
      text: "Claude Code 已初始化",
      subtype: "init",
      model: "claude-x",
      version: "1.2",
      permissionMode: "edit"
    });
  });

  it("passes through non-init system messages and non-system events unchanged", () => {
    const sys = makeEvent({ kind: "system", payload: { subtype: "other" } });
    expect(normalizeLoadedEvent(sys)).toEqual(sys);
    const msg = makeEvent({ kind: "assistant-message", payload: { text: "hi" } });
    expect(normalizeLoadedEvent(msg)).toEqual(msg);
  });
});
