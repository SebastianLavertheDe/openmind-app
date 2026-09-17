import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectEditDialog } from "./ProjectAppearance";
import type { ProjectSummary } from "./types";

const project: ProjectSummary = { id: "fixture", name: "合成项目", description: "", status: "active",
  materialCount: 0, taskCount: 0, outputCount: 0, createdAt: "", updatedAt: "" };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); document.documentElement.removeAttribute("style"); });

describe("Project icon picker presence", () => {
  it("keeps the exiting picker inert, preserves edits on reopen, and Escape only closes the top dialog", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    document.documentElement.style.setProperty("--dur-exit", "160ms");
    const close = vi.fn();
    render(<ProjectEditDialog project={project} busy={false} onClose={close} onSave={() => {}} />);
    const trigger = screen.getByRole("button", { name: "图标" });
    fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "选择项目图标" });
    act(() => vi.advanceTimersToNextFrame());
    expect(picker.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(picker).getByRole("button", { name: "书籍" }));
    expect(picker.hasAttribute("inert")).toBe(true);
    expect(picker.getAttribute("aria-hidden")).toBe("true");
    act(() => vi.advanceTimersToNextFrame());
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByRole("dialog", { name: "选择项目图标" })).toBe(picker);
    expect(within(picker).getByRole("button", { name: "书籍" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(159));
    expect(picker.isConnected).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(picker.isConnected).toBe(false);
    expect(screen.getByRole("dialog", { name: "编辑项目" })).toBeTruthy();
  });

  it("skips retention with reduced motion and closes the picker when its project closes", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const { rerender } = render(<ProjectEditDialog project={project} busy={false} onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "图标" }));
    fireEvent.click(screen.getByRole("button", { name: "书籍" }));
    expect(document.querySelector(".project-icon-picker")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "图标" }));
    rerender(<ProjectEditDialog project={null} busy={false} onClose={() => {}} onSave={() => {}} />);
    expect(document.querySelector(".project-icon-picker")).toBeNull();
  });
});
