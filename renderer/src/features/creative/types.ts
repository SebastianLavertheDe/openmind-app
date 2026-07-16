import {
  bucketForStage,
  nextWorkflowStage,
  preferredCreativeFile,
  type CreativeBucketId,
  type CreativePlatformId,
  type CreativeWorkflowStage
} from "@shared/creative-registry";
import {
  actionLabel,
  buildCreativeBuckets,
  buildPlatformOptions,
  buildWorkflowStages,
  dimensionLabel,
  platformLabel,
  stageLabel
} from "@shared/display-labels";
import { messages } from "@shared/messages";

export const STAGES = buildWorkflowStages();
export type Stage = CreativeWorkflowStage;

export type Bucket = CreativeBucketId;

export const BUCKETS = buildCreativeBuckets();

export { bucketForStage };

export type StreamFilter = Bucket | "all";

export type WorkspaceView = "workflow" | "history" | "release" | "analytics";
export type PlatformOption = { id: string; label: string; file: string };

export const PLATFORM_OPTIONS = buildPlatformOptions();

export interface CreativeReportShape {
  score: number;
  status: string;
  dimensions: Record<string, number>;
  issues: Array<{ id: string; severity: string; title: string; detail: string; line: number | null }>;
}

export function preferredFile(files: string[], stage: Stage): string {
  return preferredCreativeFile(files, stage);
}

export function firstParagraph(value: string): string {
  return value.split(/\n\s*\n/).map((part) => part.replace(/^#+\s+/gm, "").replace(/[*_`>-]/g, " ").replace(/\s+/g, " ").trim()).find(Boolean)?.slice(0, 160) || messages.common.noDescription;
}

export function formatRelative(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const delta = Date.now() - then;
  if (delta < 60000) return messages.common.justSaved;
  if (delta < 3600000) return messages.common.minutesAgo(Math.floor(delta / 60000));
  if (delta < 86400000) return messages.common.hoursAgo(Math.floor(delta / 3600000));
  return messages.common.daysAgo(Math.floor(delta / 86400000));
}

export function normalizeDate(value: string | undefined): string {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

export { stageLabel, platformLabel, actionLabel, dimensionLabel };

export function nextStage(value: Stage): Stage {
  return nextWorkflowStage(value);
}

export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function displayDate(value: string | undefined): string {
  const compact = String(value || "").replace(/\D/g, "").slice(0, 8);
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : "";
}

export type { CreativePlatformId };
