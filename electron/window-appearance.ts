import type { BrowserWindowConstructorOptions, TitleBarOverlay } from "electron";
import { DESKTOP_WINDOW_TITLEBAR_HEIGHT } from "../shared/responsive-policy";

export const WINDOWS_TITLEBAR_HEIGHT = DESKTOP_WINDOW_TITLEBAR_HEIGHT;

export function windowsTitleBarOverlay(dark: boolean): TitleBarOverlay {
  return {
    color: "#00000000",
    symbolColor: dark ? "#f2f2ef" : "#5f6368",
    height: WINDOWS_TITLEBAR_HEIGHT
  };
}

export function windowAppearance(
  platform: NodeJS.Platform,
  dark: boolean
): Pick<BrowserWindowConstructorOptions, "backgroundColor" | "backgroundMaterial" | "titleBarStyle" | "titleBarOverlay"> {
  if (platform === "win32") {
    return {
      backgroundColor: "#00000000",
      backgroundMaterial: "mica",
      titleBarStyle: "hidden",
      titleBarOverlay: windowsTitleBarOverlay(dark)
    };
  }

  return {
    backgroundColor: dark ? "#171716" : "#f6f7f9"
  };
}
