import { useId, type ReactNode } from "react";
import { useExitPresence } from "./use-exit-presence";

/**
 * Accessible animated disclosure (replaces native `<details>` where height
 * animation + exit animation are wanted).
 *
 * - Trigger is a real button element with `aria-expanded` / `aria-controls`.
 * - Content height animates via `grid-template-rows: 0fr -> 1fr` plus an opacity
 *   crossfade, on `--dur-slow` / `--ease-emphasized` (audit: 220–240ms).
 * - While closing the content stays mounted for the exit animation but is marked
 *   `inert`, so it is removed from the accessibility tree and the Tab order.
 * - Expensive disclosure bodies can opt into unmounting after that animation.
 * - `prefers-reduced-motion` is handled by the global `transition: none` override.
 */
export function AnimatedDisclosure({
  open,
  onOpenChange,
  summary,
  children,
  className,
  triggerClassName,
  contentClassName,
  triggerAriaLabel,
  unmountOnExit = false,
  exitMs = 200
}: {
  open: boolean;
  onOpenChange(next: boolean): void;
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  triggerAriaLabel?: string;
  unmountOnExit?: boolean;
  exitMs?: number;
}) {
  const contentId = useId();
  const bodyPresence = useExitPresence(open || !unmountOnExit, exitMs);
  const renderBody = !unmountOnExit || open || bodyPresence.visible;
  return (
    <div className={`ui-disclosure${className ? ` ${className}` : ""}`} data-open={open || undefined}>
      <button
        data-motion="selection"
        type="button"
        className={`ui-disclosure-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={triggerAriaLabel}
        onClick={() => onOpenChange(!open)}
      >
        {summary}
      </button>
      <div
        id={contentId}
        className={`ui-disclosure-content${contentClassName ? ` ${contentClassName}` : ""}`}
        data-open={open || undefined}
        aria-hidden={!open}
      >
        <div
          className="ui-disclosure-content-inner"
          data-leaving={(unmountOnExit && bodyPresence.leaving) || undefined}
          inert={!open || undefined}
        >
          {renderBody ? children : null}
        </div>
      </div>
    </div>
  );
}
