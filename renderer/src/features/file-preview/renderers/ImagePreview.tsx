import { useLocale } from "../../../i18n";
import { messages as uiMessages } from "@shared/messages";
import { useState } from "react";
import { EmptyState } from "../../../design-system/components";
import type { ImagePreviewResource } from "../model";

export function ImagePreview({ resource }: { resource: ImagePreviewResource }) {
  useLocale();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === resource.dataUrl) return <EmptyState title={uiMessages.interface.imageCannotDisplay} description={uiMessages.interface.imageUnsupported} />;
  return <div className="file-image-preview">
    <img src={resource.dataUrl} alt={resource.title} onError={() => setFailedUrl(resource.dataUrl)} />
  </div>;
}
