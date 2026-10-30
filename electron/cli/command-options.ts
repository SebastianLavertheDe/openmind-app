export const SCHEDULED_SKILLS = ["rss-article-saver", "daily-article-summarizer", "daily-topic-selector", "reddit-fetcher", "x-following-fetcher"] as const;

export function parseCommand(argv: string[]) {
  const [area, command, ...rest] = argv;
  if (!(area === "rss" && ["sync", "collect", "pipeline"].includes(command)
    || area === "brief" && command === "generate"
    || ["reddit", "x"].includes(area) && command === "collect"
    || area === "runtime" && command === "prepare")) throw new Error("Unknown command. Use --help.");
  const options = new Map<string, string>();
  const flags = ["--check", ...(area === "brief" ? ["--topics"] : []), ...(area === "runtime" ? ["--browser", "--scheduled"] : []), ...(area === "rss" && command === "pipeline" ? ["--summarize"] : [])];
  const values = ["--root", "--user-data", ...(area !== "runtime" && area !== "x" ? ["--date"] : []), ...(area === "rss" ? ["--source-id"] : [])];
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (options.has(key)) throw new Error(`Duplicate argument: ${key}`);
    if (flags.includes(key) && !(area === "runtime" && key === "--check")) { options.set(key, "true"); continue; }
    if (!values.includes(key) || !rest[i + 1] || rest[i + 1].startsWith("--")) throw new Error(`Invalid argument: ${key}`);
    options.set(key, rest[++i]);
  }
  const date = options.get("--date");
  if (date) {
    const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`);
    if (!/^\d{8}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10).replace(/-/g, "") !== date) throw new Error("--date must be a valid YYYYMMDD date.");
  }
  const skillIds: string[] = area === "runtime" && options.has("--scheduled") ? [...SCHEDULED_SKILLS]
    : area === "rss" ? ["rss-article-saver", ...(options.has("--summarize") ? ["daily-article-summarizer"] : [])]
    : area === "reddit" ? ["reddit-fetcher"] : area === "x" ? ["x-following-fetcher"]
    : area === "brief" ? [options.has("--topics") ? "daily-topic-selector" : "daily-article-summarizer"] : ["rss-article-saver"];
  return { area, command, options, skillIds };
}

export function commandInputs(skillId: string, command: string, options: Map<string, string>, date: string): Record<string, string> {
  if (skillId === "x-following-fetcher") return {};
  return { date, ...(skillId === "rss-article-saver" ? { mode: command, sourceId: options.get("--source-id") || "" } : {}) };
}
