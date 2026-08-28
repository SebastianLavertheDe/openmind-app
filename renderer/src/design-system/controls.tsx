import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useExitPresence } from "./use-exit-presence";

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange(value: T): void;
  label: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => handleRovingKeys(event, options.map((option) => option.value), value, onChange);

  useEffect(() => {
    const root = rootRef.current;
    const active = root?.querySelector<HTMLButtonElement>("button.active");
    if (!root || !active) return;
    root.style.setProperty("--seg-thumb-left", `${active.offsetLeft}px`);
    root.style.setProperty("--seg-thumb-width", `${active.offsetWidth}px`);
  }, [options, value]);

  return (
    <div ref={rootRef} className="ui-segmented" role="group" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => <button data-motion="selection" key={option.value} data-value={option.value} tabIndex={value === option.value ? 0 : -1} aria-pressed={value === option.value} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>{option.label}{option.count == null ? null : <span>{option.count}</span>}</button>)}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label
}: {
  value: T;
  tabs: Array<{ value: T; label: string; count?: number }>;
  onChange(value: T): void;
  label: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => handleRovingKeys(event, tabs.map((tab) => tab.value), value, onChange);
  return (
    <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => <button data-motion="selection" key={tab.value} data-value={tab.value} tabIndex={value === tab.value ? 0 : -1} role="tab" aria-selected={value === tab.value} className={value === tab.value ? "active" : ""} onClick={() => onChange(tab.value)}>{tab.label}{tab.count == null ? null : <span>{tab.count}</span>}</button>)}
    </div>
  );
}

export function ToggleSwitch({
  checked,
  label,
  disabled = false,
  onChange,
  className = ""
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange(checked: boolean): void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`ui-toggle-switch ${checked ? "active" : ""}${className ? ` ${className}` : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function handleRovingKeys<T extends string>(
  event: KeyboardEvent<HTMLDivElement>,
  values: T[],
  current: T,
  onChange: (value: T) => void
): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const index = Math.max(0, values.indexOf(current));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? values.length - 1
      : event.key === "ArrowRight"
        ? Math.min(values.length - 1, index + 1)
        : Math.max(0, index - 1);
  const next = values[nextIndex];
  if (!next) return;
  const root = event.currentTarget;
  onChange(next);
  requestAnimationFrame(() => {
    Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-value]"))
      .find((button) => button.dataset.value === next)
      ?.focus();
  });
}

export function DropdownMenu({
  label,
  children,
  disabled = false,
  ariaLabel,
  menuLabel
}: {
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  menuLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const { visible, leaving } = useExitPresence(open, 140);
  const popover = useAnchoredPopover({
    open: visible,
    anchorRef: triggerRef,
    floatingRef: menuRef,
    preferredSide: "bottom",
    align: "end"
  });
  const closeMenu = useCallback((restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!open || !visible) return;
    const frame = requestAnimationFrame(() => getEnabledMenuItems(menuRef.current).at(0)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, visible]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closeMenu, open]);

  useEffect(() => {
    if (open || visible || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [open, visible]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      closeMenu(false);
      if (event.shiftKey) triggerRef.current?.focus();
      else focusAfterDropdownTrigger(triggerRef.current);
      return;
    }
    const items = getEnabledMenuItems(menuRef.current);
    if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? currentIndex < 0 || currentIndex === items.length - 1 ? 0 : currentIndex + 1
          : currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    items[nextIndex]?.focus();
  };

  return (
    <span
      ref={rootRef}
      className="ui-dropdown"
      data-open={open || undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ui-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      {visible && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          className="ui-dropdown-menu"
          role="menu"
          aria-label={menuLabel}
          data-side={popover.side}
          data-leaving={leaving || undefined}
          style={popover.style}
          onKeyDown={onMenuKeyDown}
          onClick={(event) => {
            if (event.defaultPrevented) return;
            const item = event.target instanceof Element ? event.target.closest<HTMLElement>("[role=menuitem]") : null;
            if (!item || !menuRef.current?.contains(item) || isMenuItemDisabled(item)) return;
            closeMenu();
          }}
        >
          {children}
        </div>,
        document.body
      ) : null}
    </span>
  );
}

function getEnabledMenuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>("[role=menuitem]"))
    .filter((item) => !isMenuItemDisabled(item));
}

function isMenuItemDisabled(item: HTMLElement): boolean {
  return item.getAttribute("aria-disabled") === "true" || (item instanceof HTMLButtonElement && item.disabled);
}

function focusAfterDropdownTrigger(trigger: HTMLButtonElement | null): void {
  if (!trigger) return;
  const tabbable = Array.from(document.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.closest(".ui-dropdown-menu"));
  const triggerIndex = tabbable.indexOf(trigger);
  tabbable[triggerIndex + 1]?.focus();
}
