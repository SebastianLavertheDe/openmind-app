import type { ContentKind } from "./contracts";
import {
  CREATIVE_PLATFORMS,
  normalizePlatformId,
  type CreativePlatformId,
  type CreativeReleaseAction,
  type CreativeReviewDimension,
  type CreativeStageId
} from "./creative-registry";
import { messages } from "./messages";

export function contentKindLabel(kind: ContentKind): string {
  return messages.contentKind[kind];
}

export function stageLabel(value: string): string {
  return messages.creative.stage[value as CreativeStageId] || value;
}

export function platformLabel(value: string): string {
  const id = normalizePlatformId(value);
  if (id && id in messages.creative.platform) {
    return messages.creative.platform[id as CreativePlatformId];
  }
  return value || messages.common.unspecified;
}

export function actionLabel(action: string): string {
  return messages.creative.releaseAction[action as CreativeReleaseAction] || action;
}

export function navLabel(page: keyof typeof messages.nav): string {
  return messages.nav[page];
}

/** @deprecated 使用 contentKindLabel()；保留供 inbox filter 派生。 */


export function buildPlatformOptions() {
  return CREATIVE_PLATFORMS.map((platform) => ({
    id: platform.id,
    label: messages.creative.platform[platform.id],
    file: platform.file
  }));
}

export function buildWorkflowStages() {
  return (["today", "drafting", "review", "ready", "published"] as const).map((id) => ({
    id,
    label: messages.creative.stage[id]
  }));
}

export function buildCreativeBuckets() {
  return [
    { id: "topic" as const, label: messages.creative.bucket.topic, stages: ["today"] as const },
    { id: "drafting" as const, label: messages.creative.bucket.drafting, stages: ["drafting"] as const },
    { id: "pending" as const, label: messages.creative.bucket.pending, stages: ["review", "ready"] as const },
    { id: "published" as const, label: messages.creative.bucket.published, stages: ["published"] as const }
  ];
}
