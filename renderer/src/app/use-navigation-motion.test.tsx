import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigationMotion } from "./use-navigation-motion";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.useRealTimers(); vi.restoreAllMocks(); });

function setup() {
  const shell = document.createElement("div");
  shell.className = "app-shell";
  shell.style.setProperty("--dur-slow", "240ms");
  const nav = document.createElement("aside");
  shell.append(nav);
  document.body.append(shell);
  const ref = { current: nav };
  const hook = renderHook(({ enabled, page }) => {
    const [collapsed, setCollapsed] = useState(false);
    return { collapsed, toggle: useNavigationMotion(ref, collapsed, setCollapsed, enabled, page) };
  }, { initialProps: { enabled: true, page: "ai" } });
  return { ...hook, shell, nav };
}

function endTransition(element: HTMLElement, propertyName: string) {
  element.dispatchEvent(Object.assign(new Event("transitionend", { bubbles: true }), { propertyName }));
}

describe("navigation motion", () => {
  it("enables bounded document measurement for both directions and releases it on completion", () => {
    const { result, shell, nav } = setup();
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(true);
    act(() => { endTransition(nav, "opacity"); endTransition(shell, "color"); });
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(true);
    act(() => endTransition(shell, "grid-template-columns"));
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(true);
  });

  it("retargets rapid clicks and cleans up even when batched clicks cause no transition", () => {
    const { result, shell } = setup();
    act(() => { result.current.toggle(); result.current.toggle(); });
    expect(result.current.collapsed).toBe(false);
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(true);
    act(() => vi.advanceTimersByTime(120));
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(false);
  });

  it("cancels animation on resize, route changes and unmount without losing the state", () => {
    const { result, shell, rerender, unmount } = setup();
    act(() => result.current.toggle());
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current.collapsed).toBe(true);
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(false);
    act(() => result.current.toggle());
    rerender({ enabled: true, page: "projects" });
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(false);
    act(() => result.current.toggle());
    unmount();
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps responsive drawers and reduced motion out of the desktop transition", () => {
    const { result, shell, rerender } = setup();
    rerender({ enabled: false, page: "ai" });
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(false);
    const matchMedia = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({ ...matchMedia(query), matches: true }));
    rerender({ enabled: true, page: "ai" });
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(shell.hasAttribute("data-nav-transitioning")).toBe(false);
  });
});
