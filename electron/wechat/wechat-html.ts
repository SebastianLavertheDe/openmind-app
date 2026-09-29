import { JSDOM } from "jsdom";

const ALLOWED_TAGS = new Set(["SECTION", "DIV", "P", "SPAN", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "S", "DEL", "BR", "HR", "BLOCKQUOTE", "UL", "OL", "LI", "PRE", "CODE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A", "IMG", "FIGURE", "FIGCAPTION", "SUP", "SUB"]);
const REMOVE_CONTENT = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "META", "LINK", "BASE", "TEMPLATE"]);

/** No scripts, embedded documents, event handlers or CSS network requests cross into the clipboard/API. */
export function wechatDocument(html: string): JSDOM {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const { document } = dom.window;
  for (const node of Array.from(document.body.querySelectorAll("*"))) {
    const tagName = node.tagName.toUpperCase();
    if (!ALLOWED_TAGS.has(tagName)) {
      if (REMOVE_CONTENT.has(tagName)) node.remove();
      else node.replaceWith(...Array.from(node.childNodes));
      continue;
    }
    for (const attribute of Array.from(node.attributes)) {
      const { name, value } = attribute;
      const allowed = name === "style" || name === "title" || name === "align"
        || (node.tagName === "A" && name === "href")
        || (node.tagName === "IMG" && ["src", "alt", "width", "height"].includes(name))
        || (["TD", "TH"].includes(node.tagName) && ["rowspan", "colspan"].includes(name))
        || (node.tagName === "OL" && name === "start");
      if (!allowed || (name === "style" && /(?:url|expression|image-set|image|src|cross-fade|paint|element)\s*\(|@import|\\|behavior\s*:/i.test(value))) node.removeAttribute(name);
    }
    if (node.tagName === "A" && !/^(?:https?:\/\/|mailto:[^\s<>]+@[^\s<>]+$|#)/i.test(node.getAttribute("href") || "")) node.removeAttribute("href");
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") || "";
      if (/^(?:javascript|vbscript|file|blob):/i.test(src.trim())) node.removeAttribute("src");
      if (/^data:/i.test(src.trim()) && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src.trim())) node.removeAttribute("src");
    }
  }
  return dom;
}

export function sanitizeWechatHtml(html: string): string {
  const dom = wechatDocument(html);
  try { return dom.window.document.body.innerHTML; } finally { dom.window.close(); }
}
