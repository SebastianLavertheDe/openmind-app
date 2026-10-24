import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiSnapshot, ContentRecord, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../ai-context";
import { ContentPreview } from "./ContentPreview";

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
