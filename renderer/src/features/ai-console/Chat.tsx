import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Bot,
  BrainCircuit,
  ChevronRight,
  FileText,
  FolderCode,
  ShieldAlert
} from "lucide-react";
import type { AiEvent, AiRun } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useAi, useAiStreaming } from "../../ai-context";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { useExitingList } from "../../design-system/use-exiting-list";
import { selectRecentTurnEvents } from "../../ai-utils";
import { ApprovalDecisionEvent } from "./approval";
import { ApprovalBanner } from "./approval-banner";
import { ChatComposer } from "./composer";
import { ChangeReviewCard, ChangeTraceCard } from "./diff";
import { ErrorEvent, ProcessSystemEvent, SubtaskTrace, SystemEvent } from "./events";
import { AssistantMessage, ChatMarkdown, UserMessage } from "./message";
import { ReasoningCard } from "./thought";
import { ActiveTodoFloat, selectRunTodoEvents, WorkStateCard } from "./plan";
import { CommandGroup, ToolCallCard, toolIcon } from "./tool";
import {
  assistantPhase,
  changePaths,
  compactEvents,
  groupTimeline,
  selectRenderableTimelineEvents,
  technicalEventText,
  toolCategory,
  toolEventFailed,
  toolOperationSummary,
  type TraceStep
} from "./timeline";

export {
  buildTraceSteps,
  compactEvents,
  deriveRunActivity,
  formatElapsedSeconds,
  groupConversation,
  groupTimeline,
  selectRenderableTimelineEvents,
  toolOperationSummary
} from "./timeline";
export { ToolCallCard } from "./tool";

type TimelineViewItem = ReturnType<typeof groupTimeline>[number];
type ChatViewItem = TimelineViewItem
  | { type: "process"; key: string; run: AiRun; steps: TraceStep[]; completedAt: string | null; missingFinal: boolean }
  | { type: "changes-artifact"; key: string; run: AiRun; events: AiEvent[] };
type ToolStep = Extract<TraceStep, { type: "tool" }>;
type ToolGroupItem = { type: "tool-group"; key: string; run: AiRun; steps: ToolStep[] };
type ChatRenderItem = ChatViewItem | ToolGroupItem;
type LiveProcessState = {
  runId: string | null;
  reasoningText: string;
  commentaryText: string;
  pending: boolean;
};
type ChatScrollMemory = {
  top: number;
  near: boolean;
  follow: boolean;
};
type ChatScrollRestore = {
  sessionId: string;
  memory: ChatScrollMemory;
};

const CHAT_BOTTOM_THRESHOLD = 90;
const CHAT_SCROLL_UP_EPSILON = 1;

export function Chat({ compact = false }: { compact?: boolean }) {
  const ai = useAi();
  const [nearBottom, setNearBottom] = useState(true);
  const jumpBottomPresence = useExitPresence(!nearBottom, 160);
  const [historyLimit, setHistoryLimit] = useState(compact ? 80 : 300);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollMemory = useRef<Map<string, ChatScrollMemory>>(new Map());
  const restorePending = useRef(false);
  const restoreTarget = useRef<ChatScrollRestore | null>(null);
  const followLatest = useRef(true);
  const lastScrollTop = useRef(0);
  const sessionId = ai.activeSession?.id || "__draft";
  const currentScrollSession = useRef(sessionId);
  const serverPagedHistory = Boolean(window.cctools.aiListTurns);
  const streamingRunId = ai.sessionActiveRun?.id || ai.activeRun?.id || null;
  const { streaming, reasoningStreaming } = useAiStreaming(streamingRunId);
  const timelineEvents = useMemo(() => {
    if (compact) return compactEvents(ai.events, ai.sessionActiveRun?.id);
    if (serverPagedHistory) return ai.events;
    return selectRecentTurnEvents(ai.events, historyLimit);
  }, [ai.events, ai.sessionActiveRun?.id, compact, historyLimit, serverPagedHistory]);
  const hiddenEvents = compact || serverPagedHistory ? 0 : Math.max(0, ai.events.length - timelineEvents.length);
  const canLoadHistory = !compact && (hiddenEvents > 0 || ai.hasOlderTurns);
  const renderableTimelineEvents = useMemo(
    () => selectRenderableTimelineEvents(timelineEvents, ai.snapshot.runs),
    [ai.snapshot.runs, timelineEvents]
  );
  const visible = useMemo(
    () => groupTimeline(renderableTimelineEvents, ai.snapshot.runs),
    [ai.snapshot.runs, renderableTimelineEvents]
  );
  const processRuns = useMemo(() => {
    const runs = new Map(ai.snapshot.runs.map((run) => [run.id, run]));
    if (ai.sessionActiveRun) runs.set(ai.sessionActiveRun.id, ai.sessionActiveRun);
    return runs;
  }, [ai.sessionActiveRun, ai.snapshot.runs]);
  const renderItems = useMemo(
    () => {
      const folded = foldProcessSteps(visible, processRuns);
      const activeRun = ai.sessionActiveRun;
      if (activeRun && !folded.some((item) => item.type === "process" && item.run.id === activeRun.id)) {
        folded.push({
          type: "process",
          key: `process:${activeRun.id}`,
          run: activeRun,
          steps: [],
          completedAt: null,
          missingFinal: false
        });
      }
      return groupChatToolItems(folded);
    },
    [ai.sessionActiveRun, processRuns, visible]
  );
  const activeRunId = ai.sessionActiveRun?.id || null;
  const activeTodoEvents = useMemo(
    () => selectRunTodoEvents(ai.events, activeRunId),
    [activeRunId, ai.events]
  );
  const activeRunHasTool = useMemo(() => hasOpenTool(timelineEvents, activeRunId), [activeRunId, timelineEvents]);
  const showPendingThought = Boolean(
    ai.sessionActiveRun
    && ai.sessionActiveRun.status === "running"
    && !activeRunHasTool
    && !reasoningStreaming
    && !streaming
  );
  const activeProcessVisible = Boolean(
    activeRunId
    && renderItems.some((item) => item.type === "process" && item.run.id === activeRunId)
  );
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const top = target.scrollTop;
    const near = target.scrollHeight - top - target.clientHeight < CHAT_BOTTOM_THRESHOLD;
    const movedUp = top < lastScrollTop.current - CHAT_SCROLL_UP_EPSILON;
    if (restorePending.current) return;
    if (movedUp) followLatest.current = false;
    else if (near) followLatest.current = true;
    if (movedUp || top >= lastScrollTop.current || !followLatest.current) lastScrollTop.current = top;
    scrollMemory.current.set(sessionId, { top, near, follow: followLatest.current });
    const viewAtLatest = followLatest.current || near;
    setNearBottom((current) => current === viewAtLatest ? current : viewAtLatest);
  }, [sessionId]);

  const pinToLatest = useCallback(() => {
    const target = scroller.current;
    if (
      currentScrollSession.current !== sessionId
      || !target
      || restorePending.current
      || !followLatest.current
    ) return;
    target.scrollTop = target.scrollHeight;
    lastScrollTop.current = target.scrollTop;
    const near = target.scrollHeight - target.scrollTop - target.clientHeight < CHAT_BOTTOM_THRESHOLD;
    scrollMemory.current.set(sessionId, { top: target.scrollTop, near, follow: true });
    setNearBottom(true);
  }, [sessionId]);

  useLayoutEffect(() => {
    currentScrollSession.current = sessionId;
    const saved = scrollMemory.current.get(sessionId);
    followLatest.current = saved ? saved.follow : true;
    lastScrollTop.current = saved?.top ?? 0;
    setNearBottom(saved ? saved.follow || saved.near : true);
    restorePending.current = Boolean(saved && !saved.follow);
    restoreTarget.current = saved && !saved.follow
      ? { sessionId, memory: { ...saved } }
      : null;
  }, [sessionId]);

  useLayoutEffect(() => {
    pinToLatest();
  }, [pinToLatest, reasoningStreaming, renderItems, streaming]);

  useEffect(() => {
    const target = scroller.current;
    const thread = target?.querySelector<HTMLElement>(".chat-thread");
    if (!target || !thread || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (currentScrollSession.current !== sessionId) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (currentScrollSession.current !== sessionId) return;
        if (restorePending.current) return;
        if (followLatest.current && !restorePending.current) {
          pinToLatest();
          return;
        }
        const near = target.scrollHeight - target.scrollTop - target.clientHeight < CHAT_BOTTOM_THRESHOLD;
        if (near) {
          followLatest.current = true;
          pinToLatest();
          return;
        }
        scrollMemory.current.set(sessionId, {
          top: target.scrollTop,
          near,
          follow: followLatest.current
        });
        setNearBottom((current) => current === near ? current : near);
      });
    });
    observer.observe(target);
    observer.observe(thread);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pinToLatest, sessionId]);

  useEffect(() => {
    if (!restorePending.current) return;
    const pending = restoreTarget.current;
    if (!pending || pending.sessionId !== sessionId) {
      restorePending.current = false;
      restoreTarget.current = null;
      return;
    }
    const saved = pending.memory;
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      if (
        currentScrollSession.current !== sessionId
        || restoreTarget.current !== pending
      ) return;
      const el = scroller.current;
      if (!el) { raf = window.requestAnimationFrame(attempt); return; }
      if (el.scrollHeight - el.clientHeight >= saved.top - 4 || tries >= 10) {
        el.scrollTop = saved.top;
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < CHAT_BOTTOM_THRESHOLD;
        followLatest.current = near;
        if (near) el.scrollTop = el.scrollHeight;
        lastScrollTop.current = el.scrollTop;
        scrollMemory.current.set(sessionId, {
          top: el.scrollTop,
          near,
          follow: followLatest.current
        });
        setNearBottom((current) => current === near ? current : near);
        restorePending.current = false;
        restoreTarget.current = null;
        return;
      }
      tries++;
      raf = window.requestAnimationFrame(attempt);
    };
    raf = window.requestAnimationFrame(attempt);
    return () => window.cancelAnimationFrame(raf);
  }, [sessionId, timelineEvents.length]);
  useEffect(() => setHistoryLimit(compact ? 80 : 300), [ai.activeSession?.id, compact]);

  return (
    <section className={`chat ${compact ? "compact" : ""}`}>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={handleScroll}
      >
        <div
          className="chat-thread"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label={m.ai.chat.transcriptLabel}
        >
          {!visible.length && !ai.sessionActiveRun && !streaming && !reasoningStreaming
            ? <EmptyChat onPick={(prompt) => ai.setDraft(prompt)} />
            : null}
          {canLoadHistory ? (
            <button
              className="load-history"
              disabled={ai.historyLoading}
              onClick={() => {
                if (hiddenEvents) setHistoryLimit((value) => value + 300);
                else void ai.loadOlderTurns();
              }}
            >
              {ai.historyLoading
                ? m.ai.chat.loadingHistory
                : hiddenEvents
                  ? m.ai.chat.loadMoreEvents(Math.min(300, hiddenEvents))
                  : m.ai.chat.loadOlderTurns}
            </button>
          ) : null}
          <TimelineItems
            key={sessionId}
            items={renderItems}
            liveProcess={{
              runId: activeRunId,
              reasoningText: reasoningStreaming,
              commentaryText: streaming,
              pending: showPendingThought
            }}
          />
          {!activeProcessVisible && reasoningStreaming ? (
            <div className="trace-step reasoning live">
              <span className="trace-step-marker"><BrainCircuit size={13} /></span>
              <ReasoningCard
                text={reasoningStreaming}
                streaming
              />
            </div>
          ) : null}
          {!activeProcessVisible && showPendingThought ? (
            <div className="trace-step reasoning live">
              <span className="trace-step-marker"><BrainCircuit size={13} /></span>
              <ReasoningCard streaming pending />
            </div>
          ) : null}
        </div>
        {/* P1-CHAT-2: compact jump-to-bottom control */}
        {jumpBottomPresence.visible ? (
          <button
            type="button"
            className="jump-bottom"
            data-leaving={jumpBottomPresence.leaving || undefined}
            aria-label={m.ai.chat.jumpToBottom}
            onClick={() => {
              const target = scroller.current;
              if (!target) return;
              followLatest.current = true;
              scrollMemory.current.set(sessionId, {
                top: target.scrollTop,
                near: false,
                follow: true
              });
              target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
            }}
          >
            <ArrowDown size={16} strokeWidth={1.8} aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="chat-bottom-stack">
        <ActiveTodoFloat events={activeTodoEvents} active={Boolean(ai.sessionActiveRun)} />
        <ApprovalBanner />
        <ChatComposer />
      </div>
    </section>
  );
}

const TIMELINE_EXIT_MS = 240;

function timelineItemKey(item: ChatRenderItem): string {
  return item.type === "event" ? `event:${item.event.id}` : item.key;
}

function TimelineItems({ items, liveProcess }: { items: ChatRenderItem[]; liveProcess: LiveProcessState }) {
  const presenceItems = useExitingList(items, timelineItemKey, TIMELINE_EXIT_MS);
  const committedKeys = useRef(new Set(items.map(timelineItemKey)));
  const enteringKeys = new Set(
    presenceItems
      .filter(({ item, leaving }) => !leaving && !committedKeys.current.has(timelineItemKey(item)))
      .map(({ item }) => timelineItemKey(item))
  );

  useLayoutEffect(() => {
    for (const item of items) committedKeys.current.add(timelineItemKey(item));
  }, [items]);

  return presenceItems.map(({ item, leaving }, index) => {
    const key = timelineItemKey(item);
    const live = !leaving && item.type === "process" && item.run.id === liveProcess.runId
      ? liveProcess
      : null;
    // P2-INT-4: 消息流 stagger 进场 30ms 递增
    const staggerDelay = enteringKeys.has(key) ? Math.min(index * 30, 240) : 0;
    return (
      <div
        key={key}
        className="timeline-presence-item"
        data-entering={enteringKeys.has(key) || undefined}
        data-leaving={leaving || undefined}
        aria-hidden={leaving || undefined}
        inert={leaving || undefined}
        style={staggerDelay ? { animationDelay: `${staggerDelay}ms` } : undefined}
      >
        <div className="timeline-presence-inner">
          {item.type === "process"
            ? <CompletedProcess
                run={item.run}
                steps={item.steps}
                completedAt={item.completedAt}
                missingFinal={item.missingFinal}
                liveReasoning={live?.reasoningText || ""}
                liveCommentary={live?.commentaryText || ""}
                pending={Boolean(live?.pending)}
              />
            : item.type === "changes-artifact"
              ? <ChangeReviewCard events={item.events} run={item.run} />
            : item.type === "tool-group"
              ? <ToolGroupView item={item} />
              : item.type === "event"
                ? <EventRow event={item.event} />
                : <TraceStepView step={item.step} run={item.run} />}
        </div>
      </div>
    );
  });
}

function foldProcessSteps(items: TimelineViewItem[], processRuns: Map<string, AiRun>): ChatViewItem[] {
  const result: ChatViewItem[] = [];
  let runItems: TimelineViewItem[] = [];
  let runId: string | null = null;

  const flush = () => {
    if (!runItems.length || !runId) return;
    const run = processRuns.get(runId);
    if (!run) {
      result.push(...runItems);
      runItems = [];
      return;
    }

    const conversation = runItems.filter((item): item is Extract<TimelineViewItem, { type: "event" }> => item.type === "event");
    const prompts = conversation.filter((item) => item.event.kind === "user-message");
    const responses = conversation.filter((item) => item.event.kind === "assistant-message" && assistantPhase(item.event) === "final");
    const finalResponse = run.status === "completed" ? responses.at(-1) : undefined;
    const missingFinal = run.status === "completed" && !finalResponse;
    const steps = runItems
      .filter((item): item is Extract<TimelineViewItem, { type: "step" }> => item.type === "step")
      .map((item) => item.step);
    const changeEvents = steps
      .filter((step): step is Extract<TraceStep, { type: "changes" }> => step.type === "changes")
      .map((step) => step.event);
    const successfulWriteEvents = steps
      .filter((step): step is Extract<TraceStep, { type: "tool" }> => {
        if (step.type !== "tool") return false;
        const first = step.events[0];
        const tool = String(first?.payload.tool || first?.payload.command || first?.payload.skillId || "");
        return toolCategory(tool) === "write"
          && step.events.some((event) => event.kind === "tool-complete")
          && !step.events.some(toolEventFailed)
          && changePaths(run, first ? [first] : []).length > 0;
      })
      .map((step) => step.events[0]);
    const artifactEvents = [...changeEvents, ...successfulWriteEvents];
    const completedAt = run.completedAt || finalResponse?.event.timestamp || null;

    // A provider may emit several assistant messages before and between tool
    // calls. They are process commentary, not user-facing replies. The only
    // reply that may leave the process block is the final message of a run
    // whose lifecycle has actually completed.
    result.push(...prompts);
    result.push({
      type: "process",
      key: `process:${run.id}`,
      run,
      steps,
      completedAt,
      missingFinal
    });
    if (finalResponse) result.push(finalResponse);
    if (artifactEvents.length || run.changeSet?.files.length) {
      result.push({
        type: "changes-artifact",
        key: `changes-artifact:${run.id}`,
        run,
        events: artifactEvents
      });
    }
    runItems = [];
  };

  for (const item of items) {
    const itemRunId = item.type === "event" ? item.event.runId : item.run.id;
    if (runId && itemRunId !== runId) flush();
    runId = itemRunId;
    runItems.push(item);
  }
  flush();
  return result;
}

function groupChatToolItems(items: ChatViewItem[]): ChatRenderItem[] {
  const result: ChatRenderItem[] = [];
  let tools: Extract<TimelineViewItem, { type: "step" }>[] = [];

  const flush = () => {
    if (!tools.length) return;
    result.push({
      type: "tool-group",
      key: `tools:${tools[0].run.id}:${tools[0].step.key}`,
      run: tools[0].run,
      steps: tools.map((item) => item.step as ToolStep)
    });
    tools = [];
  };

  for (const item of items) {
    if (item.type === "step" && isToolStep(item.step)) {
      if (tools.length && tools[0].run.id !== item.run.id) flush();
      tools.push(item);
      continue;
    }
    flush();
    result.push(item);
  }
  flush();
  return result;
}

function hasOpenTool(events: AiEvent[], runId: string | null): boolean {
  if (!runId) return false;
  const open = new Set<string>();
  for (const event of events.filter((item) => item.runId === runId)) {
    if (event.kind === "tool-start") open.add(toolEventKey(event));
    if (event.kind === "tool-complete") open.delete(toolEventKey(event));
  }
  return open.size > 0;
}

function toolEventKey(event: AiEvent): string {
  const payload = event.payload;
  return String(payload.itemId || payload.toolUseId || payload.tool_use_id || payload.id || payload.callId || event.id);
}

function EmptyChat({ onPick }: { onPick?: (prompt: string) => void }) {
  const ai = useAi();
  const prompts = m.ai.chat.emptyPrompts;
  const projectName = ai.snapshot.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) || ai.snapshot.projectRoot;
  return (
    <div className="chat-empty">
      <div className="chat-project-context" title={ai.snapshot.projectRoot}>
        <FolderCode size={14} aria-hidden />
        <span>{m.ai.chat.currentProject}</span>
        <b>{projectName}</b>
      </div>
      <div className="chat-empty-icon"><Bot size={22} aria-hidden /></div>
      <h3>{m.ai.chat.emptyTitle}</h3>
      <p>{m.ai.chat.emptyBody}</p>
      {/* P1-CHAT-1: 与资料、简报、创作和自动化对应的快捷任务 */}
      <div className="chat-empty-prompts">
        {prompts.map((prompt) => (
          <button
            key={prompt.title}
            type="button"
            className="chat-empty-prompt"
            onClick={() => onPick?.(prompt.prompt)}
          >
            <strong>{prompt.title}</strong>
            <span>{prompt.body}</span>
          </button>
        ))}
      </div>
      <p className="chat-empty-hint">{m.ai.chat.emptyHint}</p>
    </div>
  );
}

function CompletedProcess({
  run,
  steps,
  completedAt,
  missingFinal,
  liveReasoning = "",
  liveCommentary = "",
  pending = false
}: {
  run: AiRun;
  steps: TraceStep[];
  completedAt: string | null;
  missingFinal: boolean;
  liveReasoning?: string;
  liveCommentary?: string;
  pending?: boolean;
}) {
  const processing = ["queued", "running", "waiting-approval", "applying"].includes(run.status);
  const [open, setOpen] = useState(processing || missingFinal);
  const [liveNow, setLiveNow] = useState(Date.now());
  useEffect(() => {
    setOpen(processing || missingFinal);
  }, [missingFinal, processing]);
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => setLiveNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [processing]);
  const duration = processDuration(
    run.startedAt,
    run.completedAt || completedAt || (processing ? new Date(liveNow).toISOString() : null)
  );
  const label = runProcessLabel(run, processing, missingFinal);
  return (
    <AnimatedDisclosure
      className={`completed-process${processing ? " processing" : ""}${missingFinal ? " protocol-error" : ""}`}
      open={open}
      onOpenChange={setOpen}
      triggerAriaLabel={label}
      summary={
        <>
          <span className="completed-process-title">
            <strong>{label}</strong>
            <small>{duration}</small>
          </span>
          <ChevronRight className="completed-process-chevron" size={15} />
        </>
      }
    >
      <div className="completed-process-body">
        {missingFinal ? (
          <div className="process-protocol-error" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{m.ai.chat.finalMissingDetail}</span>
          </div>
        ) : null}
        <TraceStepList
          steps={steps}
          run={run}
          processing={processing}
          liveCurrent={Boolean(liveReasoning || liveCommentary || pending)}
        />
        {liveCommentary ? <ProcessNarrative text={liveCommentary} streaming /> : null}
        {liveReasoning ? (
          <div className="trace-step reasoning live">
            <ReasoningCard text={liveReasoning} streaming />
          </div>
        ) : pending ? (
          <div className="trace-step reasoning live">
            <ReasoningCard streaming pending />
          </div>
        ) : null}
      </div>
    </AnimatedDisclosure>
  );
}

function runProcessLabel(run: AiRun, processing: boolean, missingFinal: boolean): string {
  if (processing) return m.ai.chat.processing;
  if (missingFinal) return m.ai.chat.finalMissing;
  if (run.status === "failed") return m.ai.status.failed;
  if (run.status === "cancelled") return m.ai.status.cancelled;
  if (run.status === "conflicted") return m.ai.status.run.conflicted;
  return m.ai.chat.processed;
}

type TraceCycle = { key: string; steps: TraceStep[] };

function TraceStepList({
  steps,
  run,
  processing,
  liveCurrent
}: {
  steps: TraceStep[];
  run: AiRun;
  processing: boolean;
  liveCurrent: boolean;
}) {
  if (!processing) return <TraceStepBlocks steps={steps} run={run} />;

  const cycles = groupTraceCycles(steps);
  const activeCycleIndex = liveCurrent
    ? -1
    : findLastIndex(cycles, (cycle) => cycle.steps.some(traceStepActive));
  const fallbackActiveIndex = activeCycleIndex < 0 && run.status === "applying" && !liveCurrent
    ? cycles.length - 1
    : activeCycleIndex;

  return cycles.map((cycle, index) => {
    const current = index === fallbackActiveIndex;
    return (
      <div
        className={`trace-cycle ${current ? "current" : "completed"}`}
        data-trace-cycle={current ? "current" : "completed"}
        key={cycle.key}
      >
        <TraceStepBlocks steps={cycle.steps} run={run} />
      </div>
    );
  });
}

function TraceStepBlocks({ steps, run }: { steps: TraceStep[]; run: AiRun }) {
  const blocks: Array<{ type: "step"; step: TraceStep } | { type: "tool-group"; key: string; steps: ToolStep[] }> = [];
  let tools: ToolStep[] = [];
  const flush = () => {
    if (!tools.length) return;
    blocks.push({ type: "tool-group", key: `tools:${run.id}:${tools[0].key}`, steps: tools });
    tools = [];
  };
  for (const step of steps) {
    if (isToolStep(step)) {
      tools.push(step);
      continue;
    }
    flush();
    blocks.push({ type: "step", step });
  }
  flush();
  return blocks.map((block) => block.type === "tool-group"
    ? <ToolGroupView key={block.key} item={{ type: "tool-group", key: block.key, run, steps: block.steps }} />
    : <TraceStepView key={block.step.key} step={block.step} run={run} folded />);
}

function groupTraceCycles(steps: TraceStep[]): TraceCycle[] {
  const cycles: TraceCycle[] = [];
  for (const step of steps) {
    if (!cycles.length || step.type === "reasoning" || step.type === "commentary") {
      cycles.push({ key: step.key, steps: [step] });
    } else {
      cycles.at(-1)?.steps.push(step);
    }
  }
  return cycles;
}

function traceStepActive(step: TraceStep): boolean {
  if (step.type === "tool") return !step.events.some((event) => event.kind === "tool-complete");
  if (step.type === "approval") return !step.events.some((event) => event.kind === "approval-decision");
  return false;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

function ToolGroupView({ item }: { item: ToolGroupItem }) {
  const firstStep = item.steps[0];
  const tool = String(firstStep?.events[0]?.payload.tool || firstStep?.events[0]?.payload.command || firstStep?.events[0]?.payload.skillId || m.ai.tool.fallbackName);
  const single = item.steps.length === 1;
  return (
    <div className={`trace-step tool tool-group-step${single ? ` ${toolCategory(tool)}` : ""}`}>
      {single ? <span className="trace-step-marker">{toolIcon(tool, false, false)}</span> : null}
      <CommandGroup calls={item.steps.map((step) => ({ key: step.key, events: step.events }))} runStatus={item.run.status} standaloneWhenSingle />
    </div>
  );
}

function isToolStep(step: TraceStep): step is ToolStep {
  return step.type === "tool";
}

function processDuration(startedAt: string, completedAt?: string | null): string {
  const started = new Date(startedAt).getTime();
  const completed = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return "";
  const totalSeconds = Math.max(0, Math.floor((completed - started) / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function ProcessNarrative({ text, streaming = false }: { text: string; streaming?: boolean }) {
  if (!text.trim()) return null;
  return (
    <div className="process-narrative-block" aria-live={streaming ? "polite" : undefined}>
      <ChatMarkdown text={text} streaming={streaming} className="process-narrative" />
    </div>
  );
}

function commentaryText(events: AiEvent[]): string {
  let text = "";
  for (const event of events) {
    const fragment = String(event.payload.text || event.payload.delta || "");
    if (!fragment) continue;
    if (event.kind === "assistant-delta") text += fragment;
    else text += `${text ? "\n\n" : ""}${fragment}`;
  }
  return text.trim();
}

function TraceStepView({ step, run, folded = false }: { step: TraceStep; run: AiRun; folded?: boolean }) {
  if (step.type === "commentary") {
    return <ProcessNarrative text={commentaryText(step.events)} />;
  }
  if (step.type === "work") {
    return <WorkStateCard planEvents={step.planEvents} todoEvents={step.todoEvents} />;
  }
  if (step.type === "subtask") return <SubtaskTrace events={step.events} />;
  if (step.type === "technical") return <ProcessSystemEvent event={step.event} />;
  if (step.type === "reasoning") {
    if (folded) {
      const text = step.events.map((event) => String(event.payload.text || "")).join("").trim();
      if (!text) return null;
      return <ReasoningCard events={step.events} />;
    }
    return (
      <div className="trace-step reasoning">
        <span className="trace-step-marker"><BrainCircuit size={13} /></span>
        <ReasoningCard events={step.events} />
      </div>
    );
  }
  if (step.type === "tool") {
    const tool = String(step.events[0]?.payload.tool || step.events[0]?.payload.command || step.events[0]?.payload.skillId || m.ai.tool.fallbackName);
    return (
      <div className={`trace-step tool ${toolCategory(tool)}`}>
        <span className="trace-step-marker">{toolIcon(tool, false, false)}</span>
        <ToolCallCard events={step.events} runStatus={run.status} />
      </div>
    );
  }
  if (step.type === "approval") {
    const decision = step.events.find((event) => event.kind === "approval-decision");
    if (!decision) {
      const request = step.events.find((event) => event.kind === "approval-request");
      if (!request) return null;
      return (
        <div className="trace-step approval pending">
          <span className="trace-step-marker"><ShieldAlert size={13} /></span>
          <div className="process-system-event approval-pending" role="status">
            <span aria-hidden="true"><ShieldAlert size={14} /></span>
            <p>{m.ai.approval.required}：{approvalRequestSubject(request)}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="trace-step approval">
        <span className="trace-step-marker"><ShieldAlert size={13} /></span>
        <ApprovalDecisionEvent event={decision} />
      </div>
    );
  }
  if (step.type === "changes") {
    return (
      <div className="trace-step changes">
        <span className="trace-step-marker"><FileText size={13} /></span>
        <ChangeTraceCard event={step.event} run={run} />
      </div>
    );
  }
  if (step.type === "error") {
    return (
      <div className="trace-step error">
        <span className="trace-step-marker"><AlertTriangle size={13} /></span>
        <ErrorEvent event={step.event} />
      </div>
    );
  }
  return (
    <div className="trace-step risk">
      <span className="trace-step-marker"><ShieldAlert size={13} /></span>
      <SystemEvent danger icon={<ShieldAlert size={14} />} text={String(step.event.payload.text || m.ai.risk.detected)} />
    </div>
  );
}

function approvalRequestSubject(event: AiEvent): string {
  const approval = event.payload.approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) return m.ai.approval.pending;
  const record = approval as Record<string, unknown>;
  const paths = Array.isArray(record.paths) ? record.paths : [];
  return String(record.command || paths[0] || record.title || record.detail || m.ai.approval.pending);
}

function EventRow({ event }: { event: AiEvent }) {
  if (event.kind === "user-message") return <UserMessage event={event} />;
  if (event.kind === "assistant-message") {
    if (assistantPhase(event) !== "final") return <ProcessNarrative text={String(event.payload.text || "")} />;
    return <AssistantMessage text={String(event.payload.text || "")} event={event} />;
  }
  if (event.kind === "assistant-delta") return <ProcessNarrative text={String(event.payload.text || event.payload.delta || "")} />;
  if (event.kind === "approval-request") return <ProcessSystemEvent event={event} />;
  if (event.kind === "approval-decision") return <ApprovalDecisionEvent event={event} />;
  if (event.kind === "error") return <ErrorEvent event={event} />;
  if (event.kind === "risk") return <SystemEvent danger icon={<ShieldAlert size={14} />} text={String(event.payload.text || m.ai.risk.detected)} />;
  if (event.kind === "reasoning-summary") {
    return <ReasoningCard events={[event]} />;
  }
  if (event.kind === "plan") return <WorkStateCard planEvents={[event]} todoEvents={[]} />;
  if (event.kind === "todo") return <WorkStateCard planEvents={[]} todoEvents={[event]} />;
  if (event.kind === "system") return <ProcessSystemEvent event={event} />;
  if (event.kind === "tool-start" || event.kind === "tool-complete") return <ToolCallCard events={[event]} />;
  if (event.kind === "changes") return <SystemEvent icon={<FileText size={14} />} text={technicalEventText(event)} />;
  return null;
}
