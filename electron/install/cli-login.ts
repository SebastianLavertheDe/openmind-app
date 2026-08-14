import { spawn } from "node:child_process";
import { resolveAppToolExecutable, type CliToolId } from "./cli-installer-service";

const LOGIN_ARGS: Record<CliToolId, string[]> = {
  claude: ["/login"],
  codex: ["login"]
};

export type CliLoginInvocation = { command: string; args: string[] };

/** Pure command construction keeps the platform-specific UX testable. */
export function buildCliLoginInvocation(cli: CliToolId, platform: NodeJS.Platform = process.platform, executableOverride?: string): CliLoginInvocation {
  const executable = executableOverride || resolveAppToolExecutable(cli) || cli;
  if (platform === "win32") {
    const command = `${cmdQuote(executable)} ${LOGIN_ARGS[cli].map(cmdQuote).join(" ")}`;
    return { command: "cmd.exe", args: ["/k", command] };
  }
  const command = `${shellQuote(executable)} ${LOGIN_ARGS[cli].map(shellQuote).join(" ")}`;
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: ["-e", `tell application "Terminal" to do script "${escapeAppleScript(command)}"`]
    };
  }
  return { command: "sh", args: ["-lc", `${shellQuote(executable)} ${LOGIN_ARGS[cli].map(shellQuote).join(" ")}; exec sh`] };
}

/**
 * Open an interactive terminal that runs the CLI's own login flow. The App
 * never receives credentials and macOS gets a command prefilled/executed in
 * Terminal, so the user only needs to finish the browser authorization.
 */
export function openCliLoginTerminal(cli: CliToolId): void {
  const invocation = buildCliLoginInvocation(cli);
  if (process.platform === "win32" || process.platform === "darwin") {
    spawn(invocation.command, invocation.args, { detached: true, stdio: "ignore", windowsVerbatimArguments: false }).unref();
    return;
  }
  for (const terminal of ["xdg-terminal-exec", "gnome-terminal", "konsole", "xterm"]) {
    try {
      spawn(terminal, ["-e", invocation.args.join(" ")], { detached: true, stdio: "ignore" }).unref();
      return;
    } catch {
      // Try the next terminal emulator.
    }
  }
  throw new Error("未找到可用的终端程序，请手动打开终端并运行登录命令。");
}

function escapeAppleScript(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
