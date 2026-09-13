import type { UserPreferences } from "@shared/contracts";

let themeTransitionTimer: number | undefined;

export function applyTheme(p: UserPreferences | null | undefined): void {
  const root = document.documentElement;
  const canAnimate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (canAnimate) {
    root.classList.add("theme-transitioning");
    window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = window.setTimeout(() => root.classList.remove("theme-transitioning"), 180);
  }

  root.setAttribute("data-theme", p?.themeMode === "dark" ? "dark" : "light");
  root.style.removeProperty("--accent");
  root.style.removeProperty("--accent-fg");
  root.style.removeProperty("--accent-tint");
  root.style.removeProperty("--accent-tint-2");
  root.style.removeProperty("--accent-soft");
  if (p?.density === "compact") root.style.setProperty("--space-3", "6px");
  else if (p?.density === "comfortable") root.style.setProperty("--space-3", "16px");
  else root.style.removeProperty("--space-3");
  if (p?.fontSize === "large") { root.style.setProperty("--fs-body", "15px"); root.style.setProperty("--fs-caption", "12px"); }
  else if (p?.fontSize === "small") { root.style.setProperty("--fs-body", "12px"); root.style.setProperty("--fs-caption", "12px"); }
  else { root.style.removeProperty("--fs-body"); root.style.removeProperty("--fs-caption"); }
}
