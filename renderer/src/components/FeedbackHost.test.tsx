import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider, useAi } from "../ai-context";
import { FeedbackHost } from "./FeedbackHost";
import { ProjectDialog } from "../features/projects/ProjectDialog";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

function ConfirmHarness() {
  const ai = useAi();
  return (
    <div>
      <button
        onClick={() => {
          void ai.confirm({
            title: "删除记录",
            body: "此操作不可恢复。",
            confirmText: "删除",
            danger: true
          }).then((result) => ai.notify(result ? "已确认" : "已取消"));
        }}
      >
        危险操作
      </button>
      <button
        onClick={() => {
          void ai.confirm({
            title: "保存更改",
            confirmText: "保存"
          }).then((result) => ai.notify(result ? "已保存" : "未保存"));
        }}
      >
        普通操作
      </button>
      <button
        onClick={() => {
          void ai.confirm({
            title: `长标题${"标题".repeat(80)}`,
            body: Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行确认内容`).join("\n"),
            confirmText: "继续"
          });
        }}
      >
        长内容操作
      </button>
      <button onClick={() => ai.notify("Skill 执行失败", "error")}>错误提示</button>
      <FeedbackHost />
    </div>
  );
}

beforeEach(() => {
  document.documentElement.style.setProperty("--dur-exit", "160ms");
  window.openmind = {
    onAiEvent: () => () => undefined
  } as unknown as DesktopApi;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.style.removeProperty("--dur-exit");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("FeedbackHost confirmation dialog", () => {
  it("isolates nested dialogs and lets Escape dismiss only the top confirmation", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    const closeProject = vi.fn();
    function Nested() {
      const ai = useAi();
      const [open, setOpen] = useState(true);
      return <>
        <div data-testid="background"><button>页面操作</button></div>
        <ProjectDialog open={open} title="项目设置" confirmLabel="保存" onConfirm={() => {}}
          onClose={() => { closeProject(); setOpen(false); }}>
          <button type="button" onClick={() => void ai.confirm({ title: "确认放弃", danger: true })}>请求确认</button>
        </ProjectDialog>
        <FeedbackHost />
      </>;
    }
    render(<AiProvider initial={snapshot}><Nested /></AiProvider>);
    const background = screen.getByTestId("background");
    const project = screen.getByRole("dialog", { name: "项目设置" });
    expect(background.closest<HTMLElement>('[aria-hidden="true"]')?.inert).toBe(true);
    expect(background.closest('[aria-hidden="true"]')).toBeTruthy();
    const trigger = within(project).getByRole("button", { name: "请求确认" });
    trigger.focus();
    fireEvent.click(trigger);
    act(() => vi.advanceTimersToNextFrame());
    const confirmation = screen.getByRole("alertdialog");
    expect(document.activeElement).toBe(within(confirmation).getByRole("button", { name: "取消" }));
    expect(project.closest<HTMLElement>('[aria-hidden="true"]')?.inert).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(closeProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(confirmation.closest("[inert]")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "项目设置" })).toBe(project);
    expect(background.closest<HTMLElement>('[aria-hidden="true"]')?.inert).toBe(true);
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(closeProject).toHaveBeenCalledTimes(1);
    expect(background.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("defaults dangerous actions to cancel and restores focus", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ConfirmHarness /></AiProvider>);

    const trigger = screen.getByRole("button", { name: "危险操作" });
    await user.click(trigger);

    const dialog = screen.getByRole("alertdialog", { name: "删除记录" });
    expect(dialog.closest("[data-ui-dialog]")?.parentElement).toBe(document.body);
    const cancel = screen.getByRole("button", { name: "取消" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.keyboard("{Enter}");

    expect(await screen.findByText("已取消")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("traps tab focus, confirms normal actions with Enter, and cancels with Escape", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ConfirmHarness /></AiProvider>);

    const normalTrigger = screen.getByRole("button", { name: "普通操作" });
    await user.click(normalTrigger);
    const save = screen.getByRole("button", { name: "保存" });
    const cancel = screen.getByRole("button", { name: "取消" });
    await waitFor(() => expect(document.activeElement).toBe(save));

    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);
    await user.keyboard("{Enter}");
    expect(await screen.findByText("已保存")).toBeTruthy();

    await user.click(normalTrigger);
    await user.keyboard("{Escape}");
    expect(await screen.findByText("未保存")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(normalTrigger));
  });

  it("adds recovery guidance and records failed cross-module actions", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ConfirmHarness /></AiProvider>);

    await user.click(screen.getByRole("button", { name: "错误提示" }));

    expect(await screen.findByText("Skill 执行失败")).toBeTruthy();
    expect(await screen.findByText("可在自动化或数据源运行日志中查看详情，并使用重试/重新运行。")).toBeTruthy();
    const log = JSON.parse(window.localStorage.getItem("openmind.feedback.log.v1") || "[]");
    expect(log.at(-1)).toMatchObject({ text: "Skill 执行失败", tone: "error" });
  });

  it("keeps long confirmation content and actions in separate regions", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ConfirmHarness /></AiProvider>);

    await user.click(screen.getByRole("button", { name: "长内容操作" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.querySelector("p")?.textContent).toContain("第 80 行确认内容");
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "继续" })).toBeTruthy();
  });
});

function ToastHarness() {
  const ai = useAi();
  return (
    <div>
      <button onClick={() => ai.notify("临时提示", "info")}>弹 toast</button>
      <FeedbackHost />
    </div>
  );
}

describe("FeedbackHost toast exit animation", () => {
  it("marks a dismissed toast as leaving, then unmounts it after the exit animation", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ToastHarness /></AiProvider>);

    await user.click(screen.getByRole("button", { name: "弹 toast" }));
    const toastEl = (await screen.findByText("临时提示")).closest(".toast") as HTMLElement;

    await user.click(within(toastEl).getByRole("button"));
    await waitFor(() => expect(toastEl.getAttribute("data-leaving")).toBe("true"));
    expect(toastEl.hasAttribute("inert")).toBe(true);
    expect(toastEl.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(screen.queryByText("临时提示")).toBeNull());
  });

  it("does not retain an invisible toast under reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ToastHarness /></AiProvider>);
    await user.click(screen.getByRole("button", { name: "弹 toast" }));
    const toastEl = screen.getByText("临时提示").closest(".toast") as HTMLElement;
    await user.click(within(toastEl).getByRole("button"));
    expect(screen.queryByText("临时提示")).toBeNull();
  });
});
