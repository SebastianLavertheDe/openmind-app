import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Check } from "lucide-react";
import { messages as m } from "@shared/messages";
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
  className
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
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuMounted, setMenuMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { visible, leaving } = useExitPresence(menuMounted, 140);

  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((option) => option.value === value)),
    [options, value]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
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
    if (!open) return;
    setActiveIndex(selectedIndex);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`[data-index="${selectedIndex}"]`)?.focus();
    });
  }, [open, selectedIndex]);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
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
    if (open || menuMounted || visible) return;
    if (!leaving) triggerRef.current?.focus();
  }, [open, menuMounted, visible, leaving]);

  const choose = (option: { value: T; disabled?: boolean }) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDownList = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = options.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => nextEnabled(options, current, 1, count));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => nextEnabled(options, current, -1, count));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(nextEnabled(options, -1, 1, count));
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(nextEnabled(options, count, -1, count));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[activeIndex]);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`[data-index="${activeIndex}"]`)?.focus();
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
        value={value}
        disabled={disabled}
        tabIndex={-1}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {placeholder && !value ? <option value="">{placeholder}</option> : null}
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
        onClick={() => !disabled && setOpen((current) => !current)}
      >
        {leadingIcon ? <span className="ui-select-leading">{leadingIcon}</span> : null}
        {label ? <span className="ui-select-label">{label}</span> : null}
        <span className="ui-select-value">{selected?.label || placeholder || "\u00A0"}</span>
        <ChevronDown size={14} className="ui-select-chevron" />
      </button>
      {visible ? (
        <div
          ref={listRef}
          className="ui-select-menu"
          role="listbox"
          aria-label={accessibleName}
          data-leaving={leaving || undefined}
          data-open={open || undefined}
          onKeyDown={onKeyDownList}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              data-index={index}
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={`ui-select-option${option.value === value ? " active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span className="ui-select-option-label">{option.label}</span>
              {option.value === value ? <Check size={13} className="ui-select-check" /> : null}
            </button>
          ))}
        </div>
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
