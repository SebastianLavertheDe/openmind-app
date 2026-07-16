export type ComposerTrigger = {
  kind: "mention" | "command";
  start: number;
  end: number;
  query: string;
};

export function findComposerTrigger(value: string, caret: number): ComposerTrigger | null {
  const safeCaret = Math.max(0, Math.min(value.length, caret));
  const beforeCaret = value.slice(0, safeCaret);
  const slash = beforeCaret.match(/^(\s*)\/([a-z0-9-]*)$/i);
  if (slash) {
    return {
      kind: "command",
      start: slash[1].length,
      end: safeCaret,
      query: slash[2]
    };
  }
  const mention = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/u);
  if (!mention) return null;
  const start = safeCaret - mention[1].length - 1;
  return {
    kind: "mention",
    start,
    end: safeCaret,
    query: mention[1]
  };
}

export function replaceComposerTrigger(
  value: string,
  trigger: ComposerTrigger,
  replacement: string
): { value: string; caret: number } {
  const prefix = value.slice(0, trigger.start);
  const suffix = value.slice(trigger.end);
  const next = `${prefix}${replacement}${suffix}`;
  return { value: next, caret: prefix.length + replacement.length };
}

export function removeMentionTrigger(value: string, trigger: ComposerTrigger): { value: string; caret: number } {
  let prefix = value.slice(0, trigger.start);
  let suffix = value.slice(trigger.end);
  if (/\s$/u.test(prefix) && /^\s/u.test(suffix)) suffix = suffix.slice(1);
  if (!prefix && /^\s/u.test(suffix)) suffix = suffix.trimStart();
  if (!suffix && /\s$/u.test(prefix)) prefix = prefix.trimEnd();
  return { value: `${prefix}${suffix}`, caret: prefix.length };
}

export { parseSkillSlashInvocation, skillMatchScore } from "@shared/skill-invocations";
