import type { MarkdownReaderLayout } from "../../../components/MarkdownReader";
import { ContentPreview } from "../../../components/ContentPreview";
import type { DocumentPreviewResource } from "../model";

export function DocumentPreview({ resource, content, layout = "file" }: {
  resource: DocumentPreviewResource;
  content?: string;
  layout?: MarkdownReaderLayout;
}) {
  return <ContentPreview content={{ ...resource.record, content: content ?? resource.record.content }} layout={layout} />;
}

