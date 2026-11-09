import fs from "node:fs";
import path from "node:path";
import type { BrokerRunEvent } from "../../shared/execution-contracts";

export function isPartialRssResult(result: unknown): boolean {
  if (!result || typeof result !== "object" || !("status" in result) || result.status !== "partial") return false;
  return "results" in result && Array.isArray(result.results)
    && result.results.some(row => row && typeof row === "object" && row.status === "succeeded");
}

export function readSkillResult(runDirectory: string, events: Pick<BrokerRunEvent, "stream" | "text">[]): unknown {
  const file = path.join(runDirectory, "result.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  // Older packages emit a final JSON line. Join chunks before parsing because
  // one line can span multiple process events.
  const stdout = events.filter(event => event.stream === "stdout").map(event => event.text || "").join("");
  let result: unknown;
  for (const line of stdout.split("\n")) {
    try { result = JSON.parse(line); } catch { /* Diagnostics remain available in the run history. */ }
  }
  return result;
}
