import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { AnimatedDisclosure } from "./animated-disclosure";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function Harness({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <AnimatedDisclosure open={open} onOpenChange={setOpen} summary="更多">
      <button>内部按钮</button>
    </AnimatedDisclosure>
  );
}

function UnmountingHarness() {
  const [open, setOpen] = useState(false);
  return (
    <AnimatedDisclosure open={open} onOpenChange={setOpen} summary="详情" unmountOnExit exitMs={200}>
      <span>昂贵内容</span>
    </AnimatedDisclosure>
  );
}

describe("AnimatedDisclosure", () => {
  it("exposes aria-expanded/aria-controls and keeps content inert while closed", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "更多" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const contentId = trigger.getAttribute("aria-controls");
    expect(contentId).toBeTruthy();
    const content = document.getElementById(contentId as string) as HTMLElement;
    expect(content.hasAttribute("data-open")).toBe(false);
    expect(content.getAttribute("aria-hidden")).toBe("true");
    const inner = content.querySelector(".ui-disclosure-content-inner") as HTMLElement;
    expect(inner.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("button", { name: "内部按钮" })).toBeNull();
  });

  it("toggles open: aria-expanded flips, content becomes data-open and drops inert", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "更多" });
    const contentId = trigger.getAttribute("aria-controls") as string;
    const content = document.getElementById(contentId) as HTMLElement;
    const inner = content.querySelector(".ui-disclosure-content-inner") as HTMLElement;

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(content.hasAttribute("data-open")).toBe(true);
    expect(content.getAttribute("aria-hidden")).toBe("false");
    expect(inner.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("button", { name: "内部按钮" })).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(content.hasAttribute("data-open")).toBe(false);
    expect(content.getAttribute("aria-hidden")).toBe("true");
    expect(inner.hasAttribute("inert")).toBe(true);
  });

  it("respects a controlled initial open state", () => {
    render(<Harness initial />);
    const trigger = screen.getByRole("button", { name: "更多" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const content = document.getElementById(trigger.getAttribute("aria-controls") as string) as HTMLElement;
    expect(content.hasAttribute("data-open")).toBe(true);
  });

  it("unmounts opted-in content after its exit animation", () => {
    vi.useFakeTimers();
    render(<UnmountingHarness />);
    const trigger = screen.getByRole("button", { name: "详情" });
    expect(screen.queryByText("昂贵内容")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByText("昂贵内容")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByText("昂贵内容")).toBeTruthy();
    act(() => vi.advanceTimersByTime(199));
    expect(screen.getByText("昂贵内容")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("昂贵内容")).toBeNull();
  });
});
