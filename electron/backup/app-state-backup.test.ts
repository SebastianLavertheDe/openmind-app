import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { AppStateBackupService } from "./app-state-backup";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-state-backup-"));
  roots.push(root);
  const userData = path.join(root, "user-data");
  // The skill store follows the mymind root; keep it outside userData so the
  // test can assert restore never touches it.
  const paths = buildAppPaths(userData, path.join(root, "mymind", ".agent", "skills"));
  ensureAppPaths(paths);
  return { root, paths, service: new AppStateBackupService(paths) };
}

function write(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("AppStateBackupService", () => {
  it("round-trips portable state while excluding secrets, packages, runtimes and work files", () => {
    const { root, paths, service } = fixture();
    write(paths.settingsFile, JSON.stringify({ schemaVersion: 2, mymindRoot: "/external/mymind" }));
    write(path.join(paths.settings, "provider-profiles.json"), JSON.stringify({ schemaVersion: 1, profiles: [] }));
    write(path.join(paths.state, "root-id", ".cctools", "ai", "sessions", "session.json"), "session-v1");
    write(path.join(paths.state, "root-id", ".runtime", "worktrees", "secret.txt"), "must-stay-out");
    write(path.join(paths.state, "root-id", "tmp-images", "image.png"), "must-stay-out");
    write(path.join(paths.automation, "registry.json"), "automation-v1");
    write(path.join(paths.runs, "run-1", "run.json"), "run-v1");
    write(path.join(paths.runs, "run-1", "events.jsonl"), "event-v1");
    write(path.join(paths.runs, "run-1", "work", "credentials", "token"), "secret-work-file");
    write(path.join(paths.credentials, "registry.json"), "credential-metadata");
    write(path.join(paths.credentials, "credential-1.bin"), "encrypted-secret");
    write(path.join(paths.skills, "publisher", "skill", "package.js"), "package-bytes");
    write(path.join(paths.runtimePacks, "python-core.zip"), "runtime-bytes");
    write(path.join(paths.userData, "browser-extension-token.bin"), "browser-secret");
    const mymind = path.join(root, "mymind");
    write(path.join(mymind, "article", "keep.md"), "user-content");

    const archivePath = path.join(root, "backup.zip");
    const exported = service.exportToFile(archivePath);
    expect(exported.operation).toBe("export");
    expect(exported.fileCount).toBe(6);
    expect(fs.existsSync(archivePath)).toBe(true);

    write(paths.settingsFile, "changed-settings");
    write(path.join(paths.state, "root-id", ".cctools", "ai", "sessions", "session.json"), "changed-session");
    write(path.join(paths.automation, "registry.json"), "changed-automation");
    write(path.join(paths.runs, "run-1", "run.json"), "changed-run");
    write(path.join(paths.runs, "run-1", "events.jsonl"), "changed-event");
    write(path.join(paths.runs, "run-1", "work", "credentials", "token"), "still-secret-work-file");

    const imported = service.importFromFile(archivePath);
    expect(imported.operation).toBe("import");
    expect(fs.readFileSync(paths.settingsFile, "utf8")).toContain("/external/mymind");
    expect(fs.readFileSync(path.join(paths.state, "root-id", ".cctools", "ai", "sessions", "session.json"), "utf8")).toBe("session-v1");
    expect(fs.readFileSync(path.join(paths.automation, "registry.json"), "utf8")).toBe("automation-v1");
    expect(fs.readFileSync(path.join(paths.runs, "run-1", "run.json"), "utf8")).toBe("run-v1");
    expect(fs.readFileSync(path.join(paths.runs, "run-1", "work", "credentials", "token"), "utf8")).toBe("still-secret-work-file");
    expect(fs.readFileSync(path.join(paths.credentials, "credential-1.bin"), "utf8")).toBe("encrypted-secret");
    expect(fs.readFileSync(path.join(paths.skills, "publisher", "skill", "package.js"), "utf8")).toBe("package-bytes");
    expect(fs.readFileSync(path.join(paths.runtimePacks, "python-core.zip"), "utf8")).toBe("runtime-bytes");
    expect(fs.readFileSync(path.join(paths.userData, "browser-extension-token.bin"), "utf8")).toBe("browser-secret");
    expect(fs.readFileSync(path.join(mymind, "article", "keep.md"), "utf8")).toBe("user-content");
  });

  it("rejects tampered manifests and extra payload entries before changing state", () => {
    const { root, paths, service } = fixture();
    const target = path.join(paths.settings, "settings.json");
    write(target, "original");
    const manifest = {
      schemaVersion: 1,
      kind: "cctools-app-state-backup",
      createdAt: new Date().toISOString(),
      files: [{ path: "settings/settings.json", bytes: 7, sha256: crypto.createHash("sha256").update("changed").digest("hex") }]
    };
    const tampered = path.join(root, "tampered.zip");
    fs.writeFileSync(tampered, zipSync({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "payload/settings/settings.json": Buffer.from("changed"),
      "payload/settings/extra.json": Buffer.from("unexpected")
    }));
    expect(() => service.importFromFile(tampered)).toThrow(/未声明条目/);
    expect(fs.readFileSync(target, "utf8")).toBe("original");
  });

  it("rejects a state symlink instead of following it during export", () => {
    const { paths, service } = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-state-outside-"));
    roots.push(outside);
    write(path.join(outside, "secret.json"), "secret");
    fs.symlinkSync(outside, path.join(paths.state, "linked"), "junction");
    expect(() => service.exportToFile(path.join(path.dirname(paths.userData), "symlink.zip"))).toThrow(/符号链接/);
  });
});
