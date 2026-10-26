/**
 * openmind layout contract v4 — adds the app-owned Project workspace.
 *
 * `projects/` is intentionally app-managed rather than skill-writable. Project
 * names are path identities and every mutation must pass ProjectPathResolver;
 * allowing a Skill manifest to claim `projects/**` would bypass uniqueness,
 * reserved-name and cross-project isolation rules.
 */

import {
  OPENMIND_LAYOUT_V3,
  topLevelOf,
  type OpenmindEntryCategory,
  type OpenmindLayoutEntry
} from "./openmind-layout-v3";

export type { OpenmindEntryCategory, OpenmindLayoutEntry };
export { topLevelOf };

export const OPENMIND_LAYOUT_VERSION_V4 = "openmind-layout-v4" as const;

export const OPENMIND_LAYOUT_V4: readonly OpenmindLayoutEntry[] = [
  ...OPENMIND_LAYOUT_V3,
  { logicalPath: ".agent/authored-skills", category: "app-managed", owner: "desktop-app SkillLibraryService", note: "User-authored Skill sources and assets; separate from replaceable installations" },
  {
    logicalPath: "projects",
    category: "app-managed",
    owner: "desktop-app ProjectService",
    note: "Independent Project workspaces; project-name directories and writes are controlled by ProjectPathResolver"
  }
] as const;

export const OPENMIND_V4_ALLOWED_TOP_LEVEL_DIRS: ReadonlySet<string> = new Set(
  OPENMIND_LAYOUT_V4.map((entry) => entry.logicalPath.split("/")[0])
);

export const OPENMIND_V4_WRITABLE_TOP_LEVEL_DIRS: ReadonlySet<string> = new Set(
  OPENMIND_LAYOUT_V4
    .filter((entry) => entry.category === "initialize-required" || entry.category === "create-if-needed")
    .map((entry) => entry.logicalPath.split("/")[0])
);

export const OPENMIND_V4_CREATE_IF_NEEDED_TOP_LEVEL: readonly string[] = OPENMIND_LAYOUT_V4
  .filter((entry) => entry.category === "create-if-needed" && !entry.logicalPath.includes("/"))
  .map((entry) => entry.logicalPath);

export const OPENMIND_V4_OPTIONAL_TOP_LEVEL: readonly string[] = OPENMIND_LAYOUT_V4
  .filter((entry) => entry.category === "optional-preserve-only" && !entry.logicalPath.includes("/"))
  .map((entry) => entry.logicalPath);

export const OPENMIND_V4_APP_MANAGED_TOP_LEVEL: readonly string[] = [...new Set(
  OPENMIND_LAYOUT_V4
    .filter((entry) => entry.category === "app-managed")
    .map((entry) => entry.logicalPath.split("/")[0])
)];

export function findLayoutV4Entry(logicalPath: string): OpenmindLayoutEntry | undefined {
  return OPENMIND_LAYOUT_V4.find((entry) => entry.logicalPath === logicalPath);
}
