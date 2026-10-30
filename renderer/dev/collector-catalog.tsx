import type { DesktopApi } from "../../shared/contracts";
import { SourceDefinitionSchema } from "../../shared/contracts";
import { CollectorSourcesPanel } from "../src/features/sources/CollectorSourcesPanel";

export function installCollectorCatalogApi() {
  let sources = Array.from({ length: 75 }, (_, index) => SourceDefinitionSchema.parse({
    id: `community-${index}`, name: `r/Community${index}`, kind: "reddit", skillId: "reddit-fetcher",
    url: `https://www.reddit.com/r/Community${index}/hot.json`, enabled: index % 4 !== 3, frequency: "daily",
    status: index % 3 === 0 ? "failed" : index % 3 === 1 ? "success" : "running",
    recentError: index % 3 === 0 ? "The community request timed out." : null, lastRunAt: "2026-10-30T08:00:00Z"
  }));
  const api = {
    listSources: async () => structuredClone(sources),
    updateSource: async (id, patch) => { sources = sources.map(source => source.id === id ? { ...source, ...patch } : source); return sources.find(source => source.id === id)!; },
    openExternal: async () => true
  } satisfies Partial<DesktopApi>;
  Object.defineProperty(window, "openmind", { value: api });
}

export function CollectorCatalogExample() {
  return <CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />;
}
