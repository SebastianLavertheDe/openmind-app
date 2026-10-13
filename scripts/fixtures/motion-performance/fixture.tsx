import { createRoot } from "react-dom/client";
import { App } from "../../../renderer/src/App";
import { applyTheme } from "../../../renderer/src/theme";
import "../../../renderer/src/styles/index.css";

// Test-only entry: exercise the production theme function without navigating
// away from the long conversation whose DOM makes theme changes expensive.
void window.openmind.getPreferences().then(preferences => {
  Object.assign(window, { motionPerf: {
    theme: (themeMode: "light" | "dark") => applyTheme({ ...preferences, themeMode })
  } });
});
createRoot(document.getElementById("root")!).render(<App />);
