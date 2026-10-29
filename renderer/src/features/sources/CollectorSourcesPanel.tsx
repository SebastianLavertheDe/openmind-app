import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { SourceDefinition } from "@shared/contracts";
import { messages } from "@shared/messages";
import { ErrorState, LoadingState } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { readWithDeadline } from "../../request-deadline";

const SkillSourcesPanel = lazy(() => import("../skills/SkillsPage").then(module => ({ default: module.SkillSourcesPanel })));

export function CollectorSourcesPanel({ skillId, title }: { skillId: "x-following-fetcher" | "reddit-fetcher"; title: string }) {
  useLocale();
  const [sources, setSources] = useState<SourceDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    if (skillId === "x-following-fetcher") return;
    try {
      const rows = await readWithDeadline(window.openmind.listSources(), messages.settings.collectorSourcesLoadTimeout);
      if (request !== sequence.current) return;
      setSources(rows.filter(source => source.skillId === skillId && source.kind === "reddit"));
      setError(null);
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [skillId]);
  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);

  return <section className="collector-sources" aria-label={title}>
    {error ? <ErrorState message={error} retry={() => void load()} /> : null}
    {skillId === "reddit-fetcher" && sources === null ? !error && <LoadingState /> : <Suspense fallback={<LoadingState />}>
      <SkillSourcesPanel summary={{ id: skillId, title }} sources={sources || []}
        onSourceUpdated={source => setSources(current => current?.map(row => row.id === source.id ? source : row) || [])}
        onReloadSources={load} />
    </Suspense>}
  </section>;
}
