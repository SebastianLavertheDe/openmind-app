import { ALL_SKILL_IDS } from "../../shared/skill-compatibility-matrix";
import { isCctoolsSkillsSourceLocator, OPENMIND_SKILLS_REPO_URL } from "../../shared/skill-package-sources";
import type { SkillPackageService } from "./skill-package-service";
import type { SkillSourceService } from "./skill-source-service";

type DefaultSkillsAutomation = {
  stop(): Promise<unknown>;
  setEnabled(enabled: boolean): Promise<unknown>;
  refresh(): Promise<unknown>;
};

/** Coordinates package mutations with the worker that owns the running jobs. */
export class DefaultSkillsService {
  constructor(
    private readonly packages: SkillPackageService,
    private readonly sources: SkillSourceService,
    private readonly automation: DefaultSkillsAutomation,
    private readonly userRetained: (key: string) => boolean = () => false
  ) {}

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (enabled) {
      const previousKeys = new Set(this.packages.listInstalled().map((record) => record.key));
      try {
        const records = await this.sources.install({ type: "git", locator: OPENMIND_SKILLS_REPO_URL }, undefined, ALL_SKILL_IDS);
        for (const record of records) this.packages.setEnabled(record.key, record.digest, true);
        await this.automation.refresh();
        await this.automation.setEnabled(true);
      } catch (error) {
        await this.automation.stop();
        // A multi-package install can fail after writing some packages. Remove
        // only newly installed defaults, preserving pre-existing user packages.
        for (const record of this.defaultPackages()) {
          if (!previousKeys.has(record.key)) this.packages.uninstall(record.key, record.digest);
        }
        await this.automation.refresh();
        await this.automation.setEnabled(false);
        throw error;
      }
    } else {
      await this.automation.stop();
      for (const record of this.defaultPackages()) this.packages.uninstall(record.key, record.digest);
      await this.automation.refresh();
      await this.automation.setEnabled(false);
    }
    return enabled;
  }

  private defaultPackages() {
    return this.packages.listInstalled().filter((record) =>
      !this.userRetained(record.key) && ALL_SKILL_IDS.includes(record.id) && record.sourceType === "git" && isCctoolsSkillsSourceLocator(record.sourceLocator || record.sourcePath));
  }
}
