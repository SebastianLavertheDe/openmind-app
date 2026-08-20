import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, InstalledSkillView, SkillDefinition, SkillPackageInspectionView, SkillSourceInspectionView } from "@shared/contracts";
import { BrokerRunRecordSchema, EXECUTION_SCHEMA_VERSION } from "@shared/execution-contracts";
import { SkillsPage } from "./SkillsPage";
import { INSTALLED_SKILL_CATALOG_CHANGED_EVENT } from "../../installed-skill-events";

const digest = "a".repeat(64);
const sourcePath = "/workspace/.claude/skills/demo-skill";
const manifest = {
  apiVersion: "cctools.dev/skill/v1",
  id: "demo-skill",
  version: "1.2.0",
  kind: "process",
  publisher: { id: "local", displayName: "本地团队" },
  display: { name: "Demo Skill", description: "用于验证 Skill Center 的示例包。", group: "测试" },
  config: { date: { type: "string", required: true } },
  capabilities: { mymind: { read: ["article/**"], write: ["daily-summary/**"] }, network: { required: false, hosts: [] }, browser: false, subprocess: { allowed: false } }
};

const inspection: SkillPackageInspectionView = {
  sourcePath,
  sourceKind: "directory",
  valid: true,
  digest,
  totalBytes: 2048,
  files: [{ path: "cctools.skill.yaml", type: "file", size: 1024, digest: "manifest" }],
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
const demoRun = BrokerRunRecordSchema.parse({
  schemaVersion: EXECUTION_SCHEMA_VERSION,
  id: "demo-run-1",
  request: { skillId: "demo-skill", trigger: { type: "manual" }, providerBindingIds: [], externalExportBindingIds: [], inputKeys: [] },
  state: "succeeded",
  sequence: 1,
  rootGeneration: 1,
  skillDigest: digest,
  runtime: null,
  createdAt: "2026-08-09T08:00:00.000Z",
  startedAt: "2026-08-09T08:00:01.000Z",
  completedAt: "2026-08-09T08:00:02.000Z",
  terminalState: "succeeded",
  error: null,
  processPid: null,
  orphanPid: null,
  artifacts: []
});
function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    inspectSkillWorkspace: async () => [inspection],
    listInstalledSkills: async () => [installedSkill],
    setInstalledSkillEnabled: async (_key: string, _digest: string, enabled: boolean) => ({ ...installedSkill, enabled }),
    listSkillRuns: async () => [demoRun],
    onAiEvent: () => () => undefined,
    ...overrides
  } as unknown as DesktopApi;
}

function renderPage(overrides: Partial<DesktopApi> = {}, initialSkillId?: string, initialSourcePickerOpen = false, onInstallationChange?: () => void | Promise<void>, onAvailabilityChange?: () => void | Promise<void>) {
  window.cctools = makeApi(overrides);
  render(<SkillsPage skills={skills} initialSkillId={initialSkillId} initialSourcePickerOpen={initialSourcePickerOpen} onInstallationChange={onInstallationChange} onAvailabilityChange={onAvailabilityChange} />);
}

beforeEach(() => {
  window.cctools = makeApi();
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

  it("does not show an availability switch for a workspace-only Skill", async () => {
    renderPage({ listInstalledSkills: async () => [] });

    expect(await screen.findByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
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
    await screen.findByRole("heading", { name: "Demo Skill" });
    expect(screen.getByRole("button", { name: "收起来源选择" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByPlaceholderText("https://github.com/org/skill.git")).toBeTruthy();
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

  it("groups installed Git Skills by repository and keeps workspace-only Skills ungrouped", async () => {
    const locator = "https://github.com/example/cctools-skills.git";
    const gitOne: InstalledSkillView = { ...installedSkill, sourceType: "git", sourceLocator: locator, sourcePath: locator };
    const gitTwo: InstalledSkillView = { ...installedSkill, key: "local/other", id: "other", digest: "b".repeat(64), sourceType: "git", sourceLocator: locator, sourcePath: locator };
    const workspaceOnly: SkillPackageInspectionView = {
      ...inspection,
      sourcePath: "/workspace/.claude/skills/workspace-only",
      digest: "c".repeat(64),
      manifest: { ...manifest, id: "workspace-only", display: { ...manifest.display, name: "Workspace Only" } }
    };
    renderPage({ inspectSkillWorkspace: async () => [workspaceOnly], listInstalledSkills: async () => [gitOne, gitTwo] });

    const repository = await screen.findByRole("button", { name: "收起 cctools-skills" });
    expect(repository.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText(locator).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /Workspace Only/ })).toBeTruthy();
    fireEvent.click(repository);
    expect(repository.getAttribute("aria-expanded")).toBe("false");
  });

  it("hides the source picker when the environment has no import API", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Demo Skill" });
    expect(screen.queryByRole("button", { name: "添加其他来源" })).toBeNull();
  });

  it("supports keyboard navigation and switches run history with the selection", async () => {
    const otherInspection: SkillPackageInspectionView = {
      ...inspection,
      sourcePath: "/workspace/.claude/skills/other-skill",
      digest: "b".repeat(64),
      manifest: { ...manifest, id: "other-skill", display: { ...manifest.display, name: "Other Skill" } }
    };
    const otherRun = BrokerRunRecordSchema.parse({
      ...demoRun,
      id: "other-run-1",
      request: { ...demoRun.request, skillId: "other-skill" },
      state: "failed",
      terminalState: "failed"
    });
    renderPage({ inspectSkillWorkspace: async () => [inspection, otherInspection], listSkillRuns: async () => [demoRun, otherRun] });
    const demoButton = await screen.findByRole("button", { name: /Demo Skill/ });
    fireEvent.keyDown(demoButton, { key: "ArrowDown" });
    expect(screen.getByText("other-run-1", { exact: false })).toBeTruthy();
    expect(screen.queryByText("demo-run-1", { exact: false })).toBeNull();
  });

  it("merges installed and workspace versions of the same Skill into one row", async () => {
    const changedWorkspaceInspection: SkillPackageInspectionView = {
      ...inspection,
      digest: "b".repeat(64),
      manifest: { ...manifest, version: "1.3.0" }
    };
    renderPage({ inspectSkillWorkspace: async () => [changedWorkspaceInspection] });

    await screen.findByRole("heading", { name: "Demo Skill" });
    expect(document.querySelectorAll(".skills-list-item")).toHaveLength(1);
    expect(screen.getByText("已安装 · 工作区已关联")).toBeTruthy();
  });
});
