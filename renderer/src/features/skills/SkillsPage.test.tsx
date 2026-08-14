import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, InstalledSkillView, SkillDefinition, SkillPackageInspectionView } from "@shared/contracts";
import { BrokerRunRecordSchema, EXECUTION_SCHEMA_VERSION } from "@shared/execution-contracts";
import { SkillsPage } from "./SkillsPage";

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

const active: InstalledSkillView = {
  schemaVersion: 1,
  key: "local/demo-skill",
  id: "demo-skill",
  publisherId: "local",
  version: "1.2.0",
  digest,
  sourcePath,
  packagePath: "/userData/skills/local/demo-skill/1.2.0-aaaaaaaaaaaaaaaa",
  status: "active",
  readiness: "ready",
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
    listInstalledSkills: async () => [active],
    listSkillRuns: async () => [demoRun],
    onAiEvent: () => () => undefined,
    ...overrides
  } as unknown as DesktopApi;
}

function renderPage(overrides: Partial<DesktopApi> = {}, initialSkillId?: string, initialSourcePickerOpen = false) {
  window.cctools = makeApi(overrides);
  render(<SkillsPage skills={skills} initialSkillId={initialSkillId} initialSourcePickerOpen={initialSourcePickerOpen} />);
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

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的 Skill")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "Demo" } });
    expect(screen.getByRole("heading", { name: "Demo Skill" })).toBeTruthy();
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
      "撤销宿主机信任", "打开运行表单", "更新", "导入到 quarantine",
      "查看扫描结果", "信任并允许运行", "回滚", "卸载候选版本"
    ]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("imports a Git source through inspect → confirm → install", async () => {
    const gitInspection: SkillPackageInspectionView = { ...inspection, sourcePath: "https://github.com/example/skill.git", sourceKind: "git" };
    const installSkillSource = vi.fn().mockResolvedValue(active);
    renderPage({
      inspectSkillSource: vi.fn().mockResolvedValue(gitInspection),
      installSkillSource
    });
    await screen.findByRole("heading", { name: "Demo Skill" });

    fireEvent.click(screen.getByRole("button", { name: "添加其他来源" }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/skill.git"), { target: { value: "https://github.com/example/skill.git" } });
    fireEvent.click(screen.getByRole("button", { name: "检查 Git 来源" }));
    expect(await screen.findByText("静态检查通过")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "安装" }));
    await waitFor(() => expect(installSkillSource).toHaveBeenCalledWith({
      type: "git",
      locator: "https://github.com/example/skill.git"
    }));
  });

  it("opens the import entry when reached from onboarding", async () => {
    renderPage({ inspectSkillSource: vi.fn(), installSkillSource: vi.fn() }, undefined, true);
    await screen.findByRole("heading", { name: "Demo Skill" });
    expect(screen.getByRole("button", { name: "收起来源选择" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByPlaceholderText("https://github.com/org/skill.git")).toBeTruthy();
  });

  it("inspects a local directory or ZIP before enabling install", async () => {
    const source = { type: "zip" as const, locator: "/tmp/demo.zip" };
    const inspectSkillSource = vi.fn().mockResolvedValue({ ...inspection, sourcePath: source.locator, sourceKind: "zip" as const, warnings: ["包含可选文件"] });
    const installSkillSource = vi.fn().mockResolvedValue(active);
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
    let release!: (value: SkillPackageInspectionView) => void;
    const inspectSkillSource = vi.fn().mockReturnValue(new Promise<SkillPackageInspectionView>((resolve) => { release = resolve; }));
    const cancelSkillSourceInspection = vi.fn().mockResolvedValue(true);
    renderPage({ inspectSkillSource, cancelSkillSourceInspection, installSkillSource: vi.fn() });
    await screen.findByRole("heading", { name: "Demo Skill" });
    fireEvent.click(screen.getByRole("button", { name: "添加其他来源" }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/skill.git"), { target: { value: "https://github.com/example/skill.git" } });
    fireEvent.click(screen.getByRole("button", { name: "检查 Git 来源" }));
    expect(await screen.findByRole("button", { name: "取消检查" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消检查" }));
    await waitFor(() => expect(cancelSkillSourceInspection).toHaveBeenCalledWith(expect.any(String)));
    release(inspection);
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
