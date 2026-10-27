import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCommandResult } from "./command-result";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function fixture() { const directory = fs.mkdtempSync(path.join(os.tmpdir(), "command-result-")); directories.push(directory); return directory; }

describe("headless command results", () => {
  it("reads every source result even when the broker output has been truncated", () => {
    const directory = fixture();
    const result = { status: "succeeded", results: Array.from({ length: 1025 }, (_, index) => ({ sourceId: `source-${index}`, status: "skipped", reason: "disabled" })) };
    const output = JSON.stringify(result);
    expect(output.length).toBeGreaterThan(32 * 1024);
    fs.writeFileSync(path.join(directory, "result.json"), output);
    expect(readCommandResult(directory, [{ stream: "stdout", text: output.slice(-32 * 1024) }])).toEqual(result);
  });

  it("reassembles legacy JSON chunks while ignoring diagnostics", () => {
    expect(readCommandResult(fixture(), [
      { stream: "stdout", text: 'Preparing…\n{"status":"suc' },
      { stream: "stderr", text: "Diagnostic\n" },
      { stream: "stdout", text: 'ceeded","selected":2}\n' }
    ])).toEqual({ status: "succeeded", selected: 2 });
  });
});
