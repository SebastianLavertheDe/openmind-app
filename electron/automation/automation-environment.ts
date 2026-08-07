import fs from "node:fs";
import os from "node:os";

export type AutomationNetworkState = "online" | "offline" | "unknown";
export type AutomationPowerState = "ac" | "battery" | "unknown";
export type AutomationEnvironment = {
  network: AutomationNetworkState;
  power: AutomationPowerState;
};

/** Best-effort host condition probe. Unknown never satisfies a rule. */
export function detectAutomationEnvironment(): AutomationEnvironment {
  return {
    network: hasNonInternalInterface() ? "online" : "offline",
    power: detectPowerState()
  };
}

function hasNonInternalInterface(): boolean {
  try {
    return Object.values(os.networkInterfaces()).flatMap((items) => items || []).some((item) => !item.internal && Boolean(item.address));
  } catch {
    return false;
  }
}

function detectPowerState(): AutomationPowerState {
  if (process.platform !== "linux") return "unknown";
  try {
    const roots = fs.readdirSync("/sys/class/power_supply", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/sys/class/power_supply/${entry.name}`);
    const ac = roots.find((root) => /^(AC|ADP|Mains)/i.test(root.split("/").pop() || ""));
    if (ac && fs.readFileSync(`${ac}/online`, "utf8").trim() === "1") return "ac";
    const battery = roots.find((root) => /battery/i.test(root.split("/").pop() || ""));
    if (battery) {
      const status = fs.readFileSync(`${battery}/status`, "utf8").trim().toLowerCase();
      if (["discharging", "charging", "full"].includes(status)) return status === "discharging" ? "battery" : "ac";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}
