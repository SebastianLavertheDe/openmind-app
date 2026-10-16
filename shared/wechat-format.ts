import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Definition, FootnoteDefinition, Nodes, Root } from "mdast";
import { messages } from "./messages";
import { createWechatStyles, WECHAT_THEME_DEFINITIONS, type WechatStyleSlot } from "./wechat-themes";

export { WECHAT_THEMES } from "./wechat-themes";
export type { WechatTheme } from "./wechat-themes";

export interface WechatArticleOptions {
  themeId: string;
  accentColor?: string;
  fontSize?: number;
}

export interface WechatArticle {
  /** A sanitized HTML fragment. It requires no stylesheet, scripts or DOM access. */
  html: string;
  text: string;
  warnings: string[];
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const id = (value: string) => value.toUpperCase();

/** URLs are never inherited from raw HTML. Relative image paths are resolved by the main process. */
function safeUrl(value: string, image: boolean): string | undefined {
  const url = value.trim().replace(/ /g, "%20");
  if (!url || /[\u0000-\u0020\u007f\\]/.test(url)) return undefined;
  if (/^data:/i.test(url)) return image && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z\d+/]+={0,2}$/i.test(url) ? url : undefined;
  if (/^https?:\/\//i.test(url) || /^\/\//.test(url)) {
    try {
      const parsed = new URL(url.startsWith("//") ? `https:${url}` : url);
      return parsed.username || parsed.password ? undefined : parsed.href;
    } catch { return undefined; }
  }
  if (!image && /^mailto:[^\s@]+@[^\s@]+$/i.test(url)) return url;
  let decoded = url;
  try { for (let count = 0; count < 3; count++) decoded = decodeURIComponent(decoded); } catch { return undefined; }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded) || /^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith("//")) return undefined;
  if (image) return !decoded.startsWith("/") && !/^[#?]/.test(decoded) ? url : undefined;
  // A relative document link has no meaningful destination in a pasted article.
  return url.startsWith("#") ? url : undefined;
}

/** Render only Markdown AST nodes; source HTML and arbitrary CSS are never interpreted. */
export function renderWechatArticle(markdown: string, options: WechatArticleOptions): WechatArticle {
  const theme = WECHAT_THEME_DEFINITIONS.find(candidate => candidate.id === options.themeId) ?? WECHAT_THEME_DEFINITIONS[0];
  const accentColor = /^#[\da-f]{6}$/i.test(options.accentColor || "") ? options.accentColor! : theme.accentColor;
  const fontSize = Number.isFinite(options.fontSize) ? Math.max(12, Math.min(24, Number(options.fontSize))) : 16;
  const styles = createWechatStyles(theme, { accentColor, fontSize });
  const tree = parser.parse(markdown) as Root;
  const warnings = new Set<string>();
  const definitions = new Map<string, Definition>();
  const footnotes = new Map<string, FootnoteDefinition>();
  const usedFootnotes: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "definition") definitions.set(id(node.identifier), node);
    if (node.type === "footnoteDefinition") footnotes.set(id(node.identifier), node);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
  const tag = (name: string, body: string, slot?: WechatStyleSlot, attrs = "") => `<${name}${slot ? ` style="${escape(styles[slot])}"` : ""}${attrs}>${body}</${name}>`;
  const children = (node: Nodes): string => "children" in node ? node.children.map(render).join("") : "";
  const renderImage = (url: string, alt: string | null | undefined, title?: string | null) => {
    const src = safeUrl(url, true);
    if (!src) {
      warnings.add(messages.wechatExport.warnings.unsafeImage);
      return tag("span", escape(alt || messages.wechatExport.image));
    }
    if (!/^(?:https?:|data:)/i.test(src)) warnings.add(messages.wechatExport.warnings.relativeImage);
    if (!/^https?:/i.test(src)) warnings.add(messages.wechatExport.warnings.localImage);
    if (/^data:image\/(?:gif|webp);/i.test(src) || /\.(?:gif|webp)(?:[?#]|$)/i.test(src)) warnings.add(messages.wechatExport.warnings.imageFormat);
    return `<img src="${escape(src)}" alt="${escape(alt || "")}"${title ? ` title="${escape(title)}"` : ""} style="${escape(styles.image)}">`;
  };
  const renderLink = (url: string, label: string, title?: string | null) => {
    const href = safeUrl(url, false);
    if (!href) { warnings.add(messages.wechatExport.warnings.unsafeLink); return label; }
    if (/^https?:/i.test(href) && !/^https?:\/\/mp\.weixin\.qq\.com\//i.test(href)) warnings.add(messages.wechatExport.warnings.externalLink);
    return tag("a", label, "link", ` href="${escape(href)}"${title ? ` title="${escape(title)}"` : ""}`);
  };
  function render(node: Nodes): string {
    switch (node.type) {
      case "root": return children(node);
      case "text": return escape(node.value);
      case "paragraph": return tag("p", children(node), "paragraph");
      case "heading": return tag(`h${node.depth}`, children(node), `h${node.depth}`);
      case "strong": return tag("strong", children(node), "strong");
      case "emphasis": return tag("em", children(node), "emphasis");
      case "delete": return tag("del", children(node), "deleted");
      case "break": return "<br>";
      case "thematicBreak": return `<hr style="${escape(styles.rule)}">`;
      case "blockquote": return tag("blockquote", children(node), "quote");
      case "list": return tag(node.ordered ? "ol" : "ul", children(node), "list", node.ordered && node.start != null ? ` start="${node.start}"` : "");
      case "listItem": return tag("li", `${node.checked == null ? "" : node.checked ? "☑ " : "☐ "}${children(node)}`, "item");
      case "inlineCode": return tag("code", escape(node.value), "code");
      case "code":
        if (node.lang?.toLowerCase() === "mermaid") warnings.add(messages.wechatExport.warnings.mermaid);
        return tag("pre", tag("code", escape(node.value)), "pre");
      case "math":
      case "inlineMath":
        warnings.add(messages.wechatExport.warnings.math);
        return tag(node.type === "math" ? "pre" : "code", escape(node.value), node.type === "math" ? "pre" : "code");
      case "html": warnings.add(messages.wechatExport.warnings.html); return "";
      case "image": return renderImage(node.url, node.alt, node.title);
      case "imageReference": {
        const definition = definitions.get(id(node.identifier));
        return definition ? renderImage(definition.url, node.alt, definition.title) : escape(node.alt || "");
      }
      case "link": return renderLink(node.url, children(node), node.title);
      case "linkReference": {
        const definition = definitions.get(id(node.identifier));
        return definition ? renderLink(definition.url, children(node), definition.title) : children(node);
      }
      case "table": {
        const rows = node.children.map((row, index) => tag("tr", row.children.map((cell, column) => {
          const alignment = node.align?.[column];
          const cellStyle = `${styles[index === 0 ? "th" : "td"]}text-align:${alignment || "left"};`;
          return `<${index === 0 ? "th" : "td"} style="${escape(cellStyle)}">${children(cell)}</${index === 0 ? "th" : "td"}>`;
        }).join("")));
        return tag("table", `${tag("thead", rows[0] || "")}${tag("tbody", rows.slice(1).join(""))}`, "table");
      }
      case "footnoteReference": {
        const key = id(node.identifier);
        if (!usedFootnotes.includes(key)) usedFootnotes.push(key);
        return tag("sup", `[${usedFootnotes.indexOf(key) + 1}]`, "footnote");
      }
      case "definition":
      case "footnoteDefinition": return "";
      default: return children(node);
    }
  }
  function plain(node: Nodes): string {
    if (node.type === "html" || node.type === "definition" || node.type === "footnoteDefinition") return "";
    if (node.type === "image" || node.type === "imageReference") return node.alt || messages.wechatExport.image;
    if (node.type === "footnoteReference") return `[${usedFootnotes.indexOf(id(node.identifier)) + 1}]`;
    if (node.type === "break") return "\n";
    if (node.type === "thematicBreak") return "\n—\n";
    if (node.type === "list") return node.children.map((child, index) => `${node.ordered ? `${(node.start ?? 1) + index}.` : "•"} ${plain(child).trim()}`).join("\n") + "\n\n";
    if ("value" in node && typeof node.value === "string") return node.value + (["code", "math"].includes(node.type) ? "\n\n" : "");
    const value = "children" in node ? node.children.map(plain).join(node.type === "tableRow" ? "\t" : "") : "";
    if (node.type === "listItem") return `${node.checked == null ? "" : node.checked ? "☑ " : "☐ "}${value}`;
    return value + (["paragraph", "heading", "blockquote", "table"].includes(node.type) ? "\n\n" : node.type === "tableRow" ? "\n" : "");
  }
  const body = render(tree);
  // Use a bounded queue: footnotes may themselves reference other footnotes or form a cycle.
  const footnoteParts: string[] = [];
  const footnoteText: string[] = [];
  for (let index = 0; index < usedFootnotes.length; index++) {
    const note = footnotes.get(usedFootnotes[index]);
    if (!note) continue;
    footnoteParts.push(tag("section", `${index + 1}. ${children(note)}`, "footnote"));
    footnoteText.push(`${index + 1}. ${note.children.map(plain).join("").trim()}`);
  }
  const text = [plain(tree).trim(), ...footnoteText].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n");
  return { html: tag("section", body + footnoteParts.join(""), "article"), text, warnings: [...warnings] };
}
