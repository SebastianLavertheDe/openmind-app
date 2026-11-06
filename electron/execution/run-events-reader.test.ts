import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readRunEventsPage } from "./run-events-reader";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "run-events-page-")); roots.push(root);
  fs.mkdirSync(path.join(root, "run-one"));
  return { root, file: path.join(root, "run-one", "events.jsonl") };
}
function line(sequence: number, text = `row ${sequence}`, runId = "run-one") {
  return JSON.stringify({ schemaVersion: 1, runId, sequence, timestamp: "2026-11-06T00:00:00.000Z", state: "running", stream: "stdout", text });
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it("includes the initial sequence-zero event unless the caller explicitly starts after it", () => {
  const { root, file } = fixture();
  fs.writeFileSync(file, `${line(0)}\n${line(1)}\n`);
  expect(readRunEventsPage(root, "run-one").events.map(row => row.sequence)).toEqual([0, 1]);
  expect(readRunEventsPage(root, "run-one", 0).events.map(row => row.sequence)).toEqual([1]);
});

it("reads only the requested rows on warm pages and no log bytes on an unchanged empty poll", () => {
  const { root, file } = fixture();
  fs.writeFileSync(file, Array.from({ length: 2000 }, (_, index) => `${line(index + 1, "x".repeat(200))}\n`).join(""));
  const first = readRunEventsPage(root, "run-one", 0, 200);
  expect(first.events).toHaveLength(200); expect(first.nextAfter).toBe(200);
  const read = vi.spyOn(fs, "readSync");
  const second = readRunEventsPage(root, "run-one", first.nextAfter!, 200);
  expect(second.events[0].sequence).toBe(201); expect(second.nextAfter).toBe(400);
  const bytes = read.mock.calls.reduce((total, args) => total + Number(args[3]), 0);
  expect(bytes).toBeLessThan(fs.statSync(file).size / 5);
  read.mockClear();
  expect(readRunEventsPage(root, "run-one", 2000, 200)).toEqual({ events: [], nextAfter: null });
  expect(read).not.toHaveBeenCalled();
  fs.appendFileSync(file, `${line(2001)}\n`);
  expect(readRunEventsPage(root, "run-one", 2000, 200).events.map(row => row.sequence)).toEqual([2001]);
  expect(read.mock.calls.reduce((total, args) => total + Number(args[3]), 0)).toBeLessThan(1000);
});

it("preserves ordering across rotations, replacements, truncation and same-size edits", () => {
  const { root, file } = fixture();
  fs.writeFileSync(`${file}.1`, `${line(2)}\n${line(1)}\n`);
  fs.writeFileSync(file, `${line(3)}\n${line(4)}\n`);
  expect(readRunEventsPage(root, "run-one", 0, 3).events.map(row => row.sequence)).toEqual([1, 2, 3]);
  fs.renameSync(`${file}.1`, `${file}.2`);
  fs.renameSync(file, `${file}.1`);
  fs.writeFileSync(file, `${line(5)}\n`);
  expect(readRunEventsPage(root, "run-one", 3).events.map(row => row.sequence)).toEqual([4, 5]);
  const stat = fs.statSync(file);
  fs.writeFileSync(file, `${line(6)}\n`); fs.utimesSync(file, stat.atime, stat.mtime);
  expect(readRunEventsPage(root, "run-one", 4).events.map(row => row.sequence)).toEqual([6]);
  fs.writeFileSync(`${file}.replacement`, `${line(7)}\n`); fs.renameSync(`${file}.replacement`, file);
  expect(readRunEventsPage(root, "run-one", 4).events.map(row => row.sequence)).toEqual([7]);
  fs.truncateSync(file, 0); fs.unlinkSync(`${file}.1`);
  expect(readRunEventsPage(root, "run-one", 2)).toEqual({ events: [], nextAfter: null });
});

it("retries a partial final line on append while preserving malformed history and filtering foreign events", () => {
  const { root, file } = fixture();
  const tail = line(4);
  const content = `${line(1)}\nmalformed\n${line(2, "foreign", "other-run")}\n${line(3)}\n${tail.slice(0, 30)}`;
  fs.writeFileSync(file, content);
  expect(readRunEventsPage(root, "run-one").events.map(row => row.sequence)).toEqual([1, 3]);
  fs.appendFileSync(file, tail.slice(30));
  expect(readRunEventsPage(root, "run-one", 3).events.map(row => row.sequence)).toEqual([4]);
  fs.appendFileSync(file, `\n${line(5)}\n`);
  expect(readRunEventsPage(root, "run-one", 3).events.map(row => row.sequence)).toEqual([4, 5]);
  expect(fs.readFileSync(file, "utf8")).toContain("malformed");
});

it("revalidates paths even after warming the cache and isolates runs and roots", () => {
  const first = fixture(), second = fixture();
  fs.writeFileSync(first.file, `${line(1, "first")}\n`); fs.writeFileSync(second.file, `${line(1, "second")}\n`);
  expect(readRunEventsPage(first.root, "run-one").events[0].text).toBe("first");
  expect(readRunEventsPage(second.root, "run-one").events[0].text).toBe("second");
  fs.unlinkSync(first.file); fs.symlinkSync(second.file, first.file);
  expect(() => readRunEventsPage(first.root, "run-one")).toThrow(/escapes/);
  expect(() => readRunEventsPage(first.root, "../run-one")).toThrow(/Invalid/);
  expect(() => readRunEventsPage(second.root, "run-one", 0, 1001)).toThrow(/Invalid/);
});
