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
  minimumWorkspaceWidth: 760
} as const;

export const DESKTOP_WINDOW_MIN_SIZE = {
  width: RESPONSIVE_LAYOUT_BREAKPOINTS.narrowDensity,
  height: 600
} as const;
