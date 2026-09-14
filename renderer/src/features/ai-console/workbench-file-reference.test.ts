import { describe, expect, it } from "vitest";
import { isBinaryPreviewPath } from "../file-preview/workspace-file-source";

describe("isBinaryPreviewPath", () => {
  it("flags media and archive extensions", () => {
    expect(isBinaryPreviewPath("a.pdf")).toBe(true);
    expect(isBinaryPreviewPath("materials/originals/x.PNG")).toBe(true);
    expect(isBinaryPreviewPath("watch.mp4")).toBe(true);
  });

  it("treats text documents as previewable", () => {
    expect(isBinaryPreviewPath(".openmind-project.json")).toBe(false);
    expect(isBinaryPreviewPath("Agentic Design Patterns.md")).toBe(false);
  });
});
