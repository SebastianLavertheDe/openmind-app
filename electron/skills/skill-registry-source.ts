import fs from "node:fs";
import path from "node:path";
import type { AppPaths } from "../paths/app-paths-service";

/** The source is operator configuration, never a renderer-supplied filesystem path. */
export function resolveSkillRegistrySource(paths: AppPaths, bundleRoot: string): string | null {
  const override = process.env.OPENMIND_SKILL_REGISTRY?.trim();
  if (override) return override;
  const file = path.join(paths.settings, "skill-registry.json");
  if (fs.existsSync(file)) {
    const settings: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!settings || typeof settings !== "object" || !("source" in settings) || typeof settings.source !== "string" || !settings.source.trim()) {
      throw new Error("Invalid Skill registry source configuration.");
    }
    return settings.source.trim();
  }
  // Local development uses the separately published repository directory.
  // Installed apps have no development checkout and use the explicit setting.
  return path.basename(path.dirname(bundleRoot)) === ".build"
    ? path.resolve(bundleRoot, "../../skill-registry") : null;
}
