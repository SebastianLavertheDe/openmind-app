import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, ContextReference, DesktopApi } from "@shared/contracts";
import { IMAGE_PROVIDERS, type ImageSelection, type ImageConfiguration } from "@shared/image-generation";
import { announceProviderConfiguration } from "../../provider-configuration-events";
import { ChatMarkdown, UserMessage } from "./message";
import { AiProvider } from "../../ai-context";
import { ChatImageGallery, GeneratedImages } from "./ChatImages";
import { ComposerModelPicker } from "./ComposerModelPicker";

const thumbnail = "data:image/png;base64,AAA=";
const original = "data:image/png;base64,BBB=";
const previous = window.openmind;
afterEach(() => { window.openmind = previous; vi.restoreAllMocks(); });
function api(overrides: Partial<DesktopApi> = {}) {
  const read = vi.fn(async (input: { variant?: string }) => ({ dataUrl: input.variant === "original" ? original : thumbnail, width: 2048, height: 2048 }));
  window.openmind = { readChatImage: read, ...overrides } as unknown as DesktopApi;
  return read;
}

function sentMessage(contexts: ContextReference[], text = "根据这些图片生成内容") {
  const event = { id: "sent-images", seq: 1, timestamp: "2026-10-22T08:00:00Z", projectId: "fixture", sessionId: "fixture", runId: "fixture", provider: "codex", kind: "user-message", payload: { text, contexts }, risks: [], schemaVersion: 1 } as AiEvent;
  return render(<AiProvider initial={{ projectRoot: "/fixture", providers: [], sessions: [], runs: [], pendingApprovals: [] }}><UserMessage event={event} /></AiProvider>);
}

describe("sent image attachments", () => {
  it("places thumbnails outside and before the text bubble, with original-image navigation", async () => {
    const read = api({ onAiEvent: () => () => {} });
    const { container } = sentMessage([0, 1, 2].map(index => ({ id: `sent-${index}`, kind: "image", label: `参考图 ${index + 1}`, path: `/private/attachments/${index}.png` })));
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));
    const strip = container.querySelector(".user-message-images")!;
    expect(strip.nextElementSibling?.className).toBe("user-message-bubble");
    expect(strip.querySelectorAll('[data-ui-control="image-thumbnail"][data-variant="attachment"]')).toHaveLength(3);
    expect(container.querySelector(".sent-contexts")).toBeNull();
    expect(container.querySelector(".chat-image-open")).toBeNull();
    expect(read.mock.calls.every(([request]) => request.variant === "thumbnail")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "查看原图：参考图 2" }));
    const dialog = screen.getByRole("dialog", { name: "图片查看器" });
    await waitFor(() => expect(within(dialog).getByAltText("参考图 2").getAttribute("src")).toBe(original));
    expect(read).toHaveBeenLastCalledWith({ source: "/private/attachments/1.png", variant: "original" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    await waitFor(() => expect(within(dialog).getByAltText("参考图 3")).toBeTruthy());
  });

  it("retains non-image references without double-counting images", async () => {
    api({ onAiEvent: () => () => {} });
    sentMessage([{ id: "picture", kind: "image", label: "粘贴图片", content: thumbnail }, { id: "note", kind: "file", label: "说明文件", path: "note.md" }]);
    await screen.findByAltText("粘贴图片");
    fireEvent.click(screen.getByRole("button", { name: /本次使用了 1 项上下文/ }));
    expect(screen.getByText("说明文件")).toBeTruthy();
    expect(document.querySelector(".sent-contexts")?.textContent).not.toContain("粘贴图片");
  });

  it("shows image-only messages without an empty text bubble and handles missing legacy attachments", async () => {
    api({ onAiEvent: () => () => {} });
    const { container } = sentMessage([{ id: "legacy-missing", kind: "image", label: "旧图片" }], "");
    expect(container.querySelector(".user-message-bubble")).toBeNull();
    expect(await screen.findByRole("button", { name: "重新加载图片：旧图片" })).toBeTruthy();
    expect(container.querySelector(".chat-image-error")?.textContent).toBeTruthy();
  });
});

describe("conversation image gallery", () => {
  it("waits for visibility before reading offscreen attachments without showing an error", async () => {
    let intersect: IntersectionObserverCallback | undefined;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe() {}
      disconnect() {}
    });
    try {
      const read = api();
      render(<ChatImageGallery><ChatMarkdown text="![屏幕外图片](openmind/assets/offscreen.png)" /></ChatImageGallery>);
      expect(read).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /重新加载图片/ })).toBeNull();
      await act(async () => { intersect?.([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver); });
      await screen.findByAltText("屏幕外图片");
      expect(read).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it("renders Markdown thumbnails, loads originals only on click, and navigates across messages", async () => {
    const read = api();
    render(<ChatImageGallery projectName="fixture"><ChatMarkdown text="![第一张](openmind/assets/a.png)" /><ChatMarkdown text="![第二张](openmind/assets/b.png)" /></ChatImageGallery>);
    await waitFor(() => expect(screen.getByAltText("第二张").getAttribute("src")).toBe(thumbnail));
    expect(screen.queryByRole("link")).toBeNull();
    expect(read.mock.calls.every(([request]) => request.variant === "thumbnail")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "查看原图：第二张" }));
    const dialog = screen.getByRole("dialog", { name: "图片查看器" });
    await waitFor(() => expect(within(dialog).getByAltText("第二张").getAttribute("src")).toBe(original));
    expect(read).toHaveBeenLastCalledWith({ source: "openmind/assets/b.png", variant: "original", projectName: "fixture" });
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    await waitFor(() => expect(within(dialog).getByAltText("第一张")).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: "下一张图片" }));
    await waitFor(() => expect(within(dialog).getByAltText("第二张")).toBeTruthy());
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "图片查看器" })).toBeNull();
  });

  it("swipes through generated images and offers fit to window", async () => {
    api();
    render(<ChatImageGallery><GeneratedImages images={[0, 1].map(index => ({ id: `image-${index}`, source: `openmind/assets/${index}.png`, title: `生成 ${index}`, model: IMAGE_PROVIDERS[0].models[0].id, provider: "volcengine", mediaType: "image/png", createdAt: "2026-10-10", batchId: "batch", index }))} /></ChatImageGallery>);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "查看原图：生成 0" }));
    const dialog = screen.getByRole("dialog");
    const stage = dialog.querySelector(".chat-image-stage")!;
    expect(stage.classList.contains("is-original")).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "适应窗口" }));
    expect(stage.classList.contains("is-original")).toBe(false);
    fireEvent.touchStart(stage, { touches: [{ clientX: 250, clientY: 30 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 80, clientY: 32 }] });
    fireEvent.touchEnd(stage, { touches: [] });
    await waitFor(() => expect(within(dialog).getByAltText("生成 1")).toBeTruthy());
  });

  it("keeps errors inline and retries without rendering a remote URL", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("图片不存在")).mockResolvedValue({ dataUrl: thumbnail, width: 10, height: 10 });
    api({ readChatImage: read });
    render(<ChatMarkdown text="![missing](https://images.example/test.png)" />);
    await waitFor(() => expect(screen.getByText("图片不存在")).toBeTruthy());
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新加载图片：missing" }));
    await waitFor(() => expect(screen.getByAltText("missing").getAttribute("src")).toBe(thumbnail));
  });
});

describe("composer model picker", () => {
  it("opens configured models on provider hover and persists the chosen pair", async () => {
    const configuration: ImageConfiguration = { defaultSelection: null, providers: IMAGE_PROVIDERS.map(item => ({ id: item.id, name: item.name, models: item.models.map(model => model.id), provider: item.id, baseUrl: item.baseUrl, configured: true, enabled: true })) };
    const save = vi.fn(async (selection: ImageSelection | null) => ({ ...configuration, defaultSelection: selection }));
    api({ getImageConfiguration: async () => configuration, selectImageModel: save });
    const onChange = vi.fn();
    render(<ComposerModelPicker providers={[]} providerId="" onProviderChange={() => {}} value={null} onChange={onChange} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "选择模型：选择模型" }));
    const menu = screen.getByRole("menu", { name: "选择模型" });
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    for (const provider of IMAGE_PROVIDERS) {
      fireEvent.mouseEnter(within(menu).getByRole("menuitem", { name: new RegExp(provider.name) }));
      const submenu = screen.getByRole("menu", { name: `${provider.name} 图片模型` });
      expect(within(submenu).getAllByRole("menuitemradio")).toHaveLength(provider.models.length);
      for (const model of provider.models) expect(within(submenu).getByText(model.name)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Nano Banana 2.1/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ providerId: "google", provider: "google", model: "gemini-nano-banana-2.1" }));
    expect(onChange).toHaveBeenCalledWith({ providerId: "google", provider: "google", model: "gemini-nano-banana-2.1" });
  });
  it("shows the unavailable-model hint without a Provider management footer", async () => {
    api({ getImageConfiguration: async () => ({ defaultSelection: null, providers: [] }) });
    render(<ComposerModelPicker providers={[]} providerId="" onProviderChange={() => {}} value={null} onChange={() => {}} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "选择模型：选择模型" }));
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    expect(screen.getByText(/暂无可用的图片模型/)).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "管理 Provider" })).toBeNull();
    expect(document.querySelector(".image-model-menu-footer")).toBeNull();
  });
  it("filters unsupported, unchecked, disabled and unconfigured models and clears revoked selections", async () => {
    const model = IMAGE_PROVIDERS[0].models[0];
    const selected = { providerId: "shared", provider: "volcengine" as const, model: model.id };
    const provider = { id: "shared", name: "共用 Provider", provider: "volcengine" as const, baseUrl: IMAGE_PROVIDERS[0].baseUrl, models: [model.id, "gpt-4o"], enabled: true, configured: true };
    let configuration: ImageConfiguration = { defaultSelection: selected, providers: [provider, { ...provider, id: "off", name: "停用 Provider", enabled: false }, { ...provider, id: "no-key", name: "缺少凭据", configured: false }] };
    api({ getImageConfiguration: async () => configuration });
    const onChange = vi.fn();
    render(<ComposerModelPicker providers={[]} providerId="" onProviderChange={() => {}} value={selected} onChange={onChange} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: `选择模型：${model.name}` }));
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /共用 Provider/ }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(1);
    expect(screen.queryByText("gpt-4o")).toBeNull();
    expect(screen.queryByText(IMAGE_PROVIDERS[0].models[1].name)).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /停用 Provider/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /缺少凭据/ })).toBeNull();
    configuration = { defaultSelection: null, providers: [] };
    act(() => announceProviderConfiguration());
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });
  it("supports keyboard entry and return from the image submenu, then dismisses to the trigger", async () => {
    const provider = IMAGE_PROVIDERS[1];
    api({ getImageConfiguration: async () => ({ defaultSelection: null, providers: [{ id: provider.id, name: provider.name, provider: provider.id, baseUrl: provider.baseUrl, models: provider.models.map(model => model.id), enabled: true, configured: true }] }) });
    render(<ComposerModelPicker providers={[]} providerId="" onProviderChange={() => {}} value={null} onChange={() => {}} />);
    await act(async () => {});
    const trigger = screen.getByRole("button", { name: "选择模型：选择模型" });
    fireEvent.click(trigger);
    const entry = screen.getByRole("menuitem", { name: /OpenAI/ });
    act(() => entry.focus());
    fireEvent.keyDown(entry, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getAllByRole("menuitemradio")[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getAllByRole("menuitemradio")[1]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(entry);
    expect(screen.queryByRole("menu", { name: "OpenAI 图片模型" })).toBeNull();
    fireEvent.keyDown(entry, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
  it("keeps selection errors visible and allows retrying the same model", async () => {
    const provider = IMAGE_PROVIDERS[0];
    const configuration: ImageConfiguration = { defaultSelection: null, providers: [{ id: provider.id, name: provider.name, provider: provider.id, baseUrl: provider.baseUrl, models: [provider.models[0].id], enabled: true, configured: true }] };
    const save = vi.fn().mockRejectedValueOnce(new Error("无法保存配置")).mockResolvedValue(configuration);
    api({ getImageConfiguration: async () => configuration, selectImageModel: save });
    render(<ComposerModelPicker providers={[]} providerId="" onProviderChange={() => {}} value={null} onChange={() => {}} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "选择模型：选择模型" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /字节火山/ }));
    fireEvent.click(screen.getByRole("menuitemradio"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("无法保存配置"));
    fireEvent.click(screen.getByRole("menuitemradio"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });
});
