import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, AppBootstrap, DesktopApi, MymindRootStatus } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { OnboardingPage } from "./OnboardingPage";

const snapshot: AiSnapshot = { projectRoot: "", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const bootstrap: AppBootstrap = { repoRoot: "", mymindRoot: "", workspaceRoot: "", validRepo: false, runtime: "linux", environment: { mode: "desktop", platform: "linux" }, overview: {} as AppBootstrap["overview"], skills: [], ai: snapshot };
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
    fireEvent.click(screen.getByRole("button", { name: "打开 Skill Center" }));
    fireEvent.click(screen.getByRole("button", { name: "查看诊断" }));
    expect(go).toHaveBeenNthCalledWith(1, "skills");
    expect(go).toHaveBeenNthCalledWith(2, "diagnostics");
  });
});
