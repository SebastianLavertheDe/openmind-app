import type { BlockEditFeatureConfig } from "@milkdown/crepe/feature/block-edit";
import { documentMenuHints, documentMenuIconHtml } from "./document-menu-icons";

/** Keep Crepe's commands and filtering, with common blocks before specialist ones. */
export const documentBlockMenu: BlockEditFeatureConfig = {
  textGroup: {
    label: "基础内容", text: { label: "正文" },
    h1: { label: "标题 1" }, h2: { label: "标题 2" },
    h3: { label: "标题 3" }, h4: { label: "标题 4" },
    h5: { label: "标题 5" }, h6: { label: "标题 6" },
    quote: { label: "引用" }, divider: { label: "分割线" }
  },
  listGroup: { label: "列表", bulletList: { label: "无序列表" }, orderedList: { label: "有序列表" }, taskList: { label: "待办列表" } },
  advancedGroup: { label: "插入", image: { label: "图片" }, codeBlock: { label: "代码块" }, table: { label: "表格" }, math: { label: "公式" } },
  buildMenu: builder => {
    const text = builder.getGroup("text").group.items;
    const lists = builder.getGroup("list").group.items;
    const inserts = builder.getGroup("advanced").group.items;
    const common = ["text", "h1", "h2", "h3", "bullet-list", "ordered-list", "task-list", "quote", "divider"];
    const items = [...text, ...lists, ...inserts];
    builder.clear();
    const basic = builder.addGroup("basic", "基础内容");
    for (const key of common) {
      const item = items.find(item => item.key === key);
      if (item) basic.addItem(item.key, item);
    }
    const media = builder.addGroup("insert", "插入内容");
    for (const item of inserts) media.addItem(item.key, item);
    const more = builder.addGroup("headings", "更多标题");
    for (const item of text.filter(item => ["h4", "h5", "h6"].includes(item.key))) more.addItem(item.key, item);

    // Crepe accepts icon HTML. Grid placement gives hints a separate trailing
    // column without changing labels, so /搜索 and command execution stay intact.
    for (const group of builder.build()) for (const item of group.items) {
      const hint = documentMenuHints[item.key]?.replaceAll(">", "&gt;");
      item.icon = `<span class="document-menu-icon" aria-hidden="true">${documentMenuIconHtml(item.key)}</span>`
        + (hint ? `<span class="document-menu-hint" aria-hidden="true">${hint}</span>` : "");
    }
  }
};

/** Bound floating menus to the editor pane as well as the window. */
export function documentMenuPosition(root?: HTMLElement): BlockEditFeatureConfig["slashMenu"] {
  return {
    root,
    middleware: [{
      name: "document-menu-boundary",
      fn: ({ x, y, rects, elements }) => {
        const menu = elements.floating;
        const pane = root ?? menu.closest<HTMLElement>(".markdown-editor-shell");
        const parent = menu.offsetParent;
        const origin = parent instanceof HTMLElement ? parent.getBoundingClientRect() : { left: 0, top: 0 };
        const boundary = pane?.getBoundingClientRect();
        const toolbar = pane?.closest(".markdown-editor-shell")?.querySelector(".document-editor-toolbar")?.getBoundingClientRect();
        const left = Math.max(0, boundary?.left ?? 0) - origin.left + 8;
        const right = Math.min(window.innerWidth, boundary?.right ?? window.innerWidth) - origin.left - 8;
        const top = Math.max(0, boundary?.top ?? 0, toolbar?.bottom ?? 0) - origin.top + 8;
        const bottom = Math.min(window.innerHeight, boundary?.bottom ?? window.innerHeight) - origin.top - 8;
        const height = `${Math.max(40, bottom - top)}px`;
        if (menu.style.getPropertyValue("--document-menu-height") !== height) {
          menu.style.setProperty("--document-menu-height", height);
          return { reset: { rects: true } };
        }
        menu.dataset.placement = y < rects.reference.y ? "top" : "bottom";
        return {
          x: Math.max(left, Math.min(x, right - rects.floating.width)),
          y: Math.max(top, Math.min(y, bottom - rects.floating.height))
        };
      }
    }]
  };
}
