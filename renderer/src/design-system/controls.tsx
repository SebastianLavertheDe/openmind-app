import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import { messages as m } from "@shared/messages";
import { Tooltip } from "./Tooltip";
import { useExitPresence } from "./use-exit-presence";

export function SearchField({
  value,
  onChange,
  placeholder = m.designSystem.search,
  label = m.designSystem.search,
  shortcut,
  loading = false
}: {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  label?: string;
  shortcut?: string;
  loading?: boolean;
}) {
  return (
    <label className="search-field">
      <Search size={15} />
      <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {loading ? <LoaderCircle className="spin" size={13} aria-label={m.designSystem.searching} /> : null}
      {value ? <Tooltip content={m.designSystem.clearSearch}><button data-motion="icon" type="button" aria-label={m.designSystem.clearSearch} onClick={() => onChange("")}><X size={13} /></button></Tooltip> : shortcut ? <kbd>{shortcut}</kbd> : null}
    </label>
  );
}

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

export function DatePicker({ value, onChange, label = m.designSystem.pickDate }: { value: string; onChange(value: string): void; label?: string }) {
  return <label className="ui-date-picker"><span>{label}</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
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

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  onClick
}: {
  label: string;
  value: number | string;
  detail?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  onClick?(): void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </>
  );
  return onClick
    ? <button className={`ui-metric-card ${tone}`} data-motion="card" onClick={onClick}>{content}</button>
    : <article className={`ui-metric-card ${tone}`}>{content}</article>;
}

export const StatCard = MetricCard;

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  label,
  loading = false,
  emptyTitle = m.designSystem.noData,
  pageSize,
  initialSort
}: {
  rows: T[];
  columns: Array<{ key: string; header: string; cell(row: T): ReactNode; sortable?: boolean; sortValue?(row: T): string | number | null | undefined }>;
  rowKey(row: T): string;
  label: string;
  loading?: boolean;
  emptyTitle?: string;
  pageSize?: number;
  initialSort?: { key: string; direction: "asc" | "desc" };
}) {
  const [sort, setSort] = useState(initialSort || null);
  const [page, setPage] = useState(0);
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;
    return [...rows].sort((left, right) => {
      const leftValue = column.sortValue?.(left);
      const rightValue = column.sortValue?.(right);
      const result = compareSortValues(leftValue, rightValue);
      return sort.direction === "asc" ? result : -result;
    });
  }, [columns, rows, sort]);
  const pages = pageSize ? Math.max(1, Math.ceil(sortedRows.length / pageSize)) : 1;
  const safePage = Math.min(page, pages - 1);
  const visibleRows = pageSize ? sortedRows.slice(safePage * pageSize, safePage * pageSize + pageSize) : sortedRows;
  const toggleSort = (key: string) => {
    setPage(0);
    setSort((current) => current?.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  };
  return (
    <div className="ui-data-table" role="table" aria-label={label} aria-busy={loading || undefined}>
      <div className="ui-data-row ui-data-head" role="row">{columns.map((column) => (
        <span role="columnheader" key={column.key} aria-sort={sort?.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : undefined}>
          {column.sortValue || column.sortable ? <button data-motion="icon" className="ui-data-sort-button" type="button" onClick={() => column.sortValue ? toggleSort(column.key) : undefined}>{column.header}{sort?.key === column.key ? <small>{sort.direction === "asc" ? "↑" : "↓"}</small> : null}</button> : column.header}
        </span>
      ))}</div>
      {loading ? <div className="ui-data-state" role="status">{m.designSystem.loadingTable}</div> : !visibleRows.length ? <div className="ui-data-state">{emptyTitle}</div> : visibleRows.map((row) => <div className="ui-data-row" role="row" key={rowKey(row)}>{columns.map((column) => <span role="cell" key={column.key}>{column.cell(row)}</span>)}</div>)}
      {pageSize && rows.length > pageSize ? (
        <footer className="ui-data-pagination">
          <button data-motion="icon" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>{m.designSystem.paginationPrev}</button>
          <span>{safePage + 1} / {pages}</span>
          <button data-motion="icon" disabled={safePage >= pages - 1} onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}>{m.designSystem.paginationNext}</button>
        </footer>
      ) : null}
    </div>
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

function compareSortValues(left: string | number | null | undefined, right: string | number | null | undefined): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "zh-CN", { numeric: true });
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

export function ContextMenu({
  open,
  x,
  y,
  children,
  onClose
}: {
  open: boolean;
  x: number;
  y: number;
  children: ReactNode;
  onClose(): void;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const { visible, leaving } = useExitPresence(open, 140);
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [open]);
  if (!visible) return null;
  return <><button className="ui-context-dismiss" aria-label={m.designSystem.closeMenu} onClick={onClose} /><div className="ui-context-menu ui-overlay" data-leaving={leaving || undefined} role="menu" style={{ left: x, top: y }}>{children}</div></>;
}
