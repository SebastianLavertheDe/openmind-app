// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RemoteSkillCatalogSchema, SKILL_REGISTRY_CATALOG_MAX_BYTES, type RemoteSkillCatalog } from "../../shared/skill-registry";
import { buildAppPaths, type AppPaths } from "../paths/app-paths-service";
import { RemoteSkillPackageUnavailableError, RemoteSkillRegistry } from "./remote-skill-registry";

const archive = Buffer.from("test archive bytes; extraction is the installer responsibility");
function catalog(id = "remote-demo"): RemoteSkillCatalog {
  return RemoteSkillCatalogSchema.parse({
    schemaVersion: 1,
    generatedAt: "2026-11-06T00:00:00.000Z",
    skills: [{
      preset: { id, category: "research", instructions: ["Research this topic."], display: { en: { title: "Research demo" } } },
      package: { path: "packages/remote-demo.zip", size: archive.length, sha256: crypto.createHash("sha256").update(archive).digest("hex"), digest: "a".repeat(64) }
    }]
  });
}

describe("RemoteSkillRegistry", () => {
  let root: string;
  let source: string;
  let paths: AppPaths;
  let servers: http.Server[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-remote-registry-"));
    paths = buildAppPaths(path.join(root, "user-data"));
    source = path.join(root, "published");
    servers = [];
    publish(source);
  });

  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  function publish(directory: string, data = catalog()) {
    fs.mkdirSync(path.join(directory, "packages"), { recursive: true });
    fs.writeFileSync(path.join(directory, "catalog.json"), JSON.stringify(data));
    fs.writeFileSync(path.join(directory, "packages", "remote-demo.zip"), archive);
  }

  async function serve(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/registry/`;
  }

  function cacheFiles(): string[] {
    return fs.existsSync(paths.cache) ? fs.readdirSync(paths.cache, { recursive: true }).map(String) : [];
  }

  it("lists directory metadata without downloading packages, then checks newly published cards on the next request", async () => {
    const registry = new RemoteSkillRegistry(paths, source);
    expect(registry.readCached()).toBeNull();
    expect(registry.status()).toEqual({ state: "unavailable", updatedAt: null, error: null });
    expect(await registry.refresh()).toEqual(catalog());
    expect(registry.readCached()).toEqual(catalog());
    expect(registry.status()).toMatchObject({ state: "fresh", error: null });
    expect(cacheFiles().filter(file => file.endsWith(".zip"))).toEqual([]);

    publish(source, catalog("newly-published"));
    expect((await new RemoteSkillRegistry(paths, source).refresh())?.skills[0].preset.id).toBe("newly-published");
  });

  it("downloads only on demand and reuses verified packages and catalogues while the source is offline", async () => {
    const registry = new RemoteSkillRegistry(paths, source);
    const entry = (await registry.refresh())!.skills[0];
    const file = await registry.packageFile(entry);
    expect(file.startsWith(paths.cache)).toBe(true);
    expect(fs.readFileSync(file)).toEqual(archive);
    fs.rmSync(source, { recursive: true });

    const offline = new RemoteSkillRegistry(paths, source);
    expect(await offline.refresh(true)).toEqual(catalog());
    expect(offline.status()).toMatchObject({ state: "cached", error: expect.any(String) });
    expect(offline.status().error).not.toContain(root);
    expect(await offline.packageFile(entry)).toBe(file);
  });

  it("preserves the last valid catalogue after an invalid refresh and validates cached files on every read", async () => {
    const registry = new RemoteSkillRegistry(paths, source);
    await registry.refresh();
    fs.writeFileSync(path.join(source, "catalog.json"), '{"schemaVersion":2}');
    expect(await registry.refresh(true)).toEqual(catalog());
    expect(registry.status().state).toBe("cached");
    const cache = cacheFiles().find(file => file.endsWith("catalog.json"))!;
    fs.writeFileSync(path.join(paths.cache, cache), '{"source":"spoofed"}');
    expect(registry.readCached()).toBeNull();
    expect(registry.status().state).toBe("unavailable");
  });

  it("repairs a corrupt cached archive and refuses corrupted bytes when offline", async () => {
    const registry = new RemoteSkillRegistry(paths, source);
    const entry = catalog().skills[0];
    const file = await registry.packageFile(entry);
    fs.writeFileSync(file, "corrupted");
    expect(await registry.packageFile(entry)).toBe(file);
    expect(fs.readFileSync(file)).toEqual(archive);
    fs.writeFileSync(file, "corrupted again");
    fs.rmSync(source, { recursive: true });
    await expect(registry.packageFile(entry)).rejects.toThrow("Unable to download");
    expect(fs.existsSync(file)).toBe(false);
  });

  it.each(["checksum", "short", "oversized"])("rejects a %s mismatch before activating the downloaded archive", async mode => {
    const entry = catalog().skills[0];
    const bytes = mode === "short" ? archive.subarray(0, archive.length - 1)
      : mode === "oversized" ? Buffer.concat([archive, Buffer.from("extra")]) : Buffer.alloc(archive.length, 120);
    fs.writeFileSync(path.join(source, entry.package.path), bytes);
    const registry = new RemoteSkillRegistry(paths, source);
    const error = await registry.packageFile(entry).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/size|checksum/);
    expect(error).not.toBeInstanceOf(RemoteSkillPackageUnavailableError);
    expect(cacheFiles().filter(file => file.endsWith(".zip"))).toEqual([]);
  });

  it("rejects traversal entries and source symlinks, including symlinked parent directories", async () => {
    const registry = new RemoteSkillRegistry(paths, source);
    const entry = catalog().skills[0];
    await expect(registry.packageFile({ ...entry, package: { ...entry.package, path: "../outside.zip" } })).rejects.toThrow("entry is invalid");
    const external = path.join(root, "outside.zip");
    fs.writeFileSync(external, archive);
    fs.rmSync(path.join(source, entry.package.path));
    fs.symlinkSync(external, path.join(source, entry.package.path), "file");
    await expect(registry.packageFile(entry)).rejects.toThrow("Symbolic links");

    fs.rmSync(path.join(source, "packages"), { recursive: true });
    fs.mkdirSync(path.join(root, "outside-packages"));
    fs.writeFileSync(path.join(root, "outside-packages", "remote-demo.zip"), archive);
    fs.symlinkSync(path.join(root, "outside-packages"), path.join(source, "packages"), "junction");
    await expect(registry.packageFile(entry)).rejects.toThrow("Symbolic links");
    fs.rmSync(path.join(source, "catalog.json"));
    fs.writeFileSync(path.join(root, "outside-catalog.json"), JSON.stringify(catalog()));
    fs.symlinkSync(path.join(root, "outside-catalog.json"), path.join(source, "catalog.json"), "file");
    expect(await registry.refresh()).toBeNull();
    expect(registry.status().error).toContain("Symbolic links");
  });

  it("classifies a missing local source or archive as unavailable, but keeps validation and symlink failures distinct", async () => {
    const registry = new RemoteSkillRegistry(paths, source);
    const entry = catalog().skills[0];
    fs.rmSync(path.join(source, entry.package.path));
    await expect(registry.packageFile(entry)).rejects.toBeInstanceOf(RemoteSkillPackageUnavailableError);
    fs.rmSync(source, { recursive: true });
    await expect(registry.packageFile(entry)).rejects.toBeInstanceOf(RemoteSkillPackageUnavailableError);
    const invalid = { ...entry, package: { ...entry.package, path: "../outside.zip" } };
    await expect(registry.packageFile(invalid)).rejects.not.toBeInstanceOf(RemoteSkillPackageUnavailableError);
    publish(source);
    fs.rmSync(path.join(source, "packages"), { recursive: true });
    const outside = path.join(root, "outside-packages");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "remote-demo.zip"), archive);
    fs.symlinkSync(outside, path.join(source, "packages"), "junction");
    await expect(registry.packageFile(entry)).rejects.not.toBeInstanceOf(RemoteSkillPackageUnavailableError);
  });

  it("will not write through a symlink in the app cache", async () => {
    const outside = path.join(root, "outside-cache");
    fs.mkdirSync(outside);
    fs.mkdirSync(paths.cache, { recursive: true });
    fs.symlinkSync(outside, path.join(paths.cache, "skill-registry"), "junction");
    const registry = new RemoteSkillRegistry(paths, source);
    expect(await registry.refresh()).toBeNull();
    const error = await registry.packageFile(catalog().skills[0]).catch(error => error);
    expect(error.message).toContain("cache path");
    expect(error).not.toBeInstanceOf(RemoteSkillPackageUnavailableError);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("isolates sources and userData roots, and canonicalizes equivalent source paths", async () => {
    const first = new RemoteSkillRegistry(paths, source + path.sep);
    await first.refresh();
    await first.packageFile(catalog().skills[0]);
    expect(new RemoteSkillRegistry(paths, path.join(source, ".")).readCached()).toEqual(catalog());
    const anotherSource = path.join(root, "another-registry");
    const second = new RemoteSkillRegistry(paths, anotherSource);
    expect(second.readCached()).toBeNull();
    await expect(second.packageFile(catalog().skills[0])).rejects.toThrow();
    expect(new RemoteSkillRegistry(buildAppPaths(path.join(root, "another-user")), source).readCached()).toBeNull();
  });

  it("returns unavailable for an unset source and rejects private URL credentials and relative paths", async () => {
    const registry = new RemoteSkillRegistry(paths, null);
    expect(await registry.refresh()).toBeNull();
    expect(registry.status()).toEqual({ state: "unavailable", updatedAt: null, error: null });
    await expect(registry.packageFile(catalog().skills[0])).rejects.toThrow("No Skill registry");
    for (const invalid of ["relative/source", "file:///tmp/registry", "https://private-token@example.test/", "https://example.test/?token=private-token"]) {
      expect(() => new RemoteSkillRegistry(paths, invalid)).toThrow(/absolute|credentials/);
      try { new RemoteSkillRegistry(paths, invalid); } catch (error) { expect(String(error)).not.toContain("private-token"); }
    }
  });

  it("deduplicates catalogue refresh and archive downloads across service instances, with HTTP TTL and force refresh", async () => {
    const requests: string[] = [];
    const url = await serve((req, res) => {
      requests.push(req.url!);
      setTimeout(() => res.end(req.url === "/registry/catalog.json" ? JSON.stringify(catalog()) : archive), 15);
    });
    const instances = Array.from({ length: 8 }, () => new RemoteSkillRegistry(paths, url));
    await Promise.all(instances.map(instance => instance.refresh()));
    expect(requests).toEqual(["/registry/catalog.json"]);
    await instances[0].refresh();
    expect(requests).toHaveLength(1);
    const archives = await Promise.all(instances.map(instance => instance.packageFile(catalog().skills[0])));
    expect(new Set(archives).size).toBe(1);
    expect(requests).toEqual(["/registry/catalog.json", "/registry/packages/remote-demo.zip"]);
    await instances[1].refresh(true);
    expect(requests).toHaveLength(3);
    servers[0].closeAllConnections();
    await new Promise<void>(resolve => servers[0].close(() => resolve()));
    expect(await instances[2].refresh(true)).toEqual(catalog());
    expect(instances[2].status().state).toBe("cached");
    expect(await instances[2].packageFile(catalog().skills[0])).toBe(archives[0]);
    expect(cacheFiles().filter(file => file.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["/outside/catalog.json", "/registry/%2e%2e%2foutside/catalog.json", "http://example.invalid/registry/catalog.json"])("rejects remote redirect %s without requesting the new target", async location => {
    const requests: string[] = [];
    const url = await serve((req, res) => {
      requests.push(req.url!);
      res.writeHead(302, { Location: location });
      res.end();
    });
    const registry = new RemoteSkillRegistry(paths, url);
    expect(await registry.refresh()).toBeNull();
    expect(requests).toEqual(["/registry/catalog.json"]);
    expect(registry.status().error).toContain("outside its configured source");
    const error = await registry.packageFile(catalog().skills[0]).catch(error => error);
    expect(error.message).toContain("outside its configured source");
    expect(error).not.toBeInstanceOf(RemoteSkillPackageUnavailableError);
  });

  it.each([404, 503])("classifies HTTP %i as package unavailable without exposing the response body", async status => {
    const url = await serve((_req, res) => { res.writeHead(status); res.end("private response"); });
    const error = await new RemoteSkillRegistry(paths, url).packageFile(catalog().skills[0]).catch(error => error);
    expect(error).toBeInstanceOf(RemoteSkillPackageUnavailableError);
    expect(error.message).toBe(`The Skill registry returned HTTP ${status}.`);
  });

  it("keeps malformed HTTP redirect responses distinct from an unavailable source", async () => {
    const url = await serve((_req, res) => { res.writeHead(302, { Location: "http://[" }); res.end(); });
    const error = await new RemoteSkillRegistry(paths, url).packageFile(catalog().skills[0]).catch(error => error);
    expect(error.message).toContain("invalid redirect");
    expect(error).not.toBeInstanceOf(RemoteSkillPackageUnavailableError);
  });

  it("classifies timeouts and connection failures as unavailable without bypassing a cached catalogue's TTL", async () => {
    const url = await serve((req, res) => {
      if (req.url === "/registry/catalog.json") res.end(JSON.stringify(catalog()));
      else { res.writeHead(200); res.flushHeaders(); }
    });
    const registry = new RemoteSkillRegistry(paths, url, { timeoutMs: 150 });
    await registry.refresh();
    expect(registry.status().state).toBe("fresh");
    await expect(registry.packageFile(catalog().skills[0])).rejects.toBeInstanceOf(RemoteSkillPackageUnavailableError);
    servers[0].closeAllConnections();
    await new Promise<void>(resolve => servers[0].close(() => resolve()));
    await expect(registry.packageFile(catalog().skills[0])).rejects.toBeInstanceOf(RemoteSkillPackageUnavailableError);
    expect(registry.status().state).toBe("fresh");
  });

  it("accepts a bounded redirect within the configured source", async () => {
    const requests: string[] = [];
    const url = await serve((req, res) => {
      requests.push(req.url!);
      if (req.url === "/registry/catalog.json") {
        res.writeHead(302, { Location: "current/catalog.json" });
        res.end();
      } else res.end(JSON.stringify(catalog()));
    });
    expect(await new RemoteSkillRegistry(paths, url).refresh()).toEqual(catalog());
    expect(requests).toEqual(["/registry/catalog.json", "/registry/current/catalog.json"]);
  });

  it("checks HTTP status, limits declared and streamed bytes, and times out stalled bodies", async () => {
    let mode = "status";
    const url = await serve((_req, res) => {
      if (mode === "status") { res.writeHead(503); res.end("sensitive upstream body"); }
      if (mode === "length") { res.writeHead(200, { "Content-Length": SKILL_REGISTRY_CATALOG_MAX_BYTES + 1 }); res.flushHeaders(); }
      if (mode === "stream") { res.writeHead(200, { "Transfer-Encoding": "chunked" }); res.end(Buffer.alloc(archive.length + 1)); }
      if (mode === "timeout") { res.writeHead(200); res.flushHeaders(); }
    });
    const registry = new RemoteSkillRegistry(paths, url, { timeoutMs: 150 });
    expect(await registry.refresh()).toBeNull();
    expect(registry.status().error).toBe("The Skill registry returned HTTP 503.");
    mode = "length";
    expect(await registry.refresh()).toBeNull();
    expect(registry.status().error).toContain("size limit");
    mode = "stream";
    await expect(registry.packageFile(catalog().skills[0])).rejects.toThrow("size limit");
    mode = "timeout";
    expect(await registry.refresh()).toBeNull();
    expect(registry.status().error).toContain("timed out");
  });

  it("rejects an oversized directory catalogue before parsing", async () => {
    const fd = fs.openSync(path.join(source, "catalog.json"), "w");
    fs.ftruncateSync(fd, SKILL_REGISTRY_CATALOG_MAX_BYTES + 1);
    fs.closeSync(fd);
    const registry = new RemoteSkillRegistry(paths, source);
    expect(await registry.refresh()).toBeNull();
    expect(registry.status().error).toContain("size limit");
  });
});
