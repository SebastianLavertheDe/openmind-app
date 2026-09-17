import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreviewMotion } from "./use-preview-motion";

beforeEach(() => { document.documentElement.style.cssText = "--dur-slow: 310ms; --ease-emphasized: cubic-bezier(.12, .3, .4, 1)"; });
afterEach(() => { document.documentElement.removeAttribute("style"); vi.restoreAllMocks(); });

describe("preview pane motion", () => {
  it("waits for presence, then moves between fixed layouts and can reverse mid-flight", () => {
    const element = document.createElement("section");
    let box = { left: 0, width: 1000 };
    element.getBoundingClientRect = () => box as DOMRect;
    const animations: Array<{ cancel: ReturnType<typeof vi.fn>; finished: Promise<void> }> = [];
    element.animate = vi.fn(() => {
      const animation = { cancel: vi.fn(), finished: new Promise<void>(() => {}) };
      animations.push(animation);
      return animation;
    }) as unknown as HTMLElement["animate"];
    const ref = { current: element };
    const { result, rerender, unmount } = renderHook(({ open, visible }) => usePreviewMotion(ref, open, visible, "split"), { initialProps: { open: false, visible: false } });

    act(() => result.current.capture());
    rerender({ open: true, visible: false });
    expect(element.animate).not.toHaveBeenCalled();
    box = { left: 560, width: 440 };
    rerender({ open: true, visible: true });
    expect(element.animate).toHaveBeenCalledOnce();
    expect(vi.mocked(element.animate).mock.calls[0][1]).toEqual({ duration: 310, easing: "cubic-bezier(0.12, 0.3, 0.4, 1)", fill: "both" });
    expect(vi.mocked(element.animate).mock.calls[0][0]).toEqual([
      { transformOrigin: "top left", transform: `translateX(-560px) scaleX(${1000 / 440})` },
      { transformOrigin: "top left", transform: "translateX(0) scaleX(1)" }
    ]);
    // Capture the visible position, including an interrupted transform.
    box = { left: 280, width: 720 };
    act(() => result.current.capture());
    box = { left: 0, width: 1000 };
    rerender({ open: false, visible: true });
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(vi.mocked(element.animate).mock.calls[1][0]).toEqual([
      { transformOrigin: "top left", transform: "translateX(280px) scaleX(0.72)" },
      { transformOrigin: "top left", transform: "translateX(0) scaleX(1)" }
    ]);
    unmount();
    expect(animations[1].cancel).toHaveBeenCalled();
  });

  it.each(["resize", "reduced-motion"])("cancels an active preview transition on %s", (reason) => {
    const preference = Object.assign(new EventTarget(), { matches: false });
    vi.spyOn(window, "matchMedia").mockReturnValue(preference as MediaQueryList);
    const element = document.createElement("section");
    let width = 1000;
    element.getBoundingClientRect = () => ({ left: 0, width }) as DOMRect;
    const cancel = vi.fn();
    element.animate = vi.fn(() => ({ cancel, finished: new Promise<void>(() => {}) })) as unknown as HTMLElement["animate"];
    const ref = { current: element };
    const { result, rerender, unmount } = renderHook(({ open }) => usePreviewMotion(ref, open, true, "split"), { initialProps: { open: false } });
    act(() => result.current.capture());
    width = 440;
    rerender({ open: true });
    expect(element.animate).toHaveBeenCalledOnce();
    act(() => {
      if (reason === "resize") window.dispatchEvent(new Event("resize"));
      else { preference.matches = true; preference.dispatchEvent(new Event("change")); }
    });
    expect(cancel).toHaveBeenCalledOnce();
    if (reason === "reduced-motion") {
      act(() => result.current.capture());
      width = 1000;
      rerender({ open: false });
      expect(element.animate).toHaveBeenCalledOnce();
    }
    unmount();
  });
});
