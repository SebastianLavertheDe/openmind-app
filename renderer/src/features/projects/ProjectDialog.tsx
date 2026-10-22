import { useLocale } from "../../i18n";
import { FormField, Input, Textarea } from "../../design-system/components";

export { FormDialog as ProjectDialog } from "../../design-system/components";

export function ProjectTextField({
  label,
  value,
  placeholder,
  autoFocus,
  multiline = false,
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  multiline?: boolean;
  onChange(value: string): void;
}) {
  useLocale();
  return (
    <FormField label={label}>
      {multiline
        ? <Textarea value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />
        : <Input value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />}
    </FormField>
  );
}
