import type { DesktopApi } from "./contracts";

declare global {
  interface Window {
    cctools: DesktopApi;
  }
}

export {};
