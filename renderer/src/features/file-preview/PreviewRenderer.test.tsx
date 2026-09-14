import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewRenderer } from "./PreviewRenderer";
import { documentPreviewResource, type PreviewResource } from "./model";

vi.mock("./renderers/PdfPreview", () => ({
  default: ({ resource }: { resource: { title: string } }) => <div data-testid="pdf-preview">{resource.title}</div>
}));
vi.mock("./renderers/DocumentPreview", () => ({
  DocumentPreview: ({ resource, content }: { resource: { record: { content?: string } }; content?: string }) => <h1>{(content ?? resource.record.content)?.replace(/^#\s*/, "")}</h1>
}));

describe("PreviewRenderer", () => {
  it("routes documents and applies the current draft", () => {
    const resource = documentPreviewResource({ path: "note.md", name: "note.md", content: "# Persisted" });
    render(<PreviewRenderer resource={resource} content="# Draft" />);
    expect(screen.getByRole("heading", { name: "Draft" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Persisted" })).toBeNull();
  });

  it.each<PreviewResource>([
    { kind: "pdf", id: "pdf", path: "report.pdf", title: "Report", data: new Uint8Array([1]) },
    { kind: "video", id: "video", path: "video.md", title: "Video", playback: { kind: "external-only", sourceUrl: "https://example.com/video.mp4" }, transcript: [] },
    { kind: "unsupported", id: "binary", path: "archive.zip", title: "Archive", reason: "不支持此格式" }
  ])("routes the $kind resource", async (resource) => {
    const view = render(<PreviewRenderer resource={resource} />);
    if (resource.kind === "pdf") expect((await screen.findByTestId("pdf-preview")).textContent).toBe("Report");
    if (resource.kind === "video") expect(await screen.findByText("当前链接无法安全内嵌播放")).toBeTruthy();
    if (resource.kind === "unsupported") expect(screen.getByText("不支持此格式")).toBeTruthy();
    view.unmount();
  });
});
