import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_PROVIDERS, type ImageConfiguration } from "@shared/image-generation";
import type { AiSnapshot, ContextReference, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { ChatComposer, ContextTray } from "./composer";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

const composerSnapshot: AiSnapshot = {
  ...snapshot,
  providers: [{
    id: "codex-native",
    provider: "codex",
    label: "Codex",
    runtime: "native",
    available: true,
    version: "1",
    supportsApprovals: true,
    supportsResume: true,
    supportsImages: true,
    diagnostic: null,
    detectedModel: null,
    contextWindow: null,
    installable: false, oneMillion: false
  }]
};

function imageContext(id: string, label: string): ContextReference {
  return {
    id,
    kind: "image",
    label,
    content: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
  };
}

function selectionContext(id: string, label: string): ContextReference {
  return {
    id,
    kind: "selection",
    label,
    path: `openmind/${id}.md`,
    content: `${label}的完整内容`
  };
}

beforeEach(() => {
  window.openmind = { onAiEvent: () => () => undefined } as unknown as DesktopApi;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ChatComposer permissions", () => {
  it("combines agent and image selection and submits both without an execution-mode control", async () => {
    const imageProvider = IMAGE_PROVIDERS[1];
    const imageConfiguration: ImageConfiguration = { defaultSelection: null, providers: [{ id: "images", name: "创作 Provider", provider: imageProvider.id, baseUrl: imageProvider.baseUrl, models: [imageProvider.models[0].id], enabled: true, configured: true }] };
    window.openmind = {
      onAiEvent: () => () => undefined,
      getImageConfiguration: async () => imageConfiguration,
      selectImageModel: vi.fn(async selection => ({ ...imageConfiguration, defaultSelection: selection }))
    } as unknown as DesktopApi;
    const onDraftSubmit = vi.fn(async () => {});
    const agents = [...composerSnapshot.providers, { ...composerSnapshot.providers[0], id: "claude-native", label: "Claude Code", provider: "claude" as const }];
    render(<AiProvider initial={{ ...composerSnapshot, providers: agents }}><ChatComposer onDraftSubmit={onDraftSubmit} /></AiProvider>);
    expect(document.querySelector(".mode-select")).toBeNull();
    expect(document.querySelector(".composer-image-controls")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "选择模型：Codex" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Claude Code/ }));
    const picker = screen.getByRole("button", { name: "选择模型：Claude Code" });
    fireEvent.click(picker);
    fireEvent.mouseEnter(await screen.findByRole("menuitem", { name: /创作 Provider/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /GPT Image 2.5 Sunburst/ }));
    await waitFor(() => expect(window.openmind.selectImageModel).toHaveBeenCalledWith({ providerId: "images", provider: "openai", model: imageProvider.models[0].id }));
    fireEvent.change(screen.getByRole("combobox", { name: "AI 消息" }), { target: { value: "生成封面" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(onDraftSubmit).toHaveBeenCalledWith(expect.objectContaining({ providerId: "claude-native", interactionMode: "default", imageGeneration: { providerId: "images", provider: "openai", model: imageProvider.models[0].id }, prompt: "生成封面" })));
  });
  it("marks automatic execution as the active permission tone", () => {
    render(<AiProvider initial={composerSnapshot}><ChatComposer /></AiProvider>);

    expect(document.querySelector(".permission-select")?.getAttribute("data-value")).toBe("auto");

    fireEvent.click(screen.getByRole("button", { name: /权限.*自动执行/ }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "权限" })).getByRole("option", { name: "只读" }));

    expect(document.querySelector(".permission-select")?.getAttribute("data-value")).toBe("read-only");
  });

  it("uses the saved new-session permission while the product default remains auto", async () => {
    window.openmind = {
      onAiEvent: () => () => undefined,
      getPreferences: async () => ({ defaultPermissionProfile: "read-only", defaultProvider: "" })
    } as unknown as DesktopApi;
    render(<AiProvider initial={composerSnapshot}><ChatComposer /></AiProvider>);

    await waitFor(() => expect(document.querySelector(".permission-select")?.getAttribute("data-value")).toBe("read-only"));
  });

  it("portals slash suggestions from a caret anchor while preserving combobox semantics", async () => {
    render(<AiProvider initial={composerSnapshot}><ChatComposer /></AiProvider>);

    const input = screen.getByRole("combobox", { name: "AI 消息" });
    fireEvent.change(input, { target: { value: " \n \n/", selectionStart: 5, selectionEnd: 5 } });

    const menu = await screen.findByLabelText("Skills");
    const popover = menu.closest(".composer-suggestion-popover");
    expect(popover?.parentElement).toBe(document.body);
    expect(document.querySelector(".composer-suggestion-caret-anchor")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe("composer-suggestions");
  });
});

describe("ContextTray selection references", () => {
  it("closes a stale detail anchor and preserves keyboard focus when its reference moves", async () => {
    const first = selectionContext("first", "引用一");
    const second = selectionContext("second", "引用二");
    window.localStorage.setItem("openmind.ai.contexts.v1", JSON.stringify({ "__new-session__": [first, second] }));
    render(<AiProvider initial={snapshot}><ChatComposer /></AiProvider>);
    const trigger = screen.getByRole("button", { name: first.path });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "引用一 详情" });
    const move = within(dialog).getByRole("button", { name: "后移" });
    move.focus();
    fireEvent.click(move);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(dialog.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect([...document.querySelectorAll(".context-chip-drag .ui-disclosure-trigger span")].map(node => node.textContent)).toEqual(["引用二", "引用一"]);
    await waitFor(() => expect(document.querySelector(".context-chip-popover")).toBeNull());
  });

  it("removes only the selected reference from its inline delete button", async () => {
    const first = selectionContext("first", "引用一");
    const second = selectionContext("second", "引用二");
    window.localStorage.setItem("openmind.ai.contexts.v1", JSON.stringify({ "__new-session__": [first, second] }));
    render(<AiProvider initial={snapshot}><ChatComposer /></AiProvider>);

    expect(screen.getByText("引用一")).toBeTruthy();
    expect(screen.getByText("引用二")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除引用：引用一" }));

    await waitFor(() => expect(screen.queryByText("引用一")).toBeNull());
    expect(screen.getByText("引用二")).toBeTruthy();
  });

  it("opens selection details from the keyboard and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    const reference = selectionContext("first", "引用一");
    render(<AiProvider initial={snapshot}><ContextTray contexts={[reference]} /></AiProvider>);

    const trigger = screen.getByRole("button", { name: reference.path });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog", { name: "引用一 详情" });
    expect(within(dialog).getByText(reference.content!)).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "引用一 详情" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("opens selection details through a coarse touch pointer sequence", async () => {
    const reference = selectionContext("touch", "触屏引用");
    render(<AiProvider initial={snapshot}><ContextTray contexts={[reference]} /></AiProvider>);

    const trigger = screen.getByRole("button", { name: reference.path });
    fireEvent.pointerDown(trigger, { pointerId: 1, pointerType: "touch", isPrimary: true });
    fireEvent.pointerUp(trigger, { pointerId: 1, pointerType: "touch", isPrimary: true });
    fireEvent.click(trigger);

    expect(await screen.findByRole("dialog", { name: "触屏引用 详情" })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("ContextTray image lightbox", () => {
  it("places image attachments above the draft inside the editor without the context toolbar", async () => {
    const first = imageContext("a", "pasted-1");
    const second = imageContext("b", "pasted-2");
    window.localStorage.setItem("openmind.ai.contexts.v1", JSON.stringify({ "__new-session__": [first, second] }));
    const { container } = render(<AiProvider initial={composerSnapshot}><ChatComposer /></AiProvider>);
    const editor = container.querySelector(".composer-editor")!;
    const image = screen.getByAltText(first.label);
    expect(editor.contains(image)).toBe(true);
    expect(container.querySelector(".context-tray-count")).toBeNull();
    expect(container.querySelector(".context-tray-clear")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "AI 消息" }), { target: { value: "根据这张图片创作" } });
    fireEvent.click(screen.getByRole("button", { name: `移除图片：${first.label}` }));
    await waitFor(() => expect(screen.queryByAltText(first.label)).toBeNull());
    expect(screen.getByAltText(second.label)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "AI 消息" })).toHaveProperty("value", "根据这张图片创作");
    fireEvent.click(screen.getByRole("button", { name: `移除图片：${second.label}` }));
    await waitFor(() => expect(container.querySelector(".context-tray")).toBeNull());
  });

  it("clears text references without removing attached images from the editor", async () => {
    const image = imageContext("a", "pasted-1");
    const reference = selectionContext("text", "引用正文");
    window.localStorage.setItem("openmind.ai.contexts.v1", JSON.stringify({ "__new-session__": [image, reference] }));
    render(<AiProvider initial={composerSnapshot}><ChatComposer /></AiProvider>);
    fireEvent.click(screen.getByRole("button", { name: /清空/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: reference.path })).toBeNull());
    expect(screen.getByAltText(image.label)).toBeTruthy();
  });

  it("renders no dialog when there are no images", () => {
    render(<AiProvider initial={snapshot}><ContextTray contexts={[]} /></AiProvider>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a modal dialog on thumbnail click and focuses the close button", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ContextTray contexts={[imageContext("a", "pasted-1")]} /></AiProvider>);

    await user.click(screen.getByAltText("pasted-1"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("图片预览");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭预览" })));
  });

  it("does not show navigation controls for a single image", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ContextTray contexts={[imageContext("a", "pasted-1")]} /></AiProvider>);

    await user.click(screen.getByAltText("pasted-1"));
    await screen.findByRole("dialog");

    expect(screen.queryByRole("button", { name: "上一张" })).toBeNull();
    expect(screen.queryByRole("button", { name: "下一张" })).toBeNull();
  });

  it("cycles through images with prev/next and shows a counter", async () => {
    const user = userEvent.setup();
    render(
      <AiProvider initial={snapshot}>
        <ContextTray contexts={[imageContext("a", "pasted-1"), imageContext("b", "pasted-2")]} />
      </AiProvider>
    );

    await user.click(screen.getByAltText("pasted-1"));
    await screen.findByRole("dialog");
    expect(screen.getByText("1 / 2")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "下一张" }));
    expect(screen.getByText("2 / 2")).toBeTruthy();

    // wraps around
    await user.click(screen.getByRole("button", { name: "下一张" }));
    expect(screen.getByText("1 / 2")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "上一张" }));
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  it("navigates with arrow keys and closes with Escape, restoring focus", async () => {
    const user = userEvent.setup();
    render(
      <AiProvider initial={snapshot}>
        <ContextTray contexts={[imageContext("a", "pasted-1"), imageContext("b", "pasted-2")]} />
      </AiProvider>
    );

    const thumb = screen.getByAltText("pasted-1").closest("button")!;
    await user.click(thumb);
    await screen.findByRole("dialog");
    expect(screen.getByText("1 / 2")).toBeTruthy();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("2 / 2")).toBeTruthy();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("1 / 2")).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(thumb));
  });

  it("traps Tab focus within the dialog", async () => {
    const user = userEvent.setup();
    render(
      <AiProvider initial={snapshot}>
        <ContextTray contexts={[imageContext("a", "pasted-1"), imageContext("b", "pasted-2")]} />
      </AiProvider>
    );

    await user.click(screen.getByAltText("pasted-1").closest("button")!);
    const close = await waitFor(() => screen.getByRole("button", { name: "关闭预览" }));
    await waitFor(() => expect(document.activeElement).toBe(close));

    // The shared viewer also offers fit/original sizing; every control stays in the focus loop.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "上一张" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "下一张" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "适应窗口" }));
    await user.tab();
    expect(document.activeElement).toBe(close);
  });

  it("shows only the active original and switches it when navigating", async () => {
    const user = userEvent.setup();
    render(
      <AiProvider initial={snapshot}>
        <ContextTray contexts={[imageContext("a", "pasted-1"), imageContext("b", "pasted-2")]} />
      </AiProvider>
    );

    await user.click(screen.getByAltText("pasted-1"));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getAllByRole("img")).toHaveLength(1);
    expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("pasted-1");
    await user.click(screen.getByRole("button", { name: "下一张" }));
    expect(within(dialog).getAllByRole("img")).toHaveLength(1);
    expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("pasted-2");
  });

  it("tracks horizontal touch movement and cancels it without navigating", async () => {
    const user = userEvent.setup();
    render(
      <AiProvider initial={snapshot}>
        <ContextTray contexts={[imageContext("a", "pasted-1"), imageContext("b", "pasted-2")]} />
      </AiProvider>
    );

    await user.click(screen.getByAltText("pasted-1"));
    const dialog = await screen.findByRole("dialog");

    const stage = within(dialog).getByRole("img").parentElement!;
    fireEvent.touchStart(stage, { touches: [{ clientX: 120, clientY: 100 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 90, clientY: 100 }] });
    expect(stage.hasAttribute("data-dragging")).toBe(true);
    fireEvent.touchCancel(stage);
    expect(stage.hasAttribute("data-dragging")).toBe(false);
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  it("advances to the next image on a left swipe past the threshold", async () => {
    const user = userEvent.setup();
    render(
      <AiProvider initial={snapshot}>
        <ContextTray contexts={[imageContext("a", "pasted-1"), imageContext("b", "pasted-2")]} />
      </AiProvider>
    );

    await user.click(screen.getByAltText("pasted-1"));
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByText("1 / 2")).toBeTruthy();

    const stage = within(dialog).getByRole("img").parentElement!;
    fireEvent.touchStart(stage, { touches: [{ clientX: 140, clientY: 100 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 40, clientY: 100 }] });
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });
});
