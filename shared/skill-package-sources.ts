import { messages } from "./messages";
import { z } from "zod";

const LocalLocatorSchema = z.string().trim().min(1).max(4096);
const GitRefSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);

const GitLocatorSchema = LocalLocatorSchema.superRefine((value, context) => {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    context.addIssue({ code: "custom", message: messages.validation.skillSource.controlCharacters });
    return;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    context.addIssue({ code: "custom", message: messages.validation.skillSource.invalidUrl });
    return;
  }
  if (url.protocol !== "https:") {
    context.addIssue({ code: "custom", message: messages.validation.skillSource.httpsOnly });
  }
  if (!url.hostname || url.username || url.password || url.hash || url.search) {
    context.addIssue({ code: "custom", message: messages.validation.skillSource.privateUrl });
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
export const OPENMIND_SKILLS_REPO_URL = "https://github.com/SebastianLavertheDe/cctools-skills";

/** Canonical form used for local source provenance and receipt comparison. */
export function normalizeGitSourceLocator(locator: string | null | undefined): string | null {
  if (!locator) return null;
  let url: URL;
  try {
    url = new URL(locator.trim());
  } catch {
    return null;
  }
  if (url.protocol.toLowerCase() !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    return null;
  }
  let pathname = url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!pathname || pathname === "/") return null;
  if (url.hostname.toLowerCase() === "github.com") pathname = pathname.toLowerCase();
  url.pathname = pathname;
  return url.toString().replace(/\/$/, "");
}

/** Matches a git source locator against {@link OPENMIND_SKILLS_REPO_URL} (ignores trailing slash / .git). */
export function isCctoolsSkillsSourceLocator(locator: string | null | undefined): boolean {
  const normalized = normalizeGitSourceLocator(locator);
  return normalized?.toLowerCase() === normalizeGitSourceLocator(OPENMIND_SKILLS_REPO_URL)?.toLowerCase();
}
