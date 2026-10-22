import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { localMediaUrl } from "@shared/media-preview";
import { MediaResults } from "./MediaResults";
import { FilePreviewProvider } from "./file-preview-context";

const record = (path: string, kind = "video") => ({ id: path, path, name: path.split("/").at(-1), kind, mimeType: kind === "video" ? "video/mp4" : "audio/wav", byteSize: 2048, mediaUrl: localMediaUrl({ path }) });
describe("MediaResults", () => {
  it("shows only existing media and opens the selected file in the pane", async () => {
    const read = vi.fn(async ({ path }) => { if (path === "missing.mp4") throw Error("missing"); return record(path); });
    window.openmind = { readMediaPreview: read } as unknown as DesktopApi;
    const open = vi.fn();
    render(<FilePreviewProvider open={open}><MediaResults paths={["outputs/final.mp4", "missing.mp4"]} /></FilePreviewProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "预览 final.mp4" }));
    expect(open).toHaveBeenCalledWith("outputs/final.mp4", undefined);
    expect(screen.queryByText("missing.mp4")).toBeNull();
  });
  it("preserves project ownership and rejects other project and absolute paths", async () => {
    const read = vi.fn(async input => ({ ...record(input.path), mediaUrl: localMediaUrl(input) }));
    window.openmind = { readMediaPreview: read } as unknown as DesktopApi;
    const open = vi.fn();
    render(<FilePreviewProvider open={open}><MediaResults projectName="Demo" paths={["openmind/projects/Demo/outputs/final.mp4", "openmind/projects/Other/outputs/leak.mp4", "C:\\outside.mp4", "../escape.mp4"]} /></FilePreviewProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "预览 final.mp4" }));
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ path: "outputs/final.mp4", projectName: "Demo" });
    expect(open).toHaveBeenCalledWith("outputs/final.mp4", { projectName: "Demo" });
  });
  it("does not display results from a previous reply after a delayed read", async () => {
    let finish!: (value: ReturnType<typeof record>) => void;
    const read = vi.fn(({ path }) => path === "old.mp4" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(record(path)));
    window.openmind = { readMediaPreview: read } as unknown as DesktopApi;
    const view = render(<MediaResults paths={["old.mp4"]} />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    view.rerender(<MediaResults paths={["new.mp4"]} />);
    await screen.findByText("new.mp4");
    await act(async () => { finish(record("old.mp4")); });
    expect(screen.queryByText("old.mp4")).toBeNull();
  });
});
