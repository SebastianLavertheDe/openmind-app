import { Children, cloneElement, forwardRef, isValidElement, useImperativeHandle, useRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import type { InputVariant, TextareaVariant, SearchVariant } from "./control-contract";

type InputSize = "sm" | "md";
type InputType = "text" | "search" | "email" | "password" | "tel" | "url" | "number" | "date" | "datetime-local" | "time" | "month" | "week";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  variant?: InputVariant;
  size?: InputSize;
  type?: InputType;
}

/** Native input behavior with one shared visual contract. Labels stay with the caller. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({
  variant = "default", size = "md", type = "text", className = "", ...props
}, ref) {
  return <input {...props} ref={ref} type={type} data-ui-control="input" className={`ui-input ${className}`.trim()} data-variant={variant} data-size={size} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: TextareaVariant;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({
  variant = "default", className = "", ...props
}, ref) {
  return <textarea {...props} ref={ref} data-ui-control="textarea" className={`ui-textarea ${className}`.trim()} data-variant={variant} />;
});

/** A shared form surface for an inline input and a unit or other non-interactive addon. */
export function InputGroup({ id, children, className = "", "aria-label": ariaLabel, "aria-labelledby": labelledBy, "aria-describedby": describedBy, "aria-invalid": invalid, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} id={id ? `${id}-group` : undefined} data-ui-control="input-group" className={`ui-input-group ${className}`.trim()}>
    {Children.map(children, child => isValidElement<InputProps>(child) && child.type === Input
      ? cloneElement(child, { id: id || child.props.id, "aria-describedby": [describedBy, child.props["aria-describedby"]].filter(Boolean).join(" ") || undefined,
        "aria-label": child.props["aria-label"] || (!child.props["aria-labelledby"] ? ariaLabel : undefined),
        "aria-labelledby": child.props["aria-labelledby"] || (!child.props["aria-label"] ? labelledBy : undefined),
        "aria-invalid": invalid ?? child.props["aria-invalid"] }) : child)}
  </div>;
}

export interface SearchInputProps extends Omit<InputProps, "variant"> {
  variant?: SearchVariant;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  inputClassName?: string;
  clearAction?: { label: string; onClear(): void };
}

/** The surface owns focus feedback so the inner input never draws a second frame. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput({
  variant = "quiet", size = "md", type = "search", className = "", inputClassName,
  leadingIcon = <Search size={14} aria-hidden />, trailingIcon, clearAction, disabled, ...props
}, ref) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  const invalid = props["aria-invalid"];
  return <label data-ui-control="search" className={`ui-search-input ${className}`.trim()} data-variant={variant} data-size={size}
    data-disabled={disabled || undefined} data-invalid={invalid && invalid !== "false" ? true : undefined}>
    {leadingIcon ? <span className="ui-search-input-icon" aria-hidden>{leadingIcon}</span> : null}
    <Input {...props} ref={input} type={type} variant="inline" size={size} className={inputClassName} disabled={disabled} />
    {trailingIcon ? <span className="ui-search-input-icon" aria-hidden>{trailingIcon}</span> : null}
    {clearAction ? <button type="button" className="ui-search-clear" data-motion="icon" aria-label={clearAction.label} disabled={disabled || props.readOnly}
      onClick={() => { clearAction.onClear(); input.current?.focus(); }}><X size={14} aria-hidden /></button> : null}
  </label>;
});
