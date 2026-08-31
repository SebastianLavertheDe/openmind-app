import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Project narrow actions", () => {
  it("keeps the project rename and archive menu available at 720px", () => {
    const css = readFileSync(resolve(process.cwd(), "renderer/src/styles/features/projects.css"), "utf8");

    expect(css).not.toContain(".project-more-menu { display: none; }");
    expect(css).toContain(".project-more-menu > div { max-width: calc(100vw - 24px); }");
  });
});
