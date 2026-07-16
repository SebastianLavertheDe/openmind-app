import { describe, expect, it } from "vitest";
import {
  expandSlashCommand,
  parseSlashInvocation,
  slashCommandValidationError
} from "./slash-commands";

describe("slash commands", () => {
  it("parses registered commands case-insensitively and preserves multiline arguments", () => {
    const invocation = parseSlashInvocation("/SEARCH provider registry\n只看 desktop-app");
    expect(invocation?.command.name).toBe("search");
    expect(invocation?.argument).toBe("provider registry\n只看 desktop-app");
  });

  it("rejects missing and unknown commands before a run is created", () => {
    expect(slashCommandValidationError("/search")).toContain("缺少必要参数");
    expect(slashCommandValidationError("/does-not-exist anything")).toContain("未知命令");
    expect(slashCommandValidationError("请读取 /home/say/file")).toBeNull();
  });

  it("allows context-aware commands to use attached files as their target", () => {
    const contexts = [{ id: "file:a", kind: "file" as const, label: "a.md", path: "notes/a.md" }];
    expect(slashCommandValidationError("/read", contexts)).toBeNull();
    expect(expandSlashCommand("/read", contexts)).toContain("notes/a.md");
  });

  it("expands commands into explicit provider instructions while retaining the original command", () => {
    const expanded = expandSlashCommand("/write 完成登录页并运行测试");
    expect(expanded).toContain('name="write"');
    expect(expanded).toContain("直接在当前项目中完成");
    expect(expanded).toContain("用户原始命令：/write 完成登录页并运行测试");
  });

  it("leaves ordinary prompts untouched", () => {
    expect(expandSlashCommand("解释 /search 的用途")).toBe("解释 /search 的用途");
  });
});

