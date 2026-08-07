import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths, type AppPaths } from "../paths/app-paths-service";
import { ManagedCredentialFileAdapter } from "./credential-file-adapter";

describe("ManagedCredentialFileAdapter", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes a run-scoped credential file with restrictive permissions and cleans it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-credential-file-"));
    roots.push(root);
    const paths: AppPaths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const adapter = new ManagedCredentialFileAdapter(paths);

    const file = adapter.materialize("run-1", "credential-file", "private-key-content");

    expect(file).toBe(path.join(paths.runs, "run-1", "work", "credentials", "credential-file.credential"));
    expect(fs.readFileSync(file, "utf8")).toBe("private-key-content");
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    adapter.cleanup("run-1");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("rejects traversal-shaped run and credential identifiers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-credential-file-"));
    roots.push(root);
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const adapter = new ManagedCredentialFileAdapter(paths);
    expect(() => adapter.materialize("../escape", "credential", "value")).toThrow();
    expect(() => adapter.materialize("run-1", "../escape", "value")).toThrow();
  });
});
