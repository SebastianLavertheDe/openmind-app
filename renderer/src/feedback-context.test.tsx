import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { FeedbackProvider, useFeedback, useFeedbackState } from "./feedback-context";
import { FeedbackHost } from "./components/FeedbackHost";
import { WechatSettingsSection } from "./features/wechat/WechatSettingsSection";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("application feedback boundary", () => {
  it("mounts a non-AI settings flow and its confirmation under feedback alone", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    window.openmind = {
      getWechatAccount: vi.fn().mockResolvedValue({ appId: "fixture", author: "", configured: true }),
      disconnectWechatAccount: disconnect
    } as unknown as DesktopApi;
    render(<FeedbackProvider><WechatSettingsSection /><FeedbackHost /></FeedbackProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "移除配置" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(dialog.querySelectorAll("button")[1]);
    await waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    expect(await screen.findByText("公众号配置已移除")).toBeTruthy();
  });

  it("keeps commands stable while toasts change and releases timers and confirmations on unmount", async () => {
    vi.useFakeTimers();
    let actions: ReturnType<typeof useFeedback> | undefined;
    let renders = 0;
    function Commands() { actions = useFeedback(); renders++; return null; }
    function State() { return <span>{useFeedbackState().toasts.length}</span>; }
    const view = render(<FeedbackProvider><Commands /><State /></FeedbackProvider>);
    const schedule = vi.spyOn(window, "setTimeout");
    const cancel = vi.spyOn(window, "clearTimeout");
    const first = actions;
    act(() => actions!.notify("Saved", "success"));
    const toastTimer = schedule.mock.results.at(-1)!.value;
    expect(screen.getByText("1")).toBeTruthy();
    expect(actions).toBe(first);
    expect(renders).toBe(1);
    const settled = vi.fn();
    act(() => { void actions!.confirm({ title: "Pending" }).then(settled); });
    view.unmount();
    await act(async () => {});
    expect(settled).toHaveBeenCalledExactlyOnceWith(false);
    expect(cancel).toHaveBeenCalledWith(toastTimer);
  });
});
