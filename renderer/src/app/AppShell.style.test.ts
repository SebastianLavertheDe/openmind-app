import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AppShell layout performance styles", () => {
  it("switches navigation grid tracks atomically", () => {
    const styles = [
      "renderer/src/styles/shell.css",
      "renderer/src/styles/final-polish.css",
      "renderer/src/styles/workbuddy-refactor.css"
    ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");

    expect(styles).not.toMatch(/@property\s+--nav-width\b/);
    expect(styles).not.toMatch(/transition(?:-property)?\s*:[^;{}]*grid-template-columns/);
  });
});
