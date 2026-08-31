import path from "node:path";
import type {
  ProjectMaterialConversionSource,
  ProjectMaterialConverter,
  ProjectMaterialConversionTarget
} from "../material-service";
import { SUPPORTED_DOCUMENT_EXTENSIONS } from "./document-converter-core";
import { convertDocumentInWorker } from "./document-converter";
import { convertVideoUrlToMarkdown, extractYoutubeVideoId } from "./video-converter";
import { convertWebPageToMarkdown } from "./web-converter";

function sourceStem(source: ProjectMaterialConversionSource): string {
  if (source.type === "file") return path.basename(source.originalName, path.extname(source.originalName));
  const url = new URL(source.url);
  const tail = decodeURIComponent(path.basename(url.pathname)).replace(/\.[^.]+$/, "");
  return (tail || url.hostname).replace(/[^\p{L}\p{N}._ -]+/gu, "-").slice(0, 160) || "网页资料";
}

function isDirectVideoUrl(value: string): boolean {
  try {
    return /\.(?:mp4|webm|m3u8)$/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

export class DocumentProjectMaterialConverter implements ProjectMaterialConverter {
  readonly id = "project-document-markdown-v1";
  readonly supportedExtensions = SUPPORTED_DOCUMENT_EXTENSIONS;

  supports(source: ProjectMaterialConversionSource): boolean {
    return source.type === "file" && this.supportedExtensions.includes(source.extension as never);
  }

  target(source: ProjectMaterialConversionSource): ProjectMaterialConversionTarget {
    if (source.type !== "file" || !this.supports(source)) throw new Error("文档转换器不支持该资料类型");
    return {
      kind: "document",
      directory: "documents",
      fileName: `${sourceStem(source)}.md`,
      title: sourceStem(source),
      preserveOriginal: true
    };
  }

  async convert(request: Parameters<ProjectMaterialConverter["convert"]>[0]) {
    if (request.source.type !== "file") throw new Error("文档转换器缺少源文件");
    const result = await convertDocumentInWorker(request.source.absolutePath);
    return { content: result.markdown, mimeType: "text/markdown", title: result.title };
  }
}

export class VideoProjectMaterialConverter implements ProjectMaterialConverter {
  readonly id = "project-video-markdown-v1";

  supports(source: ProjectMaterialConversionSource): boolean {
    return source.type === "url" && Boolean(extractYoutubeVideoId(source.url) || isDirectVideoUrl(source.url));
  }

  target(source: ProjectMaterialConversionSource): ProjectMaterialConversionTarget {
    if (source.type !== "url" || !this.supports(source)) throw new Error("视频转换器不支持该 URL");
    return {
      kind: "video",
      directory: "videos",
      fileName: `${sourceStem(source)}.video.md`,
      title: sourceStem(source)
    };
  }

  async convert(request: Parameters<ProjectMaterialConverter["convert"]>[0]) {
    if (request.source.type !== "url") throw new Error("视频转换器缺少 URL");
    const result = await convertVideoUrlToMarkdown(request.source.url);
    return { content: result.markdown, mimeType: "text/markdown", title: result.video.title };
  }
}

export class WebProjectMaterialConverter implements ProjectMaterialConverter {
  readonly id = "project-web-markdown-v1";

  supports(source: ProjectMaterialConversionSource): boolean {
    return source.type === "url" && !extractYoutubeVideoId(source.url) && !isDirectVideoUrl(source.url);
  }

  target(source: ProjectMaterialConversionSource): ProjectMaterialConversionTarget {
    if (source.type !== "url" || !this.supports(source)) throw new Error("网页转换器不支持该 URL");
    return {
      kind: "web",
      directory: "web",
      fileName: `${sourceStem(source)}.web.md`,
      title: sourceStem(source)
    };
  }

  async convert(request: Parameters<ProjectMaterialConverter["convert"]>[0]) {
    if (request.source.type !== "url") throw new Error("网页转换器缺少 URL");
    const result = await convertWebPageToMarkdown(request.source.url);
    return { content: result.markdown, mimeType: "text/markdown", title: result.title };
  }
}

export function createDefaultProjectMaterialConverters(): ProjectMaterialConverter[] {
  return [
    new DocumentProjectMaterialConverter(),
    new VideoProjectMaterialConverter(),
    new WebProjectMaterialConverter()
  ];
}
