import { z } from "zod";
import { messages } from "./messages";

export const SKILL_AVATAR_INPUT_MAX_BYTES = 2 * 1024 * 1024;
export const SKILL_AVATAR_MAX_BYTES = 100 * 1024;
export const SKILL_AVATAR_SIZE = 128;
export const SKILL_CONTRIBUTOR_NICK_MAX = 24;

// Only account homepages belong in contributor links, not repository/post URLs
// or the platforms' root-level application routes. Parse the original spelling
// so URL normalization cannot hide credentials, encoded paths or dot segments.
const PROFILE_ROUTES = {
  "github.com": new Set(["about", "apps", "codespaces", "collections", "contact", "dashboard", "enterprise", "events", "explore", "features", "issues", "join", "login", "logout", "marketplace", "new", "notifications", "organizations", "orgs", "pricing", "pulls", "search", "security", "sessions", "settings", "signup", "site", "sponsors", "topics", "trending", "users"]),
  "x.com": new Set(["about", "account", "compose", "download", "explore", "hashtag", "home", "i", "intent", "jobs", "login", "logout", "messages", "notifications", "privacy", "search", "settings", "share", "signup", "tos"])
};

export const SkillContributorProfileUrlSchema = z.string().trim().transform((value, ctx) => {
  const match = /^https:\/\/(?:www\.)?(github\.com|x\.com)\/([a-z0-9_-]+)\/?$/i.exec(value);
  if (match) {
    const host = match[1].toLowerCase() as keyof typeof PROFILE_ROUTES;
    const handle = match[2];
    const validHandle = host === "github.com" ? /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i.test(handle) : /^[a-z0-9_]{1,15}$/i.test(handle);
    if (validHandle && !PROFILE_ROUTES[host].has(handle.toLowerCase())) return `https://${host}/${handle}`;
  }
  ctx.addIssue({ code: "custom", message: messages.skillLibrary.errors.contributorProfileUrl });
  return z.NEVER;
});

export const SkillContributorNickSchema = z.string()
  .transform(value => value.trim().replace(/^@+/, "").trim().normalize("NFC"))
  .refine(value => Array.from(value).length <= SKILL_CONTRIBUTOR_NICK_MAX, { error: () => messages.skillLibrary.errors.tooLong(SKILL_CONTRIBUTOR_NICK_MAX) })
  .refine(value => !/[\p{Cc}\p{Cf}]/u.test(value), { error: () => messages.skillLibrary.errors.contributorNick });

/** Paths are relative to a Skill package (or its configuration asset directory). */
export const SkillContributorAvatarPathSchema = z.string().min(1).max(512).refine(value =>
  !value.includes("\\") && !value.includes(":") && value.split("/").every(part => part && part !== "." && part !== "..")
  && /\.(png|jpe?g|webp)$/i.test(value), "Use a relative PNG, JPEG or WebP avatar path without traversal");

export const SkillContributorSchema = z.object({
  nick: SkillContributorNickSchema.refine(value => Boolean(value), { error: () => messages.skillLibrary.errors.contributorNick }),
  avatar: SkillContributorAvatarPathSchema.optional(),
  profileUrl: SkillContributorProfileUrlSchema.optional()
}).strict();
export type SkillContributor = z.infer<typeof SkillContributorSchema>;
export interface SkillContributorView { nick: string; avatarUrl?: string; profileUrl?: string }
