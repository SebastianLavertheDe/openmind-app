import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, DataTable, DropdownMenu, SearchField, Tabs } from "./controls";
import { CollapsiblePane, ResizablePane } from "./layout";
import { VirtualList } from "./VirtualList";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("design system controls", () => {
  it("clears a search field without losing the accessible input label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchField label="资料搜索" value="agent" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getByLabelText("资料搜索")).toBeTruthy();
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

  it("sorts and paginates table rows", async () => {
    const user = userEvent.setup();
    const rows = [
      { id: "b", title: "Beta", score: 2 },
      { id: "a", title: "Alpha", score: 1 },
      { id: "c", title: "Gamma", score: 3 }
    ];
    render(
      <DataTable
        label="项目表"
        rows={rows}
        rowKey={(row) => row.id}
        pageSize={2}
        columns={[
          { key: "title", header: "标题", sortValue: (row) => row.title, cell: (row) => row.title },
          { key: "score", header: "评分", sortValue: (row) => row.score, cell: (row) => row.score }
        ]}
      />
    );
    await user.click(screen.getByRole("button", { name: "标题" }));
    const firstPage = screen.getByRole("table", { name: "项目表" }).textContent || "";
    expect(firstPage.indexOf("Alpha")).toBeLessThan(firstPage.indexOf("Beta"));
    expect(firstPage).not.toContain("Gamma");
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByRole("table", { name: "项目表" }).textContent).toContain("Gamma");
  });

  it("renders a stable empty state", () => {
    render(
      <DataTable
        label="空表"
        rows={[]}
        rowKey={() => "none"}
        emptyTitle="没有匹配结果"
        columns={[{ key: "title", header: "标题", cell: () => null }]}
      />
    );
    expect(screen.getByText("没有匹配结果")).toBeTruthy();
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

  it("resizes panes by keyboard, pointer drag and double click", () => {
    const onResize = vi.fn();
    render(<ResizablePane width={200} minWidth={120} maxWidth={300} onResize={onResize}>内容</ResizablePane>);
    const separator = screen.getByRole("separator");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.doubleClick(separator);
    fireEvent(separator, new MouseEvent("pointerdown", { bubbles: true, clientX: 200 }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 260 }));
    window.dispatchEvent(new MouseEvent("pointerup"));

    expect(onResize).toHaveBeenCalledWith(216);
    expect(onResize).toHaveBeenCalledWith(210);
    expect(onResize).toHaveBeenCalledWith(260);
  });

  it("renders collapsed panes as a classic rail with restore action", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<CollapsiblePane collapsed label="资料栏" onToggle={onToggle}>资料内容</CollapsiblePane>);
    await user.click(screen.getByRole("button", { name: "展开资料栏" }));
    expect(onToggle).toHaveBeenCalled();

    rerender(<CollapsiblePane collapsed={false} label="资料栏" onToggle={onToggle}>资料内容</CollapsiblePane>);
    expect(screen.getByText("资料内容")).toBeTruthy();
  });

  it("restores focus after dropdown and context menus close", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);

    const dropdownSummary = screen.getByText("更多");
    await user.click(dropdownSummary);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(dropdownSummary));

    const contextTrigger = screen.getByRole("button", { name: "打开上下文菜单" });
    await user.click(contextTrigger);
    await user.click(screen.getByLabelText("关闭菜单"));
    await waitFor(() => expect(document.activeElement).toBe(contextTrigger));
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
  const [contextOpen, setContextOpen] = useState(false);
  return (
    <>
      <DropdownMenu label="更多"><button role="menuitem" onClick={onRename}>重命名</button></DropdownMenu>
      <button onClick={() => setContextOpen(true)}>打开上下文菜单</button>
      <ContextMenu open={contextOpen} x={10} y={20} onClose={() => setContextOpen(false)}>
        <button role="menuitem">打开</button>
      </ContextMenu>
    </>
  );
}
