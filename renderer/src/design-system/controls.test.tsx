import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, Tabs } from "./controls";
import { VirtualList } from "./VirtualList";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("design system controls", () => {
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
    expect(screen.getByRole("menu")).toBeTruthy();
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
    expect(dropdownSummary.closest("details")?.open).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(dropdownSummary));
  });
});

function MenuHarness({ onRename = () => undefined }: { onRename?: () => void }) {
  return (
    <DropdownMenu label="更多"><button role="menuitem" onClick={onRename}>重命名</button></DropdownMenu>
  );
}
