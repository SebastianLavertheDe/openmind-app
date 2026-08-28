import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverflowBox } from "./OverflowBox";

afterEach(() => cleanup());

describe("OverflowBox", () => {
  beforeEach(() => {
    // jsdom 没有 ResizeObserver / scrollIntoView
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() { /* noop */ }
      unobserve() { /* noop */ }
      disconnect() { /* noop */ }
    };
    Element.prototype.scrollIntoView = () => undefined;
  });

  it("renders children inside a viewport with max-height", () => {
    const { container } = render(
      <OverflowBox maxHeight={200}>
        <pre>line one</pre>
      </OverflowBox>
    );
    const content = container.querySelector(".overflow-box-content") as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.style.maxHeight).toBe("200px");
    expect(screen.getByText("line one")).toBeTruthy();
  });

  it("shares one ResizeObserver across mounted overflow viewports", () => {
    const observed: Element[] = [];
    let instances = 0;
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      constructor() { instances += 1; }
      observe(element: Element) { observed.push(element); }
      unobserve() { /* noop */ }
      disconnect() { /* noop */ }
    };

    render(
      <>
        <OverflowBox><pre>one</pre></OverflowBox>
        <OverflowBox><pre>two</pre></OverflowBox>
      </>
    );

    expect(instances).toBe(1);
    expect(observed).toHaveLength(2);
  });

  it("updates scroll shadows without a React state render", () => {
    const { container } = render(<OverflowBox><pre>content</pre></OverflowBox>);
    const content = container.querySelector(".overflow-box-content") as HTMLElement;
    Object.defineProperties(content, {
      scrollTop: { configurable: true, value: 10 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 240 }
    });

    fireEvent.scroll(content);
    expect(container.querySelector(".overflow-box-shadow.top")?.hasAttribute("data-visible")).toBe(true);
    expect(container.querySelector(".overflow-box-shadow.bottom")?.hasAttribute("data-visible")).toBe(true);
  });

  it("shows expand button when expandable and expands to full height", () => {
    const { container } = render(
      <OverflowBox maxHeight={100} expandable>
        <pre>content</pre>
      </OverflowBox>
    );
    const expandBtn = screen.getByRole("button", { name: /展开全文/ });
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn);
    const content = container.querySelector(".overflow-box-content") as HTMLElement;
    expect(content.style.maxHeight).toBe("");
  });

  it("shows expand-all button and calls onExpandAll", () => {
    const onExpandAll = vi.fn();
    render(
      <OverflowBox maxHeight={100} expandAllLabel="全部展开" onExpandAll={onExpandAll}>
        <pre>content</pre>
      </OverflowBox>
    );
    const btn = screen.getByRole("button", { name: "全部展开" });
    fireEvent.click(btn);
    expect(onExpandAll).toHaveBeenCalledOnce();
  });

  it("shows progress label when progress provided", () => {
    render(
      <OverflowBox
        maxHeight={100}
        progress={{ shown: 8000, total: 48000 }}
        progressLabel={(s, t) => `已 ${s} / 共 ${t}`}
      >
        <pre>content</pre>
      </OverflowBox>
    );
    expect(screen.getByText("已 8000 / 共 48000")).toBeTruthy();
  });

  it("shows search button when searchable and opens search bar on click", () => {
    render(
      <OverflowBox maxHeight={100} searchable lines={["hello world", "foo bar"]}>
        <pre>content</pre>
      </OverflowBox>
    );
    const searchBtn = screen.getByRole("button", { name: /⌘F/ });
    fireEvent.click(searchBtn);
    expect(screen.getByPlaceholderText("搜索…")).toBeTruthy();
  });

  it("finds matches and shows count in search", async () => {
    const lines = ["hello world", "foo bar", "hello again"];
    render(
      <OverflowBox maxHeight={100} searchable lines={lines}>
        <pre>{lines.join("\n")}</pre>
      </OverflowBox>
    );
    fireEvent.click(screen.getByRole("button", { name: /⌘F/ }));
    const input = screen.getByPlaceholderText("搜索…");
    fireEvent.change(input, { target: { value: "hello" } });
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 2/)).toBeTruthy();
    });
  });

  it("calls scrollIntoView when cycling to next match", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const lines = ["alpha", "beta alpha", "gamma"];
    // 子元素必须带 data-line 属性,OverflowBox 才能定位匹配行并调用 scrollIntoView
    render(
      <OverflowBox maxHeight={100} searchable lines={lines}>
        <div>
          {lines.map((line, i) => <div key={i} data-line={i}>{line}</div>)}
        </div>
      </OverflowBox>
    );
    fireEvent.click(screen.getByRole("button", { name: /⌘F/ }));
    fireEvent.change(screen.getByPlaceholderText("搜索…"), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.getByText(/1 \/ 2/)).toBeTruthy());
    // 初始匹配时已调用 scrollIntoView 跳到第一个匹配行
    expect(scrollIntoView).toHaveBeenCalled();
    scrollIntoView.mockClear();
    // 点下一个,应再次调用 scrollIntoView 跳到第二个匹配行
    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("next/prev buttons are disabled when no matches", async () => {
    render(
      <OverflowBox maxHeight={100} searchable lines={["hello"]}>
        <pre>hello</pre>
      </OverflowBox>
    );
    fireEvent.click(screen.getByRole("button", { name: /⌘F/ }));
    fireEvent.change(screen.getByPlaceholderText("搜索…"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText("无匹配")).toBeTruthy());
    expect(screen.getByRole("button", { name: "上一个" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "下一个" })).toHaveProperty("disabled", true);
  });

  it("shows no match when query has no results", async () => {
    render(
      <OverflowBox maxHeight={100} searchable lines={["hello world"]}>
        <pre>hello world</pre>
      </OverflowBox>
    );
    fireEvent.click(screen.getByRole("button", { name: /⌘F/ }));
    const input = screen.getByPlaceholderText("搜索…");
    fireEvent.change(input, { target: { value: "zzz" } });
    await waitFor(() => {
      expect(screen.getByText("无匹配")).toBeTruthy();
    });
  });

  it("cycles through matches with next/prev buttons", async () => {
    const lines = ["alpha", "beta alpha", "gamma"];
    render(
      <OverflowBox maxHeight={100} searchable lines={lines}>
        <pre>{lines.join("\n")}</pre>
      </OverflowBox>
    );
    fireEvent.click(screen.getByRole("button", { name: /⌘F/ }));
    fireEvent.change(screen.getByPlaceholderText("搜索…"), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.getByText(/1 \/ 2/)).toBeTruthy());

    const nextBtn = screen.getByRole("button", { name: "下一个" });
    fireEvent.click(nextBtn);
    await waitFor(() => expect(screen.getByText(/2 \/ 2/)).toBeTruthy());

    const prevBtn = screen.getByRole("button", { name: "上一个" });
    fireEvent.click(prevBtn);
    await waitFor(() => expect(screen.getByText(/1 \/ 2/)).toBeTruthy());
  });

  it("closes search on close button", async () => {
    render(
      <OverflowBox maxHeight={100} searchable lines={["hello"]}>
        <pre>hello</pre>
      </OverflowBox>
    );
    fireEvent.click(screen.getByRole("button", { name: /⌘F/ }));
    expect(screen.getByPlaceholderText("搜索…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭搜索" }));
    expect(screen.queryByPlaceholderText("搜索…")).toBeNull();
  });

  it("triggers search on ⌘F keydown when focus is inside content", () => {
    render(
      <OverflowBox maxHeight={100} searchable lines={["hello"]}>
        <pre>hello</pre>
      </OverflowBox>
    );
    const content = screen.getByText("hello");
    content.focus();
    fireEvent.keyDown(content, { key: "f", metaKey: true });
    expect(screen.getByPlaceholderText("搜索…")).toBeTruthy();
  });

  it("calls onExpand callback when expand button clicked", () => {
    const onExpand = vi.fn();
    render(
      <OverflowBox maxHeight={100} expandable onExpand={onExpand}>
        <pre>content</pre>
      </OverflowBox>
    );
    fireEvent.click(screen.getByRole("button", { name: /展开全文/ }));
    expect(onExpand).toHaveBeenCalledOnce();
  });
});
