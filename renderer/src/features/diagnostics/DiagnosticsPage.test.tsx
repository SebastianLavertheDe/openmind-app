import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, AppBootstrap, DesktopApi, MymindRootStatus } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { DiagnosticsPage } from "./DiagnosticsPage";

const snapshot: AiSnapshot = { projectRoot: "/workspace", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const bootstrap: AppBootstrap = { repoRoot: "/workspace", mymindRoot: "/workspace/mymind", workspaceRoot: "/workspace", validRepo: true, runtime: "desktop", environment: { mode: "desktop", platform: "linux" }, overview: {} as AppBootstrap["overview"], skills: [], ai: snapshot };

function root(overrides: Partial<MymindRootStatus["health"]> = {}): MymindRootStatus {
  return { mymindRoot: "/workspace/mymind", workspaceRoot: "/workspace", migration: { state: "not-needed", legacyStatePresent: false, markerPresent: false, copiedFileCount: 0, sourcePreserved: true }, health: { configured: true, accessible: true, readable: true, writable: true, missingInitializeEntries: [], missingCreateIfNeededEntries: [], optionalObservedEntries: [], unknownPreservedEntries: [], symlinkWarnings: [], activeRunCount: 0, warnings: [], ...overrides }, snapshot: { rootPath: "/workspace/mymind", rootId: "root", rootGeneration: 4 } };
}

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.cctools = {
    getMymindRoot: vi.fn().mockResolvedValue(root()),
    getEnvironmentDiagnostics: vi.fn().mockResolvedValue([{ id: "node", label: "Node.js", status: "ok", value: "v22", detail: null, path: null }]),
    listInstalledSkills: vi.fn().mockResolvedValue([]),
    listRuntimePacks: vi.fn().mockResolvedValue([]),
    listSkillRuns: vi.fn().mockResolvedValue([]),
    selectMymindRoot: vi.fn().mockResolvedValue("/workspace/mymind-2"),
    setMymindRoot: vi.fn().mockResolvedValue("/workspace/mymind-2"),
    previewMymindRoot: vi.fn().mockResolvedValue({ candidate: "/workspace/mymind-2", canonicalRoot: "/workspace/mymind-2", health: root().health, canBind: true, blockingReasons: [] }),
    rebuildContentIndex: vi.fn().mockResolvedValue({ schemaVersion: 1, indexedDates: ["20260806"], itemCount: 3, indexPath: "state/index.json", statePath: "state/state.json", rebuiltAt: "2026-08-06T00:00:00.000Z" }),
    onAiEvent: vi.fn(() => () => undefined),
    ...overrides
  } as unknown as DesktopApi;
}

function renderPage() {
  render(<AiProvider initial={snapshot}><DiagnosticsPage bootstrap={bootstrap} go={vi.fn()} /><FeedbackHost /></AiProvider>);
}

afterEach(() => cleanup());

describe("DiagnosticsPage", () => {
  it("surfaces root health, environment and repair actions", async () => {
    const rebuildContentIndex = vi.fn().mockResolvedValue({ schemaVersion: 1, indexedDates: ["20260806"], itemCount: 3, indexPath: "state/index.json", statePath: "state/state.json", rebuiltAt: "2026-08-06T00:00:00.000Z" });
    installApi({ rebuildContentIndex });
    renderPage();
    expect(await screen.findByRole("heading", { name: "内容根目录" })).toBeTruthy();
    expect(screen.getByText("可用")).toBeTruthy();
    expect(screen.getByText("Node.js")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重建内容索引" }));
    await waitFor(() => expect(rebuildContentIndex).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/3 条内容/)).toBeTruthy();
  });

  it("keeps root selection available when the configured root is unusable", async () => {
    const selectMymindRoot = vi.fn().mockResolvedValue("/workspace/new-mymind");
    installApi({ getMymindRoot: vi.fn().mockResolvedValue(root({ configured: false, accessible: false, readable: false, writable: false })), selectMymindRoot });
    renderPage();
    expect(await screen.findByText("不可用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "选择 mymind 根目录" }));
    await waitFor(() => expect(selectMymindRoot).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole("alertdialog", { name: "确认绑定 mymind 根目录" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认绑定" }));
  });

  it("exposes portable app-state backup without implying Secret export", async () => {
    const exportAppStateBackup = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      kind: "cctools-app-state-backup",
      operation: "export",
      createdAt: "2026-08-06T00:00:00.000Z",
      fileCount: 4,
      byteCount: 4096,
      excludedAreas: ["credentials/**"]
    });
    installApi({ exportAppStateBackup });
    renderPage();
    expect(await screen.findByRole("heading", { name: "应用状态备份" })).toBeTruthy();
    expect(screen.getByText("不含 Secret")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "备份应用状态" }));
    await waitFor(() => expect(exportAppStateBackup).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/已导出 4 个文件/)).toBeTruthy();
  });

  it("shows a retryable legacy state migration without exposing paths", async () => {
    installApi({ getMymindRoot: vi.fn().mockResolvedValue(root()), });
    window.cctools.getMymindRoot = vi.fn().mockResolvedValue({ ...root(), migration: { state: "pending", legacyStatePresent: true, markerPresent: false, copiedFileCount: 0, sourcePreserved: true } });
    renderPage();
    expect(await screen.findByText("旧状态待迁移")).toBeTruthy();
    expect(screen.getByText(/\.cctools/)).toBeTruthy();
  });

  it("previews an explicit content relocation before switching the root", async () => {
    const selectMymindRelocationTarget = vi.fn().mockResolvedValue("/workspace/mymind-next");
    const previewMymindRelocation = vi.fn().mockResolvedValue({ schemaVersion: 1, sourceDirectory: "/workspace/mymind", targetDirectory: "/workspace/mymind-next", sourceRootId: "source", sourceFileCount: 2, sourceDirectoryCount: 1, sourceBytes: 2048, sourceDigest: "tree", targetState: "empty", targetFileCount: 0, targetDirectoryCount: 0, targetBytes: 0, pendingTransaction: false, canCommit: true, blockingReasons: [] });
    const relocateMymind = vi.fn().mockResolvedValue({ schemaVersion: 1, status: "committed", sourceDirectory: "/workspace/mymind", targetDirectory: "/workspace/mymind-next", sourceRootId: "source", targetRootId: "target", copiedFileCount: 2, copiedDirectoryCount: 1, copiedBytes: 2048, treeDigest: "tree", sourcePreserved: true, verified: true, completedAt: "2026-08-06T00:00:00.000Z" });
    installApi({ selectMymindRelocationTarget, previewMymindRelocation, relocateMymind });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "搬迁内容到新目录" }));
    await waitFor(() => expect(previewMymindRelocation).toHaveBeenCalledWith("/workspace/mymind-next"));
    const dialog = await screen.findByRole("alertdialog", { name: "确认搬迁 mymind 内容" });
    fireEvent.click(within(dialog).getByRole("button", { name: "复制并切换根目录" }));
    await waitFor(() => expect(relocateMymind).toHaveBeenCalledWith("/workspace/mymind-next"));
    expect(await screen.findByText(/已校验并搬迁 2 个文件/)).toBeTruthy();
  });
});
