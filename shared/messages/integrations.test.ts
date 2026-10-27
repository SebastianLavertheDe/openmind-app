import { afterEach, describe, expect, it } from "vitest";
import { getLocale, setLocale } from "./index";
import { IMAGE_PROVIDERS } from "../image-generation";
import { ProviderYamlEntrySchema, ProvidersYamlSchema } from "../providers-yaml";
import { SLASH_COMMANDS, parseSlashInvocation, slashCommandValidationError } from "../slash-commands";
import { renderWechatArticle, WECHAT_THEMES } from "../wechat-format";
import { WECHAT_THEME_DEFINITIONS } from "../wechat-themes";
import { WechatAccountInputSchema, WechatDraftInputSchema } from "../wechat";
import { ProjectNameSchema, ProjectAddUrlInputSchema, ProjectStartTaskRunInputSchema, ProjectCreateOutputInputSchema } from "../project-contracts";
import { AutomationTriggerSchema, AutomationRuleInputSchema } from "../automation-contracts";
import { DEFAULT_AUTOMATION_RULES } from "../automation-defaults";
import { SkillPackageSourceInputSchema } from "../skill-package-sources";
import { ArtifactFenceParser } from "../markdown-artifacts";

afterEach(() => setLocale("zh-CN"));

const provider = {
  id: "sample", name: "Sample", protocol: "openai-responses", apiKey: "test-key",
  baseUrl: "https://example.com/v1", model: "example-model"
};
const draft = {
  projectName: "sample", outputPath: "article.md", title: "A".repeat(32),
  html: "<p>Article</p>", author: "A".repeat(16), digest: "A".repeat(120), coverPath: "cover.png"
};

describe("shared UI localization integrations", () => {
  it("updates existing theme objects in both exported registries without re-importing them", () => {
    const pure = WECHAT_THEMES[0];
    const definition = WECHAT_THEME_DEFINITIONS[0];
    expect(pure.name).toBe("归真");
    setLocale("en");
    expect(WECHAT_THEMES.map(theme => theme.name)).toEqual(["Pure", "Elegant", "Magazine", "Digest"]);
    expect(pure.description).toBe("Clean spacing, focused content");
    expect(definition.name).toBe("Pure");
    setLocale("zh-CN");
    expect(pure.name).toBe("归真");
    expect(pure.description).toBe("清爽留白，专注内容");
    expect(definition.name).toBe("归真");
  });

  it("localizes formatter warnings while preserving safe article content and formatting", () => {
    const markdown = '<script>alert(1)</script>\n\n# Original title\n\n![Cover](javascript:alert%281%29)\n\n```mermaid\ngraph TD\nA-->B\n```';
    setLocale("en");
    const english = renderWechatArticle(markdown, { themeId: "pure" });
    expect(english.warnings).toContain("Raw HTML was ignored for security. Use Markdown formatting instead.");
    expect(english.warnings).toContain("An unsafe or unsupported image URL was removed.");
    expect(english.warnings.join(" ")).not.toMatch(/\p{Script=Han}/u);
    expect(english.html).toContain("Original title");
    expect(english.html).not.toMatch(/<script|<img|javascript:/);
    setLocale("zh-CN");
    const chinese = renderWechatArticle(markdown, { themeId: "pure" });
    expect(chinese.warnings).toContain("为安全起见，已忽略原始 HTML；请使用 Markdown 格式。");
    expect(chinese.html).toBe(english.html);
    expect(chinese.text).toBe(english.text);
  });

  it("uses the active language for already-created WeChat schemas and preserves their limits", () => {
    const invalidAccount = { appId: "invalid", appSecret: "short", author: "A".repeat(17) };
    setLocale("en");
    const english = WechatAccountInputSchema.safeParse(invalidAccount);
    expect(english.success).toBe(false);
    expect(english.error?.issues.map(issue => issue.message)).toEqual([
      "Enter a valid WeChat Official Account AppID.",
      "AppSecret must contain 32 letters or digits.",
      "The author can contain up to 16 characters."
    ]);
    expect(WechatAccountInputSchema.safeParse({ appId: "wx0123456789abcdef", appSecret: "", author: "A".repeat(16) }).success).toBe(true);
    expect(WechatDraftInputSchema.safeParse(draft).success).toBe(true);
    const invalidDraft = WechatDraftInputSchema.safeParse({ ...draft, title: "A".repeat(33), digest: "A".repeat(121), coverPath: "" });
    expect(invalidDraft.error?.issues.map(issue => issue.message)).toEqual([
      "The title can contain up to 32 characters.", "The summary can contain up to 120 characters.", "Choose an article cover first."
    ]);
    setLocale("zh-CN");
    const chinese = WechatAccountInputSchema.safeParse(invalidAccount);
    expect(chinese.error?.issues.map(issue => issue.message)).toEqual([
      "请输入正确的公众号 AppID。", "AppSecret 应为 32 位字母或数字。", "作者最多 16 个字。"
    ]);
    expect(WechatDraftInputSchema.safeParse({ ...draft, title: "" }).error?.issues[0].message).toBe("请输入文章标题。");
  });

  it("localizes provider field and document errors at validation time", () => {
    setLocale("en");
    expect(ProviderYamlEntrySchema.safeParse(provider).success).toBe(true);
    const unsafe = ProviderYamlEntrySchema.safeParse({ ...provider, baseUrl: "http://example.com/v1" });
    expect(unsafe.error?.issues[0].path).toEqual(["baseUrl"]);
    expect(unsafe.error?.issues[0].message).toBe("Base URL must use HTTPS and contain no credentials. HTTP is allowed only for localhost or loopback addresses.");
    const duplicate = { schemaVersion: 1, default: "sample", providers: [provider, provider] };
    expect(ProvidersYamlSchema.safeParse(duplicate).error?.issues[0].message).toBe("Duplicate provider ID: sample");
    expect(ProviderYamlEntrySchema.safeParse({ ...provider, proxyPolicy: "explicit" }).error?.issues[0].message).toBe("A Proxy URL is required when proxyPolicy is explicit.");
    setLocale("zh-CN");
    expect(ProviderYamlEntrySchema.safeParse({ ...provider, baseUrl: "http://example.com/v1" }).error?.issues[0].message).toBe("Base URL 必须是无凭据的 HTTPS URL；HTTP 仅允许 localhost/loopback。");
    expect(ProvidersYamlSchema.safeParse(duplicate).error?.issues[0].message).toBe("Provider ID 重复：sample");
  });

  it("updates image model metadata held by existing consumers without changing model IDs", () => {
    const model = IMAGE_PROVIDERS[0].models[0];
    const originalIds = IMAGE_PROVIDERS.flatMap(entry => entry.models.map(candidate => candidate.id));
    expect(model.description).toBe("快速生成 · 日常创作");
    setLocale("en");
    expect(IMAGE_PROVIDERS[0].name).toBe("ByteDance Volcengine");
    expect(model.description).toBe("Fast generation · Everyday creativity");
    expect(IMAGE_PROVIDERS.flatMap(entry => entry.models.map(candidate => candidate.description)).join(" ")).not.toMatch(/\p{Script=Han}/u);
    expect(IMAGE_PROVIDERS.flatMap(entry => entry.models.map(candidate => candidate.id))).toEqual(originalIds);
    setLocale("zh-CN");
    expect(IMAGE_PROVIDERS[0].name).toBe("字节火山");
    expect(model.description).toBe("快速生成 · 日常创作");
  });

  it("updates slash-command objects, parsed invocations, and validation text together", () => {
    const command = SLASH_COMMANDS[0];
    const invocation = parseSlashInvocation("/search sample");
    setLocale("en");
    expect(command.title).toBe("Search project");
    expect(invocation?.command.title).toBe("Search project");
    expect(command.usage).toBe("/search <query>");
    expect(SLASH_COMMANDS.map(entry => `${entry.title} ${entry.description} ${entry.usage}`).join(" ")).not.toMatch(/\p{Script=Han}/u);
    expect(slashCommandValidationError("/search")).not.toMatch(/\p{Script=Han}/u);
    setLocale("zh-CN");
    expect(getLocale()).toBe("zh-CN");
    expect(command.title).toBe("搜索项目");
    expect(invocation?.command.title).toBe("搜索项目");
    expect(slashCommandValidationError("/search")).toMatch(/\p{Script=Han}/u);
  });

  it("localizes project name failures while keeping character, byte, and path protections", () => {
    setLocale("en");
    expect(ProjectNameSchema.safeParse("A".repeat(80)).success).toBe(true);
    expect(ProjectNameSchema.safeParse("文".repeat(60)).success).toBe(true);
    expect(ProjectNameSchema.safeParse("").error?.issues[0].message).toBe("Enter a project name.");
    for (const value of ["A".repeat(81), "文".repeat(61)]) {
      expect(ProjectNameSchema.safeParse(value).error?.issues[0].message).toBe("Project names can contain up to 80 characters and 180 bytes.");
    }
    for (const value of ["../sample", "sample/name", "sample%2Fname", "sample..name", ".sample", "sample.", " sample", "CON", "LPT1.txt"]) {
      const result = ProjectNameSchema.safeParse(value);
      expect(result.success, value).toBe(false);
      expect(result.error?.issues.map(issue => issue.message).join(" ")).not.toMatch(/\p{Script=Han}/u);
    }
    setLocale("zh-CN");
    expect(ProjectNameSchema.safeParse("").error?.issues[0].message).toBe("项目名不能为空。");
    expect(ProjectNameSchema.safeParse("CON").error?.issues[0].message).toBe("项目名不能使用 Windows 保留设备名。");
  });

  it("localizes project input relationships and HTTP URL restrictions at parse time", () => {
    const taskId = "db045d08-5bf2-45b9-802d-9738a427bedd";
    setLocale("en");
    expect(ProjectAddUrlInputSchema.safeParse({ projectName: "Sample", url: "file:///tmp/file" }).error?.issues[0].message).toBe("Only HTTP(S) URLs are supported.");
    expect(ProjectAddUrlInputSchema.safeParse({ projectName: "Sample", url: "https://example.com/article" }).success).toBe(true);
    const run = ProjectStartTaskRunInputSchema.safeParse({ projectName: "Sample", taskId, prompt: "Sample" });
    expect(run.error?.issues[0].path).toEqual(["providerId"]);
    expect(run.error?.issues[0].message).toBe("New project tasks require a provider.");
    const output = { projectName: "Sample", title: "Output", sourceMessageId: "message" };
    expect(ProjectCreateOutputInputSchema.safeParse(output).error?.issues.map(issue => issue.message)).toEqual([
      "Outputs sourced from a session or message must be linked to a project task.",
      "Outputs sourced from a message must be linked to a session."
    ]);
    setLocale("zh-CN");
    expect(ProjectCreateOutputInputSchema.safeParse(output).error?.issues[0].message).toBe("Output Session/Message 来源必须绑定 Project Task。");
  });

  it("localizes automation and Git source rejections without weakening their boundaries", () => {
    setLocale("en");
    expect(AutomationTriggerSchema.safeParse({ type: "file-change", paths: ["../private"] }).error?.issues[0].message).toBe("File-change paths must be relative to openmindRoot.");
    expect(AutomationTriggerSchema.safeParse({ type: "file-change", paths: ["article/today.md"] }).success).toBe(true);
    const weekly = { type: "weekly", daysOfWeek: [1, 1], at: "08:00" };
    expect(AutomationTriggerSchema.safeParse(weekly).error?.issues[0].message).toBe("Weekly triggers cannot contain duplicate days.");
    expect(AutomationRuleInputSchema.safeParse({ ...DEFAULT_AUTOMATION_RULES[0], inputs: { access_token: "fixture" } }).error?.issues[0].message).toBe("Automation inputs cannot store secrets directly.");
    expect(SkillPackageSourceInputSchema.safeParse({ type: "git", locator: "http://example.com/skill.git" }).error?.issues[0].message).toBe("Git sources support HTTPS only. SSH, file, and HTTP URLs are not supported.");
    expect(SkillPackageSourceInputSchema.safeParse({ type: "git", locator: "https://name@example.com/skill.git" }).error?.issues[0].message).toBe("Git URLs cannot contain credentials, query parameters, or fragments.");
    expect(SkillPackageSourceInputSchema.safeParse({ type: "git", locator: "https://example.com/skill.git" }).success).toBe(true);
    setLocale("zh-CN");
    expect(AutomationTriggerSchema.safeParse(weekly).error?.issues[0].message).toBe("Weekly 触发器不能重复星期。");
    expect(SkillPackageSourceInputSchema.safeParse({ type: "git", locator: "invalid" }).error?.issues[0].message).toBe("Git 地址必须是有效的 HTTPS URL。");
  });

  it("localizes unnamed artifact titles without changing their parsed content", () => {
    const parser = new ArtifactFenceParser("example");
    parser.push("~~~~openmind-artifact\nFirst body\n~~~~\n~~~~openmind-artifact\nSecond body\n~~~~\n");
    setLocale("en");
    const english = parser.finish();
    expect(english.map(block => block.type === "artifact" ? block.title : "")).toEqual(["Untitled artifact 1", "Untitled artifact 2"]);
    setLocale("zh-CN");
    const chinese = parser.blocks();
    expect(chinese.map(block => block.type === "artifact" ? block.title : "")).toEqual(["未命名产物 1", "未命名产物 2"]);
    expect(chinese.map(block => block.type === "text" ? block.text : block.content)).toEqual(["First body", "Second body"]);
  });

  it("uses the selected language when creating default rules and keeps parsed snapshots stable", () => {
    setLocale("en");
    const saved = AutomationRuleInputSchema.parse(DEFAULT_AUTOMATION_RULES[0]);
    expect(saved.name).toBe("RSS updates");
    expect(DEFAULT_AUTOMATION_RULES.map(rule => `${rule.name} ${rule.description}`).join(" ")).not.toMatch(/\p{Script=Han}/u);
    setLocale("zh-CN");
    expect(DEFAULT_AUTOMATION_RULES[0].name).toBe("RSS 更新");
    expect(saved.name).toBe("RSS updates");
  });
});
