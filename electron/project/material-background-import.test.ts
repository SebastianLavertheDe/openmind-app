import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectMaterialConversionResult, ProjectMaterialConverter } from "./material-service";
import { ProjectService } from "./project-service";

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function deferred() {
  let resolve!: (result: ProjectMaterialConversionResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ProjectMaterialConversionResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-background-materials-"));
  fixtures.push(base);
  const root = path.join(base, "content");
  fs.mkdirSync(root);
  const jobs: ReturnType<typeof deferred>[] = [];
  const converter: ProjectMaterialConverter = {
    id: "fixture-background",
    supports: source => source.type === "url",
    target: () => ({ kind: "web", directory: "web", fileName: "page.md", title: "Page" }),
    convert: vi.fn(() => {
      const job = deferred();
      jobs.push(job);
      return job.promise;
    })
  };
  const options = { stateRoot: path.join(base, "state"), materialConverters: [converter] };
  const service = new ProjectService(root, options);
  service.createProject({ name: "Fixture" });
  return { root, service, jobs, converter, options };
}

describe("background material admission", () => {
  it("returns a persisted pending record before parsing and keeps its lease across service instances", async () => {
    const { root, service, jobs, converter, options } = fixture();
    const material = await service.addProjectUrl("Fixture", "https://example.com/a", { background: true });
    expect(material.status).toBe("converting");
    expect(converter.convert).not.toHaveBeenCalled();
    const observer = new ProjectService(root, options);
    expect(observer.listProjectMaterials("Fixture")[0].status).toBe("converting");
    expect(() => observer.removeProjectMaterial("Fixture", material.relativePath)).toThrow("正在转换");
    expect(() => observer.renameProject("Fixture", "Renamed")).toThrow();
    await vi.waitFor(() => expect(jobs).toHaveLength(1));
    jobs[0].resolve({ content: "# Parsed in background", title: "Parsed" });
    await vi.waitFor(() => expect(service.listProjectMaterials("Fixture")[0].status).toBe("ready"));
    expect(observer.readProjectMaterial("Fixture", material.relativePath).content).toBe("# Parsed in background");
    expect(service.materials.hasActiveConversions("Fixture")).toBe(false);
  });

  it("limits concurrency, lets other links finish after a failure, and queues retries without waiting", async () => {
    const { service, jobs } = fixture();
    const materials = await Promise.all(["a", "b", "c"].map(id => service.addProjectUrl("Fixture", `https://example.com/${id}`, { background: true })));
    expect(new Set(materials.map(item => item.relativePath)).size).toBe(3);
    await vi.waitFor(() => expect(jobs).toHaveLength(2));
    expect(service.listProjectMaterials("Fixture").every(item => item.status === "converting")).toBe(true);
    jobs[0].reject(new Error("Fixture parser failed"));
    await vi.waitFor(() => expect(jobs).toHaveLength(3));
    const failed = service.listProjectMaterials("Fixture").find(item => item.status === "failed")!;
    expect(failed.errorMessage).toBe("Fixture parser failed");
    jobs[1].resolve({ content: "second" });
    jobs[2].resolve({ content: "third" });
    await vi.waitFor(() => expect(service.listProjectMaterials("Fixture").filter(item => item.status === "ready")).toHaveLength(2));
    const retry = await service.retryMaterialExtraction("Fixture", failed.relativePath, { background: true });
    expect(retry.status).toBe("converting");
    // Repeated retry clicks observe the existing job instead of duplicating it.
    await service.retryMaterialExtraction("Fixture", failed.relativePath, { background: true });
    await vi.waitFor(() => expect(jobs).toHaveLength(4));
    jobs[3].resolve({ content: "retried" });
    await vi.waitFor(() => expect(service.listProjectMaterials("Fixture").every(item => item.status === "ready")).toBe(true));
    expect(service.readProjectMaterial("Fixture", failed.relativePath).content).toBe("retried");
    expect(service.materials.hasActiveConversions("Fixture")).toBe(false);
  });

  it("owns queued file inputs even if the external source is deleted before parsing starts", async () => {
    const { root, service, jobs } = fixture();
    await service.addProjectUrl("Fixture", "https://example.com/a", { background: true });
    await service.addProjectUrl("Fixture", "https://example.com/b", { background: true });
    await vi.waitFor(() => expect(jobs).toHaveLength(2));
    const external = path.join(root, "source.md");
    fs.writeFileSync(external, "# Preserved input");
    const [file] = await service.addProjectFiles("Fixture", [external], { background: true });
    expect(file.status).toBe("converting");
    expect(file.originalRelativePath).toBeTruthy();
    fs.unlinkSync(external);
    jobs.forEach(job => job.resolve({ content: "done" }));
    await vi.waitFor(() => expect(service.listProjectMaterials("Fixture").every(item => item.status === "ready")).toBe(true));
    expect(service.readProjectMaterial("Fixture", file.relativePath).content).toBe("# Preserved input");
  });
});
