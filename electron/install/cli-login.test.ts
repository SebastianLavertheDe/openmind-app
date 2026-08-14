import { describe, expect, it } from "vitest";
import { buildCliLoginInvocation } from "./cli-login";

describe("buildCliLoginInvocation", () => {
  it("opens a Windows cmd session with the app-private executable", () => {
    expect(buildCliLoginInvocation("claude", "win32", "C:\\Users\\Alice\\AppData\\Local\\CCTools\\tools\\bin\\claude.cmd")).toEqual({
      command: "cmd.exe",
      args: ["/k", '"C:\\Users\\Alice\\AppData\\Local\\CCTools\\tools\\bin\\claude.cmd" "/login"']
    });
  });

  it("prefills macOS Terminal through an escaped AppleScript command", () => {
    const invocation = buildCliLoginInvocation("codex", "darwin", "/Users/alice/CCTools/tools/bin/codex");
    expect(invocation.command).toBe("osascript");
    expect(invocation.args[0]).toBe("-e");
    expect(invocation.args[1]).toContain('tell application "Terminal" to do script "\'/Users/alice/CCTools/tools/bin/codex\' \'login\'"');
  });

  it("keeps Linux as a manual terminal fallback", () => {
    expect(buildCliLoginInvocation("claude", "linux", "/opt/cctools/tools/bin/claude")).toEqual({
      command: "sh",
      args: ["-lc", "'/opt/cctools/tools/bin/claude' '/login'; exec sh"]
    });
  });
});
