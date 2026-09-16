import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPreferences } from "@shared/contracts";

const originalStart = document.startViewTransition;
const prefs = (themeMode: "light" | "dark") => ({ themeMode }) as UserPreferences;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.className = "";
});
afterEach(() => {
  document.startViewTransition = originalStart;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockTransitions() {
  const pending: Array<{ update: () => void; finish: () => void; skip: ReturnType<typeof vi.fn> }> = [];
  document.startViewTransition = vi.fn((update: () => void) => {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const skip = vi.fn();
    pending.push({ update, finish, skip });
    return { ready: Promise.resolve(), finished, updateCallbackDone: Promise.resolve(), skipTransition: skip };
  }) as unknown as Document["startViewTransition"];
  return pending;
}

describe("theme snapshot transitions", () => {
  it("crossfades actual theme changes, without snapshotting unrelated preference saves", async () => {
    const pending = mockTransitions();
    const { applyTheme } = await import("./theme");
    applyTheme(prefs("light"));
    applyTheme({ ...prefs("light"), density: "compact" });
    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--space-3")).toBe("6px");

    applyTheme(prefs("dark"));
    expect(pending).toHaveLength(1);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(true);
    pending[0].update();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    pending[0].finish();
    await vi.runAllTimersAsync();
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
  });

  it("does not commit a stale callback after a rapid reversal", async () => {
    const pending = mockTransitions();
    const { applyTheme } = await import("./theme");
    applyTheme(prefs("light"));
    applyTheme(prefs("dark"));
    applyTheme(prefs("light"));
    expect(pending[0].skip).toHaveBeenCalledOnce();
    pending[0].update();
    pending[0].finish();
    await vi.runAllTimersAsync();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("keeps the newer transition active when an older one finishes", async () => {
    const pending = mockTransitions();
    const { applyTheme } = await import("./theme");
    applyTheme(prefs("light"));
    applyTheme(prefs("dark"));
    pending[0].update();
    applyTheme(prefs("light"));
    pending[1].update();
    pending[0].finish();
    await vi.runAllTimersAsync();
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(true);
    pending[1].finish();
    await vi.runAllTimersAsync();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
  });

  it("preserves the color animation in browser previews without snapshot support", async () => {
    document.startViewTransition = undefined as unknown as Document["startViewTransition"];
    const { applyTheme } = await import("./theme");
    applyTheme(prefs("light"));
    applyTheme(prefs("dark"));
    expect(document.documentElement.classList.contains("theme-transitioning-fallback")).toBe(true);
    await vi.advanceTimersByTimeAsync(180);
    expect(document.documentElement.classList.contains("theme-transitioning-fallback")).toBe(false);
  });
});
