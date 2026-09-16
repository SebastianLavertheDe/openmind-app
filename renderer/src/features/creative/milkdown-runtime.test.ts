import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createMarkdownEditor, uploadImage, type MilkdownRuntime } from "./milkdown-runtime";
import { createElement, StrictMode } from "react";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { MarkdownEditor } from "./MilkdownEditor";

let runtime: MilkdownRuntime | undefined;
beforeAll(() => {
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() }
  });
});
afterAll(() => { vi.restoreAllMocks(); Reflect.deleteProperty(Range.prototype, "getClientRects"); Reflect.deleteProperty(Range.prototype, "getBoundingClientRect"); });
afterEach(async () => { await runtime?.destroy(); runtime = undefined; document.body.replaceChildren(); });
async function open(value: string) {
  const host = document.createElement("div"); document.body.append(host);
  const callbacks = { onChange: vi.fn(), onSelectionChange: vi.fn(), onFormat: vi.fn() };
  runtime = await createMarkdownEditor(host, value, "文档内容", callbacks);
  const view = runtime.editor.action(ctx => ctx.get(editorViewCtx));
  return { editor: runtime, view, host, ...callbacks };
}

describe("Milkdown document editing", () => {
  it("mounts once in StrictMode, loads new values and connects the React toolbar", async () => {
    const props = { value: "# 第一份文档", ariaLabel: "文档内容", onChange: vi.fn(), onSelectionChange: vi.fn() };
    const { container, rerender, unmount } = render(createElement(StrictMode, null, createElement(MarkdownEditor, props)));
    await screen.findByRole("textbox", { name: "文档内容" });
    expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(props.onChange).not.toHaveBeenCalled();
    rerender(createElement(StrictMode, null, createElement(MarkdownEditor, { ...props, value: "# 第二份文档" })));
    await waitFor(() => expect(container.querySelector("h1")?.textContent).toBe("第二份文档"));
    expect(props.onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("段落格式"), { target: { value: "2" } });
    expect(container.querySelector("h2")?.textContent).toBe("第二份文档");
    expect(props.onChange).toHaveBeenLastCalledWith(expect.stringContaining("## 第二份文档"));
    unmount(); expect(container.querySelector(".ProseMirror")).toBeNull();
  });
  it("opens rendered headings and GFM without marking the original source dirty", async () => {
    const { host, onChange } = await open("# 文档标题\n\n正文包含 **重点**。\n\n- [ ] 完成草稿\n\n| 名称 | 状态 |\n| --- | --- |\n| 草稿 | 已保存 |\n");
    expect(host.querySelector("h1")?.textContent).toBe("文档标题");
    expect(host.querySelector("strong")?.textContent).toBe("重点");
    expect(host.querySelector("table")).not.toBeNull();
    expect(host.querySelector('[role="textbox"]')?.getAttribute("aria-label")).toBe("文档内容");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("formats the selected text and serializes actual Markdown, with undo/redo", async () => {
    const { editor, view, onChange } = await open("正文内容");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    expect(editor.run("bold")).toBe(true);
    expect(editor.getMarkdown()).toContain("**正文**内容");
    expect(onChange).toHaveBeenLastCalledWith(editor.getMarkdown());
    expect(editor.run("undo")).toBe(true);
    expect(editor.getMarkdown()).toContain("正文内容");
    expect(editor.run("redo")).toBe(true);
    expect(editor.getMarkdown()).toContain("**正文**内容");
    editor.setHeading(2);
    expect(editor.getMarkdown()).toContain("## **正文**内容");
  });
  it("replaces AI selections in the rendered document and follows edits before them", async () => {
    const { editor, view } = await open("# 标题\n\n前文和需要改写的内容");
    let from = 0;
    view.state.doc.descendants((node, pos) => { if (node.isText && node.text?.includes("需要改写")) from = pos + node.text.indexOf("需要改写"); });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + 4)));
    const selected = editor.getSelection();
    expect(selected.text).toBe("需要改写");
    view.dispatch(view.state.tr.insertText("新增", 1));
    expect(editor.replaceRange(selected.start, selected.end, "**改写完成**", selected.bookmark)).toBe(true);
    expect(editor.getMarkdown()).toContain("# 新增标题");
    expect(editor.getMarkdown()).toContain("前文和**改写完成**的内容");
  });
  it("rejects stale selections and resets document state when loading another file", async () => {
    const { editor, view, onChange } = await open("原来的内容");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
    const selected = editor.getSelection();
    view.dispatch(view.state.tr.insertText("已修改", 1, 4));
    expect(editor.replaceRange(selected.start, selected.end, "AI 改写", selected.bookmark)).toBe(false);
    onChange.mockClear(); editor.setValue("# 新文档\n\n新的内容");
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getMarkdown()).toContain("# 新文档");
    expect(editor.replaceRange(selected.start, selected.end, "错误替换", selected.bookmark)).toBe(false);
    expect(editor.run("undo")).toBe(false);
  });
  it("inserts tables, tasks and images as real document blocks", async () => {
    const { editor, host } = await open("正文");
    expect(editor.run("todo")).toBe(true);
    expect(editor.getMarkdown()).toMatch(/[-*] \[ \] 正文/);
    editor.setValue(""); expect(editor.run("table")).toBe(true);
    expect(host.querySelector("table")).not.toBeNull();
    editor.setValue(""); expect(editor.run("image")).toBe(true);
    expect(host.querySelector(".milkdown-image-block")).not.toBeNull();
  });
  it("uploads images as persistent data URLs", async () => {
    expect(await uploadImage(new File(["image"], "image.png", { type: "image/png" }))).toBe("data:image/png;base64,aW1hZ2U=");
  });
});
