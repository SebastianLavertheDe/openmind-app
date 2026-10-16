import { useLocale } from "../i18n";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { messages as m } from "@shared/messages";
import { useAnchoredPopover, type AnchoredPopoverAlign } from "./use-anchored-popover";
import { useExitPresence } from "./use-exit-presence";

/**
 * Select — 自定义下拉选择器,替代浏览器原生 <select>。
 *
 * 设计来源:AI Console 的 P0-CMP-3 ChipSelect (composer.tsx)。提升到 design-system
 * 供全 app 复用,统一替代各功能页散落的原生 <select>。
 *
 * 特性:
 *  - 胶囊/矩形两种 size,接入 token 系统(颜色/圆角/阴影/动效)
 *  - listbox + option 语义角色,箭头键/Home/End 导航,roving selected
 *  - 退场动画(与 ContextMenu 一致),Esc 关闭并恢复焦点
 *  - 点外部关闭,aria-expanded/aria-selected 完整
 *  - 可选 placeholder / leading icon
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder,
  size = "pill",
  leadingIcon,
  disabled = false,
  ariaLabel,
  className,
  menuAlign = "start"
}: {
  value: T | "";
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange(value: T): void;
  /** 可见 label,渲染在 trigger 内的弱化前缀;screen reader 通过 aria-label 读 */
  label?: string;
  placeholder?: string;
  size?: "pill" | "rect";
  leadingIcon?: React.ReactNode;
  disabled?: boolean;
  /** 优先级高于 label,用于无障碍名;省略时回退到 label/placeholder */
  ariaLabel?: string;
  /** 附加到根节点的 class(用于页面级定制宽度/对齐) */
  className?: string;
  /** 浮层相对触发器的横向对齐方式。 */
  menuAlign?: AnchoredPopoverAlign;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuMounted, setMenuMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusFrameRef = useRef<number | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const { visible, leaving } = useExitPresence(menuMounted, 160);
  const popover = useAnchoredPopover({
    open: visible,
    anchorRef: triggerRef,
    floatingRef: listRef,
    align: menuAlign,
    matchAnchorWidth: true
  });

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value, locale]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const initialActiveIndex = selected && !selected.disabled ? selectedIndex : options.findIndex((option) => !option.disabled);
  const accessibleName = ariaLabel || label || placeholder || m.designSystem.selectLabel;

  // open 与 menuMounted 解耦:open 控制数据/焦点,menuMounted 控制 DOM 存在;
  // 关闭时 menuMounted 置 false 但 visible 仍为 true 直到退场动画结束。
  useEffect(() => {
    if (open) setMenuMounted(true);
  }, [open]);
  useEffect(() => {
    if (!menuMounted || open || leaving) return;
    setMenuMounted(false);
  }, [menuMounted, open, leaving]);

  // 打开时定位到当前选中项
  useEffect(() => {
    if (!open) {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
      return;
    }
    setActiveIndex(initialActiveIndex);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      listRef.current?.querySelector<HTMLButtonElement>(`[data-index="${initialActiveIndex}"]`)?.focus();
    });
  }, [open, initialActiveIndex]);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node;
      if (!rootRef.current?.contains(targetNode) && !listRef.current?.contains(targetNode)) {
        shouldRestoreFocusRef.current = false;
        if (focusFrameRef.current !== null) {
          cancelAnimationFrame(focusFrameRef.current);
          focusFrameRef.current = null;
        }
        setOpen(false);
        // Closing the animated menu during pointerdown can remove the focused
        // option before the browser's default focus transfer runs (notably in
        // Electron/WebKit and jsdom). Preserve the native outside-click
        // behavior explicitly for keyboard and screen-reader users.
        const target = event.target as { disabled?: boolean; focus?: () => void } | null;
        if (target && !target.disabled && typeof target.focus === "function") {
          target.focus();
          queueMicrotask(() => target.focus?.());
        }
      }
    };
    const onKeyDown = (event: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        shouldRestoreFocusRef.current = true;
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // 关闭后恢复焦点到 trigger
  useEffect(() => {
    if (!shouldRestoreFocusRef.current) return;
    if (open || menuMounted || visible) return;
    if (!leaving) {
      shouldRestoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open, menuMounted, visible, leaving]);

  const choose = (option: { value: T; disabled?: boolean } | undefined) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    shouldRestoreFocusRef.current = true;
    setOpen(false);
  };

  const onKeyDownList = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = options.length;
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = nextEnabled(options, activeIndex, 1, count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = nextEnabled(options, activeIndex, -1, count);
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = nextEnabled(options, -1, 1, count);
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = nextEnabled(options, count, -1, count);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[activeIndex]);
      return;
    } else if (event.key === "Tab") {
      event.preventDefault();
      shouldRestoreFocusRef.current = false;
      setOpen(false);
      if (event.shiftKey) triggerRef.current?.focus();
      else focusAfterTrigger(triggerRef.current);
      return;
    }
    if (nextIndex === null) return;
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`[data-index="${nextIndex}"]`)?.focus();
    });
  };

  return (
    <div
      className={`ui-select ${size}${className ? ` ${className}` : ""}`}
      ref={rootRef}
      data-open={open || undefined}
      data-disabled={disabled || undefined}
    >
      <select
        className="ui-select-native-proxy"
        aria-label={accessibleName}
        value={selected ? value : ""}
        disabled={disabled}
        tabIndex={-1}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {!selected ? <option value="">{placeholder || ""}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${accessibleName} ${m.designSystem.selectButton}`}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          shouldRestoreFocusRef.current = true;
          setOpen((current) => !current);
        }}
      >
        {leadingIcon ? <span className="ui-select-leading">{leadingIcon}</span> : null}
        {label ? <span className="ui-select-label">{label}</span> : null}
        <span className="ui-select-value">{selected?.label || placeholder || "\u00A0"}</span>
        <ChevronDown size={14} className="ui-select-chevron" />
      </button>
      {visible ? createPortal(
        <div
          ref={listRef}
          className={`ui-select-menu${className ? ` ${className.split(/\s+/).filter(Boolean).map((token) => `${token}-menu`).join(" ")}` : ""}`}
          role="listbox"
          aria-label={accessibleName}
          data-leaving={leaving || undefined}
          aria-hidden={leaving || undefined}
          inert={leaving || undefined}
          data-open={open || undefined}
          data-side={popover.side}
          style={popover.style}
          onKeyDown={onKeyDownList}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              data-index={index}
              aria-selected={option.value === value}
              tabIndex={open && index === activeIndex ? 0 : -1}
              disabled={option.disabled}
              className={`ui-select-option${option.value === value ? " active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span className="ui-select-option-label">{option.label}</span>
              {option.value === value ? <Check size={13} className="ui-select-check" /> : null}
            </button>
          ))}
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function focusAfterTrigger(trigger: HTMLButtonElement | null): void {
  if (!trigger) return;
  const tabbable = Array.from(document.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.closest(".ui-select-menu") && !element.classList.contains("ui-select-native-proxy"));
  const triggerIndex = tabbable.indexOf(trigger);
  tabbable[triggerIndex + 1]?.focus();
}

/** 在 enabled 选项中按 direction 步进,跳过 disabled。 */
function nextEnabled<T>(
  options: Array<{ value: T; disabled?: boolean }>,
  from: number,
  direction: 1 | -1,
  count: number
): number {
  if (!count) return 0;
  let index = from;
  for (let step = 0; step < count; step++) {
    index += direction;
    if (index < 0) index = count - 1;
    if (index >= count) index = 0;
    if (!options[index]?.disabled) return index;
  }
  return from;
}
