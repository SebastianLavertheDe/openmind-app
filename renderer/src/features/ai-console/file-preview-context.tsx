import { createContext, useContext, type ReactNode } from "react";

export type OpenFilePreviewOptions = {
  /** Preserve Project ownership when a shared companion opens a Project file. */
  projectName?: string;
};

type OpenFilePreview = (path: string, options?: OpenFilePreviewOptions) => void;

const FilePreviewContext = createContext<OpenFilePreview | null>(null);

export function FilePreviewProvider({ open, children }: { open: OpenFilePreview; children: ReactNode }) {
  return <FilePreviewContext.Provider value={open}>{children}</FilePreviewContext.Provider>;
}

export function useFilePreview(): OpenFilePreview | null {
  return useContext(FilePreviewContext);
}

export function localFileReference(value: string | undefined): string | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the original value when it is not URI encoded.
  }
  const path = decoded
    .replace(/^file:\/\//i, "")
    .replace(/[?#]L?\d+(?::\d+)?$/i, "")
    .replace(/:(\d+)(?::\d+)?$/, "")
    .trim();
  if (!path || /(?:https?|mailto|data):/i.test(path) || path.includes("\n")) return null;
  const pathWithoutDrive = /^[a-z]:[\\/]/i.test(path) ? path.slice(2) : path;
  if (pathWithoutDrive.includes(":")) return null;
  if (!/(?:^|[\\/])[^\\/]+\.[a-z0-9][a-z0-9._-]{0,9}$/i.test(path)) return null;
  return knownContentPath(path);
}

function knownContentPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.includes("/")) return value;
  if (/^\d{8}_daily_summary\.md$/i.test(normalized)) return `openmind/daily-summary/${normalized}`;
  if (/^\d{8}_daily_topic\.md$/i.test(normalized)) return `openmind/daily-topic/${normalized}`;
  return value;
}
