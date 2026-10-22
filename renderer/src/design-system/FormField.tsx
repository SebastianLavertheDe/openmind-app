import { cloneElement, useId, type AriaAttributes, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from "react";

type FieldControl = AriaAttributes & { id?: string; ariaLabel?: string };

/** Labels and messages travel with the native control, including a Select trigger. */
export function FormField({ label, hint, error, children, className = "" }: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement<FieldControl>;
  className?: string;
}) {
  const generatedId = useId();
  const id = children.props.id || generatedId;
  const labelId = `${id}-label`;
  const labelledBy = children.props["aria-labelledby"]
    || (!children.props["aria-label"] && !children.props.ariaLabel ? labelId : undefined);
  const description = [children.props["aria-describedby"], hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <div className={`ui-form-field ${className}`.trim()}>
    <label className="ui-form-field-label" id={labelId} htmlFor={id}>{label}</label>
    {cloneElement(children, { id, "aria-labelledby": labelledBy, "aria-describedby": description, "aria-invalid": error ? true : children.props["aria-invalid"] })}
    {hint ? <small className="ui-form-field-hint" id={`${id}-hint`}>{hint}</small> : null}
    {error ? <small className="ui-form-field-error" role="alert" id={`${id}-error`}>{error}</small> : null}
  </div>;
}

export function FormActions({ className = "", ...props }: ComponentPropsWithoutRef<"footer">) {
  return <footer {...props} className={`ui-form-actions ${className}`.trim()} />;
}
