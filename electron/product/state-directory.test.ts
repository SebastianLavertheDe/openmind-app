import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStateJson, statePath } from "./state-directory";

describe("state-directory", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-state-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("quarantines corrupt JSON and returns fallback", () => {
    const filePath = statePath(root, "content-state.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{not-json", "utf8");

    const result = readStateJson<Record<string, unknown>>(filePath, {});

    expect(result).toEqual({});
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readdirSync(path.dirname(filePath)).some((name) => name.startsWith("content-state.json.corrupt-"))).toBe(true);
  });
});
