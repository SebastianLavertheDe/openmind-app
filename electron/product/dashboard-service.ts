import {
  DashboardDataSchema,
  type DashboardData
} from "../../shared/contracts";
import { BriefService } from "./brief-service";
import { SourceRegistry } from "./source-registry";
import { compactDate, type CreativeApi } from "./common";

const DASHBOARD_CACHE_TTL_MS = 20_000;

export class DashboardService {
  private briefCache = new Map<string, { expiresAt: number; value: ReturnType<BriefService["getDashboardBrief"]> }>();
  private sourceCache: { expiresAt: number; failedSources: number } | null = null;

  constructor(
    private readonly creative: CreativeApi,
    private readonly briefs: BriefService,
    private readonly sources: SourceRegistry
  ) {}

  getDashboard(rawDate: string, pendingApprovals: number): DashboardData {
    const date = compactDate(rawDate);
    const now = Date.now();
    const cachedBrief = this.briefCache.get(date);
    const brief = cachedBrief && cachedBrief.expiresAt > now
      ? cachedBrief.value
      : this.briefs.getDashboardBrief(date);
    if (!cachedBrief || cachedBrief.expiresAt <= now) {
      this.briefCache.set(date, { expiresAt: now + DASHBOARD_CACHE_TTL_MS, value: brief });
    }
    const projects = this.creative.listCreativeProjects();
    const stages = ["drafting", "review", "ready", "published"].map((stage) => ({
      stage,
      count: projects.filter((project) => project.stage === stage).length
    }));
    if (!this.sourceCache || this.sourceCache.expiresAt <= now) {
      this.sourceCache = {
        expiresAt: now + DASHBOARD_CACHE_TTL_MS,
        failedSources: this.sources.listSources().filter((source) => source.status === "failed").length
      };
    }

    return DashboardDataSchema.parse({
      schemaVersion: 1,
      date,
      refreshedAt: new Date().toISOString(),
      metrics: {
        collected: brief.counts.content,
        unread: brief.counts.unread,
        articles: brief.counts.articles,
        posts: brief.counts.posts,
        reddit: brief.counts.reddit,
        drafting: stages.find((item) => item.stage === "drafting")?.count || 0,
        review: stages.find((item) => item.stage === "review")?.count || 0,
        ready: stages.find((item) => item.stage === "ready")?.count || 0,
        failedSources: this.sourceCache.failedSources,
        pendingApprovals
      },
      sourceCounts: brief.sourceCounts,
      recommendedTopics: brief.topics.slice(0, 5),
      creativeStages: stages,
      trend: [],
      attention: []
    });
  }

  invalidate(scope: "content" | "sources" | "all" = "all", date?: string): void {
    if (scope === "content" || scope === "all") {
      if (date) this.briefCache.delete(compactDate(date));
      else this.briefCache.clear();
    }
    if (scope === "sources" || scope === "all") this.sourceCache = null;
  }
}
