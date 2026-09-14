import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, SegmentedControl, Tabs } from "./controls";
import { VirtualList } from "./VirtualList";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("design system controls", () => {
  it("positions the segmented thumb before enabling later selection transitions", async () => {
    let paint: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { paint = callback; return 1; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container } = render(
      <SegmentedControl
        label="密度"
        value="default"
        options={[{ value: "compact", label: "紧凑" }, { value: "default", label: "默认" }]}
        onChange={vi.fn()}
      />
    );

    const segmented = container.querySelector(".ui-segmented") as HTMLElement;
    expect(segmented.hasAttribute("data-motion-ready")).toBe(false);
    expect(segmented.style.getPropertyValue("--seg-thumb-left")).toBe("0px");
    expect(segmented.style.getPropertyValue("--seg-thumb-width")).toBe("0px");

    paint?.(0);
    await waitFor(() => expect(segmented.getAttribute("data-motion-ready")).toBe("true"));
  });

  it("supports arrow-key tab navigation with roving tabindex", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="视图"
        value="list"
        onChange={onChange}
        tabs={[
          { value: "list", label: "列表" },
          { value: "detail", label: "详情" }
        ]}
      />
    );
    fireEvent.keyDown(screen.getByRole("tablist", { name: "视图" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("detail");
  });

  it("scrolls the selected virtual row into view after measuring the container", async () => {
    class MockResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        Object.defineProperty(target, "clientHeight", { configurable: true, value: 90 });
        this.callback([{ target, contentRect: { height: 90 } as DOMRectReadOnly } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const items = Array.from({ length: 100 }, (_, index) => `Item ${index}`);
    render(
      <VirtualList
        items={items}
        rowHeight={30}
        selectedKey="Item 50"
        getKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
        role="listbox"
        ariaLabel="虚拟列表"
      />
    );
    const list = screen.getByRole("listbox", { name: "虚拟列表" });
    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0));
    expect(screen.getByText("Item 50")).toBeTruthy();
  });

  it("restores focus after a dropdown closes", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);

    const dropdownSummary = screen.getByText("更多");
    await user.click(dropdownSummary);
    const menu = screen.getByRole("menu");
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(dropdownSummary));

  });

  it("owns menu-item selection, close and focus restoration", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<MenuHarness onRename={onRename} />);

    const dropdownSummary = screen.getByText("更多");
    await user.click(dropdownSummary);
    const menuItem = screen.getByRole("menuitem", { name: "重命名" });
    menuItem.focus();
    await user.click(menuItem);

    expect(onRename).toHaveBeenCalledOnce();
    expect(dropdownSummary.closest(".ui-dropdown")?.hasAttribute("data-open")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(dropdownSummary));
  });

  it("opens a dropdown from arrow keys and applies the menu roving-focus model", async () => {
    render(
      <DropdownMenu label="更多">
        <button role="menuitem">重命名</button>
        <button role="menuitem">删除</button>
      </DropdownMenu>
    );

    const trigger = screen.getByRole("button", { name: "更多" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });

    const menu = await screen.findByRole("menu");
    const first = screen.getByRole("menuitem", { name: "重命名" });
    const last = screen.getByRole("menuitem", { name: "删除" });
    await waitFor(() => expect(document.activeElement).toBe(last));

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
  });
});

function MenuHarness({ onRename = () => undefined }: { onRename?: () => void }) {
  return (
    <DropdownMenu label="更多"><button role="menuitem" onClick={onRename}>重命名</button></DropdownMenu>
  );
}
