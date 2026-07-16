import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIST_WIDTH_MAX, LIST_WIDTH_MIN, useListDetailLayout } from "./useListDetailLayout";

const DEFAULTS = { listWidth: 210, listCollapsed: false };
const STORAGE_KEY = "cctools.list-detail.creative.v1";
const LEGACY_KEY = "cctools.three-pane.creative.v2";

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("useListDetailLayout", () => {
  it("initializes from defaults and persists a versioned schema", () => {
    const { result } = renderHook(() => useListDetailLayout(STORAGE_KEY, DEFAULTS));

    expect(result.current.layout).toEqual(DEFAULTS);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null")).toEqual({
      schemaVersion: 1,
      listWidth: 210,
      listCollapsed: false
    });
  });

  it("restores a valid current layout", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      listWidth: 250,
      listCollapsed: true
    }));

    const { result } = renderHook(() => useListDetailLayout(STORAGE_KEY, DEFAULTS));
    expect(result.current.layout).toEqual({ listWidth: 250, listCollapsed: true });
  });

  it("migrates the legacy filter state and ignores dead item state", () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify({
      filterWidth: 245,
      filterCollapsed: true,
      itemWidth: 460,
      itemCollapsed: true
    }));

    const { result } = renderHook(() => useListDetailLayout(
      STORAGE_KEY,
      DEFAULTS,
      { legacyStorageKeys: [LEGACY_KEY] }
    ));

    expect(result.current.layout).toEqual({ listWidth: 245, listCollapsed: true });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null")).toEqual({
      schemaVersion: 1,
      listWidth: 245,
      listCollapsed: true
    });
  });

  it("rejects unknown current schema versions and falls back to valid legacy state", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 2,
      listWidth: 260,
      listCollapsed: true
    }));
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify({
      filterWidth: 235,
      filterCollapsed: false
    }));

    const { result } = renderHook(() => useListDetailLayout(
      STORAGE_KEY,
      DEFAULTS,
      { legacyStorageKeys: [LEGACY_KEY] }
    ));
    expect(result.current.layout).toEqual({ listWidth: 235, listCollapsed: false });
  });

  it.each([
    ["malformed JSON", "{"],
    ["missing schema version", JSON.stringify({ listWidth: 260, listCollapsed: true })],
    ["invalid width", JSON.stringify({ schemaVersion: 1, listWidth: "260", listCollapsed: true })],
    ["invalid collapsed state", JSON.stringify({ schemaVersion: 1, listWidth: 260, listCollapsed: "yes" })]
  ])("uses defaults for %s in the current key", (_label, stored) => {
    window.localStorage.setItem(STORAGE_KEY, stored);
    const { result } = renderHook(() => useListDetailLayout(STORAGE_KEY, DEFAULTS));
    expect(result.current.layout).toEqual(DEFAULTS);
  });

  it("clamps restored and resized widths to the supported range", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      listWidth: 9999,
      listCollapsed: false
    }));
    const { result } = renderHook(() => useListDetailLayout(STORAGE_KEY, DEFAULTS));

    expect(result.current.layout.listWidth).toBe(LIST_WIDTH_MAX);
    act(() => result.current.resizeList(-10000));
    expect(result.current.layout.listWidth).toBe(LIST_WIDTH_MIN);
    act(() => result.current.resizeList(Number.NaN));
    expect(result.current.layout.listWidth).toBe(LIST_WIDTH_MIN);
  });

  it("toggles, collapses the full list track, and resets to defaults", () => {
    const { result } = renderHook(() => useListDetailLayout(STORAGE_KEY, DEFAULTS));

    expect(result.current.columns).toBe("210px 3px minmax(0, 1fr)");
    act(() => result.current.toggleList());
    expect(result.current.layout.listCollapsed).toBe(true);
    expect(result.current.columns).toBe("0px 0px minmax(0, 1fr)");
    act(() => result.current.reset());
    expect(result.current.layout).toEqual(DEFAULTS);
  });

  it("restores the real drag start after a resize hit a clamp boundary", () => {
    const { result } = renderHook(() => useListDetailLayout(STORAGE_KEY, DEFAULTS));

    act(() => result.current.beginListResize());
    act(() => result.current.resizeList(10000));
    expect(result.current.layout.listWidth).toBe(LIST_WIDTH_MAX);
    act(() => result.current.cancelListResize());
    expect(result.current.layout.listWidth).toBe(DEFAULTS.listWidth);
  });

  it("tracks pointer resize activity for transition suppression", () => {
    const { result } = renderHook(() => useListDetailLayout(STORAGE_KEY, DEFAULTS));

    act(() => result.current.onResizeActiveChange(true));
    expect(result.current.isResizing).toBe(true);
    act(() => result.current.onResizeActiveChange(false));
    expect(result.current.isResizing).toBe(false);
  });
});
