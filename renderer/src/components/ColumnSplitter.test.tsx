import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnSplitter } from "./ColumnSplitter";

beforeAll(() => {
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => undefined;
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => undefined;
});

let frameCallback: FrameRequestCallback | null = null;
beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frameCallback = callback; return 1; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => { frameCallback = null; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); frameCallback = null; });
function frame() { const callback = frameCallback; frameCallback = null; act(() => callback?.(16)); }

function setupLeft(overrides: Partial<{
  collapsed: boolean;
  toggle: () => void;
  resize: (delta: number) => void;
  reset: () => void;
  onResizeStart: () => void;
  onResizeCancel: () => void;
  onResizeActiveChange: (active: boolean) => void;
}> = {}) {
  const toggle = overrides.toggle ?? vi.fn();
  const resize = overrides.resize ?? vi.fn();
  const reset = overrides.reset ?? vi.fn();
  const onResizeStart = overrides.onResizeStart ?? vi.fn();
  const onResizeCancel = overrides.onResizeCancel ?? vi.fn();
  render(
    <ColumnSplitter
      side="left"
      collapsed={overrides.collapsed ?? false}
      ariaLabel="筛选栏宽度"
      toggle={toggle}
      resize={resize}
      reset={reset}
      onResizeStart={onResizeStart}
      onResizeCancel={onResizeCancel}
      onResizeActiveChange={overrides.onResizeActiveChange}
    />
  );
  return { toggle, resize, reset, onResizeStart, onResizeCancel };
}

describe("ColumnSplitter", () => {
  it("renders as a separator with the provided aria label and value range", () => {
    render(
      <ColumnSplitter
        side="left"
        collapsed={false}
        ariaLabel="筛选栏宽度"
        ariaValueMin={160}
        ariaValueMax={280}
        ariaValueNow={220}
        toggle={vi.fn()}
        resize={vi.fn()}
        reset={vi.fn()}
        onResizeStart={vi.fn()}
        onResizeCancel={vi.fn()}
      />
    );
    const separator = screen.getByRole("separator", { name: "筛选栏宽度" });
    expect(separator).toBeTruthy();
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-valuemin")).toBe("160");
    expect(separator.getAttribute("aria-valuemax")).toBe("280");
    expect(separator.getAttribute("aria-valuenow")).toBe("220");
  });

  it("the collapse button calls toggle without triggering resize", async () => {
    const user = userEvent.setup();
    const { toggle, resize } = setupLeft();
    await user.click(screen.getByRole("button", { name: "收起面板" }));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(resize).not.toHaveBeenCalled();
  });

  it("Enter and Space both toggle collapse", async () => {
    const user = userEvent.setup();
    const { toggle } = setupLeft();
    const separator = screen.getByRole("separator", { name: "筛选栏宽度" });
    separator.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("Home calls reset", async () => {
    const user = userEvent.setup();
    const { reset } = setupLeft();
    const separator = screen.getByRole("separator", { name: "筛选栏宽度" });
    separator.focus();
    await user.keyboard("{Home}");
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("double-click calls reset", async () => {
    const user = userEvent.setup();
    const { reset } = setupLeft();
    await user.dblClick(screen.getByRole("separator", { name: "筛选栏宽度" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("left side ArrowLeft resizes by -16 and ArrowRight by +16", async () => {
    const user = userEvent.setup();
    const { resize } = setupLeft();
    const separator = screen.getByRole("separator", { name: "筛选栏宽度" });
    separator.focus();
    await user.keyboard("{ArrowLeft}");
    expect(resize).toHaveBeenLastCalledWith(-16);
    await user.keyboard("{ArrowRight}");
    expect(resize).toHaveBeenLastCalledWith(16);
  });

  it("right side keeps arrows aligned with physical separator movement", async () => {
    const user = userEvent.setup();
    const resize = vi.fn();
    render(
      <ColumnSplitter
        side="right"
        collapsed={false}
        ariaLabel="内容栏宽度"
        toggle={vi.fn()}
        resize={resize}
        reset={vi.fn()}
        onResizeStart={vi.fn()}
        onResizeCancel={vi.fn()}
      />
    );
    const separator = screen.getByRole("separator", { name: "内容栏宽度" });
    separator.focus();
    await user.keyboard("{ArrowLeft}");
    expect(resize).toHaveBeenLastCalledWith(-16);
    await user.keyboard("{ArrowRight}");
    expect(resize).toHaveBeenLastCalledWith(16);
  });

  it("notifies when pointer resizing starts and ends", () => {
    const resize = vi.fn();
    const onResizeStart = vi.fn();
    const onResizeCancel = vi.fn();
    const onResizeActiveChange = vi.fn();
    render(
      <ColumnSplitter
        side="right"
        collapsed={false}
        ariaLabel="内容栏宽度"
        toggle={vi.fn()}
        resize={resize}
        reset={vi.fn()}
        onResizeStart={onResizeStart}
        onResizeCancel={onResizeCancel}
        onResizeActiveChange={onResizeActiveChange}
      />
    );

    const separator = screen.getByRole("separator", { name: "内容栏宽度" });
    fireEvent(separator, pointerEvent("pointerdown", 100));
    expect(onResizeStart).toHaveBeenCalledTimes(1);
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(true);

    window.dispatchEvent(pointerEvent("pointermove", 118));
    expect(resize).not.toHaveBeenCalled();
    frame();
    expect(resize).toHaveBeenLastCalledWith(18);

    window.dispatchEvent(pointerEvent("pointerup", 118));
    expect(onResizeCancel).not.toHaveBeenCalled();
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("uses the consumer cancel contract on Escape instead of reversing raw deltas", () => {
    const resize = vi.fn();
    const onResizeCancel = vi.fn();
    const onResizeActiveChange = vi.fn();
    setupLeft({ resize, onResizeCancel, onResizeActiveChange });

    const separator = screen.getByRole("separator", { name: "筛选栏宽度" });
    fireEvent(separator, pointerEvent("pointerdown", 100));
    window.dispatchEvent(pointerEvent("pointermove", 300));
    frame();
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(escape);

    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenLastCalledWith(200);
    expect(onResizeCancel).toHaveBeenCalledTimes(1);
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(false);
    expect(escape.defaultPrevented).toBe(true);
  });

  it("cancels a resize when pointer capture is interrupted", () => {
    const onResizeCancel = vi.fn();
    setupLeft({ onResizeCancel });

    const separator = screen.getByRole("separator", { name: "筛选栏宽度" });
    fireEvent(separator, pointerEvent("pointerdown", 100));
    window.dispatchEvent(pointerEvent("pointercancel", 100));

    expect(onResizeCancel).toHaveBeenCalledTimes(1);
  });

  it("coalesces pointer moves and commits the last position on release", () => {
    const { resize } = setupLeft();
    fireEvent(screen.getByRole("separator"), pointerEvent("pointerdown", 100));
    window.dispatchEvent(pointerEvent("pointermove", 110));
    window.dispatchEvent(pointerEvent("pointermove", 130));
    frame();
    expect(resize).toHaveBeenCalledExactlyOnceWith(30);
    window.dispatchEvent(pointerEvent("pointerup", 145));
    expect(resize).toHaveBeenLastCalledWith(15);
  });

  it("discards uncommitted movement when Escape cancels", () => {
    const { resize, onResizeCancel } = setupLeft();
    fireEvent(screen.getByRole("separator"), pointerEvent("pointerdown", 100));
    window.dispatchEvent(pointerEvent("pointermove", 300));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    frame();
    expect(resize).not.toHaveBeenCalled();
    expect(onResizeCancel).toHaveBeenCalledOnce();
  });
});

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { clientX: number; pointerId: number };
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}
