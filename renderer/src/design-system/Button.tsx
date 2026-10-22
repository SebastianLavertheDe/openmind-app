import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { ButtonVariant, ControlSize, ControlTone } from "./control-contract";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "data-motion"?: string;
  variant?: ButtonVariant;
  size?: ControlSize;
  tone?: ControlTone;
  /** Keep toolbar/navigation targets at least 44px in narrow windows. */
  responsiveTarget?: boolean;
  /** The caller owns the operation; loading only prevents duplicate activation. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

/** One native element, no subscriptions or local state. Feature classes own layout only. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "secondary", size = "md", tone = "neutral", loading = false, responsiveTarget = false,
  leadingIcon, trailingIcon, className = "", type = "button", disabled, children, ...props
}, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading}
    aria-busy={loading || props["aria-busy"] || undefined}
    className={`ui-button ${className}`.trim()} data-ui-control="button" data-variant={variant} data-size={size} data-tone={tone}
    data-responsive-target={responsiveTarget || undefined} data-loading={loading || undefined} data-motion={props["data-motion"] || "action"}>
    {loading ? <LoaderCircle className="ui-button-spinner" aria-hidden="true" /> : leadingIcon}
    {children}
    {trailingIcon}
  </button>;
});
