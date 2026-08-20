import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAutomationFileFingerprint } from "./automation-file-fingerprint";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("createAutomationFileFingerprint", () => {
  it("changes when a bound file changes and never accepts an escaping path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-automation-files-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "article.md"), "one");
    const fingerprint = createAutomationFileFingerprint(root);

    const first = fingerprint(["article.md"]);
    fs.writeFileSync(path.join(root, "article.md"), "two-two");

    expect(first).toBeTruthy();
    expect(fingerprint(["article.md"])).not.toBe(first);
    expect(fingerprint(["../outside.md"])).toBeUndefined();
  });

  it("records missing paths without reading file contents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-automation-missing-"));
    roots.push(root);
    const fingerprint = createAutomationFileFingerprint(root);
    expect(fingerprint(["missing.md"])).toMatch(/^[a-f0-9]{64}$/);
  });
});
