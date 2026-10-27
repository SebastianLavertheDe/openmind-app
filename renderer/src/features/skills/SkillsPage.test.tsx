import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, InstalledSkillView, SkillDefinition, SkillPackageInspectionView, SkillSourceInspectionView, SourceDefinition } from "@shared/contracts";
import { BrokerRunRecordSchema, EXECUTION_SCHEMA_VERSION } from "@shared/execution-contracts";
import { SkillsPage } from "./SkillsPage";
import { INSTALLED_SKILL_CATALOG_CHANGED_EVENT } from "../../installed-skill-events";

vi.mock("../../feedback-context", () => ({ useFeedback: () => ({ confirm: async () => true, notify: vi.fn() }) }));

const digest = "a".repeat(64);
const sourcePath = "/workspace/.claude/skills/demo-skill";
const manifest = {
  apiVersion: "openmind.dev/skill/v1",
  id: "demo-skill",
  version: "1.2.0",
  kind: "process",
  publisher: { id: "local", displayName: "本地团队" },
  display: { name: "Demo Skill", description: "用于验证 Skill Center 的示例包。", group: "测试" },
  config: { date: { type: "string", required: true } },
  capabilities: { openmind: { read: ["article/**"], write: ["daily-summary/**"] }, network: { required: false, hosts: [] }, browser: false, subprocess: { allowed: false } }
};

const inspection: SkillPackageInspectionView = {
  sourcePath,
  sourceKind: "directory",
  valid: true,
  digest,
  totalBytes: 2048,
  files: [{ path: "openmind.skill.yaml", type: "file", size: 1024, digest: "manifest" }],
  excludedPaths: [],
  manifest,
  legacy: null,
  issues: [],
  warnings: []
};

const installedSkill: InstalledSkillView = {
  schemaVersion: 1,
  key: "local/demo-skill",
  id: "demo-skill",
  publisherId: "local",
  version: "1.2.0",
  digest,
  sourcePath,
  packagePath: "/userData/skills/local/demo-skill/1.2.0-aaaaaaaaaaaaaaaa",
  usable: true,
  enabled: true,
  signatureStatus: "unsigned",
  reviewStatus: "unreviewed",
  skillUpdatePolicy: "manual",
  installedAt: "2026-08-06T00:00:00.000Z"
};

const skills: SkillDefinition[] = [{ id: "legacy-demo", title: "旧版 Demo", description: "旧发现链能力", cwd: sourcePath, command: "python", group: "测试" }];
const demoRunCreatedAt = new Date().toISOString();
const demoRun = BrokerRunRecordSchema.parse({
  schemaVersion: EXECUTION_SCHEMA_VERSION,
  id: "demo-run-1",
  request: { skillId: "demo-skill", trigger: { type: "manual" }, providerBindingIds: [], externalExportBindingIds: [], inputKeys: [] },
  state: "succeeded",
  sequence: 1,
  rootGeneration: 1,
  skillDigest: digest,
  runtime: null,
  createdAt: demoRunCreatedAt,
  startedAt: demoRunCreatedAt,
  completedAt: demoRunCreatedAt,
  terminalState: "succeeded",
  error: null,
  processPid: null,
  orphanPid: null,
  artifacts: []
});
function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    getDefaultSkillsEnabled: async () => false,
    setDefaultSkillsEnabled: async (enabled: boolean) => enabled,
    inspectInstalledSkill: async () => inspection,
    listInstalledSkills: async () => [installedSkill],
    setInstalledSkillEnabled: async (_key: string, _digest: string, enabled: boolean) => ({ ...installedSkill, enabled }),
    listSkillRuns: async () => [demoRun],
    listSources: async () => [],
    onAiEvent: () => () => undefined,
    ...overrides
  } as unknown as DesktopApi;
}

function renderPage(overrides: Partial<DesktopApi> = {}, initialSkillId?: string, initialSourcePickerOpen = false, onInstallationChange?: () => void | Promise<void>, onAvailabilityChange?: () => void | Promise<void>) {
  window.openmind = makeApi(overrides);
  render(<SkillsPage skills={skills} initialSkillId={initialSkillId} initialSourcePickerOpen={initialSourcePickerOpen} onInstallationChange={onInstallationChange} onAvailabilityChange={onAvailabilityChange} />);
}

beforeEach(() => {
  window.openmind = makeApi();
});

afterEach(() => cleanup());

describe("SkillsPage", () => {
  it("loads the catalog and shows only the selected Skill run history", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    expect(screen.getByText((_, node) => node?.tagName === "SMALL" && node.textContent?.includes("demo-skill") && node.textContent.includes("1.2.0"))).toBeTruthy();
    expect(screen.getByRole("heading", { name: "运行记录" })).toBeTruthy();
    expect(screen.getByText("demo-run-1", { exact: false })).toBeTruthy();
    expect(screen.getByText("成功")).toBeTruthy();
    expect(screen.getByText("近 5 天 · 1 条")).toBeTruthy();
    expect(screen.getByText("包体已验证")).toBeTruthy();
    expect(screen.getByText("后续可用性")).toBeTruthy();
    expect(screen.getByText("更改不会修改已有会话，也不会取消已排队或正在运行的任务。")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "启用 Demo Skill 的后续使用" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的 Skill")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "Demo" } });
    expect(screen.getByRole("heading", { name: "Demo Skill" })).toBeTruthy();
  });

  it("keeps the Skill catalog usable when run history is unavailable", async () => {
    renderPage({
      listSkillRuns: async () => {
        throw new Error("Error invoking remote method 'skill:run-list': setup gate failed");
      }
    });

    expect(await screen.findByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    expect(screen.getByText("运行记录暂时不可用，Skill 列表和配置仍可正常管理。")).toBeTruthy();
    expect(screen.queryByText(/Error invoking remote method/)).toBeNull();
  });

  it("shows only runs created within the last five days", async () => {
    const now = Date.now();
    const recentRun = BrokerRunRecordSchema.parse({
      ...demoRun,
      id: "recent-run",
      createdAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString()
    });
    const expiredRun = BrokerRunRecordSchema.parse({
      ...demoRun,
      id: "expired-run",
      createdAt: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString()
    });
    renderPage({ listSkillRuns: async () => [expiredRun, recentRun] });

    expect(await screen.findByText("recent-run", { exact: false })).toBeTruthy();
    expect(screen.queryByText("expired-run", { exact: false })).toBeNull();
    expect(screen.getByText("近 5 天 · 1 条")).toBeTruthy();
  });

  it("keeps RSS subscriptions inside their owning Skill and supports source actions", async () => {
    const rssInstalled: InstalledSkillView = { ...installedSkill, key: "cctools/rss-article-saver", id: "rss-article-saver" };
    const rssInspection: SkillPackageInspectionView = {
      ...inspection,
      manifest: {
        ...manifest,
        id: "rss-article-saver",
        display: { name: "RSS 文章采集", description: "采集订阅内容。", group: "采集" }
      }
    };
    const source: SourceDefinition = {
      schemaVersion: 1,
      id: "rss-1",
      name: "少数派",
      kind: "rss",
      url: "https://sspai.com/feed",
      skillId: "rss-article-saver",
      enabled: true,
      frequency: "每日流水线",
      tags: ["产品"],
      lastRunAt: null,
      lastSuccessAt: null,
      successRate: null,
      status: "idle",
      recentError: null,
      itemCount: 0
    };
    const row = { id: source.id, name: source.name, inputUrl: source.url!, kind: "feed" as const, enabled: true, revision: 1, adapterId: "feed", resolvedFeedUrl: null, presetId: null, group: "", tags: [], lastAttemptAt: null, lastSuccessAt: null, lastError: null, itemCount: 0, feedRevision: 0 };
    const document = { schemaVersion: 1 as const, initialized: true as const, revision: 1, sources: [row], deletedPresetIds: [], migrationWarnings: [] };
    const editRssSource = vi.fn(async () => document);
    const importRssOpml = vi.fn(async () => document);
    renderPage({ listInstalledSkills: async () => [rssInstalled], inspectInstalledSkill: async () => rssInspection, listSources: async () => [source], getRssSources: async () => ({ ...document, sources: [{ ...row, localFeed: { path: "/fixtures/content/.agent/skill-data/rss-article-saver/feeds/rss-1.xml", status: "missing" as const } }] }), editRssSource, importRssOpml });
    expect(await screen.findByRole("heading", { name: "RSS 文章采集" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "订阅源 1" }));
    expect(await screen.findByText("https://sspai.com/feed")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /少数派/ }));
    await waitFor(() => expect(editRssSource).toHaveBeenCalledWith({ id: "rss-1", revision: 1, enabled: false }));
    await waitFor(() => expect((screen.getByRole("button", { name: "导入 OPML" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "导入 OPML" }));
    await waitFor(() => expect(importRssOpml).toHaveBeenCalled());
  });

  it("shows and manages the actual Reddit community list", async () => {
    const redditInstalled: InstalledSkillView = { ...installedSkill, key: "cctools/reddit-fetcher", id: "reddit-fetcher" };
    const redditInspection: SkillPackageInspectionView = {
      ...inspection,
      manifest: {
        ...manifest,
        id: "reddit-fetcher",
        display: { name: "Reddit 内容抓取", description: "抓取社区内容。", group: "采集" }
      }
    };
    let current: SourceDefinition[] = [{
      schemaVersion: 1,
      id: "reddit-local-llama",
      name: "r/LocalLLaMA",
      kind: "reddit",
      url: "https://www.reddit.com/r/LocalLLaMA/hot.json",
      skillId: "reddit-fetcher",
      enabled: true,
      frequency: "每日流水线",
      tags: ["AI"],
      lastRunAt: null,
      lastSuccessAt: null,
      successRate: null,
      status: "idle",
      recentError: null,
      itemCount: 0
    }];
    const listSources = vi.fn(async () => current);
    const updateSource = vi.fn(async (id: string, patch: Partial<SourceDefinition>) => {
      const existing = current.find((source) => source.id === id)!;
      const updated = { ...existing, ...patch } as SourceDefinition;
      current = current.map((source) => source.id === id ? updated : source);
      return updated;
    });
    const addRssSource = vi.fn(async (input: { name: string; url: string; kind?: string; tags?: string[] }) => {
      const added: SourceDefinition = {
        ...current[0],
        id: "reddit-claude-ai",
        name: input.name,
        url: input.url,
        tags: input.tags || [],
        enabled: true,
        status: "idle"
      };
      current = [...current, added];
      return added;
    });
    renderPage({
      listInstalledSkills: async () => [redditInstalled],
      inspectInstalledSkill: async () => redditInspection,
      listSources,
      updateSource,
      addRssSource
    });

    expect(await screen.findByRole("heading", { name: "Reddit 内容抓取" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "社区源 1" }));
    expect(screen.getByText("https://www.reddit.com/r/LocalLLaMA/hot.json")).toBeTruthy();
    expect(screen.queryByText("Reddit 订阅")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "停用 r/LocalLLaMA" }));
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith("reddit-local-llama", { enabled: false }));

    fireEvent.click(screen.getByRole("button", { name: "编辑 r/LocalLLaMA" }));
    fireEvent.change(screen.getByRole("textbox", { name: "社区名称" }), { target: { value: "Local LLM" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reddit JSON 地址" }), { target: { value: "https://www.reddit.com/r/LocalLLaMA/new.json" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith("reddit-local-llama", expect.objectContaining({
      name: "Local LLM",
      url: "https://www.reddit.com/r/LocalLLaMA/new.json"
    })));

    fireEvent.click(await screen.findByRole("button", { name: "添加社区" }));
    fireEvent.change(screen.getByRole("textbox", { name: "社区名称" }), { target: { value: "ClaudeAI" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reddit JSON 地址" }), { target: { value: "https://www.reddit.com/r/ClaudeAI/hot.json" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "添加社区" }));
    await waitFor(() => expect(addRssSource).toHaveBeenCalledWith(expect.objectContaining({
      name: "ClaudeAI",
      kind: "reddit",
      url: "https://www.reddit.com/r/ClaudeAI/hot.json"
    })));
    expect(await screen.findByRole("tab", { name: "社区源 2" })).toBeTruthy();
  });

  it("shows X as a curl request configuration instead of an account source", async () => {
    const xInstalled: InstalledSkillView = { ...installedSkill, key: "cctools/x-following-fetcher", id: "x-following-fetcher" };
    const xInspection: SkillPackageInspectionView = {
      ...inspection,
      manifest: {
        ...manifest,
        id: "x-following-fetcher",
        display: { name: "X Following 抓取", description: "抓取关注时间线。", group: "采集" }
      }
    };
    const source: SourceDefinition = {
      schemaVersion: 1,
      id: "source-x",
      name: "X 请求",
      kind: "x",
      url: null,
      skillId: "x-following-fetcher",
      enabled: true,
      frequency: "每日流水线",
      tags: ["动态"],
      lastRunAt: null,
      lastSuccessAt: null,
      successRate: null,
      status: "idle",
      recentError: null,
      itemCount: 0
    };
    const curls = [
      "curl 'https://x.com/i/api/graphql/HomeLatestTimeline' -H 'authorization: Bearer local-token'",
      "curl 'https://x.com/i/api/graphql/ListLatestTweetsTimeline' -H 'authorization: Bearer local-token'"
    ];
    const getXFollowingCurls = vi.fn(async () => curls);
    const saveXFollowingCurls = vi.fn(async () => undefined);
    const updateSource = vi.fn(async (_id: string, patch: { enabled?: boolean }) => ({ ...source, enabled: patch.enabled ?? source.enabled }));
    renderPage({
      listInstalledSkills: async () => [xInstalled],
      inspectInstalledSkill: async () => xInspection,
      listSources: async () => [source],
      getXFollowingCurls,
      saveXFollowingCurls,
      updateSource
    });

    expect(await screen.findByRole("heading", { name: "X Following 抓取" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "请求配置" }));
    expect(await screen.findByRole("heading", { name: "X Following 抓取的请求配置" })).toBeTruthy();
    expect(screen.queryByText("账号来源", { exact: false })).toBeNull();
    expect(await screen.findByText("已配置 2 条 · 请求内容已隐藏")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "编辑 cURL 列表" }));
    const first = screen.getByRole("textbox", { name: "完整 cURL 1" }) as HTMLTextAreaElement;
    expect(first.value).toBe(curls[0]);
    expect((screen.getByRole("textbox", { name: "完整 cURL 2" }) as HTMLTextAreaElement).value).toBe(curls[1]);
    fireEvent.change(first, { target: { value: "not a curl" } });
    fireEvent.click(screen.getByRole("button", { name: "保存全部" }));
    expect((await screen.findByRole("alert")).textContent).toContain("第 1 条不是以 curl 开头的完整请求。");
    fireEvent.change(first, { target: { value: "curl 'https://x.com/new-request'" } });
    fireEvent.click(screen.getByRole("button", { name: "添加 cURL" }));
    fireEvent.change(screen.getByRole("textbox", { name: "完整 cURL 3" }), { target: { value: "curl 'https://x.com/bookmarks'" } });
    fireEvent.click(screen.getByRole("button", { name: "保存全部" }));
    await waitFor(() => expect(saveXFollowingCurls).toHaveBeenCalledWith([
      "curl 'https://x.com/new-request'",
      curls[1],
      "curl 'https://x.com/bookmarks'"
    ]));
    expect(getXFollowingCurls).toHaveBeenCalledOnce();

    // Saving must finish closing the modal before background controls are available.
    fireEvent.click(await screen.findByRole("switch", { name: "停用 X Following 抓取" }));
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith("source-x", { enabled: false }));
  });

  it("checks and updates every Skill from the selected Git source", async () => {
    const locator = "https://github.com/example/demo-skills.git";
    const source = { type: "git" as const, locator, ref: "main" };
    const gitInstalled: InstalledSkillView = {
      ...installedSkill,
      sourcePath: locator,
      sourceType: "git",
      sourceLocator: locator,
      sourceRef: "main",
      sourcePackageRef: ".",
      sourceRevision: "1".repeat(40)
    };
    const updatedInspection: SkillPackageInspectionView = {
      ...inspection,
      sourcePath: locator,
      sourceKind: "git",
      packageRef: ".",
      digest: "b".repeat(64),
      manifest: { ...manifest, version: "2.0.0" }
    };
    let currentRecord = gitInstalled;
    let currentInspection: SkillPackageInspectionView = { ...inspection, sourcePath: locator, sourceKind: "git", packageRef: "." };
    const inspectSkillSource = vi.fn().mockResolvedValue({ source, packages: [updatedInspection] });
    const installSkillSource = vi.fn().mockImplementation(async () => {
      currentRecord = { ...gitInstalled, version: "2.0.0", digest: updatedInspection.digest, sourceRevision: "2".repeat(40) };
      currentInspection = updatedInspection;
      return [currentRecord];
    });
    const onInstallationChange = vi.fn();
    const onAvailabilityChange = vi.fn();
    renderPage({
      listInstalledSkills: async () => [currentRecord],
      inspectInstalledSkill: async () => currentInspection,
      inspectSkillSource,
      installSkillSource
    }, undefined, false, onInstallationChange, onAvailabilityChange);

    await screen.findByRole("heading", { name: "Demo Skill" });
    const checkButton = screen.getByRole("button", { name: "检查更新" });
    const updateButton = screen.getByRole("button", { name: "更新" }) as HTMLButtonElement;
    expect(checkButton.closest(".skills-source-group")).toBeTruthy();
    expect(checkButton.closest(".skills-detail")).toBeNull();
    expect(updateButton.closest(".skills-source-group")).toBeTruthy();
    expect(updateButton.disabled).toBe(true);
    fireEvent.click(checkButton);

    await waitFor(() => expect(inspectSkillSource).toHaveBeenCalledWith(source, expect.stringMatching(/^skill-update-/)));
    expect(await screen.findByText("有可用更新。")).toBeTruthy();
    expect(updateButton.disabled).toBe(false);
    fireEvent.click(updateButton);

    await waitFor(() => expect(installSkillSource).toHaveBeenCalledWith(source));
    expect(await screen.findByText("更新完成。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    expect(screen.getByText("v2.0.0")).toBeTruthy();
    expect(onInstallationChange).toHaveBeenCalledOnce();
    expect(onAvailabilityChange).toHaveBeenCalledOnce();
  });

  it("does not mislabel an inaccessible valid Git source as an invalid URL", async () => {
    const locator = "https://github.com/example/private-skills.git";
    const gitInstalled: InstalledSkillView = {
      ...installedSkill,
      sourcePath: locator,
      sourceType: "git",
      sourceLocator: locator,
      sourcePackageRef: "."
    };
    renderPage({
      listInstalledSkills: async () => [gitInstalled],
      inspectSkillSource: vi.fn().mockRejectedValue(new Error(
        "Error invoking remote method 'skill-source:inspect': SkillSourceError: Git 仓库需要登录或当前账号无权访问。"
      )),
      installSkillSource: vi.fn()
    });

    await screen.findByRole("heading", { name: "Demo Skill" });
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText(/更新失败：Git 仓库需要登录或当前账号无权访问/)).toBeTruthy();
    expect(screen.queryByText(/来源输入不合法/)).toBeNull();
  });

  it("surfaces an unusable installed package without relying on lifecycle labels", async () => {
    renderPage({ listInstalledSkills: async () => [{ ...installedSkill, usable: false, enabled: false }] });

    expect((await screen.findAllByText("包体异常")).length).toBeGreaterThanOrEqual(1);
    const toggle = screen.getByRole("switch", { name: "启用 Demo Skill 的后续使用" }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(false);
    expect(screen.queryByText("installed-not-ready")).toBeNull();
    expect(screen.queryByText("quarantined")).toBeNull();
  });

  it("updates only the selected installed record and stays busy until the blank-draft catalog refreshes", async () => {
    let resolveUpdate!: (value: InstalledSkillView) => void;
    let resolveRefresh!: () => void;
    const setInstalledSkillEnabled = vi.fn().mockReturnValue(new Promise<InstalledSkillView>((resolve) => { resolveUpdate = resolve; }));
    const onInstallationChange = vi.fn();
    const onAvailabilityChange = vi.fn().mockReturnValue(new Promise<void>((resolve) => { resolveRefresh = resolve; }));
    const catalogChanged = vi.fn();
    window.addEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, catalogChanged);
    renderPage({ setInstalledSkillEnabled }, undefined, false, onInstallationChange, onAvailabilityChange);

    const toggle = await screen.findByRole("switch", { name: "启用 Demo Skill 的后续使用" }) as HTMLButtonElement;
    fireEvent.click(toggle);

    await waitFor(() => expect(setInstalledSkillEnabled).toHaveBeenCalledWith(installedSkill.key, installedSkill.digest, false));
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("正在更新…")).toBeTruthy();

    resolveUpdate({ ...installedSkill, enabled: false });
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    expect(catalogChanged).toHaveBeenCalledOnce();
    expect(onAvailabilityChange).toHaveBeenCalledOnce();
    expect(toggle.disabled).toBe(true);
    resolveRefresh();
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(screen.getByText("已为后续会话和运行停用。")).toBeTruthy();
    expect(onInstallationChange).not.toHaveBeenCalled();
    window.removeEventListener(INSTALLED_SKILL_CATALOG_CHANGED_EVENT, catalogChanged);
  });

  it("keeps the previous state and reports an inline error when an availability update fails", async () => {
    const setInstalledSkillEnabled = vi.fn().mockRejectedValue(new Error("写入失败"));
    renderPage({ setInstalledSkillEnabled });

    const toggle = await screen.findByRole("switch", { name: "启用 Demo Skill 的后续使用" });
    fireEvent.click(toggle);

    expect((await screen.findByRole("alert")).textContent).toContain("更新 Skill 可用性失败：写入失败");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("shows an empty catalog when nothing is installed", async () => {
    renderPage({ listInstalledSkills: async () => [] });

    expect(await screen.findByText("还没有可管理的 Skill")).toBeTruthy();
    expect(screen.getAllByRole("switch")).toEqual([screen.getByRole("switch", { name: "准备内置 Skills" })]);
    expect(screen.queryByText("后续可用性")).toBeNull();
  });

  it("keeps the catalog focused on search instead of redundant status categories", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Demo Skill" });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();

    const search = screen.getByRole("searchbox", { name: "搜索 Skills" }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "Demo" } });
    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(search.value).toBe("");
  });

  it("removes every Skill management action from the page", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Demo Skill" });
    for (const name of [
      "刷新列表", "同步工作区 Skill", "打开来源目录",
      "撤销宿主机信任", "打开运行表单", "更新",
      "查看扫描结果", "信任并允许运行", "回滚"
    ]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("imports a Git source through inspect → confirm → install", async () => {
    const source = { type: "git" as const, locator: "https://github.com/example/skill.git" };
    const gitInspection: SkillPackageInspectionView = { ...inspection, sourcePath: source.locator, sourceKind: "git", packageRef: "." };
    const installSkillSource = vi.fn().mockResolvedValue([installedSkill]);
    const onInstallationChange = vi.fn();
    const onAvailabilityChange = vi.fn();
    renderPage({
      inspectSkillSource: vi.fn().mockResolvedValue({ source, packages: [gitInspection] }),
      installSkillSource
    }, undefined, false, onInstallationChange, onAvailabilityChange);
    await screen.findByRole("heading", { name: "Demo Skill" });

    fireEvent.click(screen.getByRole("button", { name: "添加其他来源" }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/skill.git"), { target: { value: "https://github.com/example/skill.git" } });
    fireEvent.click(screen.getByRole("button", { name: "检查 Git 来源" }));
    expect(await screen.findByText("静态检查通过")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "安装" }));
    await waitFor(() => expect(installSkillSource).toHaveBeenCalledWith(source, ["."]));
    await waitFor(() => expect(onInstallationChange).toHaveBeenCalledTimes(1));
    expect(onAvailabilityChange).toHaveBeenCalledTimes(1);
  });

  it("opens the import entry when reached from onboarding", async () => {
    renderPage({ inspectSkillSource: vi.fn(), installSkillSource: vi.fn() }, undefined, true);
    const dialog = await screen.findByRole("dialog", { name: "添加 Skill 来源" });
    expect(within(dialog).getByPlaceholderText("https://github.com/org/skill.git")).toBeTruthy();
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    expect(cancel).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "检查 Git 来源" })).toBeTruthy();

    fireEvent.click(cancel);
    await waitFor(() => expect(document.querySelector("[data-ui-dialog]")?.getAttribute("data-leaving")).toBe("true"));
    expect(document.querySelector("[data-ui-dialog]")?.hasAttribute("inert")).toBe(true);
    await waitFor(() => expect(document.querySelector("[data-ui-dialog]")).toBeNull());
  });

  it("inspects a local directory or ZIP before enabling install", async () => {
    const source = { type: "zip" as const, locator: "/tmp/demo.zip" };
    const zipInspection = { ...inspection, sourcePath: source.locator, sourceKind: "zip" as const, packageRef: ".", warnings: ["包含可选文件"] };
    const inspectSkillSource = vi.fn().mockResolvedValue({ source, packages: [zipInspection] });
    const installSkillSource = vi.fn().mockResolvedValue([installedSkill]);
    renderPage({ selectSkillPackageSource: vi.fn().mockResolvedValue(source), inspectSkillSource, installSkillSource });
    await screen.findByRole("heading", { name: "Demo Skill" });
    fireEvent.click(screen.getByRole("button", { name: "添加其他来源" }));
    fireEvent.click(screen.getByRole("button", { name: "选择本地目录或 ZIP" }));
    await waitFor(() => expect(inspectSkillSource).toHaveBeenCalledWith(source, expect.any(String)));
    expect(screen.getByText("包含可选文件")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "安装" }));
    await waitFor(() => expect(installSkillSource).toHaveBeenCalledWith(source));
  });

  it("rejects non-HTTPS Git addresses in the renderer", async () => {
    const inspectSkillSource = vi.fn();
    renderPage({ inspectSkillSource, installSkillSource: vi.fn() });
    await screen.findByRole("heading", { name: "Demo Skill" });
    fireEvent.click(screen.getByRole("button", { name: "添加其他来源" }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/skill.git"), { target: { value: "http://example.com/skill.git" } });
    fireEvent.click(screen.getByRole("button", { name: "检查 Git 来源" }));
    expect(await screen.findByText(/来源输入不合法/)).toBeTruthy();
    expect(inspectSkillSource).not.toHaveBeenCalled();
  });

  it("cancels an in-flight Git inspection", async () => {
    let release!: (value: SkillSourceInspectionView) => void;
    const inspectSkillSource = vi.fn().mockReturnValue(new Promise<SkillSourceInspectionView>((resolve) => { release = resolve; }));
    const cancelSkillSourceInspection = vi.fn().mockResolvedValue(true);
    renderPage({ inspectSkillSource, cancelSkillSourceInspection, installSkillSource: vi.fn() });
    await screen.findByRole("heading", { name: "Demo Skill" });
    fireEvent.click(screen.getByRole("button", { name: "添加其他来源" }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/skill.git"), { target: { value: "https://github.com/example/skill.git" } });
    fireEvent.click(screen.getByRole("button", { name: "检查 Git 来源" }));
    expect(await screen.findByRole("button", { name: "取消检查" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消检查" }));
    await waitFor(() => expect(cancelSkillSourceInspection).toHaveBeenCalledWith(expect.any(String)));
    release({ source: { type: "git", locator: "https://github.com/example/skill.git" }, packages: [{ ...inspection, packageRef: "." }] });
  });

  it("selects all packages from a Git repository by default and installs only checked packages", async () => {
    const source = { type: "git" as const, locator: "https://github.com/example/cctools-skills.git" };
    const packages: SkillPackageInspectionView[] = [
      { ...inspection, sourcePath: source.locator, sourceKind: "git", packageRef: "one", manifest: { ...manifest, id: "one", display: { ...manifest.display, name: "Skill One" } } },
      { ...inspection, sourcePath: source.locator, sourceKind: "git", packageRef: "two", digest: "b".repeat(64), manifest: { ...manifest, id: "two", display: { ...manifest.display, name: "Skill Two" } } }
    ];
    const installSkillSource = vi.fn().mockResolvedValue([installedSkill]);
    renderPage({ inspectSkillSource: vi.fn().mockResolvedValue({ source, packages }), installSkillSource });
    await screen.findByRole("heading", { name: "Demo Skill" });
    fireEvent.click(screen.getByRole("button", { name: "添加其他来源" }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/skill.git"), { target: { value: source.locator } });
    fireEvent.click(screen.getByRole("button", { name: "检查 Git 来源" }));

    const first = await screen.findByRole("checkbox", { name: "选择 Skill One" }) as HTMLInputElement;
    const second = screen.getByRole("checkbox", { name: "选择 Skill Two" }) as HTMLInputElement;
    expect(first.checked).toBe(true);
    expect(second.checked).toBe(true);
    fireEvent.click(second);
    fireEvent.click(screen.getByRole("button", { name: "安装" }));
    await waitFor(() => expect(installSkillSource).toHaveBeenCalledWith(source, ["one"]));
  });

  it("groups installed Git Skills by repository", async () => {
    const locator = "https://github.com/example/cctools-skills.git";
    const gitOne: InstalledSkillView = { ...installedSkill, sourceType: "git", sourceLocator: locator, sourcePath: locator };
    const gitTwo: InstalledSkillView = { ...installedSkill, key: "local/other", id: "other", digest: "b".repeat(64), sourceType: "git", sourceLocator: locator, sourcePath: locator };
    renderPage({ listInstalledSkills: async () => [gitOne, gitTwo] });

    const repository = await screen.findByRole("button", { name: "收起 cctools-skills" });
    expect(repository.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText(locator).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(repository);
    expect(repository.getAttribute("aria-expanded")).toBe("false");
  });

  it("hides the source picker when the environment has no import API", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Demo Skill" });
    expect(screen.queryByRole("button", { name: "添加其他来源" })).toBeNull();
  });

  it("supports keyboard navigation and switches run history with the selection", async () => {
    const otherInstalled: InstalledSkillView = {
      ...installedSkill,
      key: "local/other-skill",
      id: "other-skill",
      digest: "b".repeat(64),
      sourcePath: "/workspace/.agent/skills/other-skill"
    };
    const otherRun = BrokerRunRecordSchema.parse({
      ...demoRun,
      id: "other-run-1",
      request: { ...demoRun.request, skillId: "other-skill" },
      state: "failed",
      terminalState: "failed"
    });
    renderPage({
      inspectInstalledSkill: async (key: string) => (key === "local/other-skill" ? null : inspection),
      listInstalledSkills: async () => [installedSkill, otherInstalled],
      listSkillRuns: async () => [demoRun, otherRun]
    });
    const demoButton = await screen.findByRole("button", { name: /Demo Skill/ });
    const firstDetail = document.querySelector<HTMLElement>(".skills-detail-content");
    expect(firstDetail?.dataset.skillDetailId).toContain("local/demo-skill");
    fireEvent.keyDown(demoButton, { key: "ArrowDown" });
    const nextDetail = document.querySelector<HTMLElement>(".skills-detail-content");
    expect(nextDetail).not.toBe(firstDetail);
    expect(nextDetail?.dataset.skillDetailId).toContain("local/other-skill");
    expect(screen.getByText("other-run-1", { exact: false })).toBeTruthy();
    expect(screen.queryByText("demo-run-1", { exact: false })).toBeNull();
  });
});
