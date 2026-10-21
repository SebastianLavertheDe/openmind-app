import { useCallback, useEffect, useRef, useState } from "react";

/** One success interval per copy; a stale request cannot replace newer feedback. */
export function useClipboard({ successMs = 1500 } = {}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<number | null>(null);
  const revision = useRef(0);
  useEffect(() => () => {
    revision.current += 1;
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const copy = useCallback(async (text: string): Promise<boolean> => {
    const request = ++revision.current;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setCopied(false);
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      if (request !== revision.current) return false;
      setCopied(true);
      timer.current = window.setTimeout(() => { timer.current = null; setCopied(false); }, successMs);
      return true;
    } catch (cause) {
      if (request === revision.current) { setCopied(false); setError(cause); }
      return false;
    }
  }, [successMs]);
  return { copy, copied, error };
}
