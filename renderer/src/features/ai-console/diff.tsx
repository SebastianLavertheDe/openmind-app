import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Files, FolderOpen } from "lucide-react";
import type { AiEvent, AiRun } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { CopyButton } from "./message";
import { fileIcon, fileIconColor } from "./file-icon";
import { useFilePreview } from "./file-preview-context";
import { PatchView } from "./patch-view";
import { asRecord, changePaths, numeric, scalar } from "./timeline";

type ChangeFileView = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
};

export function ChangeTraceCard({ event, run }: { event: AiEvent; run: AiRun }) {
  return <ChangeCard events={[event]} run={run} variant="trace" />;
}

/**
 * The durable, user-facing change artifact shown after the final assistant
 * reply. A run can report several incremental `changes` events; the artifact
 * deliberately folds all of them into one review surface instead of leaking
 * provider event granularity into the conversation.
 */
export function ChangeReviewCard({ events, run }: { events: AiEvent[]; run: AiRun }) {
  if (!events.length && !run.changeSet?.files.length) return null;
  return <ChangeCard events={events} run={run} variant="review" />;
}

function ChangeCard({ events, run, variant }: { events: AiEvent[]; run: AiRun; variant: "trace" | "review" }) {
  const [open, setOpen] = useState(false);
  const openPreview = useFilePreview();
  const paths = changePaths(run, events);
  const files = changeFiles(run, events, paths);
  const fileLabel = files.length ? m.ai.diff.editedFiles(files.length) : m.ai.diff.editedFile;
  if (variant === "review") {
    const visibleFiles = open ? files : files.slice(0, 3);
    const remainingFiles = files.length - visibleFiles.length;
    return (
      <section className="change-review-card" aria-label={fileLabel}>
        <header className="change-review-header">
          <span className="change-review-icon" aria-hidden="true"><Files size={15} /></span>
          <strong>{fileLabel}</strong>
        </header>
        {visibleFiles.length ? (
          <div className="change-review-files">
            {visibleFiles.map((file) => (
              <button
                type="button"
                className="change-review-file"
                data-motion="selection"
                key={file.path}
                title={m.ai.message.previewFile(file.path)}
                onClick={() => {
                  if (openPreview) openPreview(file.path);
                  else void window.cctools.openPath(file.path);
                }}
              >
                <span>{file.path}</span>
              </button>
            ))}
            {files.length > 3 ? (
              <button
                type="button"
                className="change-review-more"
                data-motion="selection"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
              >
                {open ? m.ai.diff.showFewerFiles : m.ai.diff.showMoreFiles(remainingFiles)}
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : <p className="change-review-empty">{m.ai.diff.providerReported}</p>}
      </section>
    );
  }
  const fileAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const fileDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const eventAdditions = Math.max(0, ...events.map((event) => {
    const payload = asRecord(event.payload.changeSet || event.payload);
    return numeric(payload.additions);
  }));
  const eventDeletions = Math.max(0, ...events.map((event) => {
    const payload = asRecord(event.payload.changeSet || event.payload);
    return numeric(payload.deletions);
  }));
  const additions = fileAdditions || eventAdditions;
  const deletions = fileDeletions || eventDeletions;
  return (
    <AnimatedDisclosure
      className="change-trace-card"
      open={open}
      onOpenChange={setOpen}
      summary={
        <>
          <span><strong>{fileLabel}</strong><small>{files.length ? files.map((file) => file.path).join(", ") : m.ai.diff.changesUpdated}</small></span>
          {additions || deletions ? <em>+{additions} -{deletions}</em> : null}
          <ChevronRight size={14} />
        </>
      }
    >
      <div>
        {files.length ? files.map((file) => (
          <article className="change-file-card" key={file.path}>
            <header>
              <span className="change-file-icon" style={{ color: fileIconColor(file.path) }}>{fileIcon(file.path, 14)}</span>
              <code>{file.path}</code>
              <span>{statusLabel(file.status)}{file.additions || file.deletions ? ` · +${file.additions} -${file.deletions}` : ""}</span>
            </header>
            <div>
              <button data-motion="icon" onClick={() => void window.cctools.openPath(file.path)}><ExternalLink size={13} />{m.ai.file.open}</button>
              <button data-motion="icon" onClick={() => void window.cctools.revealPath(file.path)}><FolderOpen size={13} />{m.ai.file.revealFolder}</button>
              {file.patch ? <CopyButton text={file.patch} /> : null}
            </div>
            {file.patch ? <PatchView patch={file.patch} /> : null}
          </article>
        )) : <p>{m.ai.diff.providerReported}</p>}
      </div>
    </AnimatedDisclosure>
  );
}

function changeFiles(run: AiRun, events: AiEvent[], fallbackPaths: string[]): ChangeFileView[] {
  const files = new Map<string, ChangeFileView>();
  const add = (value: unknown) => {
    const record = asRecord(value);
    const path = typeof value === "string" ? value : scalar(record.path || record.file_path || record.filePath);
    if (!path) return;
    const existing = files.get(path);
    const status = scalar(record.status || record.type || record.action);
    const patch = scalar(record.patch || record.diff);
    const additions = numeric(record.additions);
    const deletions = numeric(record.deletions);
    files.set(path, {
      path,
      status: status || existing?.status || "modified",
      additions: additions || existing?.additions || 0,
      deletions: deletions || existing?.deletions || 0,
      patch: patch || existing?.patch || ""
    });
  };

  for (const file of run.changeSet?.files || []) add(file);
  for (const event of events) {
    const payload = asRecord(event.payload);
    const changeSet = asRecord(payload.changeSet);
    for (const collection of [payload.files, payload.changes, changeSet.files]) {
      if (Array.isArray(collection)) collection.forEach(add);
    }
    const unifiedDiff = scalar(payload.diff || payload.patch || changeSet.patch);
    for (const file of parseUnifiedDiffFiles(unifiedDiff)) add(file);
  }
  for (const path of fallbackPaths) add(path);
  return [...files.values()];
}

function parseUnifiedDiffFiles(patch: string): ChangeFileView[] {
  if (!patch) return [];
  const files: ChangeFileView[] = [];
  let current: ChangeFileView | null = null;
  let lines: string[] = [];
  const finish = () => {
    if (!current) return;
    current.patch = lines.join("\n").trimEnd();
    files.push(current);
    current = null;
    lines = [];
  };

  for (const line of patch.split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      finish();
      current = {
        path: cleanDiffPath(header[2] === "/dev/null" ? header[1] : header[2]),
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: ""
      };
      lines.push(line);
      continue;
    }
    if (!current) continue;
    lines.push(line);
    if (line.startsWith("new file mode ")) current.status = "created";
    else if (line.startsWith("deleted file mode ")) current.status = "deleted";
    else if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = cleanDiffPath(line.slice("rename to ".length));
    } else if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
  }
  finish();
  return files.filter((file) => file.path && file.path !== "/dev/null");
}

function cleanDiffPath(value: string): string {
  return value.trim().replace(/^"|"$/g, "");
}

function statusLabel(value: string): string {
  const labels = m.ai.diff.status;
  return labels[value as keyof typeof labels] || value || labels.modified;
}
