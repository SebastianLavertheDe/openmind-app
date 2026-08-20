import fs from "node:fs";
import type { SkillPackageService } from "../skills/skill-package-service";
import type { SharedPythonProject } from "./shared-python-runtime";

/** Only installed Process Skills whose managed copy passes a fresh manifest
 * and digest check may contribute dependencies to the shared interpreter. */
export function listInstalledPythonProjects(packages: SkillPackageService): SharedPythonProject[] {
  return packages.listInstalled().flatMap((record) => {
    try {
      const inspection = packages.inspectInstalledCopy(record);
      if (!inspection.manifest) return [];
      if (inspection.manifest.kind !== "process" || inspection.manifest.entrypoint.runtime !== "python") return [];
      const packageRoot = fs.realpathSync(record.packagePath);
      return [{ id: record.id, version: record.version, digest: record.digest, packageRoot }];
    } catch {
      return [];
    }
  });
}
