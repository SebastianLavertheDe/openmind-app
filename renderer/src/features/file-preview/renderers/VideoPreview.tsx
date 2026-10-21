import { useLocale } from "../../../i18n";
import { messages as uiMessages } from "@shared/messages";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Video } from "lucide-react";
import { EmptyState } from "../../../design-system/components";
import { useContainerLayoutMode } from "../../../design-system/use-container-layout-mode";
import type { VideoPreviewResource } from "../model";

export const VIDEO_PREVIEW_SPLIT_MIN_INLINE_SIZE = 720;

export function VideoPreview({ resource, onOpenExternal, onRetryTranscript, retryingTranscript = false }: {
  resource: VideoPreviewResource;
  onOpenExternal?(): void;
  onRetryTranscript?(): void;
  retryingTranscript?: boolean;
}) {
  const locale = useLocale();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const layout = useContainerLayoutMode<HTMLDivElement>({ splitMinInlineSize: VIDEO_PREVIEW_SPLIT_MIN_INLINE_SIZE });
  const [currentMs, setCurrentMs] = useState(0);
  const [playerError, setPlayerError] = useState(false);
  const embedUrl = trustedYoutubeEmbedUrl(resource);
  const embedOrigin = useMemo(() => {
    if (!embedUrl) return null;
    try { return new URL(embedUrl).origin; } catch { return null; }
  }, [embedUrl, locale]);

  useEffect(() => {
    if (!embedOrigin) return;
    const receivePlaybackState = (event: MessageEvent) => {
      if (event.origin !== embedOrigin || event.source !== frameRef.current?.contentWindow) return;
      try {
        const payload = typeof event.data === "string"
          ? JSON.parse(event.data) as { event?: string; info?: number | { currentTime?: unknown } }
          : event.data as { event?: string; info?: number | { currentTime?: unknown } };
        if (payload?.event === "onError" && typeof payload.info === "number") setPlayerError(true);
        const currentTime = payload?.event === "infoDelivery" && typeof payload.info === "object" ? payload.info?.currentTime : undefined;
        if (typeof currentTime === "number" && Number.isFinite(currentTime)) setCurrentMs(currentTime * 1000);
      } catch {
        // Ignore unrelated messages from the already validated player origin.
      }
    };
    window.addEventListener("message", receivePlaybackState);
    return () => window.removeEventListener("message", receivePlaybackState);
  }, [embedOrigin]);

  const connectEmbeddedPlayer = () => {
    if (!frameRef.current?.contentWindow || !embedOrigin) return;
    frameRef.current.contentWindow.postMessage(JSON.stringify({
      event: "listening",
      id: `file-preview-video-${resource.id}`
    }), embedOrigin);
    frameRef.current.contentWindow.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onError"] }), embedOrigin);
  };

  const seek = (milliseconds: number) => {
    setCurrentMs(milliseconds);
    if (frameRef.current?.contentWindow && embedOrigin) {
      frameRef.current.contentWindow.postMessage(JSON.stringify({
        event: "command",
        func: "seekTo",
        args: [milliseconds / 1000, true]
      }), embedOrigin);
    }
  };

  return (
    <div ref={layout.ref} className={`project-video-layout layout-${layout.mode}${resource.transcript.length ? "" : " has-no-transcript"}`} data-layout-width={layout.inlineSize ? Math.round(layout.inlineSize) : undefined}>
      <div className="project-video-detail">
        <div className="project-video-media-column">
          <section className="project-video-player">
            {embedUrl ? (
              <iframe
                ref={frameRef}
                title={resource.title}
                src={embedUrl}
                onLoad={connectEmbeddedPlayer}
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="project-video-unavailable">
                <Video size={28} />
                <strong>{uiMessages.interface.videoCannotEmbed}</strong>
                <p>{uiMessages.interface.videoExternalHint}</p>
                {onOpenExternal ? <button data-motion="action" onClick={onOpenExternal}><ExternalLink size={14} />{uiMessages.interface.openBrowser}</button> : null}
              </div>
            )}
          </section>
          {embedUrl && onOpenExternal ? <div className="project-video-playback-help" role={playerError ? "status" : undefined}>
            <p>{playerError ? uiMessages.interface.youtubePlaybackFailed : uiMessages.interface.youtubePlaybackHint}</p>
            <button type="button" data-motion="action" onClick={onOpenExternal}><ExternalLink size={14} />{uiMessages.interface.openBrowser}</button>
          </div> : null}
        </div>
        <div className="project-video-inspector-column">
          <section className="project-transcript project-video-inspector">
            <div className="project-transcript-list">
              {!resource.transcript.length ? <EmptyState title={uiMessages.interface.transcriptNotFetched} description={resource.warnings?.join("\n") || uiMessages.interface.transcriptFetchHint}
                action={onRetryTranscript ? <button type="button" data-motion="action" disabled={retryingTranscript} onClick={onRetryTranscript}><RefreshCw size={14} className={retryingTranscript ? "spin" : undefined} />{retryingTranscript ? uiMessages.interface.fetchingTranscript : uiMessages.interface.retryTranscript}</button> : undefined} /> : null}
              {resource.transcript.map((item) => {
                const active = currentMs >= item.startMs && currentMs < Math.max(item.startMs + 1, item.endMs);
                return (
                  <div className={`project-transcript-row${active ? " active" : ""}`} key={item.id}>
                    <button className="project-timecode" data-motion="selection" onClick={() => seek(item.startMs)}>{formatDisplayTime(item.startMs)}</button>
                    <span>{item.speaker ? <strong>{item.speaker} </strong> : null}{item.text}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default VideoPreview;

export function trustedYoutubeEmbedUrl(resource: VideoPreviewResource): string | undefined {
  if (resource.playback.kind !== "trusted-youtube") return undefined;
  const { embedUrl, videoId } = resource.playback;
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return undefined;
  try {
    const parsed = new URL(embedUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.youtube-nocookie.com" || parsed.port || parsed.username || parsed.password || parsed.hash) return undefined;
    const query = [...parsed.searchParams.entries()];
    if (parsed.pathname !== `/embed/${videoId}` || query.length !== 1 || query[0][0] !== "enablejsapi" || query[0][1] !== "1") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function formatDisplayTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
