import { useState } from "react";
import { EmptyState } from "../../../design-system/components";
import type { ImagePreviewResource } from "../model";

export function ImagePreview({ resource }: { resource: ImagePreviewResource }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === resource.dataUrl) return <EmptyState title="图片无法显示" description="图片可能已损坏或格式不受支持，请使用外部应用打开。" />;
  return <div className="file-image-preview">
    <img src={resource.dataUrl} alt={resource.title} onError={() => setFailedUrl(resource.dataUrl)} />
  </div>;
}
