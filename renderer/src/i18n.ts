import { useSyncExternalStore } from "react";
import { getLocale, setLocale, subscribeLocale, type Locale } from "@shared/messages";
import type { UserPreferences } from "@shared/contracts";

/** Subscribe without remounting editors, conversations or in-flight tasks. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function applyLocale(preferences: Pick<UserPreferences, "uiLanguage">): void {
  const language = preferences.uiLanguage === "en" ? "en" : "zh-CN";
  document.documentElement.lang = language;
  setLocale(language);
}
