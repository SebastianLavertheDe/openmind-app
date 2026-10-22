import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, DesktopApi } from "@shared/contracts";
import { CommandGroup, ToolCallCard, type CommandCall } from "./tool";
import { ChatImageGallery } from "./ChatImages";

const previous = window.openmind;
const thumbnail = "data:image/png;base64,AAA=";
const original = "data:image/png;base64,BBB=";
const read = vi.fn(async ({ variant }: { variant?: string }) => ({ dataUrl: variant === "original" ? original : thumbnail, width: 1200, height: 900 }));
beforeEach(() => { read.mockClear(); window.openmind = { readChatImage: read } as unknown as DesktopApi; });
afterEach(() => { cleanup(); window.openmind = previous; vi.restoreAllMocks(); });
function call(id: string, tool: string, input: unknown, output: unknown = {}, isError = false): CommandCall {
  return { key: id, events: ["tool-start", "tool-complete"].map((kind, index) => ({ id: `${id}-${index}`, seq: index, timestamp: "2026-10-22T08:00:00Z", projectId: "fixture", sessionId: "fixture", runId: "fixture", provider: tool === "Read" ? "claude" : "codex", kind, schemaVersion: 1, risks: [], payload: { itemId: id, tool, input, ...(index ? { output, isError } : {}) } } as AiEvent)) };
}

describe("viewed tool images", () => {
  it.each(["Read", "imageView", "view_image"])("shows successful %s image reads immediately with original-image preview", async tool => {
    const image = call("picture", tool, { file_path: "assets/参考图.PNG" });
    const { container } = render(<ChatImageGallery projectName="fixture"><ToolCallCard events={image.events} /></ChatImageGallery>);
    expect(screen.getByRole("button", { name: "已查看 1 张图像" }).getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".read-file-summary")).toBeNull();
    expect(container.querySelector(".tool-event")).toBeNull();
    const preview = await screen.findByRole("img", { name: "参考图.PNG" });
    expect(preview.getAttribute("src")).toBe(thumbnail);
    expect(preview.closest("button")?.dataset.variant).toBe("tool");
    expect(read).toHaveBeenCalledWith({ source: "assets/参考图.PNG", variant: "thumbnail", projectName: "fixture" });
    expect(read.mock.calls.every(([input]) => input.variant === "thumbnail")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "查看原图：参考图.PNG" }));
    const dialog = screen.getByRole("dialog", { name: "图片查看器" });
    await waitFor(() => expect(within(dialog).getByAltText("参考图.PNG").getAttribute("src")).toBe(original));
  });

  it("groups consecutive image reads, deduplicates sources, and navigates originals in order", async () => {
    const calls = [call("a", "Read", { file_path: "assets/a.png" }), call("b", "imageView", { path: "assets/b.png" }), call("duplicate", "Read", { file_path: "assets/a.png" }), call("c", "view_image", { paths: ["assets/c.png"] })];
    render(<CommandGroup calls={calls} flat runStatus="running" />);
    const header = screen.getByRole("button", { name: "已查看 3 张图像" });
    expect(await screen.findAllByRole("img")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "查看原图：b.png" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByAltText("b.png");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    await within(dialog).findByAltText("c.png");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "查看原图：a.png" })).toBeNull();
    fireEvent.click(header);
    expect(await screen.findAllByRole("img")).toHaveLength(3);
  });

  it("preserves intervening tools and never interprets text-file contents as viewed images", async () => {
    const { container } = render(<CommandGroup calls={[call("a", "Read", { path: "a.png" }), call("text", "Read", { file_path: "note.md" }, "contents.png"), call("b", "Read", { path: "b.jpg" })]} flat />);
    expect(await screen.findAllByRole("img")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "已查看 1 张图像" })).toHaveLength(2);
    const rows = container.querySelector(".command-group-list")!.children;
    expect(rows[0].classList.contains("viewed-images")).toBe(true);
    expect(rows[1].classList.contains("tool-event")).toBe(true);
    expect(rows[2].classList.contains("viewed-images")).toBe(true);
    expect(read.mock.calls.some(([request]) => (request as unknown as { source: string }).source === "contents.png")).toBe(false);
  });

  it("only switches from running activity to viewed images after a successful completion", async () => {
    const image = call("a", "Read", { path: "a.png" });
    const view = render(<ToolCallCard events={image.events.slice(0, 1)} runStatus="running" />);
    expect(screen.queryByRole("button", { name: /已查看/ })).toBeNull();
    expect(read).not.toHaveBeenCalled();
    view.rerender(<ToolCallCard events={image.events} runStatus="running" />);
    expect(await screen.findByRole("img", { name: "a.png" })).toBeTruthy();
  });

  it("retains the failed read and error details without claiming the image was viewed", () => {
    const image = call("missing", "Read", { path: "missing.png" }, "file not found", true);
    render(<ToolCallCard events={image.events} runStatus="failed" />);
    expect(screen.queryByRole("button", { name: /已查看/ })).toBeNull();
    expect(screen.getByText("file not found")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });
});
