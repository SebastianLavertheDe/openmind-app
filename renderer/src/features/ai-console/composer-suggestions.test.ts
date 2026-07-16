import { describe, expect, it } from "vitest";
import {
  findComposerTrigger,
  parseSkillSlashInvocation,
  removeMentionTrigger,
  replaceComposerTrigger,
  skillMatchScore
} from "./composer-suggestions";
import type { SkillDefinition } from "@shared/contracts";

const skill: SkillDefinition = {
  id: "rss-article-saver",
  title: "RSS 文章抓取",
  description: "拉取订阅并保存文章。",
  cwd: ".claude/skills/rss-article-saver",
  command: "uv",
  group: "采集",
  permission: "edit"
};

describe("composer suggestion parsing", () => {
  it("finds mention triggers at the caret without requiring them to be at the end of the draft", () => {
    const value = "请分析 @composer 后面的要求";
    expect(findComposerTrigger(value, "请分析 @composer".length)).toEqual({
      kind: "mention",
      start: 4,
      end: 13,
      query: "composer"
    });
  });

  it("only treats slash commands at the start of a message as command triggers", () => {
    expect(findComposerTrigger("  /rev", 6)).toEqual({
      kind: "command",
      start: 2,
      end: 6,
      query: "rev"
    });
    expect(findComposerTrigger("解释 /rev", 7)).toBeNull();
  });

  it("replaces command tokens and removes mention tokens without leaving duplicate spaces", () => {
    const command = findComposerTrigger("/rea", 4)!;
    expect(replaceComposerTrigger("/rea", command, "/read ")).toEqual({ value: "/read ", caret: 6 });

    const mentionValue = "请读 @file 后继续";
    const mention = findComposerTrigger(mentionValue, "请读 @file".length)!;
    expect(removeMentionTrigger(mentionValue, mention)).toEqual({ value: "请读 后继续", caret: 3 });
  });

  it("parses a registered skill directly from slash syntax", () => {
    expect(parseSkillSlashInvocation("/rss-article-saver", [skill])).toEqual({
      skill,
      argument: "",
      raw: "/rss-article-saver"
    });
    expect(parseSkillSlashInvocation("/rss-article-saver 2026-06-27", [skill])).toEqual({
      skill,
      argument: "2026-06-27",
      raw: "/rss-article-saver 2026-06-27"
    });
    expect(parseSkillSlashInvocation("/not-registered", [skill])).toBeNull();
  });

  it("keeps native skill arguments intact and filters skills by real metadata", () => {
    expect(parseSkillSlashInvocation("/rss-article-saver fetch unread posts", [skill])).toMatchObject({
      argument: "fetch unread posts",
      raw: "/rss-article-saver fetch unread posts"
    });
    expect(skillMatchScore(skill, "rss")).toBe(80);
    expect(skillMatchScore(skill, "采集")).toBe(30);
    expect(skillMatchScore(skill, "translate")).toBe(-1);
  });
});
