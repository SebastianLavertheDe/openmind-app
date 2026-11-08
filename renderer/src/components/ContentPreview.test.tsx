import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, ContentRecord, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../ai-context";
import { ContentPreview } from "./ContentPreview";
import { FilePreviewProvider } from "../features/ai-console/file-preview-context";

const snapshot: AiSnapshot = { projectRoot: "/fixture", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const opml = '<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <body>\n    <outline text="Example Feed" xmlUrl="https://example.invalid/feed.xml" />\n  </body>\n</opml>';

beforeEach(() => {
  window.openmind = { onAiEvent: () => () => {} } as unknown as DesktopApi;
});
afterEach(cleanup);

function preview(content: ContentRecord) {
  return render(<AiProvider initial={snapshot}><ContentPreview content={content} layout="file" /></AiProvider>);
}

describe("ContentPreview file formats", () => {
  it.each([
    ["../article/20261101/rss-example.md", "openmind/article/20261101/rss-example.md"],
    ["..\\article\\20261101\\rss-example.md", "openmind/article/20261101/rss-example.md"],
    ["file:///D:/work/openmind/article/source%20file.md", "D:/work/openmind/article/source file.md"]
  ])("opens source link %s in the shared file preview", (href, expected) => {
    const open = vi.fn();
    render(<AiProvider initial={snapshot}><FilePreviewProvider open={open}><ContentPreview content={{
      path: "openmind/daily-summary/20261101_daily_summary.md", content: `[源文件](<${href}>)\n\n[原文](https://example.com/article)`
    }} /></FilePreviewProvider></AiProvider>);
    const link = screen.getByRole("link", { name: "源文件" });
    expect(link.getAttribute("target")).toBeNull();
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith(expected, undefined);
    const external = screen.getByRole("link", { name: "原文" });
    expect(external.getAttribute("href")).toBe("https://example.com/article");
    expect(external.getAttribute("target")).toBe("_blank");
  });

  it("preserves project ownership when following a document link", () => {
    const open = vi.fn();
    render(<AiProvider initial={snapshot}><FilePreviewProvider open={open}><ContentPreview content={{
      path: "openmind/projects/示例/outputs/draft.md", content: "[素材](../materials/source.md)\n\n[越界](../../../article/private.md)"
    }} /></FilePreviewProvider></AiProvider>);
    fireEvent.click(screen.getByRole("link", { name: "素材" }));
    expect(open).toHaveBeenCalledWith("openmind/projects/示例/materials/source.md", { projectName: "示例" });
    expect(screen.getByText("越界").getAttribute("href")).toBeNull();
  });

  it.each([
    ["subscriptions.opml", opml],
    ["subscriptions.OPML", opml],
    ["subscriptions.opml", `<!DOCTYPE opml>\n${opml}`],
    ["subscriptions.xml", `<!DOCTYPE opml>\n${opml}`],
    ["example.ts", 'const template = "<html><body>Example</body></html>";']
  ])("preserves %s as literal source instead of swallowing its markup", (path, raw) => {
    const { container } = preview({ path, name: path, content: raw });
    expect(container.querySelector(".document-plain .document-flow")?.textContent).toBe(raw);
    expect(container.querySelector("iframe, opml, outline")).toBeNull();
  });

  it("honors explicit OPML extension metadata", () => {
    const { container } = preview({ path: "subscriptions", ext: ".opml", content: opml });
    expect(container.querySelector(".document-plain .document-flow")?.textContent).toBe(opml);
  });

  it("keeps HTML in its sandboxed preview", () => {
    const html = "<!doctype html><html><body><h1>Preview</h1></body></html>";
    const { container } = preview({ path: "page.html", content: html });
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("srcdoc")).toBe(html);
  });

  it("keeps Markdown rendering for articles", () => {
    preview({ path: "article.md", content: "# Article heading\n\n**Article body**" });
    expect(screen.getByRole("heading", { name: "Article heading" })).toBeTruthy();
    expect(screen.getByText("Article body").tagName).toBe("STRONG");
  });
});
