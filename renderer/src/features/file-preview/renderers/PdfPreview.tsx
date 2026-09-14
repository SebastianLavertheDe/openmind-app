import type { PdfPreviewResource } from "../model";
import { PdfMaterialViewer } from "./PdfViewer";

export default function PdfPreview({ resource, onError }: { resource: PdfPreviewResource; onError?(message: string): void }) {
  return <PdfMaterialViewer data={resource.data} title={resource.title} onError={onError || (() => {})} />;
}
