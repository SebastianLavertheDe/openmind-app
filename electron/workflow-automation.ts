import type { UserPreferences } from "../shared/contracts";

const SOURCE_SKILLS = new Set(["rss-article-saver", "reddit-fetcher", "x-following-fetcher"]);
const DAILY_BRIEF_SKILL = "daily-article-summarizer";

type WorkflowPreferences = Pick<UserPreferences, "workflowAutoBriefOnSourceComplete">;

export class WorkflowAutomationCoordinator {
  private readonly seenInvocations = new Set<string>();
  private readonly pendingByDate = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly preferences: () => WorkflowPreferences,
    private readonly runSkill: (skillId: string, date: string) => Promise<unknown>,
    private readonly debounceMs = 750
  ) {}

  handleSkillEvent(event: Record<string, unknown>): void {
    if (event.type !== "status" || event.state !== "success") return;
    const skillId = String(event.skillId || "");
    const invocationId = String(event.invocationId || "");
    if (!SOURCE_SKILLS.has(skillId) || !invocationId || this.seenInvocations.has(invocationId)) return;
    if (!this.preferences().workflowAutoBriefOnSourceComplete) return;
    this.seenInvocations.add(invocationId);
    const date = eventDate(event.timestamp);
    const pending = this.pendingByDate.get(date);
    if (pending) clearTimeout(pending);
    this.pendingByDate.set(date, setTimeout(() => {
      this.pendingByDate.delete(date);
      void this.runSkill(DAILY_BRIEF_SKILL, date).catch(() => { /* 失败会由 skill-event 和运行历史展示。 */ });
    }, this.debounceMs));
  }

  close(): void {
    for (const timer of this.pendingByDate.values()) clearTimeout(timer);
    this.pendingByDate.clear();
  }
}

function eventDate(timestamp: unknown): string {
  const parsed = typeof timestamp === "string" ? new Date(timestamp) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}
