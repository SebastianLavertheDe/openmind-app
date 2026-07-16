import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AiRolloutLineSchema, type AiSession } from "../../shared/contracts";
import { makeRolloutLine, sessionMetaItem } from "./rollout";
import { RolloutJournal } from "./rollout-journal";

function makeSession(): AiSession {
  return {
    schemaVersion: 1,
    id: "session",
    projectId: "project",
    projectRoot: "/project",
    title: "Session",
    provider: "codex",
    providerSessionId: null,
    providerId: "codex-native",
    cwd: "/project",
    permissionProfile: "edit",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastRunId: null
  };
}

function validLine(n = 0): ReturnType<typeof makeRolloutLine> {
  return makeRolloutLine(sessionMetaItem(makeSession()), `2026-07-01T00:00:0${n}.000Z`);
}

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-journal-"));
  return path.join(dir, "rollout.ndjson");
}

describe("RolloutJournal", () => {
  describe("append (durable)", () => {
    it("appends lines synchronously as ndjson", () => {
      const file = tmpFile();
      try {
        const journal = new RolloutJournal();
        journal.append(file, [validLine(0), validLine(1)], true);
        const content = fs.readFileSync(file, "utf8").trim().split("\n");
        expect(content).toHaveLength(2);
        // each line parses as a valid rollout line
        expect(() => AiRolloutLineSchema.parse(JSON.parse(content[0]))).not.toThrow();
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    });

    it("is a no-op when there are no pending or new durable lines", () => {
      const file = tmpFile();
      try {
        const journal = new RolloutJournal();
        journal.append(file, [], true);
        expect(fs.existsSync(file)).toBe(false);
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    });

    it("creates parent directories on demand", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-journal-"));
      const file = path.join(dir, "nested", "deep", "rollout.ndjson");
      try {
        const journal = new RolloutJournal();
        journal.append(file, [validLine(0)], true);
        expect(fs.existsSync(file)).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("append (deferred) + flush", () => {
    it("buffers deferred lines and writes them on flush", () => {
      const file = tmpFile();
      try {
        const journal = new RolloutJournal();
        journal.append(file, [validLine(0)], false);
        expect(fs.existsSync(file)).toBe(false);
        journal.flush(file);
        const content = fs.readFileSync(file, "utf8").trim().split("\n");
        expect(content).toHaveLength(1);
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    });

    it("discard drops pending deferred lines without writing", () => {
      const file = tmpFile();
      try {
        const journal = new RolloutJournal();
        journal.append(file, [validLine(0)], false);
        journal.discard(file);
        journal.flush(file);
        expect(fs.existsSync(file)).toBe(false);
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    });
  });

  describe("write (atomic rewrite)", () => {
    it("atomically overwrites the file and invalidates the cache", () => {
      const file = tmpFile();
      try {
        const journal = new RolloutJournal();
        journal.append(file, [validLine(0), validLine(1)], true);
        // rewrite with a single line — cache must be invalidated so read sees the new content
        journal.write("session", file, [validLine(2)]);
        const { lines, parseErrors } = journal.read("session", file);
        expect(parseErrors).toBe(0);
        expect(lines).toHaveLength(1);
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    });
  });

  describe("read (caching)", () => {
    it("returns empty for a missing file and clears stale cache", () => {
      const file = tmpFile();
      const journal = new RolloutJournal();
      const { lines, parseErrors } = journal.read("session", file);
      expect(lines).toEqual([]);
      expect(parseErrors).toBe(0);
    });

    it("reads all lines on first load, then reuses cache on identical fingerprint", () => {
      const file = tmpFile();
      try {
        const journal = new RolloutJournal();
        journal.append(file, [validLine(0), validLine(1)], true);
        const first = journal.read("session", file);
        expect(first.lines).toHaveLength(2);
        // second read with unchanged file → same cached line array reference
        const second = journal.read("session", file);
        expect(second.lines).toBe(first.lines);
        expect(second.parseErrors).toBe(first.parseErrors);
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    });

    it("incrementally tails appended lines on a grown file", () => {
      const file = tmpFile();
      try {
        const journal = new RolloutJournal();
        journal.append(file, [validLine(0)], true);
        const first = journal.read("session", file);
        // append more lines externally (simulating another process / re-entrancy)
        journal.append(file, [validLine(1), validLine(2)], true);
        const second = journal.read("session", file);
        expect(second.lines).toHaveLength(3);
        expect(second.lines).toBe(first.lines); // same array, mutated in place
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    });

    it("counts malformed lines as parseErrors but keeps the valid ones", () => {
      const file = tmpFile();
      try {
        const journal = new RolloutJournal();
        journal.append(file, [validLine(0)], true);
        // inject a malformed line directly
        fs.appendFileSync(file, "{not valid json}\n", "utf8");
        const { lines, parseErrors } = journal.read("session", file);
        expect(lines.length).toBe(1);
        expect(parseErrors).toBe(1);
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    });
  });

  describe("cache control", () => {
    it("invalidate drops the cache so the next read is a full reload", () => {
      const file = tmpFile();
      try {
        const journal = new RolloutJournal();
        journal.append(file, [validLine(0), validLine(1)], true);
        const first = journal.read("session", file);
        expect(first.lines).toHaveLength(2);
        journal.invalidate("session");
        const second = journal.read("session", file);
        // new array reference after cache invalidation
        expect(second.lines).not.toBe(first.lines);
        expect(second.lines).toHaveLength(2);
      } finally {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    });
  });
});
