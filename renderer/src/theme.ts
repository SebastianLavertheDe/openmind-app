import type { UserPreferences } from "@shared/contracts";

let themeTransitionTimer: number | undefined;
let themeTransition: ViewTransition | undefined;
let themeRevision = 0;

export function applyTheme(p: UserPreferences | null | undefined): void {
  const root = document.documentElement;
  const revision = ++themeRevision;
  const nextTheme = p?.themeMode === "dark" ? "dark" : "light";
  const previousTheme = root.getAttribute("data-theme");
  const canAnimate = previousTheme !== null && previousTheme !== nextTheme
    && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const commit = () => {
    // A skipped view transition still invokes its update callback. Rapid theme
    // changes must never let an older callback overwrite the latest preference.
    if (revision === themeRevision) commitTheme(root, p);
  };
  themeTransition?.skipTransition();
  themeTransition = undefined;
  window.clearTimeout(themeTransitionTimer);
  root.classList.remove("theme-transitioning", "theme-transitioning-fallback");

  if (!canAnimate) {
    commit();
    return;
  }
  if (typeof document.startViewTransition !== "function") {
    // Browser previews without snapshot support retain the color transition.
    root.classList.add("theme-transitioning-fallback");
    commit();
    themeTransitionTimer = window.setTimeout(() => root.classList.remove("theme-transitioning-fallback"), 180);
    return;
  }

  root.classList.add("theme-transitioning");
  const transition = document.startViewTransition(commit);
  themeTransition = transition;
  // ready rejects when an in-flight transition is superseded or the document
  // is hidden. Preference application is independent of snapshot availability.
  void transition.ready.catch(() => {});
  void transition.finished.catch(() => {}).finally(() => {
    if (themeTransition !== transition) return;
    themeTransition = undefined;
    root.classList.remove("theme-transitioning");
  });
}

function commitTheme(root: HTMLElement, p: UserPreferences | null | undefined): void {
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
