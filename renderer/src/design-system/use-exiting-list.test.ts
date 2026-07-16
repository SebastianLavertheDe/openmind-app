import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExitingList } from "./use-exiting-list";

type Item = { id: string };
const item = (id: string): Item => ({ id });
const ids = (list: { item: Item }[]) => list.map((e) => e.item.id);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useExitingList", () => {
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
