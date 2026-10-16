import type { Root } from "hast";
import type { Locale } from "./messages";

export type DocumentBlock = {
  id: string;
  tree: Root;
  text: string;
  start: number;
  kind: string;
  continuation: boolean;
};
export type ReadingDocument = {
  blocks: DocumentBlock[];
  text: string;
  headings: Array<{ id: string; title: string; block: number }>;
  anchors: Record<string, number>;
  code: Record<string, string>;
};
export type DocumentMatch = { start: number; end: number; block: number };
export type DocumentWorkerRequest =
  | { type: "parse"; content: string; math: boolean; locale?: Locale }
  | { type: "find"; query: string; id: number };
export type DocumentWorkerResponse =
  | { type: "document"; document: ReadingDocument }
  | { type: "matches"; id: number; matches: DocumentMatch[] }
  | { type: "error"; message: string };
