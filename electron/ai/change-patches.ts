import crypto from "node:crypto";
import { formatPatch, parsePatch } from "diff";
import type { ChangeSet } from "../../shared/contracts";

const MAX_PATCH_CACHE_CHARS = 4 * 1024 * 1024;
type PatchCacheEntry = {
  fingerprint?: string;
  analysis?: { segments: string[]; path: string | null };
};
const patchCache = new Map<string, PatchCacheEntry>();
let patchCacheChars = 0;

export function patchFingerprint(value: string): string {
  const entry = patchCacheEntry(value);
  if (!entry.fingerprint) entry.fingerprint = crypto.createHash("sha256").update(value).digest("hex");
  return entry.fingerprint;
}

export function patchSegments(changeSet: ChangeSet): string[] {
  const segments: string[] = [];
  for (const file of changeSet.files) {
    if (changeSet.appliedFiles.includes(file.path)) continue;
    for (const patch of filePatchSegments(file)) {
      if (!changeSet.appliedPatches.includes(patchFingerprint(patch))) segments.push(patch);
    }
  }
  return segments;
}

export function filePatchSegments(file: ChangeSet["files"][number]): string[] {
  return analyzePatch(file.patch).segments;
}

export function remainingPatch(changeSet: ChangeSet): string {
  return patchSegments(changeSet).join("\n");
}

export function patchPath(value: string): string | null {
  return analyzePatch(value).path;
}

function analyzePatch(value: string): { segments: string[]; path: string | null } {
  const entry = patchCacheEntry(value);
  if (entry.analysis) return entry.analysis;
  try {
    const parsed = parsePatch(value)[0];
    const file = parsed?.newFileName || parsed?.oldFileName;
    entry.analysis = {
      segments: parsed?.hunks.length
        ? parsed.hunks.map((hunk) => formatPatch({ ...parsed, hunks: [hunk] }))
        : [value],
      path: file ? file.replace(/^[ab]\//, "") : null
    };
  } catch {
    entry.analysis = { segments: [value], path: null };
  }
  return entry.analysis;
}

function patchCacheEntry(value: string): PatchCacheEntry {
  const cached = patchCache.get(value);
  if (cached) {
    patchCache.delete(value);
    patchCache.set(value, cached);
    return cached;
  }
  const entry: PatchCacheEntry = {};
  patchCache.set(value, entry);
  patchCacheChars += value.length;
  while (patchCacheChars > MAX_PATCH_CACHE_CHARS && patchCache.size > 1) {
    const oldest = patchCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    patchCache.delete(oldest);
    patchCacheChars -= oldest.length;
  }
  return entry;
}
