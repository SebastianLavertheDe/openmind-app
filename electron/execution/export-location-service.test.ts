import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExportLocationService } from "./export-location-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ExportLocationService", () => {
  it("canonicalizes and persists a binding, then resolves and revokes it", () => {
    const root = makeRoot();
    const exportDir = path.join(root, "exports");
    fs.mkdirSync(exportDir);
    const service = new ExportLocationService(path.join(root, "settings", "bindings.json"), () => [path.join(root, "app-data")]);
    const binding = service.create("视频导出", exportDir);

    expect(service.list()[0]?.availability).toBe("available");
    expect(service.resolve(binding.id).canonicalPath).toBe(fs.realpathSync(exportDir));
    expect(service.revoke(binding.id)).toBe(true);
    expect(() => service.resolve(binding.id)).toThrow(/已撤销/);
  });

  it("rejects paths inside forbidden app-private or openmind roots", () => {
    const root = makeRoot();
    const privateRoot = path.join(root, "app-data");
    const openmindRoot = path.join(root, "openmind");
    fs.mkdirSync(path.join(privateRoot, "nested"), { recursive: true });
    fs.mkdirSync(openmindRoot);
    const service = new ExportLocationService(path.join(root, "bindings.json"), () => [privateRoot, openmindRoot]);

    expect(() => service.create("bad", path.join(privateRoot, "nested"))).toThrow(/不能位于/);
    expect(() => service.create("bad", openmindRoot)).toThrow(/不能位于/);
  });

  it("preserves a Manifest binding ID across revoke and Relink", () => {
    const root = makeRoot();
    const firstDir = path.join(root, "first-export");
    const secondDir = path.join(root, "second-export");
    fs.mkdirSync(firstDir);
    fs.mkdirSync(secondDir);
    const service = new ExportLocationService(path.join(root, "bindings.json"));

    const created = service.create("视频导出", firstDir, "videoExportDir");
    expect(created.id).toBe("videoExportDir");
    fs.renameSync(firstDir, path.join(root, "moved-export"));
    expect(service.list()[0]?.availability).toBe("needs-relink");
    expect(() => service.resolve(created.id)).toThrow(/需要 Relink/);
    fs.mkdirSync(firstDir);
    expect(service.revoke(created.id)).toBe(true);
    const relinked = service.relink(created.id, secondDir);

    expect(relinked.id).toBe(created.id);
    expect(relinked.canonicalPath).toBe(fs.realpathSync(secondDir));
    expect(relinked.revoked).toBe(false);
    expect(relinked.availability).toBe("available");
    expect(relinked.createdAt).toBe(created.createdAt);
    expect(service.resolve(created.id).canonicalPath).toBe(fs.realpathSync(secondDir));
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-export-location-"));
  roots.push(root);
  return root;
}
