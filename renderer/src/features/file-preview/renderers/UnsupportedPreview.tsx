import { FileWarning } from "lucide-react";
import { EmptyState } from "../../../design-system/components";
import type { UnsupportedPreviewResource } from "../model";

export function UnsupportedPreview({ resource }: { resource: UnsupportedPreviewResource }) {
  return <EmptyState icon={<FileWarning size={30} />} title="暂不支持预览" description={resource.reason} />;
}

