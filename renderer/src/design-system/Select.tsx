import { focusAfterTrigger } from "./tab-navigation";
import { SelectTrigger } from "./SelectTrigger";
import { SelectItem } from "./SelectItem";
import type { SelectSelection, SelectTone, SelectVariant } from "./control-contract";
import { useLocale } from "../i18n";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { messages as m } from "@shared/messages";
import { useAnchoredPopover, type AnchoredPopoverAlign, type AnchoredPopoverSide } from "./use-anchored-popover";
import { useExitPresence } from "./use-exit-presence";
import { useMotionTokens } from "./motion-tokens";
import { SelectMenuSurface } from "./SelectMenuSurface";
import { useDismissableLayer } from "./use-dismissable-layer";

/**
 * Select — 自定义下拉选择器,替代浏览器原生 <select>。
 *
 * 供全 app 复用。普通选择和分组模型菜单共用 SelectMenuSurface 的 UI 与动效。
 *
 * 特性:
 *  - 胶囊/矩形两种 size,接入 token 系统(颜色/圆角/阴影/动效)
 *  - listbox + option 语义角色,箭头键/Home/End 导航,roving selected
 *  - 退场动画(与 ContextMenu 一致),Esc 关闭并恢复焦点
 *  - 点外部关闭,aria-expanded/aria-selected 完整
 *  - 可选 placeholder / leading icon
 */
type SelectProps<T extends string> = {
  options: Array<{ value: T; label: string; disabled?: boolean; tone?: SelectTone }>;
  /** 可见 label,渲染在 trigger 内的弱化前缀;screen reader 通过 aria-label 读 */
  label?: string;
  placeholder?: string;
  size?: "pill" | "rect";
  variant?: SelectVariant;
  leadingIcon?: React.ReactNode;
  disabled?: boolean;
  /** 优先级高于 label,用于无障碍名;省略时回退到 label/placeholder */
  ariaLabel?: string;
  /** 附加到根节点的 class(用于页面级定制宽度/对齐) */
  className?: string;
  title?: string;
  autoFocus?: boolean;
  /** 浮层相对触发器的横向对齐方式。 */
  menuAlign?: AnchoredPopoverAlign;
  menuSide?: AnchoredPopoverSide;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
} & SelectSelection<T>;

export function Select<T extends string>(props: SelectProps<T>) {
  const {
    value, options, label, placeholder, size = "pill", variant = "default", leadingIcon,
    disabled = false, ariaLabel, className, title, autoFocus, menuAlign = "start", menuSide = "bottom", id,
    "aria-label": explicitAriaLabel, "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid
  } = props;
  useLocale();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const valueId = `${listId}-value`;
  const [menuMounted, setMenuMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusFrameRef = useRef<number | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const { exitMs } = useMotionTokens();
  const { visible, leaving } = useExitPresence(menuMounted, exitMs);
  const popover = useAnchoredPopover({
    open: visible,
    anchorRef: triggerRef,
    floatingRef: listRef,
    align: menuAlign,
    preferredSide: menuSide,
    matchAnchorWidth: true
  });

  const selectedValues = useMemo(
    () => props.multiple ? props.value : [props.value],
    [props.multiple, value]
  );
  const selectedIndex = options.findIndex(option => selectedValues.includes(option.value));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const selectedLabel = selectedValues.map(value => options.find(option => option.value === value)?.label).filter(Boolean).join(" / ");
  const initialActiveIndex = selected && !selected.disabled ? selectedIndex : options.findIndex((option) => !option.disabled);
  const accessibleName = explicitAriaLabel || ariaLabel || label || placeholder || m.designSystem.selectLabel;
  // A referenced field label overrides aria-label, so expose its current value separately.
  const accessibleDescription = [ariaLabelledBy ? valueId : undefined, ariaDescribedBy].filter(Boolean).join(" ") || undefined;

  // open 与 menuMounted 解耦:open 控制数据/焦点,menuMounted 控制 DOM 存在;
  // 关闭时 menuMounted 置 false 但 visible 仍为 true 直到退场动画结束。
  useEffect(() => {
    if (open) setMenuMounted(true);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!menuMounted || open || leaving) return;
    setMenuMounted(false);
  }, [menuMounted, open, leaving]);

  // Focus the current choice only when opening, so multi-select toggles keep focus.
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
  }, [open]);

  useDismissableLayer({
    open, contentRefs: [rootRef, listRef], triggerRef, restoreFocus: false,
    onDismiss(reason, event) {
      shouldRestoreFocusRef.current = reason === "escape";
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
      setOpen(false);
      if (reason === "outside") {
        const target = event.target as HTMLElement | null;
        if (target && !(target as HTMLButtonElement).disabled && typeof target.focus === "function") {
          target.focus();
          queueMicrotask(() => target.focus());
        }
      }
    }
  });

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
    if (disabled || !option || option.disabled) return;
    if (props.multiple) {
      props.onChange(props.value.includes(option.value) ? props.value.filter(value => value !== option.value) : [...props.value, option.value]);
      return;
    }
    props.onChange(option.value);
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
      data-value={value}
    >
      <select
        className="ui-select-native-proxy"
        aria-hidden={props.multiple || undefined}
        aria-label={accessibleName}
        aria-labelledby={ariaLabelledBy}
        multiple={props.multiple}
        value={props.multiple ? props.value : selected ? props.value : ""}
        disabled={disabled}
        tabIndex={-1}
        onChange={(event) => {
          if (props.multiple) props.onChange(Array.from(event.target.selectedOptions, option => option.value as T));
          else props.onChange(event.target.value as T);
        }}
      >
        {!props.multiple && !selected ? <option value="">{placeholder || ""}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <SelectTrigger shape={size} variant={variant} tone={selected?.tone}
        ref={triggerRef}
        data-ui-control="select-trigger"
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={accessibleDescription}
        aria-invalid={ariaInvalid}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${accessibleName}${selectedLabel ? `：${selectedLabel}` : ""} ${m.designSystem.selectButton}`}
        disabled={disabled}
        title={title}
        autoFocus={autoFocus}
        data-motion="selection"
        onKeyDown={(event) => {
          if (!disabled && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            shouldRestoreFocusRef.current = true;
            setOpen(true);
          }
        }}
        onClick={() => {
          if (disabled) return;
          shouldRestoreFocusRef.current = true;
          setOpen((current) => !current);
        }}
      >
        {leadingIcon ? <span className="ui-select-leading">{leadingIcon}</span> : null}
        {label ? <span className="ui-select-label">{label}</span> : null}
        <span id={valueId} className="ui-select-value">{selectedLabel || placeholder || "\u00A0"}</span>
        <ChevronDown size={14} className="ui-select-chevron" />
      </SelectTrigger>
      {visible ? createPortal(
        <div
          ref={listRef}
          id={listId}
          className={`ui-select-menu${className ? ` ${className.split(/\s+/).filter(Boolean).map((token) => `${token}-menu`).join(" ")}` : ""}`}
          role="listbox"
          aria-multiselectable={props.multiple || undefined}
          aria-label={accessibleName}
          aria-labelledby={ariaLabelledBy}
          data-leaving={leaving || undefined}
          aria-hidden={leaving || undefined}
          inert={leaving || undefined}
          data-open={open || undefined}
          data-side={popover.side}
          style={popover.style}
          onKeyDown={onKeyDownList}
        >
          <SelectMenuSurface side={popover.side} leaving={leaving}>
          {options.map((option, index) => (
            <SelectItem tone={option.tone}
              data-ui-control="select-option"
              key={option.value}
              type="button"
              role="option"
              data-index={index}
              data-value={option.value}
              data-motion="selection"
              aria-selected={selectedValues.includes(option.value)}
              tabIndex={open && index === activeIndex ? 0 : -1}
              disabled={option.disabled}
              className={`ui-select-option${selectedValues.includes(option.value) ? " active" : ""}`}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span className="ui-select-option-label">{option.label}</span>
              {selectedValues.includes(option.value) ? <Check size={13} className="ui-select-check" /> : null}
            </SelectItem>
          ))}
          </SelectMenuSurface>
        </div>,
        rootRef.current?.closest<HTMLElement>("[data-focus-scope-backdrop]") || document.body
      ) : null}
    </div>
  );
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
