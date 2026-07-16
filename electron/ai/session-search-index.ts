import { SCHEMA_VERSION, type AiEvent, type AiSession } from "../../shared/contracts";

/** SessionSearchIndex 的磁盘 io 端口（由 SessionStore 注入其 readJson/atomicJson）。 */
export type SearchIndexIO = {
  readJson(file: string): unknown;
  writeAtomic(file: string, value: unknown): void;
};

/**
 * 会话搜索索引：内存里按 sessionId 维护 title+body 文本，按 query 子串过滤。
 * 从 SessionStore 抽出，使索引逻辑可独立单测。行为与原 SessionStore.writeSearchIndex 逐字一致：
 * event bursts 只更新内存；turn 边界（additions 为空）把合并 body 落盘一次。
 */
export class SessionSearchIndex {
  private text = new Map<string, string>();
  private bodies = new Map<string, string>();

  constructor(private readonly io: SearchIndexIO) {}

  /** ensureIndex 时加载已有索引：磁盘 raw 有则用，否则用 title 占位。 */
  load(sessionId: string, title: string, raw: { body?: string; text?: string } | null): void {
    this.bodies.set(sessionId, raw?.body || "");
    this.text.set(sessionId, raw?.text || title);
  }

  delete(sessionId: string): void {
    this.text.delete(sessionId);
    this.bodies.delete(sessionId);
  }

  /**
   * 增量更新内存索引；turn 边界（additions 为空）把合并后的 body 落盘。
   * title 由调用方（SessionStore.getSession）传入，searchFile 为该 session 的索引路径。
   */
  write(sessionId: string, title: string, additions: AiEvent[], searchFile: string): void {
    try {
      let body = this.bodies.get(sessionId);
      if (body === undefined) {
        try {
          const current = this.io.readJson(searchFile) as { body?: string };
          body = current.body || "";
        } catch {
          body = "";
        }
      }
      const added = additions.flatMap((event) => [
        typeof event.payload.text === "string" ? event.payload.text : "",
        typeof event.payload.command === "string" ? event.payload.command : ""
      ]).filter(Boolean).join("\n");
      if (additions.length && !added) return;
      if (added) body = `${body}\n${added}`.trim();
      this.bodies.set(sessionId, body);
      this.text.set(sessionId, `${title}\n${body}`);
      // Event bursts update the live in-memory index only. Turn boundaries and title
      // changes call this method without additions and persist one consolidated file.
      if (additions.length) return;
      this.io.writeAtomic(searchFile, {
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        updatedAt: new Date().toISOString(),
        title,
        body,
        text: `${title}\n${body}`
      });
    } catch { /* session may be mid-creation */ }
  }

  search(query: string, sessions: AiSession[]): AiSession[] {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) => this.text.get(session.id)?.toLocaleLowerCase().includes(needle));
  }
}
