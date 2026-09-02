import type { Session } from "electron";

export const OPENMIND_YOUTUBE_REFERRER = "https://com.openmind.desktop/";

const YOUTUBE_EMBED_URLS = [
  "https://www.youtube.com/embed/*",
  "https://www.youtube-nocookie.com/embed/*"
];

type EmbedRequest = {
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
};

/**
 * YouTube error 153 is returned when a desktop WebView does not identify the
 * embedding app. OpenMind loads its renderer from file://, so Chromium cannot
 * derive a useful Referer on its own. Keep the identity header narrowly scoped
 * to top-level YouTube embed documents; player subresources and unrelated
 * requests retain their original headers.
 */
export function youtubeEmbedRequestHeaders(details: EmbedRequest): Record<string, string> {
  if (details.resourceType !== "subFrame" || !isTrustedYoutubeEmbed(details.url)) {
    return details.requestHeaders;
  }
  const headers = Object.fromEntries(
    Object.entries(details.requestHeaders).filter(([name]) => name.toLocaleLowerCase() !== "referer")
  );
  headers.Referer = OPENMIND_YOUTUBE_REFERRER;
  return headers;
}

export function registerYoutubeEmbedRequestPolicy(target: Session): void {
  target.webRequest.onBeforeSendHeaders({ urls: YOUTUBE_EMBED_URLS }, (details, callback) => {
    callback({ requestHeaders: youtubeEmbedRequestHeaders(details) });
  });
}

function isTrustedYoutubeEmbed(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && (parsed.hostname === "www.youtube.com" || parsed.hostname === "www.youtube-nocookie.com")
      && parsed.pathname.startsWith("/embed/");
  } catch {
    return false;
  }
}
