import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, ProvidersYamlView } from "@shared/contracts";
import { AiProvidersSettingsSection } from "./settings-sections";

const view = { schemaVersion: 1, default: "fixture", providers: [{
  id: "fixture", name: "测试 Provider", enabled: true, protocol: "openai-chat", authMode: "bearer", apiKeySet: true,
  baseUrl: "https://example.invalid", model: "fixture", proxyUrl: "", proxyPolicy: "system", tlsPolicy: "verify"
}] } as ProvidersYamlView;
function mount() {
  document.documentElement.style.setProperty("--dur-exit", "160ms");
  window.openmind = { getProviderApiKey: async () => "fixture-key" } as unknown as DesktopApi;
  render(<AiProvidersSettingsSection view={view} busy={false} onSave={async () => {}} notify={() => {}} />);
}
afterEach(() => { cleanup(); document.documentElement.removeAttribute("style"); vi.restoreAllMocks(); });
describe("Provider CSS exit presence", () => {
  it("retains an inert add form, restores focus and cancels removal on quick reopen", async () => {
    mount();
    const trigger = screen.getByRole("button", { name: "添加 Provider" });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "添加 Provider" });
    fireEvent.change(within(dialog).getByLabelText("API Key"), { target: { value: "fixture-unsaved" } });
    fireEvent.click(within(dialog).getByLabelText("关闭添加 Provider 弹窗"));
    expect(dialog.closest("[data-leaving]")?.hasAttribute("inert")).toBe(true);
    expect((within(dialog).getByLabelText("API Key") as HTMLInputElement).value).toBe("fixture-unsaved");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    expect(screen.getAllByRole("dialog", { name: "添加 Provider" })).toHaveLength(1);
    expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
  });
  it("keeps the painted edit values during exit while cancelling underlying edits", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /编辑.*测试 Provider/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "未保存的名称" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(dialog.closest("[data-leaving]")?.hasAttribute("inert")).toBe(true);
    expect((within(dialog).getByLabelText("名称") as HTMLInputElement).value).toBe("未保存的名称");
    await waitFor(() => expect(document.querySelector(".settings-provider-dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /编辑.*测试 Provider/ }));
    expect((within(await screen.findByRole("dialog")).getByLabelText("名称") as HTMLInputElement).value).toBe("测试 Provider");
  });
});
