import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider, useAi } from "../ai-context";
import { FeedbackHost } from "./FeedbackHost";

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
      <button onClick={() => ai.notify("Skill 执行失败", "error")}>错误提示</button>
      <FeedbackHost />
    </div>
  );
}

beforeEach(() => {
  window.cctools = {
    onAiEvent: () => () => undefined
  } as unknown as DesktopApi;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("FeedbackHost confirmation dialog", () => {
  it("defaults dangerous actions to cancel and restores focus", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ConfirmHarness /></AiProvider>);

    const trigger = screen.getByRole("button", { name: "危险操作" });
    await user.click(trigger);

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
    const log = JSON.parse(window.localStorage.getItem("cctools.feedback.log.v1") || "[]");
    expect(log.at(-1)).toMatchObject({ text: "Skill 执行失败", tone: "error" });
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
    await waitFor(() => expect(screen.queryByText("临时提示")).toBeNull());
  });
});
