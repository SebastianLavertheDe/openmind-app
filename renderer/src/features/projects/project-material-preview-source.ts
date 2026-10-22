import { messages } from "@shared/messages";
import { parseProjectVideoMediaUrl } from "@shared/youtube-import";
import { bilibiliEmbedUrl, parseTrustedBilibiliEmbed } from "@shared/bilibili-video";
import type { ContentRecord } from "@shared/contracts";
import {
  documentPreviewResource,
  type FilePreviewSource,
  type PreviewResource,
  type PreviewTranscriptSegment,
  type VideoPlayback,
  type VideoPreviewResource
} from "../file-preview/model";
import { projectsApi } from "./projects-api";
import type { ProjectMaterial, ProjectTranscriptSegment } from "./types";

export type ProjectMaterialPreviewOptions = {
  logicalPath?: string;
  view?: "auto" | "document" | "pdf";
  initialMaterial?: ProjectMaterial;
  onMaterial?(material: ProjectMaterial): void;
};

/**
 * Keeps Project ownership checks on the existing typed Project IPC. In
 * particular, PDF bytes are resolved through the material record rather than
 * by accepting an arbitrary workspace path.
 */
export function projectMaterialPreviewSource(
  projectName: string,
  relativePath: string,
  options: ProjectMaterialPreviewOptions = {}
): FilePreviewSource {
  const logicalPath = options.logicalPath || projectLogicalPath(projectName, relativePath);
  let externalUrl = "";
  return {
    id: `project-material:${projectName}:${relativePath}:${options.view || "auto"}`,
    path: logicalPath,
    capabilities: {
      editContent: false,
      editTitle: false,
      openExternal: true
    },
    async load() {
      const material = options.initialMaterial || await projectsApi.readMaterial(projectName, relativePath);
      options.onMaterial?.(material);
      externalUrl = projectMaterialExternalUrl(material);
      if (material.status !== "ready") {
        return unsupportedMaterialResource(material, logicalPath, messages.projectUi.materialPreviewUnavailable(material.status));
      }
      if (options.view === "pdf") {
        const original = await projectsApi.readMaterialOriginal(projectName, relativePath);
        return {
          kind: "pdf",
          id: `project-material-pdf:${projectName}:${relativePath}`,
          path: logicalPath,
          title: material.title || original.fileName,
          data: original.data
        };
      }
      return projectMaterialPreviewResource(material, logicalPath);
    },
    async openExternal() {
      if (externalUrl) await window.openmind.openExternal(externalUrl);
    }
  };
}

export function projectMaterialPreviewResource(material: ProjectMaterial, logicalPath = material.relativePath): PreviewResource {
  if (material.kind === "video") return projectMaterialVideoResource(material, logicalPath);
  const record: ContentRecord = {
    path: logicalPath,
    name: material.title,
    content: material.content || "",
    ext: ".md",
    extension: ".md",
    truncated: material.truncated
  };
  return documentPreviewResource(record, `project-material:${logicalPath}`);
}

export function projectMaterialVideoResource(material: ProjectMaterial, logicalPath = material.relativePath): VideoPreviewResource {
  const video = material.video;
  const trustedYoutube = trustedYoutubeDescriptor(video?.provider, video?.embedUrl, video?.videoId);
  const bilibili = video?.provider === "bilibili" && video.embedUrl && video.videoId ? parseTrustedBilibiliEmbed(video.embedUrl, video.videoId) : null;
  const localMediaUrl = video?.localMediaUrl && parseProjectVideoMediaUrl(video.localMediaUrl) ? video.localMediaUrl : undefined;
  const playback: VideoPlayback = bilibili ? { kind: "trusted-bilibili", embedUrl: bilibiliEmbedUrl(bilibili), videoId: bilibili.videoId }
    : localMediaUrl && video?.provider !== "bilibili" ? { kind: "local-video", mediaUrl: localMediaUrl } : trustedYoutube
    ? { kind: "trusted-youtube", ...trustedYoutube }
    : { kind: "external-only", sourceUrl: projectMaterialExternalUrl(material) };
  const transcript = video?.transcript?.length
    ? video.transcript.map(normalizeTranscriptSegment)
    : parseProjectMaterialTranscript(material.content || "");
  return {
    kind: "video",
    id: `project-material-video:${logicalPath}`,
    path: logicalPath,
    title: material.title,
    playback,
    transcript,
    warnings: video?.warnings,
    durationMs: video?.durationMs
  };
}

function trustedYoutubeDescriptor(provider?: string, embedUrl?: string, videoId?: string): { embedUrl: string; videoId: string } | null {
  if (provider !== "youtube" || !videoId || !embedUrl || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const parsed = new URL(embedUrl);
    const query = [...parsed.searchParams.entries()];
    return parsed.protocol === "https:"
      && parsed.hostname === "www.youtube-nocookie.com"
      && !parsed.port
      && !parsed.username
      && !parsed.password
      && !parsed.hash
      && parsed.pathname === `/embed/${videoId}`
      && query.length === 1
      && query[0][0] === "enablejsapi"
      && query[0][1] === "1"
      ? { embedUrl: parsed.toString(), videoId }
      : null;
  } catch {
    return null;
  }
}

export function projectLogicalPath(projectName: string, relativePath: string): string {
  return `openmind/projects/${projectName}/${relativePath.replace(/^\/+/, "")}`;
}

function unsupportedMaterialResource(material: ProjectMaterial, logicalPath: string, reason: string): PreviewResource {
  return {
    kind: "unsupported",
    id: `project-material-unsupported:${logicalPath}`,
    path: logicalPath,
    title: material.title,
    reason
  };
}

function projectMaterialExternalUrl(material: ProjectMaterial): string {
  return material.sourceUrl || material.video?.mediaUrl || "";
}

function normalizeTranscriptSegment(item: ProjectTranscriptSegment): PreviewTranscriptSegment {
  return {
    id: item.id,
    startMs: item.startMs,
    endMs: item.endMs,
    text: item.text,
    speaker: item.speaker
  };
}

export function parseProjectMaterialTranscript(content: string): PreviewTranscriptSegment[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*\[(\d{1,2}:)?(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\s*[–-]\s*(\d{1,2}:)?(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.+)$/);
    if (!match) return [];
    const startMs = timePartsToMs(match[1], match[2], match[3]);
    const endMs = timePartsToMs(match[4], match[5], match[6]);
    return [{ id: `line-${index}`, startMs, endMs, text: match[7].trim() }];
  });
}

function timePartsToMs(hours: string | undefined, minutes: string, seconds: string): number {
  return ((Number.parseInt(hours || "0", 10) * 3600) + Number.parseInt(minutes, 10) * 60 + Number.parseFloat(seconds)) * 1000;
}
