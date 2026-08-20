import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, AppBootstrap, DesktopApi, MymindRootStatus } from "@shared/contracts";
import { CCTOOLS_SKILLS_REPO_URL } from "@shared/skill-package-sources";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { OnboardingPage } from "./OnboardingPage";

const snapshot: AiSnapshot = { projectRoot: "", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const bootstrap: AppBootstrap = { repoRoot: "", mymindRoot: "", workspaceRoot: "", validRepo: false, skillsInstalled: false, runtime: "linux", environment: { mode: "desktop", platform: "linux" }, overview: {} as AppBootstrap["overview"], skills: [], ai: snapshot };

const rootStatus = (ready = false): MymindRootStatus => ({ mymindRoot: ready ? "/workspace/mymind" : "", workspaceRoot: "", health: { configured: ready, accessible: ready, readable: ready, writable: ready, missingInitializeEntries: [], missingCreateIfNeededEntries: [], optionalObservedEntries: [], unknownPreservedEntries: [], symlinkWarnings: [], activeRunCount: 0, warnings: [] }, snapshot: ready ? { rootPath: "/workspace/mymind", rootId: "root", rootGeneration: 1 } : null });

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.cctools = { getMymindRoot: vi.fn().mockResolvedValue(rootStatus()), selectMymindRoot: vi.fn().mockResolvedValue("/workspace/mymind"), setMymindRoot: vi.fn().mockResolvedValue("/workspace/mymind"), previewMymindRoot: vi.fn().mockResolvedValue({ candidate: "/workspace/mymind", canonicalRoot: "/workspace/mymind", health: rootStatus(true).health, canBind: true, blockingReasons: [] }), getBootstrap: vi.fn().mockResolvedValue({ ...bootstrap, validRepo: true, mymindRoot: "/workspace/mymind" }), onAiEvent: vi.fn(() => () => undefined), ...overrides } as unknown as DesktopApi;
}

afterEach(() => cleanup());

describe("OnboardingPage", () => {
  it("keeps the root choice explicit and refreshes after a successful selection", async () => {
    const onRefresh = vi.fn(async () => bootstrap);
    installApi();
    render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={bootstrap} go={vi.fn()} onRefresh={onRefresh} /><FeedbackHost /></AiProvider>);
    expect(await screen.findByRole("heading", { name: "先准备本地工作台" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "选择 mymind 根目录" }));
    await waitFor(() => expect(window.cctools.selectMymindRoot).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole("alertdialog", { name: "确认绑定 mymind 根目录" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认绑定" }));
    await waitFor(() => expect(window.cctools.setMymindRoot).toHaveBeenCalledWith("/workspace/mymind"));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("leaves the app skippable without a configured root", async () => {
    const go = vi.fn();
    installApi();
    render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={bootstrap} go={go} onRefresh={vi.fn(async () => bootstrap)} /></AiProvider>);
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
    let skillsInstalled = false;
    const installSkillSource = vi.fn(async () => {
      skillsInstalled = true;
      return [];
    });
    installApi({
      getMymindRoot: vi.fn().mockResolvedValue(rootStatus(true)),
      getOnboardingState: vi.fn().mockImplementation(async () => onboardingState),
      updateOnboardingState,
      installSkillSource
    });
    const onRefresh = vi.fn(async () => ({
      ...bootstrap,
      validRepo: true,
      mymindRoot: "/workspace/mymind",
      skillsInstalled
    }));
    render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={{ ...bootstrap, mymindRoot: "/workspace/mymind" }} go={go} onRefresh={onRefresh} /></AiProvider>);
    await screen.findByRole("heading", { name: "先准备本地工作台" });
    const finish = screen.getByRole("button", { name: "进入工作台" });
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "稍后配置" }));
    await waitFor(() => expect(updateOnboardingState).toHaveBeenCalledWith({ provider: "skipped" }));
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    const install = screen.getByRole("button", { name: "一键安装 cctools-skills" }) as HTMLButtonElement;
    // Initial refresh now resolves the root and bootstrap in parallel. Under
    // full-suite load, wait for that state transition before clicking; a
    // synthetic click on a still-disabled button is intentionally ignored.
    await waitFor(() => expect(install.disabled).toBe(false));
    fireEvent.click(install);
    await waitFor(() => expect(installSkillSource).toHaveBeenCalledWith({ type: "git", locator: CCTOOLS_SKILLS_REPO_URL }));
    await waitFor(() => expect((finish as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(finish);
    await waitFor(() => expect(updateOnboardingState).toHaveBeenCalledWith({ completed: true }));
    expect(onRefresh).toHaveBeenCalledTimes(3);
    expect(go).toHaveBeenCalledWith("ai");
  });

  it("adopts a bootstrap refresh completed by the preserved Settings route", async () => {
    installApi({
      getMymindRoot: vi.fn().mockResolvedValue(rootStatus(true)),
      getOnboardingState: vi.fn().mockResolvedValue({ completed: false, skill: "pending", provider: "skipped" })
    });
    const go = vi.fn();
    const onRefresh = vi.fn(async () => ({ ...bootstrap, validRepo: true, mymindRoot: "/workspace/mymind", skillsInstalled: false }));
    const view = render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={{ ...bootstrap, validRepo: true, mymindRoot: "/workspace/mymind" }} go={go} onRefresh={onRefresh} /></AiProvider>);
    const finish = await screen.findByRole("button", { name: "进入工作台" }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);

    view.rerender(<AiProvider initial={snapshot}><OnboardingPage bootstrap={{ ...bootstrap, validRepo: true, mymindRoot: "/workspace/mymind", skillsInstalled: true }} go={go} onRefresh={onRefresh} /></AiProvider>);

    await waitFor(() => expect(finish.disabled).toBe(false));
  });
});
