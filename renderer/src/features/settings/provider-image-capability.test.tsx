import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, ProvidersYamlView } from "@shared/contracts";
import { IMAGE_PROVIDERS } from "@shared/image-generation";
import { AiProvidersSettingsSection } from "./settings-sections";

const original = window.openmind;
afterEach(() => { window.openmind = original; vi.restoreAllMocks(); });
const flash = IMAGE_PROVIDERS[0].models[0];
const pro = IMAGE_PROVIDERS[0].models[1];
function fixture(): ProvidersYamlView {
  return { schemaVersion: 1, default: "shared", cli: { claude: null, codex: null }, providers: [{
    id: "shared", name: "共用火山 Provider", enabled: true, protocol: "openai-chat", authMode: "bearer", apiKeySet: true,
    baseUrl: IMAGE_PROVIDERS[0].baseUrl, model: "doubao-text", proxyUrl: "", proxyPolicy: "system", tlsPolicy: "verify"
  }] };
}

describe("Provider text and image categories", () => {
  it("enables image generation on the same entry and shows it in both categories", async () => {
    window.openmind = { getProviderApiKey: async () => "fixture-key" } as unknown as DesktopApi;
    const view = fixture();
    const save = vi.fn(async (_input: Parameters<DesktopApi["saveProviders"]>[0]) => {});
    const props = { busy: false, onSave: save, notify: vi.fn() };
    const { rerender } = render(<AiProvidersSettingsSection view={view} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑 共用火山 Provider 配置" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("文本模型")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("switch", { name: "支持图片生成" }));
    expect((within(dialog).getByRole("checkbox", { name: new RegExp(flash.name) }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: new RegExp(pro.name) }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const input = save.mock.calls[0][0];
    expect(input.providers).toHaveLength(1);
    expect(input.providers[0]).toMatchObject({ id: "shared", baseUrl: view.providers[0].baseUrl, apiKey: "fixture-key", model: "doubao-text", imageGeneration: { provider: "volcengine", models: [flash.id, pro.id] } });
    const next = { ...view, providers: [{ ...view.providers[0], imageGeneration: input.providers[0].imageGeneration }] };
    rerender(<AiProvidersSettingsSection view={next} {...props} />);
    expect(screen.getAllByRole("button", { name: "编辑 共用火山 Provider 配置" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "图片 Provider (1)" }));
    expect(screen.getAllByRole("button", { name: "编辑 共用火山 Provider 配置" })).toHaveLength(1);
    expect(screen.getByText(`${flash.name} · ${pro.name}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "文本 Provider (1)" }));
    expect(screen.getByText("openai-chat · doubao-text")).toBeTruthy();
  });

  it("adds a single shared Provider from the image category and preserves its text model", async () => {
    const save = vi.fn(async (_input: Parameters<DesktopApi["saveProviders"]>[0]) => {});
    render(<AiProvidersSettingsSection view={fixture()} busy={false} onSave={save} notify={vi.fn()} initialCategory="image" />);
    fireEvent.click(screen.getByRole("button", { name: "添加 Provider" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("switch", { name: "支持图片生成" }).getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).getByRole("button", { name: /Provider 预设/ }).textContent).toContain("火山豆包");
    fireEvent.change(within(dialog).getByLabelText("API Key"), { target: { value: "new-fixture-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加到列表" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const input = save.mock.calls[0][0];
    expect(input.providers).toHaveLength(2);
    expect(input.providers.filter(entry => entry.id === "doubao")).toHaveLength(1);
    expect(input.providers[1]).toMatchObject({ model: "doubao-pro-32k", imageGeneration: { provider: "volcengine", models: [flash.id] } });
  });

  it("removes only the image capability and leaves the text Provider available", async () => {
    window.openmind = { getProviderApiKey: async () => "fixture-key" } as unknown as DesktopApi;
    const view = fixture();
    view.providers[0].imageGeneration = { provider: "volcengine", models: [flash.id] };
    const save = vi.fn(async (_input: Parameters<DesktopApi["saveProviders"]>[0]) => {});
    render(<AiProvidersSettingsSection view={view} busy={false} onSave={save} notify={vi.fn()} initialCategory="image" />);
    fireEvent.click(screen.getByRole("button", { name: "编辑 共用火山 Provider 配置" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("switch", { name: "支持图片生成" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));
    await act(async () => {});
    const input = save.mock.calls[0][0];
    expect(input.providers).toHaveLength(1);
    expect(input.providers[0]).toMatchObject({ id: "shared", enabled: true, imageGeneration: null, model: "doubao-text" });
    expect(screen.queryByRole("button", { name: "编辑 共用火山 Provider 配置" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "文本 Provider (1)" }));
    expect(screen.getByRole("button", { name: "编辑 共用火山 Provider 配置" })).toBeTruthy();
  });
});
