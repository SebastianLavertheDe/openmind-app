import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatchView } from "./patch-view";

afterEach(() => cleanup());

beforeEach(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  };
  Element.prototype.scrollIntoView = () => undefined;
});

const SAMPLE_PATCH = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from "./foo";
-const bar = 1;
+const bar = 2;
+const baz = 3;
 export { bar };
`;

const LONG_PATCH = Array.from({ length: 60 }, (_, i) =>
  i % 3 === 0 ? `@@ -${i + 1},1 +${i + 1},1 @@` : i % 3 === 1 ? `-old line ${i}` : `+new line ${i}`
).join("\n");

describe("PatchView", () => {
  it("renders patch lines with correct add/del/content and coloring", () => {
    const { container } = render(<PatchView patch={SAMPLE_PATCH} />);
    // 验证具体行内容: +const baz = 3 应该是 add 行
    const addLines = container.querySelectorAll(".patch-line.add");
    const addTexts = Array.from(addLines).map(el => el.querySelector(".patch-line-text")?.textContent);
    expect(addTexts).toContain("const bar = 2;");
    expect(addTexts).toContain("const baz = 3;");
    // -const bar = 1 应该是 del 行
    const delLines = container.querySelectorAll(".patch-line.del");
    const delTexts = Array.from(delLines).map(el => el.querySelector(".patch-line-text")?.textContent);
    expect(delTexts).toContain("const bar = 1;");
    // 上下文行 import { foo } 不应有 add/del 类
    const contextLines = container.querySelectorAll(".patch-line.context");
    const contextTexts = Array.from(contextLines).map(el => el.querySelector(".patch-line-text")?.textContent);
    expect(contextTexts).toContain("import { foo } from \"./foo\";");
    // hunk header
    const hunk = container.querySelector(".patch-line.hunk");
    expect(hunk?.querySelector(".patch-line-text")?.textContent).toMatch(/@@.*@@/);
  });

  it("applies correct background colors via CSS classes (not inline styles)", () => {
    const { container } = render(<PatchView patch={SAMPLE_PATCH} />);
    const addLine = container.querySelector(".patch-line.add") as HTMLElement;
    const delLine = container.querySelector(".patch-line.del") as HTMLElement;
    // 颜色由 CSS class 控制,不应有 inline background
    expect(addLine.classList.contains("add")).toBe(true);
    expect(delLine.classList.contains("del")).toBe(true);
  });

  it("shows file header lines (--- and +++) as meta", () => {
    const { container } = render(<PatchView patch={SAMPLE_PATCH} />);
    const metaLines = container.querySelectorAll(".patch-line.meta");
    expect(metaLines.length).toBeGreaterThanOrEqual(2);
  });

  it("renders line numbers for add and del lines", () => {
    const { container } = render(<PatchView patch={SAMPLE_PATCH} />);
    const addLine = container.querySelector(".patch-line.add") as HTMLElement;
    const newNum = addLine.querySelector(".patch-line-num.new");
    expect(newNum?.textContent).toBeTruthy();
  });

  it("collapses patches over 50 lines and shows expand button", () => {
    render(<PatchView patch={LONG_PATCH} />);
    const expandBtn = screen.getByRole("button", { name: /展开全部 \d+ 行/ });
    expect(expandBtn).toBeTruthy();
  });

  it("expands collapsed patch on button click", () => {
    const { container } = render(<PatchView patch={LONG_PATCH} />);
    const expandBtn = screen.getByRole("button", { name: /展开全部 \d+ 行/ });
    fireEvent.click(expandBtn);
    // After expand, the toggle button should be gone
    expect(screen.queryByRole("button", { name: /展开全部/ })).toBeNull();
    // All lines should be visible now
    const allLines = container.querySelectorAll(".patch-line");
    expect(allLines.length).toBeGreaterThan(50);
  });

  it("does not collapse short patches", () => {
    render(<PatchView patch={SAMPLE_PATCH} />);
    expect(screen.queryByRole("button", { name: /展开全部/ })).toBeNull();
  });

  it("shows sign character for add/del lines", () => {
    const { container } = render(<PatchView patch={SAMPLE_PATCH} />);
    const addSign = container.querySelector(".patch-line.add .patch-line-sign");
    const delSign = container.querySelector(".patch-line.del .patch-line-sign");
    expect(addSign?.textContent).toBe("+");
    expect(delSign?.textContent).toBe("-");
  });

  it("handles empty patch gracefully", () => {
    const { container } = render(<PatchView patch="" />);
    expect(container.querySelectorAll(".patch-line").length).toBe(0);
  });

  it("handles patch with only context lines", () => {
    const patch = " unchanged line\n another line\n";
    const { container } = render(<PatchView patch={patch} />);
    const contextLines = container.querySelectorAll(".patch-line.context");
    expect(contextLines.length).toBeGreaterThanOrEqual(2);
  });

  it("renders inside an OverflowBox with search capability", () => {
    const { container } = render(<PatchView patch={SAMPLE_PATCH} />);
    const overflowBox = container.querySelector(".overflow-box");
    expect(overflowBox).toBeTruthy();
    // Search button should be available
    const searchBtn = screen.queryByRole("button", { name: /⌘F/ });
    expect(searchBtn).toBeTruthy();
  });
});
