import fs from "node:fs";
import type { SkillPackageService } from "../skills/skill-package-service";
import type { SharedPythonProject } from "./shared-python-runtime";

/** Only approved active Process Skills may contribute dependencies to the
 * shared interpreter.  Dependency installation can execute Python build
 * backends, so quarantined/untrusted packages must never reach uv. */
export function listInstalledPythonProjects(packages: SkillPackageService): SharedPythonProject[] {
  return packages.listInstalled().flatMap((record) => {
    if (record.status !== "active" || record.readiness !== "ready" || record.executionTrust !== "approved-host") return [];
    try {
      const inspection = packages.inspect(record.packagePath);
      if (!inspection.valid || !inspection.manifest || inspection.digest !== record.digest) return [];
      if (inspection.manifest.kind !== "process" || inspection.manifest.entrypoint.runtime !== "python") return [];
      const packageRoot = fs.realpathSync(record.packagePath);
      return [{ id: record.id, version: record.version, digest: record.digest, packageRoot }];
    } catch {
      return [];
    }
  });
}
