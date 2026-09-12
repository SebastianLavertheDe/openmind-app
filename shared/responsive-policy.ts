/**
 * Cross-process responsive contract. Renderer layout and Electron window
 * constraints consume the same values so every designed state is reachable in
 * the packaged application.
 */
export const RESPONSIVE_LAYOUT_BREAKPOINTS = {
  companionCompact: 1760,
  workspaceSingle: 1480,
  shellDrawer: 840,
  narrowDensity: 720,
  expandedNavigationWidth: 260,
  railNavigationWidth: 60,
  minimumCompanionWidth: 380,
  minimumWorkspaceWidth: 760
} as const;

export const DESKTOP_WINDOW_MIN_SIZE = {
  width: RESPONSIVE_LAYOUT_BREAKPOINTS.narrowDensity,
  height: 600
} as const;

/**
 * Compact desktop top chrome (Codex-like): one value drives both the native
 * Windows title-bar overlay height and the renderer's drag region / shell
 * padding so the strip never disagrees with the caption buttons.
 */
export const DESKTOP_WINDOW_TITLEBAR_HEIGHT = 34;
