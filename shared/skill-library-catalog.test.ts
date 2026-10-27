import { describe, expect, it } from "vitest";
import catalog from "../config/skill-library/catalog.json";
import { SkillLibraryCatalogSchema, SkillLibraryPresetSchema, resolveSkillLibraryCopy } from "./skill-library-catalog";

const preset = { id: "future-skill", category: "research", instructions: ["Follow the user's materials."], display: { en: { title: "Future skill" } } };

describe("Skill library catalog configuration", () => {
  it("validates the shipped configuration and keeps both display languages", () => {
    const parsed = SkillLibraryCatalogSchema.parse(catalog);
    expect(parsed.skills.length).toBeGreaterThan(0);
    for (const entry of parsed.skills) {
      expect(entry.display.en?.title).toBeTruthy();
      expect(entry.display["zh-CN"]?.title).toBeTruthy();
    }
  });

  it("accepts a new id and falls back to the available language", () => {
    const entry = SkillLibraryPresetSchema.parse(preset);
    expect(resolveSkillLibraryCopy(entry, "zh-CN")).toEqual({ title: "Future skill", subtitle: "", inputHint: "" });
  });

  it("accepts optional contributor metadata and normalizes the displayed nickname", () => {
    expect(SkillLibraryPresetSchema.parse(preset).contributor).toBeUndefined();
    expect(SkillLibraryPresetSchema.parse({ ...preset, contributor: { nick: " @共建者 ", avatar: "avatars/member.webp" } }).contributor).toEqual({ nick: "共建者", avatar: "avatars/member.webp" });
    expect(SkillLibraryPresetSchema.parse({ ...preset, contributor: { nick: "Author", profileUrl: "https://x.com/author/" } }).contributor?.profileUrl).toBe("https://x.com/author");
  });

  it.each([
    { nick: "" }, { nick: "@" }, { nick: "a".repeat(25) }, { nick: "line\nbreak" },
    { nick: "reader", avatar: "../avatar.png" }, { nick: "reader", avatar: "/tmp/avatar.png" },
    { nick: "reader", avatar: "https://example.com/avatar.png" }, { nick: "reader", avatar: "avatar.svg" },
    { nick: "reader", profileUrl: "https://example.com/reader" }, { nick: "reader", profileUrl: "https://github.com/yang0/handraw-style" }
  ])("rejects invalid contributor metadata: %j", contributor => {
    expect(SkillLibraryPresetSchema.safeParse({ ...preset, contributor }).success).toBe(false);
  });

  it.each([
    { ...preset, id: "../outside" },
    { ...preset, id: "nested/skill" },
    { ...preset, category: "typo" },
    { ...preset, requirement: "typo" },
    { ...preset, instructions: [] },
    { ...preset, files: ["../outside.txt"] },
    { ...preset, files: [{ source: "../outside.txt", target: "references/source.txt" }] },
    { ...preset, files: [{ source: "_shared/source.txt", target: "/outside.txt" }] },
    { ...preset, files: [{ source: "_shared/source.txt", target: "../outside.txt" }] },
    { ...preset, display: {} },
    { ...preset, display: { en: { title: " " } } },
    { ...preset, display: { en: { title: "Name", hint: "Misspelled field" } } }
  ])("rejects invalid configuration: %j", value => {
    expect(SkillLibraryPresetSchema.safeParse(value).success).toBe(false);
  });

  it("rejects duplicate identities and unsupported schema versions", () => {
    expect(() => SkillLibraryCatalogSchema.parse({ schemaVersion: 1, skills: [preset, preset] })).toThrow("Duplicate Skill id");
    expect(SkillLibraryCatalogSchema.safeParse({ schemaVersion: 2, skills: [preset] }).success).toBe(false);
  });
});
