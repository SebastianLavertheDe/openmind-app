import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

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

export function DropdownMenu({ label, children }: { label: ReactNode; children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const focusRestorePending = useRef(false);
  const restoreFocus = useCallback(() => {
    if (focusRestorePending.current) return;
    focusRestorePending.current = true;
    requestAnimationFrame(() => {
      summaryRef.current?.focus();
      focusRestorePending.current = false;
    });
  }, []);
  const closeMenu = useCallback(() => {
    const details = detailsRef.current;
    if (!details?.open) return;
    details.open = false;
    restoreFocus();
  }, [restoreFocus]);
  return (
    <details
      ref={detailsRef}
      className="ui-dropdown"
      onToggle={(event) => {
        if (!event.currentTarget.open) restoreFocus();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && detailsRef.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          return;
        }
        const menu = detailsRef.current?.querySelector<HTMLElement>(":scope > [role=menu]");
        if (!menu || !menu.contains(event.target as Node)) return;
        const items = getEnabledMenuItems(menu);
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
      }}
      onClick={(event) => {
        if (event.defaultPrevented) return;
        const menu = detailsRef.current?.querySelector<HTMLElement>(":scope > [role=menu]");
        const item = event.target instanceof Element ? event.target.closest<HTMLElement>("[role=menuitem]") : null;
        if (!menu || !item || !menu.contains(item) || isMenuItemDisabled(item)) return;
        closeMenu();
      }}
    >
      <summary ref={summaryRef} aria-haspopup="menu">{label}</summary>
      <div role="menu">{children}</div>
    </details>
  );
}

function getEnabledMenuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>("[role=menuitem]"))
    .filter((item) => !isMenuItemDisabled(item));
}

function isMenuItemDisabled(item: HTMLElement): boolean {
  return item.getAttribute("aria-disabled") === "true" || (item instanceof HTMLButtonElement && item.disabled);
}
