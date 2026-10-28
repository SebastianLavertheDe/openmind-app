import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RssService } from "./rss-service";
import type { SkillPackageService } from "../skills/skill-package-service";
import type { SharedPythonRuntimeService } from "../runtime/shared-python-runtime";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
it("saves the existing group without installing a package or detecting the URL", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rss-group-save-")); roots.push(root);
  const bundle = path.join(root, "bundle"); fs.mkdirSync(path.join(bundle, "rss-article-saver"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "rss-article-saver/rss-catalog.json"), JSON.stringify({ schemaVersion: 1, adapters: [], sources: [{ id: "one", name: "One", inputUrl: "https://one.test/", kind: "feed", adapterId: "feed", group: "blog", enabled: true, tags: [], legacyAliases: [] }] }));
  const service = new RssService(root, {} as SkillPackageService, {} as SharedPythonRuntimeService, bundle);
  const detect = vi.spyOn(service, "detect").mockRejectedValue(new Error("Network must not be used"));
  const source = service.repository.read().sources[0];
  const result = await service.update({ id: source.id, revision: source.revision, group: "Existing custom group" });
  expect(result.sources[0].group).toBe("Existing custom group"); expect(detect).not.toHaveBeenCalled();
});
