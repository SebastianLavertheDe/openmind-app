import { CheckCircle2, Copy } from "lucide-react";
import { messages } from "@shared/messages";
import { useLocale } from "../i18n";
import { IconButton } from "./IconButton";
import { useClipboard } from "./use-clipboard";
import { Button } from "./Button";

export function CopyButton({ text, className, label, copiedLabel, showLabel = false }: { text: string; className?: string; label?: string; copiedLabel?: string; showLabel?: boolean }) {
  useLocale();
  const { copy, copied } = useClipboard();
  const name = copied ? copiedLabel || messages.ai.message.copied : label || messages.ai.message.copy;
  const icon = copied ? <CheckCircle2 className="copy-check-pop" /> : <Copy />;
  return showLabel
    ? <Button variant="ghost" size="sm" className={className} onClick={() => void copy(text)} leadingIcon={icon}><span aria-live="polite">{name}</span></Button>
    : <IconButton className={className} label={name} onClick={() => void copy(text)}>{icon}</IconButton>;
}
