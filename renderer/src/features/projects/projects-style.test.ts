import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Project narrow actions", () => {
  it("keeps the project rename and archive menu available at 720px", () => {
    const css = readFileSync(resolve(process.cwd(), "renderer/src/styles/features/projects.css"), "utf8");

    expect(css).not.toContain(".project-more-menu { display: none; }");
    expect(css).toContain(".project-more-menu > div { max-width: calc(100vw - 24px); }");
  });

  it("keeps project dialog fields neutral while focused", () => {
    const css = readFileSync(resolve(process.cwd(), "renderer/src/styles/features/projects.css"), "utf8");
    const focusRule = css.match(/\.project-field input:focus,[\s\S]*?box-shadow: none;\s*}/)?.[0] ?? "";

    expect(focusRule).toContain(".project-field input:focus-visible");
    expect(focusRule).toContain(".project-field textarea:focus-visible");
    expect(focusRule).toContain("border-color: var(--border);");
    expect(focusRule).toContain("outline: none;");
    expect(focusRule).not.toContain("var(--accent)");
  });

  it("keeps the project list and detail canvas on the same panel surface", () => {
    const css = readFileSync(resolve(process.cwd(), "renderer/src/styles/features/projects.css"), "utf8");

    expect(css).toMatch(/\.project-main-pane\s*{[^}]*background: var\(--panel\);[^}]*}/);
    expect(css).not.toMatch(/\.project-main-pane\s*{[^}]*background: var\(--bg\);[^}]*}/);
  });
});
