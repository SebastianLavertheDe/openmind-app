import { useState } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { TraceCycleList, type TraceCycle } from "./TraceCycleList";

const originalScrollTo = HTMLElement.prototype.scrollTo;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("chat-scroll") ? 400 : 100;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains("trace-cycle-list") ? -(this.parentElement?.scrollTop || 0) : 0;
    return new DOMRect(0, top, 600, this.classList.contains("chat-scroll") ? 400 : 100);
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.height || "20000");
  });
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y || 0 : options?.top || 0;
    this.dispatchEvent(new Event("scroll"));
  };
});
afterEach(() => { HTMLElement.prototype.scrollTo = originalScrollTo; vi.restoreAllMocks(); });

const cycles = (count: number): TraceCycle[] => Array.from({ length: count }, (_, index) => ({ key: `cycle-${index}`, steps: [] }));
function Cycle({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  return <AnimatedDisclosure open={open} onOpenChange={setOpen} summary={value} unmountOnExit>
    <div className="cycle-detail">Details of {value}</div>
  </AnimatedDisclosure>;
}
const renderCycle = (cycle: TraceCycle) => <Cycle value={cycle.key} />;
function Fixture({ items, currentKey = null }: { items: TraceCycle[]; currentKey?: string | null }) {
  return <div className="chat-scroll" style={{ overflowY: "auto" }}>
    <TraceCycleList cycles={items} currentKey={currentKey} renderCycle={renderCycle} />
  </div>;
}

describe("process cycle window", () => {
  it("bounds mounted cycles while keeping active and expanded rows available", async () => {
    const { container } = render(<Fixture items={cycles(300)} currentKey="cycle-298" />);
    await waitFor(() => expect(container.querySelectorAll("[data-trace-index]").length).toBeLessThan(25));
    expect(container.querySelector('[data-trace-key="cycle-298"]')).toBeTruthy();
    const first = container.querySelector<HTMLButtonElement>('[data-trace-index="0"] button')!;
    fireEvent.click(first);
    await waitFor(() => expect(container.querySelector('[data-trace-index="0"] .cycle-detail')).toBeTruthy());
    const list = container.querySelector<HTMLElement>(".trace-cycle-list")!;
    fireEvent.keyDown(list, { key: "End" });
    await waitFor(() => expect(document.activeElement?.closest("[data-trace-index]")?.getAttribute("data-trace-index")).toBe("299"));
    expect(container.querySelector('[data-trace-index="0"] button')?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-trace-index="0"] .cycle-detail')).toBeTruthy();
    expect(container.querySelectorAll("[data-trace-index]").length).toBeLessThan(25);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    await waitFor(() => expect(document.activeElement?.closest("[data-trace-index]")?.getAttribute("data-trace-index")).toBe("0"));
  });

  it("keeps disclosure and focus state when a growing process crosses the window threshold", async () => {
    const items = cycles(41);
    const { container, rerender } = render(<Fixture items={items.slice(0, 40)} />);
    const trigger = container.querySelector<HTMLButtonElement>('[data-trace-index="20"] button')!;
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
    rerender(<Fixture items={items} />);
    await waitFor(() => expect(container.querySelector(".trace-cycle-list.is-virtual")).toBeTruthy());
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector('[data-trace-index="20"] button')).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll("[data-trace-index]").length).toBeLessThan(25);
  });

  it("keeps keyboard navigation available for narrative cycles without interactive controls", async () => {
    const { container } = render(<div className="chat-scroll" style={{ overflowY: "auto" }}>
      <TraceCycleList cycles={cycles(300)} currentKey={null} renderCycle={cycle => <p>{cycle.key}</p>} />
    </div>);
    const list = container.querySelector<HTMLElement>(".trace-cycle-list")!;
    fireEvent.keyDown(list, { key: "End" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-trace-index")).toBe("299"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-trace-index")).toBe("0"));
    expect(container.querySelectorAll("[data-trace-index]").length).toBeLessThan(25);
  });
});
