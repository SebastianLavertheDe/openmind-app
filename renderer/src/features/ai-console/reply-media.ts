import { mediaKind } from "@shared/media-preview";
import { localFileReference } from "./file-preview-context";

/** Only inspect this reply and its write records; never scan the workspace. */
export function replyMediaCandidates(text: string, writtenPaths: string[] = []): string[] {
  const candidates: string[] = [];
  const add = (value: string) => {
    const path = localFileReference(value.trim().replace(/^<|>$/g, ""));
    if (path && mediaKind(path)) candidates.push(path);
  };
  const bounded = text.slice(0, 200_000);
  for (const match of bounded.matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))\s*\)/g)) add(match[1] || match[2]);
  for (const match of bounded.matchAll(/`([^`\n]+)`/g)) add(match[1]);
  for (const line of bounded.split(/\r?\n/)) add(line);
  // Older replies often put absolute paths in prose or a table, without links.
  const plain = bounded.replace(/(?:https?:)?\/\/[^\s<>"`]+/g, "");
  for (const match of plain.matchAll(/(?:[a-z]:[\\/]|(?<![\w:/])\/)[^\r\n<>"`|]*?\.(?:mp4|m4v|webm|mov|mp3|wav|ogg|opus|m4a|aac|flac|png|jpe?g|gif|webp|svg|ico|bmp)(?=$|[\s\])>。，；,;])/gi)) add(match[0]);
  writtenPaths.forEach(add);
  const unique = [...new Map(candidates.map(path => [path.replaceAll("\\", "/"), path])).values()];
  return unique.filter(path => path.includes("/") || path.includes("\\") || !unique.some(other => other !== path && other.replaceAll("\\", "/").endsWith(`/${path}`))).slice(0, 12);
}
