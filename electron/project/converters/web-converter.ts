import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { safeHttpGet, type SafeHttpOptions } from "./safe-http";

export type ConvertedWebPage = {
  title: string;
  sourceUrl: string;
  byline?: string;
  excerpt?: string;
  markdown: string;
};

function cleanText(input: string | null | undefined, fallback = "未命名网页"): string {
  const clean = (input ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 500) || fallback;
}

function safeAbsoluteAssetUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeArticleHtml(html: string, baseUrl: string): string {
  const dom = new JSDOM(`<main>${html}</main>`, { url: baseUrl });
  const document = dom.window.document;
  // Project web materials are text extracts. Remote images are deliberately
  // discarded so opening an imported note cannot trigger tracking or private
  // network requests from the renderer.
  for (const node of document.querySelectorAll("script,style,noscript,iframe,object,embed,form,input,button,svg,canvas,img")) {
    node.remove();
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on") || attribute.name === "style" || attribute.name === "srcset") {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const safe = safeAbsoluteAssetUrl(anchor.getAttribute("href") ?? "", baseUrl);
    if (safe) anchor.href = safe;
    else anchor.removeAttribute("href");
  }
  return document.querySelector("main")?.innerHTML ?? "";
}

export async function convertWebPageToMarkdown(
  inputUrl: string,
  options: SafeHttpOptions = {}
): Promise<ConvertedWebPage> {
  const response = await safeHttpGet(inputUrl, options);
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && !contentType.includes("text/plain")) {
    throw new Error(`网页内容类型不受支持：${contentType.split(";")[0]}`);
  }
  const html = response.body.toString("utf8");
  if (!html.trim()) throw new Error("网页内容为空");

  return extractWebPageMarkdown(html, response.finalUrl);
}

export function extractWebPageMarkdown(html: string, sourceUrl: string): ConvertedWebPage {
  const sourceDom = new JSDOM(html, { url: sourceUrl });
  const article = new Readability(sourceDom.window.document, { charThreshold: 20 }).parse();
  const title = cleanText(article?.title ?? sourceDom.window.document.title);
  const rawContent = article?.content ?? sourceDom.window.document.body?.innerHTML ?? "";
  const safeHtml = sanitizeArticleHtml(rawContent, sourceUrl);
  const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
  turndown.remove(["script", "style", "iframe", "object", "embed", "form"]);
  const body = turndown.turndown(safeHtml).replace(/\n{4,}/g, "\n\n\n").trim();
  if (!body) throw new Error("网页没有可提取的正文");
  const byline = article?.byline ? cleanText(article.byline, "") : undefined;
  const excerpt = article?.excerpt ? cleanText(article.excerpt, "") : undefined;
  const metadata = [
    `- URL：${sourceUrl}`,
    `- 导入时间：${new Date().toISOString()}`,
    ...(byline ? [`- 作者：${byline}`] : [])
  ];
  return {
    title,
    sourceUrl,
    byline,
    excerpt,
    markdown: `# ${title}\n\n## 元数据\n\n${metadata.join("\n")}\n\n## 正文\n\n${body}\n`
  };
}
