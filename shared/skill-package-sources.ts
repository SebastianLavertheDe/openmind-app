import { z } from "zod";

const LocalLocatorSchema = z.string().trim().min(1).max(4096);
const GitRefSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);

const GitLocatorSchema = LocalLocatorSchema.superRefine((value, context) => {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    context.addIssue({ code: "custom", message: "Git 地址不能包含控制字符。" });
    return;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    context.addIssue({ code: "custom", message: "Git 地址必须是有效的 HTTPS URL。" });
    return;
  }
  if (url.protocol !== "https:") {
    context.addIssue({ code: "custom", message: "Git 来源只允许 HTTPS，不支持 SSH、file 或 HTTP 地址。" });
  }
  if (!url.hostname || url.username || url.password || url.hash || url.search) {
    context.addIssue({ code: "custom", message: "Git 地址不能包含凭据、查询参数或片段。" });
  }
});

const DirectorySourceSchema = z.object({
  type: z.literal("directory"),
  locator: LocalLocatorSchema
});

const ZipSourceSchema = z.object({
  type: z.literal("zip"),
  locator: LocalLocatorSchema
});

const GitSourceSchema = z.object({
  type: z.literal("git"),
  locator: GitLocatorSchema,
  ref: GitRefSchema.optional()
});

/**
 * User-selected Skill sources. Signed Catalog is intentionally absent from
 * this union; the current product only accepts local sources and public HTTPS
 * Git repositories.
 */
export const SkillPackageSourceInputSchema = z.discriminatedUnion("type", [
  DirectorySourceSchema,
  ZipSourceSchema,
  GitSourceSchema
]);

export type SkillPackageSourceInput = z.infer<typeof SkillPackageSourceInputSchema>;

export function parseSkillPackageSourceInput(value: unknown): SkillPackageSourceInput {
  return SkillPackageSourceInputSchema.parse(value);
}

/** Official first-start skill repository; installing it is part of the onboarding gate. */
export const CCTOOLS_SKILLS_REPO_URL = "https://github.com/SebastianLavertheDe/cctools-skills";

/** Matches a git source locator against {@link CCTOOLS_SKILLS_REPO_URL} (ignores trailing slash / .git). */
export function isCctoolsSkillsSourceLocator(locator: string | null | undefined): boolean {
  if (!locator) return false;
  const normalized = locator.trim().replace(/\/+$/, "").replace(/\.git$/, "").toLowerCase();
  return normalized === CCTOOLS_SKILLS_REPO_URL.toLowerCase();
}

