import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, AppBootstrap, DesktopApi, InstalledSkillView, MymindRootStatus } from "@shared/contracts";
import { CCTOOLS_SKILLS_REPO_URL } from "@shared/skill-package-sources";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { OnboardingPage } from "./OnboardingPage";

const snapshot: AiSnapshot = { projectRoot: "", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const bootstrap: AppBootstrap = { repoRoot: "", mymindRoot: "", workspaceRoot: "", validRepo: false, skillsInstalled: false, runtime: "linux", environment: { mode: "desktop", platform: "linux" }, overview: {} as AppBootstrap["overview"], skills: [], ai: snapshot };

const installedSkillRecord = (locator: string): InstalledSkillView => ({
  schemaVersion: 1,
  key: "cctools/rss-article-saver",
  id: "rss-article-saver",
  publisherId: "cctools",
  version: "1.0.0",
  digest: "deadbeef",
  sourcePath: locator,
  sourceType: "git",
  sourceLocator: locator,
  packagePath: "C:/skills/rss-article-saver",
  status: "active",
  readiness: "ready",
  signatureStatus: "unsigned",
  reviewStatus: "unreviewed",
  skillUpdatePolicy: "manual",
  installedAt: "2026-08-18T00:00:00.000Z"
});
const rootStatus = (ready = false): MymindRootStatus => ({ mymindRoot: ready ? "/workspace/mymind" : "", workspaceRoot: "", migration: { state: "not-needed", legacyStatePresent: false, markerPresent: false, copiedFileCount: 0, sourcePreserved: true }, health: { configured: ready, accessible: ready, readable: ready, writable: ready, missingInitializeEntries: [], missingCreateIfNeededEntries: [], optionalObservedEntries: [], unknownPreservedEntries: [], symlinkWarnings: [], activeRunCount: 0, warnings: [] }, snapshot: ready ? { rootPath: "/workspace/mymind", rootId: "root", rootGeneration: 1 } : null });

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.cctools = { getMymindRoot: vi.fn().mockResolvedValue(rootStatus()), selectMymindRoot: vi.fn().mockResolvedValue("/workspace/mymind"), setMymindRoot: vi.fn().mockResolvedValue("/workspace/mymind"), previewMymindRoot: vi.fn().mockResolvedValue({ candidate: "/workspace/mymind", canonicalRoot: "/workspace/mymind", health: rootStatus(true).health, canBind: true, blockingReasons: [] }), getBootstrap: vi.fn().mockResolvedValue({ ...bootstrap, validRepo: true, mymindRoot: "/workspace/mymind" }), onAiEvent: vi.fn(() => () => undefined), ...overrides } as unknown as DesktopApi;
}

afterEach(() => cleanup());

describe("OnboardingPage", () => {
  it("keeps the root choice explicit and refreshes after a successful selection", async () => {
    const onRefresh = vi.fn();
    installApi();
    render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={bootstrap} go={vi.fn()} onRefresh={onRefresh} /><FeedbackHost /></AiProvider>);
    expect(await screen.findByRole("heading", { name: "先准备本地工作台" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "选择 mymind 根目录" }));
    await waitFor(() => expect(window.cctools.selectMymindRoot).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole("alertdialog", { name: "确认绑定 mymind 根目录" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认绑定" }));
    await waitFor(() => expect(window.cctools.setMymindRoot).toHaveBeenCalledWith("/workspace/mymind"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("leaves the app skippable without a configured root", async () => {
    const go = vi.fn();
    installApi();
    render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={bootstrap} go={go} onRefresh={vi.fn()} /></AiProvider>);
    await screen.findByRole("heading", { name: "先准备本地工作台" });
    // Step order is enforced: the repo install button stays disabled until a
    // mymind root is selected.
    const install = screen.getByRole("button", { name: "一键安装 cctools-skills" });
    expect((install as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "打开导入入口" }));
    expect(go).toHaveBeenNthCalledWith(1, "skills", { openSkillImport: true });
  });

  it("requires the official cctools-skills repository before entering the app", async () => {
    const go = vi.fn();
    let onboardingState = { completed: false, skill: "pending" as const, provider: "pending" as const };
    const updateOnboardingState = vi.fn(async (patch: Partial<typeof onboardingState>) => {
      onboardingState = { ...onboardingState, ...patch };
      return onboardingState;
    });
    let installed: InstalledSkillView[] = [];
    const installSkillSource = vi.fn(async () => {
      installed = [installedSkillRecord(CCTOOLS_SKILLS_REPO_URL)];
      return installed;
    });
    installApi({
      getMymindRoot: vi.fn().mockResolvedValue(rootStatus(true)),
      getOnboardingState: vi.fn().mockImplementation(async () => onboardingState),
      updateOnboardingState,
      listInstalledSkills: vi.fn().mockImplementation(async () => installed),
      installSkillSource
    });
    const onRefresh = vi.fn();
    render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={{ ...bootstrap, mymindRoot: "/workspace/mymind" }} go={go} onRefresh={onRefresh} /></AiProvider>);
    await screen.findByRole("heading", { name: "先准备本地工作台" });
    const finish = screen.getByRole("button", { name: "进入工作台" });
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "稍后配置" }));
    await waitFor(() => expect(updateOnboardingState).toHaveBeenCalledWith({ provider: "skipped" }));
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "一键安装 cctools-skills" }));
    await waitFor(() => expect(installSkillSource).toHaveBeenCalledWith({ type: "git", locator: CCTOOLS_SKILLS_REPO_URL }));
    await waitFor(() => expect((finish as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(finish);
    await waitFor(() => expect(updateOnboardingState).toHaveBeenCalledWith({ completed: true }));
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(go).toHaveBeenCalledWith("ai");
  });
});
