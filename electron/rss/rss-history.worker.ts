import { parentPort } from "node:worker_threads";
import { RssRepository } from "./rss-repository";
import { RssSourceReader } from "./rss-source-reader";
import type { RssHistoryRequest, RssHistoryReply } from "./rss-history-service";

if (!parentPort) throw new Error("RSS history requires a worker port.");
const port = parentPort;
port.on("message", (request: RssHistoryRequest) => {
  let reply: RssHistoryReply;
  try {
    const repository = new RssRepository(request.root, request.catalog, request.legacyStateRoots);
    const reader = new RssSourceReader(repository, request.runsRoot);
    reply = { id: request.id, result: request.kind === "runs" ? reader.runs(request.query) : reader.events(request.query) };
  } catch (error) { reply = { id: request.id, error: error instanceof Error ? error.message : String(error) }; }
  port.postMessage(reply);
});
