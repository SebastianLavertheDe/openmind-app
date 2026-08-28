import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bell, CircleHelp, Search } from "lucide-react";
import { ResponsiveActionBar, ResponsiveContextBadge, type ResponsiveAction } from "./ResponsiveActionBar";

afterEach(cleanup);

function actions(onHelp = vi.fn()): ResponsiveAction[] {
  return [
    { id: "search", label: "搜索全部内容", displayLabel: "搜索", shortLabel: "搜索", icon: Search, priority: "essential", onSelect: vi.fn() },
    { id: "alerts", label: "通知", icon: Bell, priority: "primary", badge: 2, onSelect: vi.fn() },
    { id: "help", label: "帮助", icon: CircleHelp, priority: "secondary", onSelect: onHelp }
  ];
}

describe("ResponsiveActionBar", () => {
  it("renders full labels without an overflow menu in full presentation", () => {
    const { container } = render(<ResponsiveActionBar actions={actions()} presentation="full" />);
    expect(container.querySelector('[aria-label="搜索全部内容"]')?.textContent).toContain("搜索");
    expect(container.querySelector('[aria-label="通知"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="帮助"]')).toBeTruthy();
    expect(container.querySelector(".ui-dropdown")).toBeNull();
  });

  it("moves secondary actions into overflow in compact presentation", () => {
    const onHelp = vi.fn();
    const { container } = render(<ResponsiveActionBar actions={actions(onHelp)} presentation="compact" overflowLabel="更多" />);
    expect(container.querySelector('[aria-label="搜索全部内容"]')?.textContent).toContain("搜索");
    fireEvent.click(container.querySelector(".ui-dropdown-trigger") as HTMLElement);
    const overflowItem = document.querySelector('.ui-dropdown-menu [role="menuitem"]') as HTMLButtonElement;
    expect(overflowItem.textContent).toContain("帮助");
    expect(overflowItem.dataset.motion).toBe("action");
    fireEvent.click(overflowItem);
    expect(onHelp).toHaveBeenCalledOnce();
    expect(container.querySelector(".ui-dropdown")?.hasAttribute("data-open")).toBe(false);
  });

  it("keeps only essential actions visible in minimal presentation", () => {
    const { container } = render(<ResponsiveActionBar actions={actions()} presentation="minimal" />);
    expect(container.querySelectorAll(":scope > .ui-responsive-actions > .ui-responsive-action")).toHaveLength(1);
    fireEvent.click(container.querySelector(".ui-dropdown-trigger") as HTMLElement);
    expect(document.querySelectorAll('.ui-dropdown-menu [role="menuitem"]')).toHaveLength(2);
  });

  it("keeps warning context visible while hiding secondary healthy context", () => {
    const { container, rerender } = render(<ResponsiveContextBadge presentation="minimal" priority="secondary" label="已连接" />);
    expect(container.textContent).toBe("");
    rerender(<ResponsiveContextBadge presentation="minimal" priority="essential" label="预览环境" tone="warning" />);
    expect(container.textContent).toContain("预览环境");
  });

  it("keeps collapsing actions and labels inert during their exit motion", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<ResponsiveActionBar actions={actions()} presentation="full" overflowLabel="更多" />);

      rerender(<ResponsiveActionBar actions={actions()} presentation="minimal" overflowLabel="更多" />);

      const exitingNotification = container.querySelector('.ui-responsive-action[aria-label="通知"]') as HTMLButtonElement;
      const exitingLabel = container.querySelector('.ui-responsive-action[aria-label="搜索全部内容"] .ui-responsive-action-label') as HTMLElement;
      expect(exitingNotification.dataset.leaving).toBe("true");
      expect(exitingNotification.hasAttribute("inert")).toBe(true);
      expect(exitingLabel.dataset.leaving).toBe("true");
      expect(container.querySelector(".ui-responsive-overflow-presence")).toBeTruthy();

      act(() => { vi.advanceTimersByTime(140); });

      expect(container.querySelector('.ui-responsive-action[aria-label="通知"]')).toBeNull();
      expect(container.querySelector('.ui-responsive-action[aria-label="搜索全部内容"] .ui-responsive-action-label')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a hidden context badge mounted and inert until its exit completes", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<ResponsiveContextBadge presentation="full" priority="secondary" label="已连接" />);
      rerender(<ResponsiveContextBadge presentation="minimal" priority="secondary" label="已连接" />);

      const leaving = container.querySelector(".ui-responsive-context") as HTMLElement;
      expect(leaving.dataset.leaving).toBe("true");
      expect(leaving.hasAttribute("inert")).toBe(true);

      act(() => { vi.advanceTimersByTime(140); });
      expect(container.querySelector(".ui-responsive-context")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
