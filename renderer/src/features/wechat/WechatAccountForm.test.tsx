import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import type { WechatAccountView } from "@shared/wechat";
import { WechatAccountForm } from "./WechatAccountForm";

const unconfigured: WechatAccountView = { appId: "", author: "", configured: false };
const configured: WechatAccountView = { appId: "wx1234567890abcdef", author: "作者", configured: true };
const fixtureSecret = "0123456789abcdef0123456789abcdef";

beforeEach(() => {
  window.openmind = {
    getWechatAccount: vi.fn().mockResolvedValue(unconfigured),
    saveWechatAccount: vi.fn().mockResolvedValue(configured),
    openExternal: vi.fn().mockResolvedValue(undefined)
  } as unknown as DesktopApi;
});
afterEach(() => cleanup());

describe("WechatAccountForm", () => {
  it("saves a new configuration, clears the secret and explains local network requirements", async () => {
    const onSaved = vi.fn();
    render(<WechatAccountForm onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText("AppID"), { target: { value: ` ${configured.appId} ` } });
    fireEvent.change(screen.getByLabelText("AppSecret"), { target: { value: fixtureSecret } });
    fireEvent.change(screen.getByLabelText("默认作者（选填）"), { target: { value: " 作者 " } });
    expect(screen.getByText(/本桌面电脑当前网络出口的公网 IP/)).toBeTruthy();
    expect(screen.getByText(/不会验证微信接口权限/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(configured));
    expect(window.openmind.saveWechatAccount).toHaveBeenCalledWith({ appId: configured.appId, appSecret: fixtureSecret, author: "作者" });
    const secret = screen.getByLabelText("AppSecret") as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "打开微信公众平台" }));
    expect(window.openmind.openExternal).toHaveBeenCalledWith("https://mp.weixin.qq.com/");
  });

  it("preserves an existing secret by omitting it, and requires a new one when AppID changes", async () => {
    render(<WechatAccountForm account={configured} onSaved={vi.fn()} />);
    const appId = await screen.findByLabelText("AppID");
    expect(window.openmind.getWechatAccount).not.toHaveBeenCalled();
    expect((screen.getByLabelText("AppSecret") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("默认作者（选填）"), { target: { value: "新作者" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(window.openmind.saveWechatAccount).toHaveBeenCalledWith({ appId: configured.appId, author: "新作者" }));
    fireEvent.change(appId, { target: { value: "wxabcdef1234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "更换 AppID 时，请重新填写 AppSecret。");
    expect(window.openmind.saveWechatAccount).toHaveBeenCalledTimes(1);
  });

  it("retries a failed load and exposes storage failures without reporting success", async () => {
    const onSaved = vi.fn();
    window.openmind.getWechatAccount = vi.fn().mockRejectedValueOnce(new Error("读取失败")).mockResolvedValue(configured);
    window.openmind.saveWechatAccount = vi.fn().mockRejectedValue(new Error("请启用系统密钥环后重试。"));
    render(<WechatAccountForm onSaved={onSaved} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByLabelText("AppID");
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "请启用系统密钥环后重试。");
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "保存配置" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks cancellation and duplicate submission during an in-flight save", async () => {
    let resolveSave!: (account: WechatAccountView) => void;
    window.openmind.saveWechatAccount = vi.fn().mockReturnValue(new Promise<WechatAccountView>((resolve) => { resolveSave = resolve; }));
    const onCancel = vi.fn();
    const onBusyChange = vi.fn();
    render(<WechatAccountForm account={configured} onSaved={vi.fn()} onCancel={onCancel} onBusyChange={onBusyChange} />);
    await screen.findByLabelText("AppID");
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    fireEvent.click(screen.getByRole("button", { name: "正在保存…" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(window.openmind.saveWechatAccount).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => resolveSave(configured));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });
});
