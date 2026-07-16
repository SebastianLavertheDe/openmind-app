import type { AiContextState, AiEvent, AiRun, AiTurnListParams, AiTurnPage, RiskFinding } from "../../shared/contracts";
import { paginateTurns, type RolloutReconstruction } from "./rollout";
import { normalizeLoadedEvent, reassembleEvents } from "./event-chunking";

/**
 * rollout 投影：reconstruct 的消费者集中于此（readEvents / listTurns / getContextState / getRisks）。
 * 从 SessionStore 抽出（C1），reconstruct 函数与 getRun 由 SessionStore 注入（它持有 journal + 元数据），
 * 使投影逻辑可独立单测。
 */
export class RolloutProjector {
  constructor(
    private readonly reconstruct: (sessionId: string) => RolloutReconstruction,
    private readonly getRun: (runId: string) => AiRun
  ) {}

  readEvents(sessionId: string): AiEvent[] {
    const turns = this.reconstruct(sessionId).turns;
    return reassembleEvents(turns.flatMap((turn) => turn.events).map(normalizeLoadedEvent).filter((event): event is AiEvent => Boolean(event)));
  }

  listTurns(sessionId: string, params: AiTurnListParams = {}): AiTurnPage {
    return paginateTurns(this.reconstruct(sessionId), params);
  }

  getContextState(sessionId: string): AiContextState {
    return this.reconstruct(sessionId).context;
  }

  getRisks(runId: string): RiskFinding[] {
    const all = this.readEvents(this.getRun(runId).sessionId).filter((event) => event.runId === runId).flatMap((event) => event.risks);
    const seen = new Set<string>();
    const distinct: RiskFinding[] = [];
    for (const finding of all) {
      const key = `${finding.kind}:${finding.summary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      distinct.push(finding);
    }
    return distinct;
  }
}
