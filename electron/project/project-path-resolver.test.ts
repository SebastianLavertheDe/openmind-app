import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectPathError, ProjectPathResolver } from "./project-path-resolver";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

function fixture(): { root: string; resolver: ProjectPathResolver } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-path-"));
  fixtures.push(root);
  return { root, resolver: new ProjectPathResolver(root) };
}

describe("ProjectPathResolver", () => {
  it("enforces global case and NFKC-insensitive project-name uniqueness", () => {
    const { resolver } = fixture();
    resolver.createProjectRoot("Ａlpha");
    expect(() => resolver.createProjectRoot("alpha")).toThrowError(ProjectPathError);
  });

  it("rejects pre-existing case or NFKC-equivalent directory conflicts during list and resolve", () => {
    const { resolver } = fixture();
    resolver.initialize();
    fs.mkdirSync(path.join(resolver.projectsRoot, "Alpha"));
    const lowerCasePath = path.join(resolver.projectsRoot, "alpha");
    if (fs.existsSync(lowerCasePath)) {
      // Case-insensitive volumes cannot contain both directory entries. The app
      // must reject a duplicate request and retain the existing display name.
      expect(() => resolver.createProjectRoot("alpha")).toThrow(expect.objectContaining({ code: "project-already-exists" }));
      expect(resolver.listProjectNames()).toEqual(["Alpha"]);
      expect(resolver.resolveProject("alpha").name).toBe("Alpha");
      expect(fs.readdirSync(resolver.projectsRoot)).toEqual(["Alpha"]);
    } else {
      fs.mkdirSync(lowerCasePath);
      expect(() => resolver.listProjectNames()).toThrow(expect.objectContaining({ code: "project-name-conflict" }));
      expect(() => resolver.resolveProject("Alpha")).toThrow(expect.objectContaining({ code: "project-name-conflict" }));
      fs.rmdirSync(lowerCasePath);
    }

    fs.mkdirSync(path.join(resolver.projectsRoot, "Ａlpha"));
    expect(() => resolver.listProjectNames()).toThrow(expect.objectContaining({ code: "project-name-conflict" }));
    expect(() => resolver.resolveProject("Alpha")).toThrow(expect.objectContaining({ code: "project-name-conflict" }));
  });

  it("honors a mutation lock owned by another process", async () => {
    const { root, resolver } = fixture();
    resolver.initialize();
    const ready = path.join(root, "holder-ready");
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "electron/project/project-path-resolver.ts")).href;
    const script = `
      import fs from "node:fs";
      import { ProjectPathResolver } from ${JSON.stringify(moduleUrl)};
      const resolver = new ProjectPathResolver(process.env.PROJECT_TEST_ROOT);
      resolver.withProjectMutationLock(() => {
        fs.writeFileSync(process.env.PROJECT_TEST_READY, "ready");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      });
    `;
    const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "-e", script], {
      env: { ...process.env, PROJECT_TEST_ROOT: root, PROJECT_TEST_READY: ready },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForFile(ready, child);
    const contender = new ProjectPathResolver(root, { lockTimeoutMs: 50 });
    expect(() => contender.createProjectRoot("Locked")).toThrow(expect.objectContaining({ code: "project-lock-timeout" }));
    await waitForExit(child);
    expect(contender.createProjectRoot("Locked").name).toBe("Locked");
  });

  it("never reclaims an old lock while its owner process is still alive", () => {
    const { resolver } = fixture();
    resolver.initialize();
    const lockPath = path.join(resolver.projectsRoot, ".openmind-projects.lock");
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify({
      token: "live-owner",
      pid: process.pid,
      createdAt: "2000-01-01T00:00:00.000Z"
    })}\n`, "utf8");
    const old = new Date("2000-01-01T00:00:00.000Z");
    fs.utimesSync(lockPath, old, old);

    const contender = new ProjectPathResolver(resolver.openmindRoot, { lockTimeoutMs: 30, staleLockMs: 1_000 });
    expect(() => contender.createProjectRoot("MustWait")).toThrow(expect.objectContaining({ code: "project-lock-timeout" }));
    expect(fs.existsSync(lockPath)).toBe(true);
    fs.rmSync(lockPath, { recursive: true });
  });

  it("renames case-only identities through a portable intermediate directory", () => {
    const { resolver } = fixture();
    const original = resolver.createProjectRoot("Alpha");
    fs.writeFileSync(path.join(original.rootPath, "retained.txt"), "retained content");
    const renamed = resolver.renameProjectRoot("Alpha", "ALPHA");
    expect(renamed.name).toBe("ALPHA");
    expect(fs.readdirSync(resolver.projectsRoot)).toEqual(["ALPHA"]);
    expect(resolver.resolveProject("alpha").name).toBe("ALPHA");
    expect(fs.readFileSync(path.join(renamed.rootPath, "retained.txt"), "utf8")).toBe("retained content");
  });

  it("rejects traversal, absolute paths, missing reads and symlinks", () => {
    const { root, resolver } = fixture();
    resolver.createProjectRoot("Safe");
    fs.mkdirSync(path.join(root, "projects", "Safe", "materials"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-outside-"));
    fixtures.push(outside);
    fs.symlinkSync(outside, path.join(root, "projects", "Safe", "materials", "escape"), "dir");

    expect(() => resolver.resolveInsideProject("Safe", "../Other/file.md")).toThrowError(ProjectPathError);
    expect(() => resolver.resolveInsideProject("Safe", path.join(root, "outside.md"))).toThrowError(ProjectPathError);
    expect(() => resolver.resolveInsideProject("Safe", "materials/missing.md")).toThrowError(ProjectPathError);
    expect(() => resolver.resolveInsideProject("Safe", "materials/escape/file.md", { allowMissingLeaf: true })).toThrowError(ProjectPathError);
  });
});

async function waitForFile(filePath: string, child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(filePath)) {
    if (child.exitCode !== null) throw new Error(`lock holder exited early with ${child.exitCode}`);
    if (Date.now() > deadline) throw new Error("timed out waiting for lock holder");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) {
    expect(child.exitCode).toBe(0);
    return;
  }
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  expect(exitCode).toBe(0);
}
