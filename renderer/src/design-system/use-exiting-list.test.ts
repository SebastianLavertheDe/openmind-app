import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExitingList } from "./use-exiting-list";

type Item = { id: string };
const item = (id: string): Item => ({ id });
const ids = (list: { item: Item }[]) => list.map((e) => e.item.id);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("useExitingList", () => {
  it("removes immediately without a timer under reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const { result, rerender } = renderHook(({ items }) => useExitingList(items, (x) => x.id, 200), {
      initialProps: { items: [item("a"), item("b")] }
    });
    rerender({ items: [item("a")] });
    expect(ids(result.current)).toEqual(["a"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes pending exits on a live preference change without stale removal after revival", () => {
    const listeners = new Set<() => void>();
    const media = { matches: false, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
    vi.spyOn(window, "matchMedia").mockReturnValue(media as unknown as MediaQueryList);
    const { result, rerender } = renderHook(({ items }) => useExitingList(items, (x) => x.id, 200), {
      initialProps: { items: [item("a"), item("b")] }
    });
    rerender({ items: [] });
    expect(result.current.every(entry => entry.leaving)).toBe(true);
    expect(vi.getTimerCount()).toBe(2);
    act(() => { media.matches = true; listeners.forEach(fn => fn()); });
    expect(result.current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { media.matches = false; listeners.forEach(fn => fn()); });
    rerender({ items: [item("b")] });
    act(() => vi.advanceTimersByTime(300));
    expect(ids(result.current)).toEqual(["b"]);
    expect(result.current[0].leaving).toBe(false);
  });

  it("settles immediately if exit duration becomes zero during an exit", () => {
    const { result, rerender } = renderHook(({ items, duration }) => useExitingList(items, (x) => x.id, duration), {
      initialProps: { items: [item("a")], duration: 200 }
    });
    rerender({ items: [], duration: 200 });
    expect(result.current[0].leaving).toBe(true);
    rerender({ items: [], duration: 0 });
    expect(result.current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a removed item as leaving, then drops it after the exit timer fires", () => {
    const { result, rerender } = renderHook(({ items }) => useExitingList(items, (x) => x.id, 200), {
      initialProps: { items: [item("a"), item("b")] }
    });

    rerender({ items: [item("a")] });
    expect(ids(result.current)).toEqual(["a", "b"]);
    expect(result.current[1].leaving).toBe(true);

    act(() => { vi.advanceTimersByTime(200); });
    expect(ids(result.current)).toEqual(["a"]);
  });

  it("cancels the exit timer when a middle item revives, so it does not jump to the end", () => {
    const { result, rerender } = renderHook(({ items }) => useExitingList(items, (x) => x.id, 200), {
      initialProps: { items: [item("a"), item("b"), item("c")] }
    });

    // remove b (middle) -> it stays in place as leaving
    rerender({ items: [item("a"), item("c")] });
    expect(ids(result.current)).toEqual(["a", "b", "c"]);
    expect(result.current[1].leaving).toBe(true);

    // revive b before its timer fires
    rerender({ items: [item("a"), item("b"), item("c")] });
    expect(ids(result.current)).toEqual(["a", "b", "c"]);
    expect(result.current[1].leaving).toBe(false);

    // advance well past the original exit window; the revived item must NOT be
    // removed/reordered by a stale timer.
    act(() => { vi.advanceTimersByTime(300); });
    expect(ids(result.current)).toEqual(["a", "b", "c"]);
  });

  it("places newly inserted items in the current input position", () => {
    const { result, rerender } = renderHook(({ items }) => useExitingList(items, (x) => x.id, 200), {
      initialProps: { items: [item("a"), item("c")] }
    });

    rerender({ items: [item("a"), item("b"), item("c")] });

    expect(ids(result.current)).toEqual(["a", "b", "c"]);
    expect(result.current.every((entry) => !entry.leaving)).toBe(true);
  });

  it("reflects a reorder of live items immediately", () => {
    const { result, rerender } = renderHook(({ items }) => useExitingList(items, (x) => x.id, 200), {
      initialProps: { items: [item("a"), item("b"), item("c")] }
    });

    rerender({ items: [item("c"), item("a"), item("b")] });

    expect(ids(result.current)).toEqual(["c", "a", "b"]);
    expect(result.current.every((entry) => !entry.leaving)).toBe(true);
  });

  it("keeps a replaced item leaving near its old neighbour without appending the replacement", () => {
    const { result, rerender } = renderHook(({ items }) => useExitingList(items, (x) => x.id, 200), {
      initialProps: { items: [item("a"), item("old"), item("c")] }
    });

    rerender({ items: [item("a"), item("new"), item("c")] });
    expect(ids(result.current)).toEqual(["a", "new", "old", "c"]);
    expect(result.current.find((entry) => entry.item.id === "old")?.leaving).toBe(true);
    expect(result.current.find((entry) => entry.item.id === "new")?.leaving).toBe(false);

    act(() => { vi.advanceTimersByTime(200); });
    expect(ids(result.current)).toEqual(["a", "new", "c"]);
  });
});
