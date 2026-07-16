import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FILTER_WIDTH_MAX, FILTER_WIDTH_MIN, ITEM_WIDTH_MAX, ITEM_WIDTH_MIN, useThreePaneLayout } from "./useThreePaneLayout";

const DEFAULTS = { filterWidth: 210, itemWidth: 330, filterCollapsed: false, itemCollapsed: false };

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("useThreePaneLayout", () => {
  it("initializes from defaults when nothing is stored", () => {
    const { result } = renderHook(() => useThreePaneLayout("cctools.three-pane.library.v1", DEFAULTS));
    expect(result.current.layout).toEqual(DEFAULTS);
  });

  it("persists layout to localStorage", () => {
    const key = "cctools.three-pane.library.v1";
    const { result } = renderHook(() => useThreePaneLayout(key, DEFAULTS));
    act(() => result.current.toggleFilter());
    const stored = JSON.parse(window.localStorage.getItem(key) || "null");
    expect(stored.filterCollapsed).toBe(true);
  });

  it("restores a previously stored layout on mount", () => {
    const key = "cctools.three-pane.creative.v1";
    window.localStorage.setItem(key, JSON.stringify({ filterWidth: 250, itemWidth: 400, filterCollapsed: true, itemCollapsed: false }));
    const { result } = renderHook(() => useThreePaneLayout(key, DEFAULTS));
    expect(result.current.layout).toEqual({ filterWidth: 250, itemWidth: 400, filterCollapsed: true, itemCollapsed: false });
  });

  it("clamps filter resize to the allowed range", () => {
    const { result } = renderHook(() => useThreePaneLayout("cctools.three-pane.library.v1", DEFAULTS));
    act(() => result.current.resizeFilter(10000));
    expect(result.current.layout.filterWidth).toBe(FILTER_WIDTH_MAX);
    act(() => result.current.resizeFilter(-10000));
    expect(result.current.layout.filterWidth).toBe(FILTER_WIDTH_MIN);
  });

  it("clamps item resize to the allowed range", () => {
    const { result } = renderHook(() => useThreePaneLayout("cctools.three-pane.library.v1", DEFAULTS));
    act(() => result.current.resizeItem(10000));
    expect(result.current.layout.itemWidth).toBe(ITEM_WIDTH_MAX);
    act(() => result.current.resizeItem(-10000));
    expect(result.current.layout.itemWidth).toBe(ITEM_WIDTH_MIN);
  });

  it("toggleItem flips itemCollapsed", () => {
    const { result } = renderHook(() => useThreePaneLayout("cctools.three-pane.library.v1", DEFAULTS));
    act(() => result.current.toggleItem());
    expect(result.current.layout.itemCollapsed).toBe(true);
    act(() => result.current.toggleItem());
    expect(result.current.layout.itemCollapsed).toBe(false);
  });

  it("columns string uses 48px for a collapsed pane", () => {
    const { result } = renderHook(() => useThreePaneLayout("cctools.three-pane.library.v1", DEFAULTS));
    act(() => result.current.toggleFilter());
    expect(result.current.columns.startsWith("48px ")).toBe(true);
  });

  it("allows compact splitter tracks for dense three-pane screens", () => {
    const { result } = renderHook(() => useThreePaneLayout("cctools.three-pane.inbox.v2", DEFAULTS, { splitterWidth: 4 }));
    expect(result.current.columns).toBe("210px 4px 330px 4px minmax(0, 1fr)");
  });

  it("reset restores the defaults", () => {
    const { result } = renderHook(() => useThreePaneLayout("cctools.three-pane.library.v1", DEFAULTS));
    act(() => { result.current.toggleFilter(); result.current.resizeFilter(50); });
    act(() => result.current.reset());
    expect(result.current.layout).toEqual(DEFAULTS);
  });
});
