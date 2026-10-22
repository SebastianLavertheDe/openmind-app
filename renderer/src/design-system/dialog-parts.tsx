import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { X } from "lucide-react";
import { messages } from "@shared/messages";
import { IconButton } from "./IconButton";
import { SearchInput, type SearchInputProps } from "./inputs";

export function DialogHeader({ title, description, titleId, descriptionId, onClose, closeDisabled, actions, closeLabel = messages.common.close }: {
  title: ReactNode;
  description?: ReactNode;
  titleId: string;
  descriptionId?: string;
  onClose?(): void;
  closeDisabled?: boolean;
  actions?: ReactNode;
  closeLabel?: string;
}) {
  return <header className="ui-dialog-header">
    <div className="ui-dialog-heading"><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div>
    {actions}
    {onClose ? <IconButton label={closeLabel} disabled={closeDisabled} onClick={onClose}><X aria-hidden="true" /></IconButton> : null}
  </header>;
}

export function DialogBody({ className = "", ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={`ui-dialog-body ${className}`.trim()} />;
}

export function DialogFooter({ className = "", ...props }: ComponentPropsWithoutRef<"footer">) {
  return <footer {...props} className={`ui-dialog-footer ${className}`.trim()} />;
}

/** A command/search dialog shares chrome while its owner handles result navigation. */
export function SearchDialogHeader({ onClose, loadingLabel, ...props }: SearchInputProps & { onClose(): void; loadingLabel?: string }) {
  return <header className="ui-dialog-search-header">
    <SearchInput {...props} variant="quiet" />
    {loadingLabel ? <span className="ui-dialog-search-status" role="status">{loadingLabel}</span> : null}
    <IconButton label={messages.common.close} onClick={onClose}><X aria-hidden="true" /></IconButton>
  </header>;
}
