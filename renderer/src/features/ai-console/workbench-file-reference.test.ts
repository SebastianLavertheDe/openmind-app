import { describe, expect, it } from "vitest";
import { isBinaryPreviewPath, projectPreviewCandidates } from "./AiWorkbench";

describe("projectPreviewCandidates", () => {
  it("resolves bare project files to the owning Project logical path", () => {
    expect(projectPreviewCandidates(".openmind-project.json", "AI安全")).toEqual([
      "openmind/projects/AI安全/.openmind-project.json"
    ]);
  });

  it("resolves relative material paths with directories", () => {
    expect(projectPreviewCandidates("materials/originals/Agentic Design Patterns.pdf", "2")).toEqual([
      "openmind/projects/2/materials/originals/Agentic Design Patterns.pdf"
    ]);
  });

  it("keeps logical openmind paths and rejects nothing for them", () => {
    expect(projectPreviewCandidates("openmind/projects/2/outputs/a.md", "2")).toEqual([
      "openmind/projects/2/outputs/a.md"
    ]);
  });

  it("passes absolute paths through for the main-process boundary check", () => {
    expect(projectPreviewCandidates("D:\\work\\openmind\\projects\\2\\a.md", "2")).toEqual([
      "D:/work/openmind/projects/2/a.md"
    ]);
  });

  it("returns no candidates without a project name", () => {
    expect(projectPreviewCandidates("a.md", "")).toEqual([]);
  });
});

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
