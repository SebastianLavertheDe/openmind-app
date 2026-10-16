import { zhCN, type Messages } from "./zh-CN";
import { en } from "./en";
import { config, locales } from "zod";

export { zhCN, type Messages } from "./zh-CN";
export { en } from "./en";
export type { TranslationOf } from "./types";

export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];
export const DEFAULT_LOCALE: Locale = "zh-CN";

const catalogs: Record<Locale, Messages> = { "zh-CN": zhCN, en };
let locale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();
config(locales.zhCN());

export function getLocale(): Locale { return locale; }

export function setLocale(next: Locale): void {
  if (!SUPPORTED_LOCALES.includes(next)) throw new Error(`Unsupported UI language: ${next}`);
  if (next === locale) return;
  locale = next;
  config(next === "en" ? locales.en() : locales.zhCN());
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Use an explicit catalog for work that must retain its original language. */
export function getMessages(language: Locale = locale): Messages { return catalogs[language]; }

// Keep existing messages aliases live, including nested aliases held by helpers.
// No React or platform dependencies: Main, Worker and Renderer share this entry.
function liveMessages(path: PropertyKey[] = []): object {
  const read = (): any => path.reduce((value, key) => value[key], catalogs[locale] as any);
  const initial = read();
  const children = new Map<PropertyKey, object>();
  return new Proxy(Array.isArray(initial) ? [] : {}, {
    get(_target, key) {
      const value = read()[key];
      if (typeof value === "function") {
        if (!children.has(key)) children.set(key, (...args: unknown[]) => Reflect.apply(read()[key], read(), args));
        return children.get(key);
      }
      if (value && typeof value === "object" && !(value instanceof RegExp)) {
        if (!children.has(key)) children.set(key, liveMessages([...path, key]));
        return children.get(key);
      }
      return value;
    },
    has: (_target, key) => key in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, key) => {
      if (Array.isArray(initial) && key === "length") return { value: read().length, writable: true, enumerable: false, configurable: false };
      return key in read() ? { enumerable: true, configurable: true } : undefined;
    }
  });
}

export const messages = liveMessages() as Messages;
