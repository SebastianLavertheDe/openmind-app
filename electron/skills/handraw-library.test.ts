import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareSkillLibraryBundle } from "./skill-library-bundle";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "./skill-package-service";
import { SkillLibraryService } from "./skill-library-service";
import { readSkillLibraryCatalog } from "./skill-library-catalog";

describe("Handraw cards from configuration to installed packages", () => {
  it("ships all ten self-contained workflows with shared references and source credit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-handraw-install-"));
    try {
      const bundle = path.join(root, "bundle");
      const content = path.join(root, "content"); fs.mkdirSync(content);
      prepareSkillLibraryBundle(path.resolve("config/skill-library"), bundle);
      const paths = buildAppPaths(path.join(root, "state"), path.join(content, ".agent/skills")); ensureAppPaths(paths);
      const packages = new SkillPackageService(paths);
      const service = new SkillLibraryService(content, paths, packages, bundle);
      const ids = ["om-article-cover", "om-article-illustrator", "om-social-cards", "om-knowledge-infographic", "om-poster-maker", "om-four-panel-comic", "om-photo-diptych", "om-product-highlights", "om-brand-character", "om-style-fusion"];
      const catalog = readSkillLibraryCatalog(bundle);
      for (const id of ids) {
        const preset = catalog.skills.find(entry => entry.id === id)!;
        expect(preset.requirement).toBe("image");
        expect(preset.contributor?.nick).toBe("yang0");
        expect(preset.contributor?.avatar).toBe("avatars/yang0.jpg");
        expect(preset.contributor?.profileUrl).toBe("https://github.com/yang0");
        const installed = service.installPreset(id);
        expect(installed.contributor?.avatarUrl).toMatch(/^data:image\/jpeg;base64,/);
        expect(installed.contributor?.profileUrl).toBe("https://github.com/yang0");
        const record = packages.getInstalled(installed.key!, installed.digest!)!;
        const avatar = fs.readFileSync(path.join(record.packagePath, preset.contributor!.avatar!));
        expect(avatar.length).toBeLessThanOrEqual(100 * 1024);
        expect(installed.contributor?.avatarUrl).toBe(`data:image/jpeg;base64,${avatar.toString("base64")}`);
        const reference = JSON.parse(fs.readFileSync(path.join(record.packagePath, "references/visual-library.json"), "utf8"));
        expect(reference.styles.length).toBeGreaterThan(0);
        expect(reference.layouts.some((layout: { id: string }) => layout.id === "SC-021")).toBe(true);
        expect(fs.readFileSync(path.join(record.packagePath, "LICENSE.handraw-style"), "utf8")).toContain("Copyright (c) 2026 yang0");
        expect(fs.readFileSync(path.join(record.packagePath, "ATTRIBUTION.md"), "utf8")).toContain("https://github.com/yang0/handraw-style");
        expect(packages.inspectInstalledCopy(record).valid).toBe(true);
      }
      // An installed card remains complete after discovery resources disappear.
      fs.rmSync(bundle, { recursive: true });
      for (const record of packages.listInstalledViews()) {
        expect(fs.existsSync(path.join(record.packagePath, "references/image-workflow.md"))).toBe(true);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
