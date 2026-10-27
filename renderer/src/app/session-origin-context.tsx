import { createContext, useContext, useLayoutEffect } from "react";
import type { AiSessionOrigin } from "@shared/ai-session-origin";

export function createSessionOriginStore() {
  let current: AiSessionOrigin = { page: "ai" };
  return {
    get: () => current,
    register(origin: AiSessionOrigin) {
      current = origin;
      return () => { if (current === origin) current = { page: "ai" }; };
    }
  };
}
export const SessionOriginContext = createContext<ReturnType<typeof createSessionOriginStore>>({
  get: () => ({ page: "ai" }), register: () => () => {}
});
export function useCurrentSessionOrigin() { return useContext(SessionOriginContext).get; }

/** The visible feature owns the draft's origin; existing sessions keep theirs. */
export function useSessionOrigin(origin: AiSessionOrigin | null) {
  const store = useContext(SessionOriginContext);
  const value = JSON.stringify(origin);
  useLayoutEffect(() => value === "null" ? undefined : store.register(JSON.parse(value)), [store, value]);
}
