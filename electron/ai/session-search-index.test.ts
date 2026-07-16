import { describe, expect, it, vi } from "vitest";
import type { AiEvent, AiSession } from "../../shared/contracts";
import { SessionSearchIndex, type SearchIndexIO } from "./session-search-index";

function makeIO(): SearchIndexIO & { writes: Array<{ file: string; value: unknown }>; reads: Array<string>; readJsonImpl: (f: string) => unknown } {
  const writes: Array<{ file: string; value: unknown }> = [];
  const reads: Array<string> = [];
  let disk = new Map<string, unknown>();
  const io = {
    writes,
    reads,
    readJsonImpl: (f: string) => disk.get(f),
    readJson: (file: string) => {
      reads.push(file);
      const v = disk.get(file);
      if (v === undefined) throw new Error("not found");
      return v;
    },
    writeAtomic: (file: string, value: unknown) => {
      writes.push({ file, value });
      disk.set(file, value);
    },
    // helper to seed disk for tests
    _seed: (file: string, value: unknown) => { disk.set(file, value); }
  };
  return io as unknown as ReturnType<typeof makeIO>;
}

function evt(overrides: Partial<AiEvent> & { payload: Record<string, unknown> }): AiEvent {
  return {
    id: "e", seq: 1, timestamp: "2026-07-07T00:00:00.000Z", projectId: "p", sessionId: "s",
    runId: "r", provider: "claude", kind: "assistant-message", risks: [], ...overrides
  } as AiEvent;
}

function session(id: string): AiSession {
  return { id, title: id } as AiSession;
}

describe("SessionSearchIndex", () => {
  describe("load + search", () => {
    it("indexes by raw.text when provided, else falls back to title (body alone is not searchable until a write merges it)", () => {
      const io = makeIO();
      const idx = new SessionSearchIndex(io);
      // load: text is set from raw.text || title; body is stored but not yet merged into searchable text
      idx.load("s1", "Title1", { text: "Title1\nalpha beta", body: "alpha beta" });
      idx.load("s2", "Title2", null);
      const sessions = [session("s1"), session("s2")];
      expect(idx.search("alpha", sessions).map((s) => s.id)).toEqual(["s1"]);
      // fallback: title searchable
      expect(idx.search("title2", sessions).map((s) => s.id)).toEqual(["s2"]);
    });

    it("returns all sessions for empty query", () => {
      const io = makeIO();
      const idx = new SessionSearchIndex(io);
      idx.load("s1", "T", null);
      const sessions = [session("s1"), session("s2")];
      expect(idx.search("", sessions)).toHaveLength(2);
      expect(idx.search("   ", sessions)).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("removes both body and text entries", () => {
      const io = makeIO();
      const idx = new SessionSearchIndex(io);
      idx.load("s1", "Title", { text: "Title\ndeep content", body: "deep content" });
      idx.delete("s1");
      expect(idx.search("deep", [session("s1")])).toHaveLength(0);
    });
  });

  describe("write", () => {
    it("accumulates event text/command into the body in-memory during bursts, and persists on turn boundary", () => {
      const io = makeIO();
      const idx = new SessionSearchIndex(io);
      // burst: additions non-empty → in-memory only, no write
      idx.write("s1", "Title", [evt({ payload: { text: "first" } }), evt({ payload: { command: "ls" } })], "s1.json");
      expect(io.writes).toHaveLength(0);
      // searchable in-memory already
      expect(idx.search("first", [session("s1")]).map((s) => s.id)).toEqual(["s1"]);
      // turn boundary: empty additions → persist consolidated file
      idx.write("s1", "Title", [], "s1.json");
      expect(io.writes).toHaveLength(1);
      const persisted = io.writes[0].value as { title: string; body: string; text: string; sessionId: string };
      expect(persisted.sessionId).toBe("s1");
      expect(persisted.title).toBe("Title");
      expect(persisted.body).toContain("first");
      expect(persisted.body).toContain("ls");
      expect(persisted.text).toContain("Title");
    });

    it("skips writes for events that produce no searchable text", () => {
      const io = makeIO();
      const idx = new SessionSearchIndex(io);
      idx.write("s1", "T", [evt({ payload: { number: 5 } })], "s1.json");
      expect(io.writes).toHaveLength(0);
      // body unchanged
      idx.write("s1", "T", [], "s1.json");
      const persisted = io.writes[0].value as { body: string };
      expect(persisted.body).toBe("");
    });

    it("reads existing body from disk when session not yet loaded", () => {
      const io = makeIO();
      io._seed("s1.json", { body: "seeded body" });
      const idx = new SessionSearchIndex(io);
      // not pre-loaded → write must consult io.readJson
      idx.write("s1", "Title", [evt({ payload: { text: " appended" } })], "s1.json");
      idx.write("s1", "Title", [], "s1.json");
      const persisted = io.writes[0].value as { body: string };
      expect(persisted.body).toContain("seeded body");
    });
  });
});
