import type { Command } from "@milkdown/kit/prose/state";
import { lift, setBlockType, wrapIn } from "@milkdown/kit/prose/commands";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";

export function toggleList(kind: "bullet" | "ordered" | "todo"): Command {
  return (state, dispatch) => {
    const { schema, selection } = state;
    const type = schema.nodes[kind === "ordered" ? "ordered_list" : "bullet_list"];
    let depth = selection.$from.depth;
    while (depth > 0 && !["bullet_list", "ordered_list"].includes(selection.$from.node(depth).type.name)) depth--;
    if (depth) {
      const list = selection.$from.node(depth);
      const item = selection.$from.node(depth + 1);
      const current = list.type.name === "ordered_list" ? "ordered" : item?.attrs.checked != null ? "todo" : "bullet";
      if (current === kind) return liftListItem(schema.nodes.list_item)(state, dispatch);
      if (dispatch) {
        const pos = selection.$from.before(depth);
        const tr = state.tr.setNodeMarkup(pos, type);
        list.forEach((child, offset, index) => {
          tr.setNodeMarkup(pos + 1 + offset, undefined, { ...child.attrs, listType: kind === "ordered" ? "ordered" : "bullet", label: kind === "ordered" ? `${index + 1}.` : "•", checked: kind === "todo" ? false : null });
        });
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    return wrapInList(type)(state, dispatch && (tr => {
      if (kind === "todo") tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
        if (node.type === schema.nodes.list_item) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
      });
      dispatch(tr);
    }));
  };
}

export const toggleQuote: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "blockquote") return lift(state, dispatch);
  }
  return wrapIn(state.schema.nodes.blockquote)(state, dispatch);
};

export const toggleCode: Command = (state, dispatch) => setBlockType(
  state.schema.nodes[state.selection.$from.parent.type.name === "code_block" ? "paragraph" : "code_block"]
)(state, dispatch);
