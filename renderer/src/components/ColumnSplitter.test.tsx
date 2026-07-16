import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ColumnSplitter } from "./ColumnSplitter";

beforeAll(() => {
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => undefined;
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => undefined;
});

afterEach(cleanup);

function setupLeft(overrides: Partial<{
  collapsed: boolean;
  toggle: () => void;
  resize: (delta: number) => void;
  reset: () => void;
  onResizeActiveChange: (active: boolean) => void;
}> = {}) {
  const toggle = overrides.toggle ?? vi.fn();
  const resize = overrides.resize ?? vi.fn();
  const reset = overrides.reset ?? vi.fn();
  render(
    <ColumnSplitter
      side="left"
      collapsed={overrides.collapsed ?? false}
      ariaLabel="筛选栏宽度"
      toggle={toggle}
      resize={resize}
      reset={reset}
      onResizeActiveChange={overrides.onResizeActiveChange}
    />
  );
  return { toggle, resize, reset };
}

describe("ColumnSplitter", () => {
  it("renders as a separator with the provided aria label", () => {
    setupLeft();
    const separator = screen.getByRole("separator", { name: "筛选栏宽度" });
    expect(separator).toBeTruthy();
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
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

  it("right side reverses arrow direction", async () => {
    const user = userEvent.setup();
    const resize = vi.fn();
    render(
      <ColumnSplitter side="right" collapsed={false} ariaLabel="内容栏宽度" toggle={vi.fn()} resize={resize} reset={vi.fn()} />
    );
    const separator = screen.getByRole("separator", { name: "内容栏宽度" });
    separator.focus();
    await user.keyboard("{ArrowLeft}");
    expect(resize).toHaveBeenLastCalledWith(16);
    await user.keyboard("{ArrowRight}");
    expect(resize).toHaveBeenLastCalledWith(-16);
  });

  it("notifies when pointer resizing starts and ends", () => {
    const resize = vi.fn();
    const onResizeActiveChange = vi.fn();
    render(
      <ColumnSplitter
        side="right"
        collapsed={false}
        ariaLabel="内容栏宽度"
        toggle={vi.fn()}
        resize={resize}
        reset={vi.fn()}
        onResizeActiveChange={onResizeActiveChange}
      />
    );

    const separator = screen.getByRole("separator", { name: "内容栏宽度" });
    fireEvent(separator, pointerEvent("pointerdown", 100));
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(true);

    window.dispatchEvent(pointerEvent("pointermove", 118));
    expect(resize).toHaveBeenLastCalledWith(18);

    window.dispatchEvent(pointerEvent("pointerup", 118));
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(false);
  });
});

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { clientX: number; pointerId: number };
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}
