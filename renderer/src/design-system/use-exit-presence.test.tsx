import { cleanup, renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExitPresence } from "./use-exit-presence";

afterEach(() => cleanup());

describe("useExitPresence (MOTION-QA-005)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows immediately on open and sets leaving+delayed unmount on close", () => {
    const { result } = renderHook(({ initial }) => useExitPresence(initial, 160), { initialProps: { initial: false } });

    // open=true → visible immediately, not leaving
    act(() => {
      result.current; // touch
    });
    const utils = renderHook(({ initial }) => useExitPresence(initial, 160), { initialProps: { initial: true } });
    expect(utils.result.current.visible).toBe(true);
    expect(utils.result.current.leaving).toBe(false);

    // open=false → leaving=true, still visible
    utils.rerender({ initial: false });
    expect(utils.result.current.leaving).toBe(true);
    expect(utils.result.current.visible).toBe(true);

    // after exitMs → visible=false, leaving=false
    act(() => { vi.advanceTimersByTime(160); });
    expect(utils.result.current.visible).toBe(false);
    expect(utils.result.current.leaving).toBe(false);
  });

  it("reopening during exit cancels the unmount timer", () => {
    const utils = renderHook(({ initial }) => useExitPresence(initial, 160), { initialProps: { initial: true } });
    // start closing
    utils.rerender({ initial: false });
    expect(utils.result.current.leaving).toBe(true);
    // reopen before timer fires
    utils.rerender({ initial: true });
    expect(utils.result.current.leaving).toBe(false);
    expect(utils.result.current.visible).toBe(true);
    // advance past exitMs — should still be visible (timer was cancelled)
    act(() => { vi.advanceTimersByTime(200); });
    expect(utils.result.current.visible).toBe(true);
  });

  it("skips exit delay under prefers-reduced-motion", () => {
    const matchMediaSpy = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const utils = renderHook(({ initial }) => useExitPresence(initial, 160), { initialProps: { initial: true } });
    utils.rerender({ initial: false });
    // reduced-motion → unmount immediately, no leaving phase
    expect(utils.result.current.visible).toBe(false);
    expect(utils.result.current.leaving).toBe(false);
    matchMediaSpy.mockRestore();
  });
});
