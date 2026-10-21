import { CheckCircle2, Copy } from "lucide-react";
import { messages } from "@shared/messages";
import { useLocale } from "../i18n";
import { IconButton } from "./IconButton";
import { useClipboard } from "./use-clipboard";

export function CopyButton({ text, className, label, copiedLabel, showLabel = false }: { text: string; className?: string; label?: string; copiedLabel?: string; showLabel?: boolean }) {
  useLocale();
  const { copy, copied } = useClipboard();
  return <IconButton className={className || ""} label={copied ? copiedLabel || messages.ai.message.copied : label || messages.ai.message.copy}
    onClick={() => void copy(text)}>{copied ? <CheckCircle2 className="copy-check-pop" size={13} /> : <Copy size={13} />}{showLabel ? <span aria-live="polite">{copied ? copiedLabel || messages.ai.message.copied : label || messages.ai.message.copy}</span> : null}</IconButton>;
}
