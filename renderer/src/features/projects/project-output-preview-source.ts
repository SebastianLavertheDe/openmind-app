import type { ContentRecord } from "@shared/contracts";
import { documentPreviewResource, type FilePreviewSource, type PreviewResource } from "../file-preview/model";
import { projectsApi } from "./projects-api";
import { projectLogicalPath } from "./project-material-preview-source";
import type { ProjectOutput } from "./types";

export function projectOutputPreviewSource(
  projectName: string,
  relativePath: string,
  {
    editable = true,
    logicalPath = projectLogicalPath(projectName, relativePath),
    initialOutput,
    onOutput
  }: {
    editable?: boolean;
    logicalPath?: string;
    initialOutput?: ProjectOutput;
    onOutput?(output: ProjectOutput): void;
  } = {}
): FilePreviewSource {
  const source: FilePreviewSource = {
    id: `project-output:${projectName}:${relativePath}`,
    path: logicalPath,
    capabilities: {
      editContent: editable,
      editTitle: editable,
      openExternal: false
    },
    async load() {
      const output = initialOutput || await projectsApi.readOutput(projectName, relativePath);
      onOutput?.(output);
      return projectOutputPreviewResource(output, logicalPath);
    }
  };
  if (editable) {
    source.save = async ({ content, title }) => {
      const output = await projectsApi.saveOutput(projectName, relativePath, content, title.trim() || undefined);
      onOutput?.(output);
      return projectOutputPreviewResource(output, logicalPath);
    };
  }
  return source;
}

export function projectOutputPreviewResource(output: ProjectOutput, logicalPath = output.relativePath): PreviewResource {
  const record: ContentRecord = {
    path: logicalPath,
    name: output.title,
    content: output.content || "",
    ext: ".md",
    extension: ".md"
  };
  return documentPreviewResource(record, `project-output:${logicalPath}`);
}
