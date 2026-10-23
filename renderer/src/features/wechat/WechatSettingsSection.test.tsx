import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { WechatSettingsSection } from "./WechatSettingsSection";

const ui = vi.hoisted(() => ({ confirm: vi.fn(), notify: vi.fn() }));
vi.mock("../../feedback-context", () => ({ useFeedback: () => ui }));
const account = { appId: "wx1234567890abcdef", author: "作者", configured: true };

beforeEach(() => {
  ui.confirm.mockReset();
  ui.notify.mockReset();
  window.openmind = {
    getWechatAccount: vi.fn().mockResolvedValue(account),
    saveWechatAccount: vi.fn().mockResolvedValue(account),
    disconnectWechatAccount: vi.fn().mockResolvedValue(undefined)
  } as unknown as DesktopApi;
});
afterEach(() => cleanup());

describe("WechatSettingsSection", () => {
  it("recovers unreadable credentials by confirming removal and opening an empty configuration form", async () => {
    window.openmind.getWechatAccount = vi.fn().mockRejectedValue(new Error("无法读取公众号凭据，请在设置中重新配置。"));
    ui.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<WechatSettingsSection />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "无法读取公众号凭据，请在设置中重新配置。");
    fireEvent.click(screen.getByRole("button", { name: "移除配置" }));
    await waitFor(() => expect(ui.confirm).toHaveBeenCalledTimes(1));
    expect(window.openmind.disconnectWechatAccount).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "移除配置" }));
    const dialog = await screen.findByRole("dialog", { name: "配置微信公众号" });
    expect(window.openmind.disconnectWechatAccount).toHaveBeenCalledOnce();
    expect((await within(dialog).findByLabelText("AppID") as HTMLInputElement).value).toBe("");
    expect((within(dialog).getByLabelText("AppSecret") as HTMLInputElement).placeholder).toBe("输入 AppSecret");
    expect(ui.notify).toHaveBeenCalledWith("公众号配置已移除", "success");
  });

  it("opens a focused configuration dialog and returns focus on dismiss", async () => {
    render(<WechatSettingsSection />);
    const trigger = await screen.findByRole("button", { name: "编辑配置" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "配置微信公众号" });
    await within(dialog).findByLabelText("AppID");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("removes the local configuration only after confirmation", async () => {
    ui.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<WechatSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "移除配置" }));
    await waitFor(() => expect(ui.confirm).toHaveBeenCalledTimes(1));
    expect(window.openmind.disconnectWechatAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "移除配置" }));
    await screen.findByRole("button", { name: "配置公众号" });
    expect(window.openmind.disconnectWechatAccount).toHaveBeenCalledTimes(1);
    expect(ui.notify).toHaveBeenCalledWith("公众号配置已移除", "success");
    expect(screen.queryByText(account.appId)).toBeNull();
  });

  it("retains the configured state and allows retry after removal failure", async () => {
    ui.confirm.mockResolvedValue(true);
    window.openmind.disconnectWechatAccount = vi.fn().mockRejectedValueOnce(new Error("移除失败，请重试。"));
    render(<WechatSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "移除配置" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "移除失败，请重试。");
    expect(screen.getByText("已配置")).toBeTruthy();
    expect((screen.getByRole("button", { name: "移除配置" }) as HTMLButtonElement).disabled).toBe(false);
    expect(ui.notify).not.toHaveBeenCalled();
  });
});
