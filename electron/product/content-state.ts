import {
  ContentItemSchema,
  ContentStatePatchSchema,
  type ContentState,
  type ContentStatePatch
} from "../../shared/contracts";
import { statePath as statePath_, readStateJson } from "./state-directory";
import {
  CONTENT_STATE_DEFAULT,
  normalizeTags,
  writeJsonAtomic,
  type IndexedContent,
  type StoredContentState
} from "./common";

export class ContentStateStore {
  readonly statePath: string;

  constructor(repoRoot: string) {
    this.statePath = statePath_(repoRoot, "content-state.json");
  }

  update(id: string, relativePath: string, rawPatch: ContentStatePatch): ContentState {
    const patch = ContentStatePatchSchema.parse(rawPatch);
    const state = this.read();
    const current = state[id] || state[relativePath] || CONTENT_STATE_DEFAULT;
    state[id] = {
      ...current,
      ...patch,
      tags: patch.tags ? normalizeTags(patch.tags) : current.tags
    };
    delete state[relativePath];
    writeJsonAtomic(this.statePath, state);
    return state[id];
  }

  readFor(indexed: IndexedContent[]): StoredContentState {
    const state = this.read();
    if (this.applyLegacyKeyMigration(state, indexed)) writeJsonAtomic(this.statePath, state);
    return state;
  }

  /** 把旧的 path-key 状态迁到 id-key（一次性 legacy 修复），原地改 state 并返回是否有变更。幂等。 */
  private applyLegacyKeyMigration(state: StoredContentState, indexed: IndexedContent[]): boolean {
    let changed = false;
    for (const record of indexed) {
      if (!state[record.id] && state[record.path]) {
        state[record.id] = state[record.path];
        changed = true;
      }
      if (state[record.path]) {
        delete state[record.path];
        changed = true;
      }
    }
    return changed;
  }

  private read(): StoredContentState {
    const raw = readStateJson(this.statePath, {}) as Record<string, unknown>;
    const parsed: StoredContentState = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const result = ContentItemSchema.shape.state.safeParse(value);
      if (result.success) parsed[key] = result.data;
    }
    return parsed;
  }
}
