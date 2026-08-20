import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, AppBootstrap, DesktopApi, OpenmindRootStatus } from "@shared/contracts";
import { OPENMIND_SKILLS_REPO_URL } from "@shared/skill-package-sources";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { OnboardingPage } from "./OnboardingPage";

const snapshot: AiSnapshot = { projectRoot: "", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const bootstrap: AppBootstrap = { repoRoot: "", openmindRoot: "", workspaceRoot: "", validRepo: false, skillsInstalled: false, runtime: "linux", environment: { mode: "desktop", platform: "linux" }, overview: {} as AppBootstrap["overview"], skills: [], ai: snapshot };

const rootStatus = (ready = false): OpenmindRootStatus => ({ openmindRoot: ready ? "/workspace/openmind" : "", workspaceRoot: "", health: { configured: ready, accessible: ready, readable: ready, writable: ready, missingInitializeEntries: [], missingCreateIfNeededEntries: [], optionalObservedEntries: [], unknownPreservedEntries: [], symlinkWarnings: [], activeRunCount: 0, warnings: [] }, snapshot: ready ? { rootPath: "/workspace/openmind", rootId: "root", rootGeneration: 1 } : null });

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.openmind = { getOpenmindRoot: vi.fn().mockResolvedValue(rootStatus()), selectOpenmindRoot: vi.fn().mockResolvedValue("/workspace/openmind"), setOpenmindRoot: vi.fn().mockResolvedValue("/workspace/openmind"), previewOpenmindRoot: vi.fn().mockResolvedValue({ candidate: "/workspace/openmind", canonicalRoot: "/workspace/openmind", health: rootStatus(true).health, canBind: true, blockingReasons: [] }), getBootstrap: vi.fn().mockResolvedValue({ ...bootstrap, validRepo: true, openmindRoot: "/workspace/openmind" }), onAiEvent: vi.fn(() => () => undefined), ...overrides } as unknown as DesktopApi;
}

afterEach(() => cleanup());

function expectActiveStep(step: 1 | 2 | 3 | 4, title: string) {
  const track = document.querySelector<HTMLElement>(".onboarding-step-track");
  expect(track?.dataset.currentStep).toBe(String(step));
  expect(screen.getByRole("heading", { level: 2, name: title })).toBeTruthy();
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  const panels = Array.from(document.querySelectorAll<HTMLElement>("[data-onboarding-step]"));
  expect(panels).toHaveLength(4);
  expect(panels.filter((panel) => panel.getAttribute("aria-hidden") === "false")).toHaveLength(1);
  expect(panels.find((panel) => panel.dataset.onboardingStep === String(step))?.hasAttribute("inert")).toBe(false);
  expect(panels.filter((panel) => panel.dataset.onboardingStep !== String(step)).every((panel) => panel.hasAttribute("inert"))).toBe(true);
}

describe("OnboardingPage", () => {
  it("shows one minimal data-directory panel, then advances to the RSS source step after selection", async () => {
    let ready = false;
    const getOpenmindRoot = vi.fn(async () => rootStatus(ready));
    const setOpenmindRoot = vi.fn(async () => {
      ready = true;
      return "/workspace/openmind";
    });
    const onRefresh = vi.fn(async () => ({ ...bootstrap, validRepo: ready, openmindRoot: ready ? "/workspace/openmind" : "" }));
    installApi({ getOpenmindRoot, setOpenmindRoot });
    render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={bootstrap} go={vi.fn()} onRefresh={onRefresh} /><FeedbackHost /></AiProvider>);

    await screen.findByRole("heading", { level: 2, name: "选择 OpenMind 数据目录" });
    expectActiveStep(1, "选择 OpenMind 数据目录");
    expect(document.querySelector(".onboarding-risk")).toBeNull();
    expect(document.querySelector(".onboarding-progress")).toBeNull();
    expect(screen.queryByRole("button", { name: "稍后配置" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "选择文件夹" }));
    await waitFor(() => expect(window.openmind.selectOpenmindRoot).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole("alertdialog", { name: "确认绑定 OpenMind 数据目录" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认绑定" }));

    await waitFor(() => expect(setOpenmindRoot).toHaveBeenCalledWith("/workspace/openmind"));
    expect(onRefresh).toHaveBeenCalledTimes(2);
    await screen.findByRole("heading", { level: 2, name: "安装 RSS 源" });
    expectActiveStep(2, "安装 RSS 源");
    expect(screen.queryByRole("button", { name: "打开导入入口" })).toBeNull();
  });

  it("does not expose later actions or a skip path before the required root step", async () => {
    installApi();
    render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={bootstrap} go={vi.fn()} onRefresh={vi.fn(async () => bootstrap)} /></AiProvider>);

    await screen.findByRole("heading", { level: 2, name: "选择 OpenMind 数据目录" });
    expectActiveStep(1, "选择 OpenMind 数据目录");
    expect(screen.queryByRole("button", { name: "安装 RSS 源" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开导入入口" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开 Provider 设置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "稍后配置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "进入工作台" })).toBeNull();
  });

  it("requires the Skill step, allows Provider to be skipped, and makes the final step non-blocking", async () => {
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
      getOpenmindRoot: vi.fn().mockResolvedValue(rootStatus(true)),
      getOnboardingState: vi.fn().mockImplementation(async () => onboardingState),
      updateOnboardingState,
      installSkillSource
    });
    const onRefresh = vi.fn(async () => ({
      ...bootstrap,
      validRepo: true,
      openmindRoot: "/workspace/openmind",
      skillsInstalled
    }));
    render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={{ ...bootstrap, openmindRoot: "/workspace/openmind" }} go={go} onRefresh={onRefresh} /></AiProvider>);

    await screen.findByRole("heading", { level: 2, name: "安装 RSS 源" });
    expectActiveStep(2, "安装 RSS 源");
    expect(screen.queryByRole("button", { name: "打开导入入口" })).toBeNull();
    expect(screen.queryByRole("button", { name: "稍后配置" })).toBeNull();
    const install = screen.getByRole("button", { name: "安装 RSS 源" }) as HTMLButtonElement;
    await waitFor(() => expect(install.disabled).toBe(false));
    fireEvent.click(install);

    await waitFor(() => expect(installSkillSource).toHaveBeenCalledWith({ type: "git", locator: OPENMIND_SKILLS_REPO_URL }));
    await screen.findByRole("heading", { level: 2, name: "连接 AI Provider" });
    expectActiveStep(3, "连接 AI Provider");
    expect(screen.queryByRole("button", { name: "进入工作台" })).toBeNull();
    expect(screen.getByRole("button", { name: "稍后配置" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "稍后配置" }));
    await waitFor(() => expect(updateOnboardingState).toHaveBeenCalledWith({ provider: "skipped" }));
    await screen.findByRole("heading", { level: 2, name: "准备完成" });
    expectActiveStep(4, "准备完成");
    expect(screen.queryByRole("button", { name: "稍后配置" })).toBeNull();
    const finish = screen.getByRole("button", { name: "进入工作台" }) as HTMLButtonElement;
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);

    await waitFor(() => expect(updateOnboardingState).toHaveBeenCalledWith({ completed: true }));
    expect(onRefresh).toHaveBeenCalledTimes(3);
    expect(go).toHaveBeenCalledWith("ai");
  });

  it("adopts a bootstrap refresh completed by the preserved Settings route", async () => {
    installApi({
      getOpenmindRoot: vi.fn().mockResolvedValue(rootStatus(true)),
      getOnboardingState: vi.fn().mockResolvedValue({ completed: false, skill: "pending", provider: "skipped" })
    });
    const go = vi.fn();
    const onRefresh = vi.fn(async () => ({ ...bootstrap, validRepo: true, openmindRoot: "/workspace/openmind", skillsInstalled: false }));
    const view = render(<AiProvider initial={snapshot}><OnboardingPage bootstrap={{ ...bootstrap, validRepo: true, openmindRoot: "/workspace/openmind" }} go={go} onRefresh={onRefresh} /></AiProvider>);

    await screen.findByRole("heading", { level: 2, name: "安装 RSS 源" });
    expectActiveStep(2, "安装 RSS 源");

    view.rerender(<AiProvider initial={snapshot}><OnboardingPage bootstrap={{ ...bootstrap, validRepo: true, openmindRoot: "/workspace/openmind", skillsInstalled: true }} go={go} onRefresh={onRefresh} /></AiProvider>);

    await screen.findByRole("heading", { level: 2, name: "准备完成" });
    expectActiveStep(4, "准备完成");
    expect((screen.getByRole("button", { name: "进入工作台" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
