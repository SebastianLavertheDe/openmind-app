import { useLocale } from "../../../i18n";
import { messages as uiMessages } from "@shared/messages";
import { FileWarning } from "lucide-react";
import { EmptyState } from "../../../design-system/components";
import type { UnsupportedPreviewResource } from "../model";

export function UnsupportedPreview({ resource }: { resource: UnsupportedPreviewResource }) {
  useLocale();
  return <EmptyState icon={<FileWarning size={30} />} title={uiMessages.interface.unsupportedPreview} description={resource.reason} />;
}

