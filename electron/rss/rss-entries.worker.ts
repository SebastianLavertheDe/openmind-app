import { parentPort } from "node:worker_threads";
import type { RssEntriesWorkerRequest, RssEntriesWorkerReply } from "../../shared/rss-contracts";
import { RssRepository } from "./rss-repository";
import { RssSourceReader } from "./rss-source-reader";

if (!parentPort) throw new Error("RSS entries require a worker port.");
const port = parentPort;
port.on("message", (request: RssEntriesWorkerRequest) => {
  let reply: RssEntriesWorkerReply;
  try {
    const repository = new RssRepository(request.root, request.catalog, request.legacyStateRoots);
    reply = { id: request.id, result: new RssSourceReader(repository, "").entries(request.query) };
  } catch (error) { reply = { id: request.id, error: error instanceof Error ? error.message : String(error) }; }
  port.postMessage(reply);
});
