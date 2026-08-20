import type { DesktopApi } from "./contracts";

declare global {
  interface Window {
    openmind: DesktopApi;
  }
}

export {};
