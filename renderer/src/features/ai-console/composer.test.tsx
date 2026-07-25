import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    oneMillion: false
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
    path: `mymind/${id}.md`,
    content: `${label}的完整内容`
  };
}

beforeEach(() => {
  window.cctools = { onAiEvent: () => () => undefined } as unknown as DesktopApi;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ChatComposer permissions", () => {
  it("marks automatic execution as the active permission tone", () => {
    render(<AiProvider initial={composerSnapshot}><ChatComposer /></AiProvider>);

    fireEvent.click(screen.getByRole("button", { name: /权限.*编辑/ }));
    fireEvent.click(screen.getByRole("option", { name: "自动执行" }));

    expect(document.querySelector(".permission-select")?.getAttribute("data-value")).toBe("auto");
  });
});

describe("ContextTray selection references", () => {
  it("removes only the selected reference from its inline delete button", async () => {
    const first = selectionContext("first", "引用一");
    const second = selectionContext("second", "引用二");
    window.localStorage.setItem("cctools.ai.contexts.v1", JSON.stringify({ "__new-session__": [first, second] }));
    render(<AiProvider initial={snapshot}><ChatComposer /></AiProvider>);

    expect(screen.getByText("引用一")).toBeTruthy();
    expect(screen.getByText("引用二")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除引用：引用一" }));

    await waitFor(() => expect(screen.queryByText("引用一")).toBeNull());
    expect(screen.getByText("引用二")).toBeTruthy();
  });
});

describe("ContextTray image lightbox", () => {
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

    // focusables order in the dialog: 关闭预览, 上一张, 下一张. Tabbing past 下一张 wraps to 关闭预览.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "上一张" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "下一张" }));
    await user.tab();
    expect(document.activeElement).toBe(close);
  });

  it("renders every image as a slide in the track", async () => {
    const user = userEvent.setup();
    render(
      <AiProvider initial={snapshot}>
        <ContextTray contexts={[imageContext("a", "pasted-1"), imageContext("b", "pasted-2")]} />
      </AiProvider>
    );

    await user.click(screen.getByAltText("pasted-1"));
    const dialog = await screen.findByRole("dialog");

    // Both images mount as slides (the active one centered, the next one
    // translated off to the right) so prev/next can slide between them.
    const slides = within(dialog).getAllByRole("img");
    expect(slides).toHaveLength(2);
    expect(slides[0].getAttribute("alt")).toBe("pasted-1");
    expect(slides[1].getAttribute("alt")).toBe("pasted-2");
  });

  it("toggles a dragging state on touch start/end for swipe motion", async () => {
    const user = userEvent.setup();
    render(
      <AiProvider initial={snapshot}>
        <ContextTray contexts={[imageContext("a", "pasted-1"), imageContext("b", "pasted-2")]} />
      </AiProvider>
    );

    await user.click(screen.getByAltText("pasted-1"));
    const dialog = await screen.findByRole("dialog");

    fireEvent.touchStart(dialog);
    expect(dialog.hasAttribute("data-dragging")).toBe(true);

    fireEvent.touchEnd(dialog);
    expect(dialog.hasAttribute("data-dragging")).toBe(false);
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

    // Swipe left: 100 → 40 (dx = -60, past the 40px threshold) → next image.
    fireEvent.touchStart(dialog, { changedTouches: [{ clientX: 100 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 40 }] });
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });
});
