import fs from "node:fs";
import path from "node:path";
import type { BrokerRunEvent } from "../../shared/execution-contracts";

export function readCommandResult(runDirectory: string, events: Pick<BrokerRunEvent, "stream" | "text">[]): unknown {
  const file = path.join(runDirectory, "result.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  // Older packages and brief generators emit a small final JSON line. Join
  // process chunks before parsing: a JSON line can span multiple events.
  const stdout = events.filter(event => event.stream === "stdout").map(event => event.text || "").join("");
  let result: unknown;
  for (const line of stdout.split("\n")) {
    try { result = JSON.parse(line); } catch { /* Diagnostics remain available in the run history. */ }
  }
  return result;
}
