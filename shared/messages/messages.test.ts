import { afterEach, describe, expect, it, vi } from "vitest";
import { en, getLocale, getMessages, messages, setLocale, subscribeLocale, zhCN, type Locale } from "./index";

afterEach(() => setLocale("zh-CN"));

describe("shared UI languages", () => {
  it("provides every message and interpolation in both languages", () => {
    function compare(chinese: unknown, english: unknown, path: string) {
      expect(typeof english, path).toBe(typeof chinese);
      if (typeof chinese === "function") {
        expect((english as Function).length, path).toBe(chinese.length);
      } else if (typeof chinese === "string") {
        // Display the language's native name in either interface.
        if (path !== "interface.chinese") expect(english, path).not.toMatch(/\p{Script=Han}/u);
      } else if (chinese instanceof RegExp) {
        expect(english, path).toBeInstanceOf(RegExp);
      } else if (chinese && typeof chinese === "object") {
        expect(Object.keys(english as object).sort(), path).toEqual(Object.keys(chinese).sort());
        for (const key of Object.keys(chinese)) compare((chinese as any)[key], (english as any)[key], path ? `${path}.${key}` : key);
      }
    }
    compare(zhCN, en, "");
  });

  it("keeps cached nested aliases, arrays and formatters live after switching", () => {
    const nav = messages.nav;
    const format = messages.common.chars;
    const suggestions = messages.ai.chat.emptyPrompts;
    expect(messages.common.chars).toBe(format);
    expect(nav.settings).toBe("设置");
    setLocale("en");
    expect(nav.settings).toBe("Settings");
    expect(format(12)).toBe(en.common.chars(12));
    expect(suggestions.map((suggestion) => suggestion.title)).toEqual(en.ai.chat.emptyPrompts.map((suggestion) => suggestion.title));
    expect({ ...messages.nav }).toEqual(en.nav);
    expect("settings" in nav).toBe(true);
    expect(getMessages("zh-CN").nav.settings).toBe("设置");
    setLocale("zh-CN");
    expect(nav.settings).toBe("设置");
    expect(format(12)).toBe("12 字符");
  });

  it("notifies subscribers once per change and rejects unsupported languages", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocale(listener);
    setLocale("en");
    setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => setLocale("fr" as Locale)).toThrow("Unsupported UI language");
    expect(getLocale()).toBe("en");
    unsubscribe();
    setLocale("zh-CN");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
