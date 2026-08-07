import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnvFileAnalyzer } from "./env-file-analyzer";

describe("EnvFileAnalyzer", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns names and classifications without returning values", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-env-analysis-"));
    roots.push(root);
    const file = path.join(root, ".env");
    fs.writeFileSync(file, "# comment\nexport NVIDIA_API_KEY=nvapi-secret\nPASSWORD=top-secret\nPLAIN=value\nBROKEN\n");

    const result = new EnvFileAnalyzer().analyze(file);

    expect(result.containsPotentialSecrets).toBe(true);
    expect(result.variables).toEqual([
      { name: "NVIDIA_API_KEY", line: 2, kind: "api-key", hasValue: true, valueLength: 12 },
      { name: "PASSWORD", line: 3, kind: "password", hasValue: true, valueLength: 10 },
      { name: "PLAIN", line: 4, kind: "unknown", hasValue: true, valueLength: 5 }
    ]);
    expect(JSON.stringify(result)).not.toContain("nvapi-secret");
    expect(JSON.stringify(result)).not.toContain("top-secret");
    expect(result.ignoredLines).toBe(1);
  });

  it("rejects symlinks and oversized files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-env-analysis-"));
    roots.push(root);
    const target = path.join(root, "real.env");
    const link = path.join(root, ".env");
    fs.writeFileSync(target, "API_KEY=value\n");
    fs.symlinkSync(target, link);
    expect(() => new EnvFileAnalyzer().analyze(link)).toThrow("符号链接");
    fs.writeFileSync(target, "x".repeat(512 * 1024 + 1));
    expect(() => new EnvFileAnalyzer().analyze(target)).toThrow("过大");
  });
});
