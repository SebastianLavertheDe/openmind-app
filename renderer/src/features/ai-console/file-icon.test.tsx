import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { fileIcon, fileIconColor } from "./file-icon";

describe("fileIcon", () => {
  it("returns FileCode2 icon for TypeScript paths", () => {
    const { container } = render(<>{fileIcon("src/app.ts")}</>);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("class")).toContain("lucide-file-code");
  });

  it("returns FileCode2 icon for bare extension 'tsx'", () => {
    const { container } = render(<>{fileIcon("tsx")}</>);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("lucide-file-code");
  });

  it("returns Braces icon for JSON files", () => {
    const { container } = render(<>{fileIcon("config.json")}</>);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("lucide-braces");
  });

  it("returns Braces icon for YAML files", () => {
    const { container } = render(<>{fileIcon("config.yaml")}</>);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("lucide-braces");
  });

  it("returns FileText icon for unknown extensions", () => {
    const { container } = render(<>{fileIcon("readme.md")}</>);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("lucide-file-text");
  });

  it("returns FileText icon for no extension", () => {
    const { container } = render(<>{fileIcon("Makefile")}</>);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("lucide-file-text");
  });

  it("uses custom size", () => {
    const { container } = render(<>{fileIcon("app.ts", 20)}</>);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("height")).toBe("20");
  });

  it("handles uppercase extensions case-insensitively", () => {
    const { container } = render(<>{fileIcon("app.TS")}</>);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("lucide-file-code");
  });
});

describe("fileIconColor", () => {
  it("returns blue for TypeScript", () => {
    expect(fileIconColor("app.ts")).toBe("#3178c6");
  });

  it("returns yellow for JavaScript", () => {
    expect(fileIconColor("app.js")).toBe("#eab308");
  });

  it("returns blue for Python", () => {
    expect(fileIconColor("app.py")).toBe("#3776ab");
  });

  it("returns amber for JSON", () => {
    expect(fileIconColor("config.json")).toBe("#b7791f");
  });

  it("returns red for YAML", () => {
    expect(fileIconColor("config.yml")).toBe("#cb171e");
  });

  it("returns muted for unknown", () => {
    expect(fileIconColor("readme.md")).toBe("var(--muted)");
  });

  it("works with bare extension", () => {
    expect(fileIconColor("ts")).toBe("#3178c6");
  });
});
