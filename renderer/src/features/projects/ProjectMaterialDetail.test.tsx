import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { projectVideoMediaUrl } from "@shared/youtube-import";
import { FeedbackProvider } from "../../feedback-context";
import { ProjectMaterialDetail } from "./ProjectMaterialDetail";
import type { ProjectDetail } from "./types";

const project: ProjectDetail = { id: "fixture", name: "Fixture", description: "", status: "active", materialCount: 1, taskCount: 0, outputCount: 0, createdAt: "", updatedAt: "" };
const relativePath = "materials/videos/fixture.video.md";
const sourceUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const material = { relativePath, title: "Fixture video", kind: "video", status: "ready", source: { type: "url", url: sourceUrl } };
const video = { provider: "youtube", videoId: "dQw4w9WgXcQ", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1", sourceUrl, transcript: [] };

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

function mount() {
  const read = vi.fn().mockResolvedValue({ material, video });
  const retry = vi.fn().mockResolvedValue({ ...material, originalRelativePath: "materials/originals/fixture.mp4" });
  const onChanged = vi.fn();
  window.openmind = { readProjectMaterial: read, retryMaterialExtraction: retry, openExternal: vi.fn() } as unknown as DesktopApi;
  const content = (path = relativePath) => <FeedbackProvider><ProjectMaterialDetail project={project} materialPath={path} createRequested={false} onCreateHandled={vi.fn()} onChanged={onChanged} /></FeedbackProvider>;
  return { ...render(content()), read, retry, onChanged, content };
}

describe("video material refresh", () => {
  it("replaces an embedded player and empty transcript after downloading the selected video", async () => {
    const fixture = mount();
    const download = await screen.findByRole("button", { name: "下载到本地播放" });
    fixture.read.mockResolvedValue({ material, video: { ...video, localMediaUrl: projectVideoMediaUrl(project.name, relativePath), transcript: [{ startMs: 0, endMs: 3000, text: "Downloaded captions." }] } });
    fireEvent.click(download);
    await screen.findByText("Downloaded captions.");
    expect(fixture.container.querySelector("video")?.getAttribute("src")).toBe(projectVideoMediaUrl(project.name, relativePath));
    expect(fixture.container.querySelector("iframe")).toBeNull();
    expect(fixture.read).toHaveBeenCalledTimes(2);
    expect(fixture.retry).toHaveBeenCalledExactlyOnceWith({ projectName: project.name, relativePath });
    expect(fixture.onChanged).toHaveBeenCalledOnce();
  });

  it("keeps a failed retry visible with the original player available, then clears it on success", async () => {
    const fixture = mount();
    fixture.retry.mockRejectedValueOnce(new Error("YouTube requires verification."));
    fireEvent.click(await screen.findByRole("button", { name: "下载到本地播放" }));
    expect((await screen.findByRole("alert")).textContent).toBe("YouTube requires verification.");
    expect(fixture.container.querySelector("iframe")).toBeTruthy();
    expect(fixture.read).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "重新获取字幕" }));
    await waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the current selection when a previously selected video's download completes", async () => {
    const fixture = mount();
    let complete!: (value: unknown) => void;
    fixture.retry.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    fireEvent.click(await screen.findByRole("button", { name: "下载到本地播放" }));
    const otherPath = "materials/videos/other.video.md";
    fixture.read.mockResolvedValue({ material: { ...material, relativePath: otherPath, title: "Other video" }, video: { ...video, transcript: [{ startMs: 0, endMs: 3000, text: "Other captions." }] } });
    fixture.rerender(fixture.content(otherPath));
    await screen.findByText("Other captions.");
    await act(async () => { complete(material); });
    expect(screen.getByText("Other captions.")).toBeTruthy();
    expect(fixture.read).toHaveBeenCalledTimes(2);
    expect(fixture.container.querySelector("iframe")?.getAttribute("title")).toBe("Other video");
  });
});
