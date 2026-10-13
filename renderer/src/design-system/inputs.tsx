import { forwardRef, useImperativeHandle, useRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Search, X } from "lucide-react";

type InputVariant = "default" | "inline";
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
  return <input {...props} ref={ref} type={type} className={`ui-input ${className}`.trim()} data-variant={variant} data-size={size} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: InputVariant;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({
  variant = "default", className = "", ...props
}, ref) {
  return <textarea {...props} ref={ref} className={`ui-textarea ${className}`.trim()} data-variant={variant} />;
});

/** A shared form surface for an inline input and a unit or other non-interactive addon. */
export function InputGroup({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-input-group ${className}`.trim()} />;
}

export interface SearchInputProps extends Omit<InputProps, "variant"> {
  variant?: "quiet" | "outlined";
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
  return <label className={`ui-search-input ${className}`.trim()} data-variant={variant} data-size={size}
    data-disabled={disabled || undefined} data-invalid={invalid && invalid !== "false" ? true : undefined}>
    {leadingIcon ? <span className="ui-search-input-icon" aria-hidden>{leadingIcon}</span> : null}
    <Input {...props} ref={input} type={type} variant="inline" size={size} className={inputClassName} disabled={disabled} />
    {trailingIcon ? <span className="ui-search-input-icon" aria-hidden>{trailingIcon}</span> : null}
    {clearAction ? <button type="button" className="ui-search-clear" data-motion="icon" aria-label={clearAction.label} disabled={disabled || props.readOnly}
      onClick={() => { clearAction.onClear(); input.current?.focus(); }}><X size={14} aria-hidden /></button> : null}
  </label>;
});
