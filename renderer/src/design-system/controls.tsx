import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useExitPresence } from "./use-exit-presence";
import { useDismissableLayer } from "./use-dismissable-layer";
import { Button } from "./Button";

type SelectionChange<T> = (value: T) => void | boolean | Promise<void | boolean>;
type Choice<T> = { value: T; label: ReactNode; count?: number; icon?: ReactNode; disabled?: boolean };

export function SegmentedControl<T extends string>({ value, options, onChange, label, className = "" }: {
  value: T;
  options: Choice<T>[];
  onChange: SelectionChange<T>;
  label: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => handleRovingKeys(event, options.filter(option => !option.disabled).map(option => option.value), value, onChange);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const active = root?.querySelector<HTMLButtonElement>("button.active");
    if (!root || !active) return;
    const sync = () => {
      root.style.setProperty("--seg-thumb-left", `${active.offsetLeft}px`);
      root.style.setProperty("--seg-thumb-width", `${active.offsetWidth}px`);
    };
    sync();
    const frame = root.hasAttribute("data-motion-ready") ? 0
      : window.requestAnimationFrame(() => root.setAttribute("data-motion-ready", "true"));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(root);
    root.querySelectorAll("button").forEach(button => observer?.observe(button));
    window.addEventListener("resize", sync);
    return () => { if (frame) window.cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", sync); };
  }, [options, value]);
  return <div ref={rootRef} className={`ui-segmented${className ? ` ${className}` : ""}`} role="group" aria-label={label} onKeyDown={onKeyDown}>
    {options.map(option => <button type="button" data-motion="selection" key={option.value} data-value={option.value}
      tabIndex={value === option.value ? 0 : -1} aria-pressed={value === option.value} disabled={option.disabled}
      className={value === option.value ? "active" : ""} onClick={() => void onChange(option.value)}>
      {option.icon}{option.label}{option.count == null ? null : <span>{option.count}</span>}
    </button>)}
  </div>;
}

export function Tabs<T extends string>({ value, tabs, onChange, label, className = "" }: {
  value: T;
  tabs: Array<Choice<T> & { id?: string; controls?: string; attributes?: Record<`data-${string}`, string> }>;
  onChange: SelectionChange<T>;
  label: string;
  className?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => handleRovingKeys(event, tabs.filter(tab => !tab.disabled).map(tab => tab.value), value, onChange);
  return <div className={className || "ui-tabs"} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
    {tabs.map(tab => <button {...tab.attributes} type="button" data-motion="selection" key={tab.value} id={tab.id} aria-controls={tab.controls}
      data-value={tab.value} tabIndex={value === tab.value ? 0 : -1} role="tab" aria-selected={value === tab.value} disabled={tab.disabled}
      className={value === tab.value ? "active" : ""} onClick={() => void onChange(tab.value)}>
      {tab.icon}{tab.label}{tab.count == null ? null : <span>{tab.count}</span>}
    </button>)}
  </div>;
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

function handleRovingKeys<T extends string>(event: KeyboardEvent<HTMLDivElement>, values: T[], current: T, onChange: SelectionChange<T>): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !values.length) return;
  event.preventDefault();
  const index = Math.max(0, values.indexOf(current));
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? values.length - 1
    : (index + (event.key === "ArrowRight" ? 1 : -1) + values.length) % values.length;
  const next = values[nextIndex];
  const root = event.currentTarget;
  const focus = (accepted: void | boolean) => {
    if (accepted === false) return;
    requestAnimationFrame(() => {
      if (!root.isConnected) return;
      Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-value]"))
        .find(button => button.dataset.value === next)?.focus();
    });
  };
  const result = onChange(next);
  if (result instanceof Promise) void result.then(focus);
  else focus(result);
}

export function DropdownMenu({
  label,
  children,
  disabled = false,
  responsiveTarget = false,
  ariaLabel,
  menuLabel,
  className,
  menuClassName,
  menuInert,
  restoreFocusOnSelect = true,
  open: controlledOpen,
  onOpenChange,
  menuAlign = "end"
}: {
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  responsiveTarget?: boolean;
  ariaLabel?: string;
  menuLabel?: string;
  className?: string;
  menuClassName?: string;
  /** Editor commands restore their own text selection and focus. */
  restoreFocusOnSelect?: boolean;
  /** A retained owner may be inert while this menu is portalled outside it. */
  menuInert?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  menuAlign?: "start" | "end";
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = useCallback((next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const initialFocusRef = useRef<"first" | "last">("first");
  const { visible, leaving } = useExitPresence(open, 140);
  const popover = useAnchoredPopover({
    open: visible,
    anchorRef: triggerRef,
    floatingRef: menuRef,
    preferredSide: "bottom",
    align: menuAlign
  });
  const closeMenu = useCallback((restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
  }, [setOpen]);

  useLayoutEffect(() => {
    if (!open || !visible) return;
    const frame = requestAnimationFrame(() => {
      const items = getEnabledMenuItems(menuRef.current);
      const target = initialFocusRef.current === "last" ? items.at(-1) : items.find(item => item.getAttribute("aria-checked") === "true") ?? items.at(0);
      target?.focus();
      initialFocusRef.current = "first";
    });
    return () => cancelAnimationFrame(frame);
  }, [open, visible]);

  useDismissableLayer({
    open, contentRefs: [rootRef, menuRef], triggerRef, restoreFocus: false,
    onDismiss: reason => closeMenu(reason === "escape")
  });

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
      className={`ui-dropdown${className ? ` ${className}` : ""}`}
      data-open={open || undefined}
    >
      <Button variant="ghost" size="sm" responsiveTarget={responsiveTarget}
        ref={triggerRef}
        type="button"
        className="ui-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          initialFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {visible && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          className={`ui-dropdown-menu${menuClassName ? ` ${menuClassName}` : ""}`}
          role="menu"
          aria-label={menuLabel}
          inert={menuInert || leaving || undefined}
          aria-hidden={menuInert || leaving || undefined}
          data-side={popover.side}
          data-leaving={leaving || undefined}
          style={popover.style}
          onKeyDown={onMenuKeyDown}
          onClick={(event) => {
            if (event.defaultPrevented) return;
            const item = event.target instanceof Element ? event.target.closest<HTMLElement>(MENU_ITEM_SELECTOR) : null;
            if (!item || !menuRef.current?.contains(item) || isMenuItemDisabled(item)) return;
            closeMenu(restoreFocusOnSelect);
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
  return Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR))
    .filter((item) => !isMenuItemDisabled(item));
}

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

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
