import fs from "node:fs";
import path from "node:path";

export type UserDataBootstrapApp = {
  commandLine: { hasSwitch(name: string): boolean };
  setPath(name: "userData", value: string): void;
};

/**
 * Apply the optional environment override before Electron becomes ready.
 * Electron's standard --user-data-dir switch wins when both are supplied.
 */
export function configureUserDataPath(
  electronApp: UserDataBootstrapApp,
  configuredPath = process.env.OPENMIND_USER_DATA_DIR
): string | null {
  if (electronApp.commandLine.hasSwitch("user-data-dir")) return null;
  const raw = configuredPath?.trim();
  if (!raw) return null;
  if (!path.isAbsolute(raw)) {
    throw new Error("OPENMIND_USER_DATA_DIR 必须是绝对路径。");
  }

  const target = path.resolve(raw);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(target, 0o700);
  electronApp.setPath("userData", target);
  return target;
}
