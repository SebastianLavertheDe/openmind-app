import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Tooltip", () => {
  it("opens after the pointer delay and exits before unmounting", () => {
    vi.useFakeTimers();
    render(<Tooltip content="刷新" delayMs={150}><button aria-label="刷新" title="native">R</button></Tooltip>);
    const trigger = screen.getByRole("button", { name: "刷新" });

    expect(trigger.getAttribute("title")).toBeNull();
    fireEvent.mouseEnter(trigger);
    act(() => vi.advanceTimersByTime(149));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(1));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("刷新");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);

    fireEvent.mouseLeave(trigger);
    expect(screen.getByRole("tooltip").hasAttribute("data-leaving")).toBe(true);
    act(() => vi.advanceTimersByTime(140));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens immediately for keyboard focus and closes on Escape", () => {
    vi.useFakeTimers();
    render(<Tooltip content="帮助"><button aria-label="帮助">?</button></Tooltip>);
    const trigger = screen.getByRole("button", { name: "帮助" });

    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe("帮助");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.getByRole("tooltip").hasAttribute("data-leaving")).toBe(true);
  });

  it("preserves trigger handlers", () => {
    const onMouseEnter = vi.fn();
    const onClick = vi.fn();
    render(<Tooltip content="操作"><button aria-label="操作" onMouseEnter={onMouseEnter} onClick={onClick}>A</button></Tooltip>);
    const trigger = screen.getByRole("button", { name: "操作" });

    fireEvent.mouseEnter(trigger);
    fireEvent.click(trigger);
    expect(onMouseEnter).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("supports side placement for collapsed navigation rails", () => {
    render(<Tooltip content="资料库" side="right"><button aria-label="资料库">D</button></Tooltip>);
    fireEvent.focus(screen.getByRole("button", { name: "资料库" }));
    expect(screen.getByRole("tooltip").getAttribute("data-side")).toBe("right");
  });
});
