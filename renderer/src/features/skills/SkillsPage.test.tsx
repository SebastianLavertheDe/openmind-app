import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi, InstalledSkillView, SkillDefinition, SkillPackageInspectionView } from "@shared/contracts";
import type { SkillManifest } from "@shared/skill-manifest-schema";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { SkillsPage } from "./SkillsPage";
import { SkillRunForm } from "./SkillRunForm";

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

const snapshot: AiSnapshot = { projectRoot: "/workspace", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const skills: SkillDefinition[] = [{ id: "legacy-demo", title: "旧版 Demo", description: "旧发现链能力", cwd: sourcePath, command: "python", group: "测试" }];
const runManifest = {
  ...manifest,
  kind: "process",
  inputs: { type: "object", required: ["date"], properties: { date: { type: "string", format: "compact-date", description: "本次运行日期" } } },
  config: { provider: { type: "provider-profile", required: true, description: "运行时 Provider" } },
  artifacts: [],
  execution: { concurrency: { maxInstances: 1, mutexes: [] }, timeoutSeconds: 60, gracefulStopSeconds: 5, retry: { maxAttempts: 0 } },
  platforms: ["windows-x64"],
  compatibility: { minAppVersion: "1.0.0" },
  entrypoint: { runtime: "python", script: "main.py", args: [] },
  runtime: { version: ">=3.11", dependencyFile: "pyproject.toml", packs: [] }
} as unknown as SkillManifest;

const exportRunManifest = {
  ...runManifest,
  artifacts: [{ id: "video", type: "file", externalExportId: "videoExportDir" }]
} as unknown as SkillManifest;

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    inspectSkillWorkspace: async () => [inspection],
    listInstalledSkills: async () => [active],
    migrateSkillWorkspace: async () => ({ inspected: [inspection], installed: [active], skipped: [] }),
    installSkillPackage: vi.fn().mockResolvedValue(active),
    updateSkillPackage: vi.fn().mockResolvedValue(active),
    rollbackSkillPackage: vi.fn().mockResolvedValue({ active, previous: { ...active, status: "previous" } }),
    uninstallSkillPackage: vi.fn().mockResolvedValue(true),
    approveInstalledSkillHost: vi.fn().mockResolvedValue({ ...active, executionTrust: "approved-host" }),
    revokeInstalledSkillHost: vi.fn().mockResolvedValue(active),
    openPath: vi.fn().mockResolvedValue(""),
    onAiEvent: () => () => undefined,
    ...overrides
  } as unknown as DesktopApi;
}

function renderPage(overrides: Partial<DesktopApi> = {}, initialSkillId?: string) {
  window.cctools = makeApi(overrides);
  render(<AiProvider initial={snapshot}><SkillsPage skills={skills} initialSkillId={initialSkillId} go={vi.fn()} /><FeedbackHost /></AiProvider>);
}

beforeEach(() => {
  window.cctools = makeApi();
});

afterEach(() => cleanup());

describe("SkillsPage", () => {
  it("loads installed and workspace packages with searchable status filters", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    expect(screen.getByText((_, node) => node?.tagName === "SMALL" && node.textContent?.includes("demo-skill") && node.textContent.includes("1.2.0"))).toBeTruthy();
    expect(screen.getAllByText("active · ready")).toHaveLength(2);
    expect(screen.getByText("本地团队")).toBeTruthy();
    expect(screen.getByText("配置字段")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "不存在" } });
    expect(screen.getAllByText("没有匹配的 Skill")).toHaveLength(2);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), { target: { value: "Demo" } });
    expect(screen.getByRole("heading", { name: "Demo Skill" })).toBeTruthy();
  });

  it("renders signature, review, host trust, and update policy as independent states", async () => {
    renderPage({
      listInstalledSkills: async () => [{
        ...active,
        signatureStatus: "invalid",
        reviewStatus: "automated-scan",
        executionTrust: "inspect-only",
        skillUpdatePolicy: "download-only"
      }]
    });

    await screen.findByRole("heading", { name: "Demo Skill" });
    expect(screen.getByText("directory")).toBeTruthy();
    expect(screen.getByText("invalid")).toBeTruthy();
    expect(screen.getByText("automated-scan")).toBeTruthy();
    expect(screen.getByText(/更新策略：download-only/)).toBeTruthy();
    expect(screen.getByText(/宿主机授权/)).toBeTruthy();
  });

  it("shows the capability diff before a candidate version can be trusted", async () => {
    const candidateDigest = "b".repeat(64);
    const candidate: InstalledSkillView = {
      ...active,
      version: "2.0.0",
      digest: candidateDigest,
      packagePath: "/userData/skills/local/demo-skill/2.0.0-bbbbbbbb",
      status: "quarantined",
      readiness: "installed-not-ready"
    };
    const candidateInspection: SkillPackageInspectionView = {
      ...inspection,
      digest: candidateDigest,
      manifest: {
        ...manifest,
        version: "2.0.0",
        capabilities: { ...manifest.capabilities, browser: true, mymind: { ...manifest.capabilities.mymind, write: ["daily-summary/**"] } }
      }
    };
    renderPage({
      listInstalledSkills: async () => [active, candidate],
      inspectInstalledSkill: async (_key: string, digest?: string) => digest === candidateDigest ? candidateInspection : inspection
    });

    const packageButtons = await screen.findAllByRole("button", { name: /Demo Skill/ });
    fireEvent.click(packageButtons[1]);
    expect(await screen.findByRole("heading", { name: "更新权限 diff" })).toBeTruthy();
    expect(screen.getByText(/新增：/)).toBeTruthy();
    expect(screen.getByText(/不会继承原版本的宿主机授权/)).toBeTruthy();
  });

  it("requires explicit host trust confirmation before approving an active digest", async () => {
    const approveInstalledSkillHost = vi.fn().mockResolvedValue({ ...active, executionTrust: "approved-host" });
    renderPage({ approveInstalledSkillHost });
    fireEvent.click(await screen.findByRole("button", { name: "信任并允许运行" }));

    const dialog = await screen.findByRole("alertdialog", { name: "信任并运行 Skill" });
    expect(dialog.textContent).toContain("当前用户权限");
    expect(dialog.textContent).toContain("真实 entrypoint");
    expect(dialog.textContent).toContain("声明能力");
    expect(dialog.textContent).toContain("Secret binding");
    expect(approveInstalledSkillHost).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "信任并运行" }));
    await waitFor(() => expect(approveInstalledSkillHost).toHaveBeenCalledWith(active.key, active.digest));
  });

  it("imports a valid workspace package into quarantine and refreshes", async () => {
    const installSkillPackage = vi.fn().mockResolvedValue({ ...active, status: "quarantined", readiness: "installed-not-ready" });
    const listInstalledSkills = vi.fn().mockResolvedValue([]);
    renderPage({ listInstalledSkills, installSkillPackage });
    expect(await screen.findByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Workspace 来源" }));
    fireEvent.click(screen.getByRole("button", { name: "导入到 quarantine" }));
    await waitFor(() => expect(installSkillPackage).toHaveBeenCalledWith(sourcePath));
  });

  it("renders the Manifest schema and submits a safe manual Skill Run request", async () => {
    const startSkillRun = vi.fn().mockResolvedValue({ id: "run-1" });
    window.cctools = makeApi({
      listProviderProfiles: async () => [{ schemaVersion: 1, id: "profile-1", name: "本地 Provider", protocol: "provider-native", credentialId: null, baseUrl: "", model: "model", timeoutMs: 120000, maxRetries: 2, proxyPolicy: "system", tlsPolicy: "verify", fallbackProfileId: null, test: { status: "success", testedAt: "2026-08-06T00:00:00.000Z", diagnostic: "ok" } }],
      listExportLocations: async () => [],
      getMymindRoot: async () => ({ mymindRoot: "/workspace/mymind", workspaceRoot: "/workspace", health: { configured: true, accessible: true, readable: true, writable: true, missingInitializeEntries: [], missingCreateIfNeededEntries: [], optionalObservedEntries: [], unknownPreservedEntries: [], symlinkWarnings: [], activeRunCount: 0, warnings: [] }, snapshot: { rootPath: "/workspace/mymind", rootId: "root", rootGeneration: 7 } }),
      startSkillRun
    });
    render(<SkillRunForm record={active} manifest={runManifest} onCancel={vi.fn()} onStarted={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "date" }), { target: { value: "20260806" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider Profile provider" }), { target: { value: "profile-1" } });
    fireEvent.click(screen.getByRole("button", { name: "启动 Run" }));
    await waitFor(() => expect(startSkillRun).toHaveBeenCalledWith(expect.objectContaining({ skillId: active.id, version: active.version, digest: active.digest, inputs: { date: "20260806" }, providerBindings: { provider: "profile-1" }, trigger: { type: "manual" }, externalExportBindingIds: [], rootGeneration: 7 })));
  });

  it("creates, revokes, and Relinks a stable external Export Location binding", async () => {
    const binding = { schemaVersion: 1, id: "videoExportDir", label: "视频导出", canonicalPath: "/tmp/video-export", createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z", revoked: false };
    const selectExportLocation = vi.fn()
      .mockResolvedValueOnce(binding)
      .mockResolvedValueOnce({ ...binding, canonicalPath: "/tmp/video-export-new", updatedAt: "2026-08-06T00:01:00.000Z" });
    const revokeExportLocation = vi.fn().mockResolvedValue(true);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    window.cctools = makeApi({
      listProviderProfiles: async () => [],
      listExportLocations: async () => [],
      selectExportLocation,
      revokeExportLocation,
      getMymindRoot: async () => ({ mymindRoot: "/workspace/mymind", workspaceRoot: "/workspace", health: { configured: true, accessible: true, readable: true, writable: true, missingInitializeEntries: [], missingCreateIfNeededEntries: [], optionalObservedEntries: [], unknownPreservedEntries: [], symlinkWarnings: [], activeRunCount: 0, warnings: [] }, snapshot: { rootPath: "/workspace/mymind", rootId: "root", rootGeneration: 7 } })
    });
    render(<SkillRunForm record={active} manifest={exportRunManifest} onCancel={vi.fn()} onStarted={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "选择目录 videoExportDir" }));
    await waitFor(() => expect(selectExportLocation).toHaveBeenCalledWith("videoExportDir", "videoExportDir"));
    expect(screen.getByText(/视频导出/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "撤销 videoExportDir" }));
    await waitFor(() => expect(revokeExportLocation).toHaveBeenCalledWith("videoExportDir"));
    expect(screen.getByText(/已撤销/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新绑定 videoExportDir" }));
    await waitFor(() => expect(selectExportLocation).toHaveBeenCalledTimes(2));
    expect(selectExportLocation).toHaveBeenLastCalledWith("视频导出", "videoExportDir");
    confirmSpy.mockRestore();
  });
});
