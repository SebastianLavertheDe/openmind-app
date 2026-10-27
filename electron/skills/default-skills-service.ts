import { ALL_SKILL_IDS } from "../../shared/skill-compatibility-matrix";
import { installBuiltinDefault, removeManagedWikiGenerator } from "./builtin-default-packages";
import { resolveSkillLibraryBundleRoot } from "./skill-library-catalog";
import type { SkillPackageService } from "./skill-package-service";
import type { SkillSourceService } from "./skill-source-service";

type DefaultSkillsAutomation = { stop(): Promise<unknown>; setEnabled(enabled: boolean): Promise<unknown>; refresh(): Promise<unknown> };

export class DefaultSkillsService {
  constructor(private readonly packages: SkillPackageService, _sources: SkillSourceService,
    private readonly automation: DefaultSkillsAutomation,
    private readonly userRetained: (key: string) => boolean = () => false,
    private readonly bundleRoot: string = resolveSkillLibraryBundleRoot()) {}

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (enabled) {
      await this.automation.stop();
      try {
        for (const id of ALL_SKILL_IDS) {
          const record = installBuiltinDefault(this.packages, id, this.bundleRoot, this.userRetained);
          this.packages.setEnabled(record.key, record.digest, true);
        }
        removeManagedWikiGenerator(this.packages, this.userRetained);
      } catch (error) {
        // Successful migrations remain durable. Retry resumes remaining IDs.
        await this.automation.refresh();
        await this.automation.setEnabled(false);
        throw error;
      }
    }
    // This switch never deletes installed packages, subscriptions or content.
    await this.automation.refresh();
    await this.automation.setEnabled(enabled);
    return enabled;
  }
}
