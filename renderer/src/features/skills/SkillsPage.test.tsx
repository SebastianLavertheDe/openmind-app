import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  executionTrust: "inspect-only",
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

function renderPage(overrides: Partial<DesktopApi> = {}, initialSkillId?: string) {
  window.cctools = makeApi(overrides);
  render(<SkillsPage skills={skills} initialSkillId={initialSkillId} />);
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
    expect(screen.getAllByText("没有匹配的 Skill")).toHaveLength(2);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "Demo" } });
    expect(screen.getByRole("heading", { name: "Demo Skill" })).toBeTruthy();
  });

  it("removes every Skill management action from the page", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Demo Skill" });
    for (const name of [
      "刷新列表", "添加其他来源", "同步工作区 Skill", "打开来源目录",
      "撤销宿主机信任", "打开运行表单", "更新", "导入到 quarantine",
      "查看扫描结果", "信任并允许运行", "回滚", "卸载候选版本"
    ]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("switches run history when another Skill is selected", async () => {
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
    const otherButton = await screen.findByRole("button", { name: /Other Skill/ });
    fireEvent.click(otherButton);
    expect(screen.getByText("other-run-1", { exact: false })).toBeTruthy();
    expect(screen.queryByText("demo-run-1", { exact: false })).toBeNull();
  });
});
