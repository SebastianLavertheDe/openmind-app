import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Nodes } from "mdast";
import { defaultUrlTransform } from "react-markdown";
import { localFileReference } from "./file-preview-context";

export type ImageSource = { source: string; title: string };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export function chatUrlTransform(url: string, key: string): string {
  if (key === "src" && (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(url) || /^file:\/\//i.test(url) || /^[a-z]:[\\/]/i.test(url))) return url;
  return defaultUrlTransform(url);
}

export function chatImageSource(source: string): string {
  return source.startsWith("//") ? `https:${source}` : localFileReference(source) || source;
}

/** Metadata only: never loads images or mistakes fenced/inline code for images. */
export function markdownImageSources(text: string): ImageSource[] {
  if (!text.includes("![")) return [];
  const tree = parser.parse(text);
  const definitions = new Map<string, string>();
  const visit = (node: Nodes, fn: (node: Nodes) => void) => {
    fn(node);
    if ("children" in node) node.children.forEach(child => visit(child, fn));
  };
  visit(tree, node => {
    if (node.type === "definition" && !definitions.has(node.identifier.toUpperCase())) definitions.set(node.identifier.toUpperCase(), node.url);
  });
  const images: ImageSource[] = [];
  visit(tree, node => {
    const url = node.type === "image" ? node.url : node.type === "imageReference" ? definitions.get(node.identifier.toUpperCase()) : undefined;
    if (!url) return;
    const source = chatUrlTransform(url, "src");
    if (source) images.push({ source: chatImageSource(source), title: "alt" in node ? node.alt || "" : "" });
  });
  return images;
}

/** Cache only this mounted process's current steps, including image-free text. */
export class MarkdownImageCatalog {
  private readonly entries = new Map<string, { text: string; images: ImageSource[] }>();
  constructor(private readonly parse = markdownImageSources) {}

  read(key: string, text: string): ImageSource[] {
    const existing = this.entries.get(key);
    if (existing?.text === text) return existing.images;
    const images = text.includes("![") ? this.parse(text) : [];
    this.entries.set(key, { text, images });
    return images;
  }

  retain(keys: Set<string>): void {
    for (const key of this.entries.keys()) if (!keys.has(key)) this.entries.delete(key);
  }
}
