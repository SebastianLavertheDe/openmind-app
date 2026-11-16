import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareSkillLibraryBundle } from "./skill-library-bundle";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "./skill-package-service";
import { SkillLibraryService } from "./skill-library-service";
import { readSkillLibraryCatalog } from "./skill-library-catalog";
import { filterSkillLibrary } from "../../shared/skill-library";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";
import { RuntimeManager } from "../runtime/runtime-manager";
import { migrateBuiltinPackages } from "./builtin-package-migration";

describe("Handraw cards from configuration to installed packages", () => {
  it("preserves every original sub-Skill over one shared installation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-handraw-install-"));
    try {
      const bundle = path.join(root, "bundle");
      const content = path.join(root, "content"); fs.mkdirSync(content);
      prepareSkillLibraryBundle(path.resolve("config/skill-library"), bundle);
      const paths = buildAppPaths(path.join(root, "state"), path.join(content, ".agent/skills")); ensureAppPaths(paths);
      const packages = new SkillPackageService(paths);
      const service = new SkillLibraryService(content, paths, packages, bundle);
      const catalog = readSkillLibraryCatalog(bundle);
      const originals = catalog.skills.filter(entry => entry.packageId);
      const ids = originals.map(entry => entry.id);
      expect(ids).toHaveLength(21);
      expect(filterSkillLibrary(service.list(), "explore", "image").map(entry => entry.id)).toEqual(ids);
      const installed = service.installPreset(ids[0]);
      const record = packages.getInstalled(installed.key!, installed.digest!)!;
      expect(packages.listInstalled()).toHaveLength(1);
      for (const preset of originals) {
        const card = service.list().find(entry => entry.id === preset.id)!;
        expect(card).toMatchObject({ installed: true, key: installed.key, digest: installed.digest, entrypoint: preset.skillPath });
        expect(card.contributor?.avatarUrl).toMatch(/^data:image\/jpeg;base64,/);
        expect(fs.readFileSync(path.join(record.packagePath, preset.skillPath!)))
          .toEqual(fs.readFileSync(path.resolve("config/skill-library/packages/handraw-style", preset.skillPath!)));
      }
      expect(fs.readFileSync(path.join(record.packagePath, "LICENSE"), "utf8")).toContain("yang0/handraw-style");
      migrateBuiltinPackages(content, packages, bundle);
      const reloaded = new SkillPackageService(paths);
      const resolver = new InstalledSkillExecutionResolver(reloaded, new RuntimeManager(paths), content, 1);
      const snapshots = resolver.captureSessionSnapshot();
      expect(snapshots.map(entry => entry.definition.id)).toEqual(expect.arrayContaining(ids));
      for (const id of [ids[0], ids.at(-1)!]) {
        const record = reloaded.getInstalledById(originals[0].packageId!)!;
        expect(reloaded.isRetired(record)).toBe(false);
        expect(reloaded.isEnabled(record)).toBe(true);
        const snapshot = snapshots.find(entry => entry.definition.id === id)!;
        expect(() => resolver.providerSkillBridge(snapshot)).not.toThrow();
      }
      // An installed card remains complete after discovery resources disappear.
      fs.rmSync(bundle, { recursive: true });
      for (const record of packages.listInstalledViews()) {
        expect(fs.existsSync(path.join(record.packagePath, "LICENSE"))).toBe(true);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 90_000);
});
