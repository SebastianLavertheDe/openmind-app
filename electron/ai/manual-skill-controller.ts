import { SkillToolRegistry } from "./skill-tool-registry";

export class ManualSkillController {
  constructor(
    private readonly skillTools: SkillToolRegistry,
    private readonly projectRoot: string,
    private readonly publish: (message: unknown) => void
  ) {}

  startSkill(skillId: string, date?: string): boolean {
    const invocationId = `manual:${skillId}`;
    if (this.skillTools.isRunning(invocationId)) throw new Error("该技能正在运行。");
    void this.skillTools.run(skillId, date ? { date } : {}, this.projectRoot, {
      invocationId,
      onEvent: (event) => this.publish({ kind: "skill-event", event })
    }).catch((error) => {
      this.publish({
        kind: "skill-event",
        event: {
          skillId,
          invocationId,
          type: "output",
          stream: "stderr",
          text: `${error instanceof Error ? error.message : String(error)}\n`,
          timestamp: new Date().toISOString()
        }
      });
    });
    return true;
  }

  startSource(sourceId: string, skillId: string, date?: string, sourceUrl?: string, sourceName?: string): boolean {
    const invocationId = `manual:${sourceId}`;
    if (this.skillTools.isRunning(invocationId)) throw new Error("该数据源正在运行。");
    void this.skillTools.run(skillId, {
      ...(date ? { date } : {}),
      sourceId,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(sourceName ? { sourceName } : {})
    }, this.projectRoot, {
      invocationId,
      onEvent: (event) => this.publish({ kind: "skill-event", event })
    }).catch((error) => {
      this.publish({
        kind: "skill-event",
        event: {
          skillId,
          sourceId,
          invocationId,
          type: "output",
          stream: "stderr",
          text: `${error instanceof Error ? error.message : String(error)}\n`,
          timestamp: new Date().toISOString()
        }
      });
    });
    return true;
  }

  stopSkill(skillId: string): Promise<boolean> {
    return this.skillTools.stop(`manual:${skillId}`);
  }

  stopSource(sourceId: string): Promise<boolean> {
    return this.skillTools.stop(`manual:${sourceId}`);
  }
}
