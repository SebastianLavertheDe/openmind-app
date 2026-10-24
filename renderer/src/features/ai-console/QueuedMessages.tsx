import { useId, useRef, useState } from "react";
import { ListEnd, MoreHorizontal, Trash2 } from "lucide-react";
import type { AiRun } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { IconButton, Popover } from "../../design-system/components";
import { useLocale } from "../../i18n";

type QueuedMessage = Pick<AiRun, "id" | "prompt" | "contexts">;

export function QueuedMessages({ runs, cancellingRunIds, onCancel }: {
  runs: QueuedMessage[];
  cancellingRunIds: ReadonlySet<string>;
  onCancel(id: string): void;
}) {
  useLocale();
  if (!runs.length) return null;
  return <ol className="queue-tray" aria-label={m.ai.composer.queuedSummary(runs.length)}>
    {runs.map((run, index) => <QueuedMessageRow key={run.id} run={run} index={index}
      cancelling={cancellingRunIds.has(run.id)} onCancel={onCancel} />)}
  </ol>;
}

function QueuedMessageRow({ run, index, cancelling, onCancel }: {
  run: QueuedMessage;
  index: number;
  cancelling: boolean;
  onCancel(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailId = useId();
  const label = m.ai.composer.queuedMessage(index + 1);
  const preview = run.prompt.trim() || m.ai.context.count(run.contexts.length);
  return <li className="queue-tray-item">
    <ListEnd className="queue-tray-icon" size={14} strokeWidth={1.5} aria-hidden />
    <span className="ui-visually-hidden">{label}</span>
    <span className="queue-tray-preview">{preview}</span>
    <div className="queue-tray-actions">
      <IconButton variant="ghost" size="sm" label={m.ai.composer.removeQueuedMessage(index + 1)}
        loading={cancelling} onClick={() => onCancel(run.id)}>
        <Trash2 size={14} strokeWidth={1.5} aria-hidden />
      </IconButton>
      <IconButton ref={triggerRef} variant="ghost" size="sm" label={m.ai.composer.viewQueuedMessage(index + 1)}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? detailId : undefined}
        onClick={() => setOpen(value => !value)}>
        <MoreHorizontal size={14} strokeWidth={1.5} aria-hidden />
      </IconButton>
    </div>
    <Popover open={open} anchorRef={triggerRef} onClose={() => setOpen(false)} side="top"
      id={detailId} className="queue-message-detail" aria-label={label}>
      <strong>{label}</strong>
      <p className="queue-message-prompt">{preview}</p>
      {run.contexts.length ? <span className="queue-message-contexts">{m.ai.context.count(run.contexts.length)}</span> : null}
    </Popover>
  </li>;
}
