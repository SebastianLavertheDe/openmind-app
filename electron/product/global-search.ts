import { z } from "zod";
import {
  GlobalSearchResultSchema,
  type AiSession,
  type GlobalSearchResult
} from "../../shared/contracts";
import type { ProductService } from "./product-service";
import type { ProjectService } from "../project/project-service";

export type GlobalSearchContext = {
  ensureProductService(): ProductService;
  ensureProjectService(): ProjectService;
  searchSessions(query: string): Promise<AiSession[]>;
  listSkillDefinitions(): Promise<Array<Record<string, unknown>>>;
};

/** 全局搜索编排：fan-out 到 AI worker（会话/skill）+ ProductService（内容/创作项目），合并 4 类结果。 */
export async function globalSearch(rawQuery: unknown, ctx: GlobalSearchContext): Promise<GlobalSearchResult[]> {
  const query = z.string().max(500).parse(rawQuery || "").trim();
  if (!query) return [];
  const [sessions, skillDefinitions] = await Promise.all([
    ctx.searchSessions(query),
    ctx.listSkillDefinitions()
  ]);
  const normalizedQuery = query.toLocaleLowerCase();
  const product = ctx.ensureProductService();
  const contentResults = product.searchContent(query, 24);
  const projectResults = product.searchCreativeProjects(query, 16);
  const independentProjectResults: GlobalSearchResult[] = ctx.ensureProjectService().listProjects()
    .filter((project) => `${project.name} ${project.description}`.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, 16)
    .map((project) => ({
      id: `project:${project.name}`,
      kind: "project",
      title: project.name,
      subtitle: `${project.materialCount} 份资料 · ${project.taskCount} 个任务 · ${project.outputCount} 个成品`,
      path: `projects/${project.name}`,
      date: project.updatedAt,
      status: project.status,
      targetId: project.name
    }));
  const sessionResults: GlobalSearchResult[] = sessions
    // Project Task conversations are owned by their Project page. They must
    // not leak into the workspace-wide AI/session search surface.
    .filter((session) => session.scope?.type !== "project-task")
    .slice(0, 16)
    .map((session) => ({
      id: `session:${session.id}`,
      kind: "session",
      title: session.title,
      subtitle: `${session.provider === "claude" ? "Claude Code" : "Codex"} · ${session.cwd}`,
      path: session.cwd,
      date: session.updatedAt,
      status: session.status,
      targetId: session.id
    }));
  const skillResults: GlobalSearchResult[] = skillDefinitions
    .filter((skill) =>
      `${skill.title || ""} ${skill.description || ""} ${skill.id || ""}`.toLocaleLowerCase().includes(normalizedQuery)
    )
    .slice(0, 12)
    .map((skill) => ({
      id: `skill:${String(skill.id)}`,
      kind: "skill",
      title: String(skill.title || skill.id),
      subtitle: String(skill.description || skill.cwd || "Skill"),
      path: typeof skill.cwd === "string" ? skill.cwd : null,
      date: null,
      status: null,
      targetId: String(skill.id)
    }));
  return [...contentResults, ...independentProjectResults, ...projectResults, ...sessionResults, ...skillResults]
    .slice(0, 64)
    .map((result) => GlobalSearchResultSchema.parse(result));
}
