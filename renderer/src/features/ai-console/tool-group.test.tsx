import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent } from "@shared/contracts";
import { CommandGroup, type CommandCall } from "./tool";

const originalScrollTo = HTMLElement.prototype.scrollTo;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("command-group-list") ? 304 : 32;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(304);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.height || "0");
  });
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y || 0 : options?.top || 0;
    this.dispatchEvent(new Event("scroll"));
  };
});
afterEach(() => {
  HTMLElement.prototype.scrollTo = originalScrollTo;
  vi.restoreAllMocks();
});

function calls(count: number): CommandCall[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `call-${index}`,
    events: ["tool-start", "tool-complete"].map((kind, step) => ({
      schemaVersion: 1, id: `${index}-${step}`, seq: index * 2 + step,
      timestamp: "2026-09-16T00:00:00Z", projectId: "fixture", sessionId: "fixture", runId: "fixture", provider: "codex", kind,
      payload: { itemId: `call-${index}`, tool: "Bash", input: { command: `scan-${index}` }, ...(step ? { output: `result ${index}` } : {}) }, risks: []
    } as AiEvent))
  }));
}

describe("large command groups", () => {
  it("shows flat tool summaries directly and opens each result independently", () => {
    const { container, rerender } = render(<CommandGroup calls={calls(2)} runStatus="completed" />);
    expect(container.querySelectorAll(".tool-event")).toHaveLength(0);
    rerender(<CommandGroup calls={calls(2)} runStatus="completed" flat />);
    expect(container.querySelector(".command-group > .ui-disclosure-trigger")).toBeNull();
    const triggers = container.querySelectorAll<HTMLButtonElement>(".tool-event > .ui-disclosure-trigger");
    expect(triggers).toHaveLength(2);
    expect(container.textContent).toContain("scan-0");
    expect(container.textContent).toContain("scan-1");
    expect(container.textContent).not.toContain("result 0");
    fireEvent.click(triggers[0]);
    expect(triggers[0].getAttribute("aria-expanded")).toBe("true");
    expect(triggers[1].getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).toContain("result 0");
    fireEvent.click(triggers[1]);
    expect(triggers[0].getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("result 1");
  });

  it("keeps flat tool histories bounded and navigable without a group header", async () => {
    const { container } = render(<CommandGroup calls={calls(500)} runStatus="completed" flat />);
    expect(container.querySelector(".command-group > .ui-disclosure-trigger")).toBeNull();
    expect(container.querySelectorAll(".tool-event").length).toBeGreaterThan(5);
    expect(container.querySelectorAll(".tool-event").length).toBeLessThan(30);
    const list = container.querySelector<HTMLElement>(".command-group-list")!;
    fireEvent.keyDown(list, { key: "End" });
    await waitFor(() => expect(document.activeElement?.closest("[data-command-index]")?.getAttribute("data-command-index")).toBe("499"));
  });

  it("bounds mounted cards and keeps the exit content mounted for its animation", async () => {
    const { container } = render(<CommandGroup calls={calls(500)} runStatus="completed" />);
    const trigger = container.querySelector<HTMLButtonElement>(".command-group > button")!;
    expect(container.querySelectorAll(".tool-event")).toHaveLength(0);
    fireEvent.click(trigger);
    expect(container.querySelectorAll(".tool-event").length).toBeGreaterThan(5);
    expect(container.querySelectorAll(".tool-event").length).toBeLessThan(30);
    fireEvent.click(trigger);
    expect(container.querySelectorAll(".tool-event").length).toBeGreaterThan(0);
    expect(container.querySelector(".command-group > .ui-disclosure-content")?.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(container.querySelectorAll(".tool-event")).toHaveLength(0));
  });

  it("reaches offscreen commands by keyboard and retains expanded output while scrolling", async () => {
    const { container } = render(<CommandGroup calls={calls(500)} runStatus="completed" />);
    fireEvent.click(container.querySelector(".command-group > button")!);
    const list = container.querySelector<HTMLElement>(".command-group-list")!;
    fireEvent.keyDown(list, { key: "End" });
    await waitFor(() => expect(document.activeElement?.closest("[data-command-index]")?.getAttribute("data-command-index")).toBe("499"));
    expect(list.scrollTop).toBeGreaterThan(0);
    const last = document.activeElement as HTMLButtonElement;
    fireEvent.click(last);
    expect(last.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("result 499");
    fireEvent.keyDown(last, { key: "Home" });
    await waitFor(() => expect(document.activeElement?.closest("[data-command-index]")?.getAttribute("data-command-index")).toBe("0"));
    expect(container.textContent).toContain("result 499");
    expect(container.querySelectorAll(".tool-event").length).toBeLessThan(35);
  });
});
