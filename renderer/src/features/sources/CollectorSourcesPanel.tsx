import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { SourceDefinition } from "@shared/contracts";
import { messages } from "@shared/messages";
import { ErrorState, LoadingState } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { reconcileSources } from "./source-list-state";
import { readWithDeadline } from "../../request-deadline";

const SkillSourcesPanel = lazy(() => import("./SkillSourcesPanel").then(module => ({ default: module.SkillSourcesPanel })));

export function CollectorSourcesPanel({ skillId, title }: { skillId: "x-following-fetcher" | "reddit-fetcher"; title: string }) {
  useLocale();
  const [sources, setSources] = useState<SourceDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    if (skillId === "x-following-fetcher") return;
    try {
      const rows = await readWithDeadline(window.openmind.listSources({ kind: "reddit", skillId }), messages.settings.collectorSourcesLoadTimeout);
      if (request !== sequence.current) return;
      setSources(current => reconcileSources(current || [], rows.filter(source => source.skillId === skillId && source.kind === "reddit")));
      setError(null);
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [skillId]);
  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);
  const updated = useCallback((source: SourceDefinition) => { sequence.current++; setSources(current => current?.map(row => row.id === source.id ? source : row) || []); }, []);

  return <section className="collector-sources" aria-label={title}>
    {error ? <ErrorState message={error} retry={() => void load()} /> : null}
    {skillId === "reddit-fetcher" && sources === null ? !error && <LoadingState /> : <Suspense fallback={<LoadingState />}>
      <SkillSourcesPanel refreshOnMount={false} summary={{ id: skillId, title }} sources={sources || []}
        onSourceUpdated={updated}
        onReloadSources={load} />
    </Suspense>}
  </section>;
}
