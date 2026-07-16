import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { DropdownMenu } from "./controls";
import { Tooltip } from "./Tooltip";
import { useExitPresence } from "./use-exit-presence";
import { useExitingList } from "./use-exiting-list";

export type ActionPresentation = "full" | "compact" | "minimal";
export type ResponsiveActionPriority = "essential" | "primary" | "secondary";

export type ResponsiveAction = {
  id: string;
  /** Accessible name; remains stable when the visible label is shortened. */
  label: string;
  displayLabel?: string;
  shortLabel?: string;
  labelBehavior?: "responsive" | "icon";
  icon: LucideIcon;
  priority: ResponsiveActionPriority;
  onSelect(): void;
  disabled?: boolean;
  pressed?: boolean;
  badge?: ReactNode;
  className?: string;
};

const VISIBLE_PRIORITIES: Record<ActionPresentation, ReadonlySet<ResponsiveActionPriority>> = {
  full: new Set(["essential", "primary", "secondary"]),
  compact: new Set(["essential", "primary"]),
  minimal: new Set(["essential"])
};

const RESPONSIVE_EXIT_MS = 140;
const actionKey = (action: ResponsiveAction) => action.id;

export function isResponsivePriorityVisible(presentation: ActionPresentation, priority: ResponsiveActionPriority): boolean {
  return VISIBLE_PRIORITIES[presentation].has(priority);
}

function ActionButton({
  action,
  presentation,
  entering = false,
  leaving = false
}: {
  action: ResponsiveAction;
  presentation: ActionPresentation;
  entering?: boolean;
  leaving?: boolean;
}) {
  const Icon = action.icon;
  const text = action.labelBehavior === "icon"
    ? undefined
    : presentation === "full"
      ? action.displayLabel || action.label
      : presentation === "compact"
        ? action.shortLabel
        : undefined;
  const previousTextRef = useRef(text);
  useLayoutEffect(() => {
    if (text) previousTextRef.current = text;
  }, [text]);
  const labelPresence = useExitPresence(Boolean(text) && !leaving, RESPONSIVE_EXIT_MS);
  const renderedText = text || previousTextRef.current;
  const button = (
    <button
      type="button"
      className={`ui-responsive-action${action.className ? ` ${action.className}` : ""}`}
      aria-label={action.label}
      aria-pressed={action.pressed}
      aria-hidden={leaving || undefined}
      disabled={action.disabled}
      inert={leaving || undefined}
      tabIndex={leaving ? -1 : undefined}
      data-motion="icon"
      data-presentation={text ? "label" : "icon"}
      data-entering={entering || undefined}
      data-leaving={leaving || undefined}
      onClick={leaving ? undefined : action.onSelect}
    >
      <Icon size={16} aria-hidden="true" />
      {labelPresence.visible && renderedText ? (
        <span
          key={renderedText}
          className="ui-responsive-action-label"
          aria-hidden={labelPresence.leaving || undefined}
          data-leaving={labelPresence.leaving || undefined}
        >
          {renderedText}
        </span>
      ) : null}
      {action.badge != null ? <b>{action.badge}</b> : null}
    </button>
  );
  return labelPresence.visible && renderedText ? button : <Tooltip content={action.label}>{button}</Tooltip>;
}

/**
 * Priority-driven action disclosure. Callers describe semantics only; the
 * component owns label collapse and moving lower-priority actions into a menu.
 */
export function ResponsiveActionBar({
  actions,
  presentation,
  overflowLabel = "更多操作",
  className = ""
}: {
  actions: ResponsiveAction[];
  presentation: ActionPresentation;
  overflowLabel?: string;
  className?: string;
}) {
  const visible = actions.filter((action) => isResponsivePriorityVisible(presentation, action.priority));
  const overflow = actions.filter((action) => !isResponsivePriorityVisible(presentation, action.priority));
  const animatedVisible = useExitingList(visible, actionKey, RESPONSIVE_EXIT_MS);
  const previousVisibleIds = useRef(new Set(visible.map(actionKey)));
  const enteringIds = new Set(visible.filter((action) => !previousVisibleIds.current.has(action.id)).map(actionKey));
  useLayoutEffect(() => {
    previousVisibleIds.current = new Set(visible.map(actionKey));
  }, [visible]);

  const overflowPresence = useExitPresence(overflow.length > 0, RESPONSIVE_EXIT_MS);
  const previousOverflowRef = useRef(overflow);
  useLayoutEffect(() => {
    if (overflow.length) previousOverflowRef.current = overflow;
  }, [overflow]);
  const renderedOverflow = overflow.length ? overflow : previousOverflowRef.current;
  return (
    <div className={`ui-responsive-actions ${className}`.trim()} role="toolbar" aria-label={overflowLabel} data-presentation={presentation}>
      {animatedVisible.map(({ item: action, leaving }) => (
        <ActionButton
          key={action.id}
          action={action}
          presentation={presentation}
          entering={enteringIds.has(action.id)}
          leaving={leaving}
        />
      ))}
      {overflowPresence.visible ? (
        <span
          className="ui-responsive-overflow-presence"
          aria-hidden={overflowPresence.leaving || undefined}
          data-leaving={overflowPresence.leaving || undefined}
          inert={overflowPresence.leaving || undefined}
        >
          <DropdownMenu label={
            <span className="ui-responsive-overflow-trigger" aria-label={overflowLabel}>
              <MoreHorizontal size={17} aria-hidden="true" />
            </span>
          }>
            {renderedOverflow.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  type="button"
                  role="menuitem"
                  key={action.id}
                  disabled={action.disabled}
                  data-motion="action"
                  onClick={action.onSelect}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{action.label}</span>
                  {action.badge != null ? <b>{action.badge}</b> : null}
                </button>
              );
            })}
          </DropdownMenu>
        </span>
      ) : null}
    </div>
  );
}

export function ResponsiveContextBadge({
  presentation,
  priority,
  label,
  shortLabel,
  tone = "neutral"
}: {
  presentation: ActionPresentation;
  priority: ResponsiveActionPriority;
  label: string;
  shortLabel?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const shown = isResponsivePriorityVisible(presentation, priority);
  const presence = useExitPresence(shown, RESPONSIVE_EXIT_MS);
  const currentContent = { label, shortLabel, tone };
  const previousContentRef = useRef(currentContent);
  useLayoutEffect(() => {
    if (shown) previousContentRef.current = currentContent;
  }, [label, shortLabel, shown, tone]);
  if (!presence.visible) return null;
  const content = shown ? currentContent : previousContentRef.current;
  return (
    <span
      className="ui-responsive-context"
      role="status"
      data-tone={content.tone}
      data-leaving={presence.leaving || undefined}
      aria-hidden={presence.leaving || undefined}
      inert={presence.leaving || undefined}
    >
      <span className="status-dot" aria-hidden="true" />
      <span key={presentation === "full" ? content.label : content.shortLabel || content.label} className="ui-responsive-context-label">
        {presentation === "full" ? content.label : content.shortLabel || content.label}
      </span>
    </span>
  );
}
