import type { ContentKind } from "./contracts";
import { messages } from "./messages";

export function contentKindLabel(kind: ContentKind): string {
  return messages.contentKind[kind];
}

export function navLabel(page: keyof typeof messages.nav): string {
  return messages.nav[page];
}
