import { useState } from "react";
import { Music2 } from "lucide-react";
import { mediaKind, parseLocalMediaUrl } from "@shared/media-preview";
import { messages } from "@shared/messages";
import { Button, EmptyState } from "../../../design-system/components";
import { useLocale } from "../../../i18n";
import type { AudioPreviewResource } from "../model";

export function AudioPreview({ resource, onOpenExternal }: { resource: AudioPreviewResource; onOpenExternal?(): void }) {
  useLocale();
  const [failed, setFailed] = useState(false);
  const source = parseLocalMediaUrl(resource.mediaUrl);
  if (!source || mediaKind(source.path) !== "audio") return <EmptyState title={messages.interface.unsupportedPreview} />;
  return <div className="file-audio-preview">
    <Music2 size={40} aria-hidden /><strong>{resource.title}</strong>
    <audio controls preload="metadata" src={resource.mediaUrl} aria-label={resource.title} onError={() => setFailed(true)} />
    {failed ? <div role="status"><p>{messages.interface.mediaPlaybackFailed}</p>
      {onOpenExternal ? <Button variant="ghost" onClick={onOpenExternal}>{messages.interface.openExternalMedia}</Button> : null}
    </div> : null}
  </div>;
}
