import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";
import { useModalFocusScope } from "./use-modal-focus-scope";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Opts = Array<{ value: "a" | "b" | "c"; label: string }>;

const OPTIONS: Opts = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" }
];

function Harness({ initial = "" as "" | "a" | "b" | "c" }) {
  const [value, setValue] = useState<"" | "a" | "b" | "c">(initial);
  return <Select value={value} options={OPTIONS} onChange={(v) => setValue(v)} ariaLabel="排序" placeholder="选择" />;
}

function getTrigger() {
  return screen.getByRole("button", { name: /下拉菜单/ });
}

function ModalHarness({ onDismiss }: { onDismiss(): void }) {
  const ref = useRef<HTMLElement>(null);
  useModalFocusScope({ open: true, containerRef: ref, onDismiss });
  return <section ref={ref} role="dialog" aria-modal="true"><Harness /><button>after select</button></section>;
}

describe("Select (custom dropdown)", () => {
  it.each(["", "missing"])("keeps an unmatched value (%s) unselected until the user chooses", async (value) => {
    const onChange = vi.fn();
    const options = [{ value: "a", label: "Alpha", disabled: true }, { value: "b", label: "Beta" }];
    const { container, rerender } = render(<Select value={value} options={options} onChange={onChange} placeholder="请选择" />);
    expect(getTrigger().textContent).toContain("请选择");
    expect(container.querySelector("select")?.value).toBe("");
    fireEvent.click(getTrigger());
    const list = screen.getByRole("listbox");
    expect(within(list).queryByRole("option", { selected: true })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Beta" })));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b");
    rerender(<Select value="b" options={options} onChange={onChange} placeholder="请选择" />);
    expect(getTrigger().textContent).toContain("Beta");
    expect(container.querySelector("select")?.value).toBe("b");
  });

  it("does not choose a missing option while options are loading", () => {
    const onChange = vi.fn();
    render(<Select value="" options={[]} onChange={onChange} placeholder="请选择" />);
    fireEvent.click(getTrigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not steal focus on initial mount", () => {
    const anchor = document.createElement("button");
    anchor.textContent = "原焦点";
    document.body.appendChild(anchor);
    anchor.focus();

    render(<Harness />);

    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });

  it("opens a listbox and reports expanded state", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = getTrigger();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "排序" })).toBeTruthy();
  });

  it("selects an option and closes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getTrigger());
    const listbox = screen.getByRole("listbox", { name: "排序" });
    await user.click(within(listbox).getByRole("option", { name: "Beta" }));
    expect(getTrigger().textContent).toContain("Beta");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("navigates options with arrow keys and confirms with Enter", async () => {
    const onChange = vi.fn();
    render(<Select value="" options={OPTIONS} onChange={onChange} ariaLabel="排序" placeholder="选择" />);
    const trigger = getTrigger();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const listbox = screen.getByRole("listbox", { name: "排序" });
    // 从定位到的第一项开始,按两次下到 Gamma,再 Enter
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = getTrigger();
    await user.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps an inert leaving menu mounted for the full 160ms exit", () => {
    document.documentElement.style.setProperty("--dur-exit", "160ms");
    vi.useFakeTimers();
    try {
      render(<Harness />);
      fireEvent.click(getTrigger());
      fireEvent.keyDown(document, { key: "Escape" });

      const leaving = document.querySelector(".ui-select-menu") as HTMLElement;
      expect(leaving?.getAttribute("data-leaving")).toBe("true");
      expect(leaving?.hasAttribute("inert")).toBe(true);
      expect(leaving.querySelector(".ui-select-surface")?.getAttribute("data-leaving")).toBe("true");
      act(() => vi.advanceTimersByTime(159));
      expect(document.querySelector(".ui-select-menu")).toBe(leaving);
      act(() => vi.advanceTimersByTime(1));
      expect(document.querySelector(".ui-select-menu")).toBeNull();
    } finally {
      vi.useRealTimers();
      document.documentElement.style.removeProperty("--dur-exit");
    }
  });

  it("focuses the visible trigger in a dialog and dismisses its menu before the dialog", async () => {
    const onDismiss = vi.fn();
    render(<ModalHarness onDismiss={onDismiss} />);
    const trigger = getTrigger();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    const option = within(list).getByRole("option", { name: "Alpha" });
    await waitFor(() => expect(document.activeElement).toBe(option));
    fireEvent.keyDown(option, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(onDismiss).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("preserves autofocus and the tooltip while closing a newly disabled control", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Select value="a" options={OPTIONS} onChange={onChange} autoFocus title="Provider is locked" />);
    const trigger = getTrigger();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("title")).toBe("Provider is locked");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    rerender(<Select value="a" options={OPTIONS} onChange={onChange} disabled title="Provider is locked" />);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(trigger.hasAttribute("disabled")).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button>outside</button>
      </>
    );
    await user.click(getTrigger());
    expect(screen.getByRole("listbox")).toBeTruthy();
    const outside = screen.getByText("outside");
    await user.click(outside);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(document.activeElement).toBe(outside);
  });

  it("lets Tab leave the open menu without pulling focus back", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button>after select</button>
      </>
    );
    await user.click(getTrigger());
    const listbox = screen.getByRole("listbox", { name: "排序" });
    await waitFor(() => expect(document.activeElement).toBe(within(listbox).getByRole("option", { name: "Alpha" })));

    await user.keyboard("{Tab}");

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "after select" }));
  });

  it("renders the selected value and marks the option aria-selected", async () => {
    const user = userEvent.setup();
    render(<Harness initial="b" />);
    expect(getTrigger().textContent).toContain("Beta");
    await user.click(getTrigger());
    const listbox = screen.getByRole("listbox", { name: "排序" });
    const selected = within(listbox).getByRole("option", { name: "Beta" });
    expect(selected.getAttribute("aria-selected")).toBe("true");
  });

  it("portals, flips, and clamps the menu near the viewport edge", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 240 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("ui-select-trigger")) return domRect(280, 200, 40, 32);
      if (this.classList.contains("ui-select-menu")) return domRect(0, 0, 180, 150);
      return domRect(0, 0, 0, 0);
    });

    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getTrigger());
    const listbox = screen.getByRole("listbox", { name: "排序" });

    await waitFor(() => expect(listbox.style.visibility).toBe("visible"));
    expect(listbox.closest(".ui-select")).toBeNull();
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox.getAttribute("data-side")).toBe("top");
    expect(listbox.style.left).toBe("132px");
    expect(listbox.style.top).toBe("44px");
  });
});

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({})
  } as DOMRect;
}
