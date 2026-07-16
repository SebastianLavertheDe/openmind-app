import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AiRolloutLineSchema, type AiRolloutLine } from "../../shared/contracts";
import { replaceFileAtomicallySync } from "./process-utils";
import type { RolloutReconstruction } from "./rollout";

type CacheEntry = {
  size: number;
  mtimeMs: number;
  lines: AiRolloutLine[];
  parseErrors: number;
  reconstruction?: RolloutReconstruction | null;
};

/**
 * Rollout 日志的拥有者：内存缓存已解析行 + 同步追加 / 延迟 flush / 原子重写 / 增量 tail。
 * 从 SessionStore 抽出（C1），使 rollout 落盘策略单一拥有——session-store 不再扛这职责，
 * 调用方经 journal 拿到一致的 lines 视图。缓存按 (size, mtimeMs) 指纹增量更新，
 * 避免每条消息都全量读盘 + Zod 校验。
 */
export class RolloutJournal {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, AiRolloutLine[]>();
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly directories = new Set<string>();

  getEntry(sessionId: string): CacheEntry | undefined {
    return this.cache.get(sessionId);
  }

  setReconstruction(sessionId: string, reconstruction: RolloutReconstruction): void {
    const entry = this.cache.get(sessionId);
    if (entry) entry.reconstruction = reconstruction;
  }

  invalidate(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /**
   * 追加 rollout 行。durable=true（默认）锁内同步落盘（turn 起止/回滚等需即时持久化）；
   * durable=false 走 50ms 延迟 flush（事件热路径，批量落盘）。调用方经此单一入口表达耐久度
   * 意图（C7），不再在 append vs queue 两个方法之间选——journal 单一拥有「何时落盘」。
   */
  append(file: string, lines: AiRolloutLine[], durable = true): void {
    if (!durable) { this.scheduleFlush(file, lines); return; }
    const pending = this.pending.get(file) || [];
    if (!pending.length && !lines.length) return;
    this.clearFlushTimer(file);
    this.ensureDirectory(file);
    const combined = pending.length ? [...pending, ...lines] : lines;
    fs.appendFileSync(file, `${combined.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
    this.pending.delete(file);
  }

  /** 延迟 flush（durable=false 路径）：push 到 pending，50ms 后批量 appendFileSync。 */
  private scheduleFlush(file: string, lines: AiRolloutLine[]): void {
    if (!lines.length) return;
    const pending = this.pending.get(file);
    if (pending) pending.push(...lines);
    else this.pending.set(file, [...lines]);
    if (this.flushTimers.has(file)) return;
    const timer = setTimeout(() => {
      this.flushTimers.delete(file);
      try { this.flush(file); } catch { /* the next append/read retries */ }
    }, 50);
    timer.unref?.();
    this.flushTimers.set(file, timer);
  }

  flush(file: string): void {
    const pending = this.pending.get(file);
    if (!pending?.length) return;
    this.clearFlushTimer(file);
    this.ensureDirectory(file);
    fs.appendFileSync(file, `${pending.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
    this.pending.delete(file);
  }

  discard(file: string): void {
    this.clearFlushTimer(file);
    this.pending.delete(file);
  }

  /**
   * 原子重写（compaction / 首建）：tmp + rename。完成后整体结构已变，缓存必须作废，
   * 下次 read 全量重读。
   */
  write(sessionId: string, file: string, lines: AiRolloutLine[]): void {
    const pending = this.pending.get(file) || [];
    this.clearFlushTimer(file);
    this.ensureDirectory(file);
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      const combined = pending.length ? [...lines, ...pending] : lines;
      fs.writeFileSync(temporary, `${combined.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
      replaceFileAtomicallySync(temporary, file);
      this.pending.delete(file);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
    this.cache.delete(sessionId);
  }

  /**
   * 读 rollout：先 flush pending，再按 (size, mtimeMs) 指纹决定复用 / 增量 tail / 全量重读。
   * 返回的 entry（经 getEntry）持有 lines 与 reconstruction 缓存。
   */
  read(sessionId: string, file: string): { lines: AiRolloutLine[]; parseErrors: number } {
    this.flush(file);
    let stat: ReturnType<typeof fs.statSync>;
    try {
      stat = fs.statSync(file);
    } catch {
      // 文件不存在——清掉陈旧缓存，按空会话处理。
      this.cache.delete(sessionId);
      return { lines: [], parseErrors: 0 };
    }
    const cached = this.cache.get(sessionId);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      // 指纹未变：直接复用内存里的已解析行，零读盘、零 Zod。
      return { lines: cached.lines, parseErrors: cached.parseErrors };
    }
    if (cached && stat.size > cached.size) {
      // 追加场景：只读取并解析新增的尾部几行，挂到既有缓存末尾。
      const tail = this.readTail(file, cached.size, stat.size);
      for (const rawLine of tail.split("\n")) {
        if (!rawLine.trim()) continue;
        try {
          cached.lines.push(AiRolloutLineSchema.parse(JSON.parse(rawLine)));
        } catch {
          cached.parseErrors++;
        }
      }
      cached.size = stat.size;
      cached.mtimeMs = stat.mtimeMs;
      cached.reconstruction = null;   // lines 增长，缓存的 reconstruction 已过期，需重建
      return { lines: cached.lines, parseErrors: cached.parseErrors };
    }
    // 首次加载 / 文件被重写变小 / 指纹对不上：全量读盘 + 逐行解析，重建缓存。
    const lines: AiRolloutLine[] = [];
    let parseErrors = 0;
    for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
      if (!rawLine.trim()) continue;
      // 冷读用 Zod safeParse 完整校验：最小守卫挡不住 {"type":"x"} 这类合法 JSON 但缺
      // payload 的行，会进 lines 导致恢复崩溃。冷读只发生在打开 session 时（不频繁），
      // 安全优先于几十~几百 ms。增量分支同样用 Zod parse。
      try {
        const parsed = AiRolloutLineSchema.safeParse(JSON.parse(rawLine));
        if (parsed.success) {
          lines.push(parsed.data);
        } else {
          parseErrors++;
        }
      } catch {
        parseErrors++;
      }
    }
    this.cache.set(sessionId, { size: stat.size, mtimeMs: stat.mtimeMs, lines, parseErrors });
    return { lines, parseErrors };
  }

  /** 读取 rollout 文件 [offset, end) 字节范围的尾部，供增量解析追加行使用。 */
  private readTail(file: string, offset: number, end: number): string {
    const length = end - offset;
    if (length <= 0) return "";
    const buffer = Buffer.allocUnsafe(length);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, buffer, 0, length, offset);
    } finally {
      fs.closeSync(fd);
    }
    return buffer.toString("utf8");
  }

  private ensureDirectory(file: string): void {
    const directory = path.dirname(file);
    if (this.directories.has(directory)) return;
    fs.mkdirSync(directory, { recursive: true });
    this.directories.add(directory);
  }

  private clearFlushTimer(file: string): void {
    const timer = this.flushTimers.get(file);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(file);
  }
}
