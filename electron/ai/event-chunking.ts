import crypto from "node:crypto";
import type { AiEvent } from "../../shared/contracts";

// 单个 AI 事件 payload 的最大字节上限：超过则切成多段，避免单条 rollout line 过大。
const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;
// 切片步长取字节上限的一半：gate 用 UTF-8 字节，slice 按 UTF-16 code unit，
// 留 2× 余量覆盖最坏每字符 4 字节的情况，保证切片重组后不超字节上限。
const MAX_EVENT_CHUNK_CHARS = MAX_EVENT_PAYLOAD_BYTES / 2;

type ChunkMeta = { id: string; index: number; total: number; field: "text" | "$json" };

/**
 * 事件 payload 的切片与重组 + 加载期归一化。从 SessionStore 抽出（C1），
 * 让 rollout 的 append（chunkPayload）/ read（reassembleEvents）成对内聚于一处，
 * SessionStore 与 RolloutProjector 都从这里 import，避免循环依赖。
 */
export function chunkPayload(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_EVENT_PAYLOAD_BYTES) return [payload];
  const chunkId = crypto.randomUUID();
  const field = typeof payload.text === "string" ? "text" : "$json";
  const text = field === "text" ? String(payload.text) : serialized;
  const base = field === "text"
    ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "text"))
    : {};
  const pieces: string[] = [];
  for (let offset = 0; offset < text.length; offset += MAX_EVENT_CHUNK_CHARS) pieces.push(text.slice(offset, offset + MAX_EVENT_CHUNK_CHARS));
  return pieces.map((piece, index) => ({
    ...base,
    [field === "text" ? "text" : "chunkData"]: piece,
    chunk: { id: chunkId, index, total: pieces.length, field } satisfies ChunkMeta
  }));
}

export function reassembleEvents(events: AiEvent[]): AiEvent[] {
  const groups = new Map<string, AiEvent[]>();
  for (const event of events) {
    const chunk = event.payload.chunk as { id?: string; index?: number; total?: number; field?: string } | undefined;
    if (!chunk?.id) continue;
    const group = groups.get(chunk.id) || [];
    group.push(event);
    groups.set(chunk.id, group);
  }

  const result: AiEvent[] = [];
  const emittedGroups = new Set<string>();
  for (const event of events) {
    const chunk = event.payload.chunk as { id?: string; index?: number; total?: number; field?: string } | undefined;
    if (!chunk?.id) {
      result.push(event);
      continue;
    }
    if (emittedGroups.has(chunk.id)) continue;
    const group = groups.get(chunk.id) || [];
    if (group.length !== chunk.total) {
      result.push(event);
      continue;
    }
    emittedGroups.add(chunk.id);
    group.sort((a, b) => Number((a.payload.chunk as { index?: number }).index) - Number((b.payload.chunk as { index?: number }).index));
    const first = group[0];
    const field = String(chunk.field || "text");
    const joined = group.map((item) => String(field === "$json" ? item.payload.chunkData || "" : item.payload.text || "")).join("");
    const payload = field === "$json"
      ? JSON.parse(joined) as Record<string, unknown>
      : { ...first.payload, text: joined };
    delete payload.chunk;
    delete payload.chunkData;
    result.push({
      ...first,
      payload,
      risks: group.flatMap((item) => item.risks)
    });
  }
  return result;
}

export function isProviderPrivateDelta(kind: AiEvent["kind"], payload: Record<string, unknown>): boolean {
  if (kind !== "system" || !payload.message || typeof payload.message !== "object") return false;
  const subtype = String((payload.message as Record<string, unknown>).subtype || "");
  return subtype === "thinking_tokens" || subtype === "status";
}

export function isContextCompaction(kind: AiEvent["kind"], payload: Record<string, unknown>): boolean {
  if (kind !== "system") return false;
  const subtype = String(payload.subtype || "");
  return subtype === "compact_boundary" || subtype === "context_compacted";
}

export function normalizeLoadedEvent(event: AiEvent): AiEvent | null {
  if (isProviderPrivateDelta(event.kind, event.payload)) return null;
  if (event.kind !== "system" || !event.payload.message || typeof event.payload.message !== "object") return event;
  const message = event.payload.message as Record<string, unknown>;
  if (message.subtype !== "init") return event;
  return {
    ...event,
    payload: {
      text: "Claude Code 已初始化",
      subtype: "init",
      model: message.model,
      version: message.claude_code_version,
      permissionMode: message.permissionMode
    }
  };
}
