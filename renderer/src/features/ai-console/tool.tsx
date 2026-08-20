import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, CircleStop, FileText, LoaderCircle, ShieldAlert, SquareTerminal, Terminal } from "lucide-react";
import type { AiEvent, RunStatus } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { formatDuration } from "../../ai-utils";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { OverflowBox } from "../../design-system/OverflowBox";
import { localFileReference, useFilePreview } from "./file-preview-context";
import {
  asRecord,
  firstLine,
  scalar,
  toolCategory,
  toolCategoryLabel,
  toolEventFailed,
  toolOperationSummary,
  toolValueText
} from "./timeline";

const OUTPUT_CHUNK_SIZE = 8_000;

const t = m.ai.tool;
const s = m.ai.status;
type TerminalLine = { kind: "command" | "meta" | "stdout" | "stderr" | "result"; text: string };

export type CommandCall = { key: string; events: AiEvent[] };

export function CommandGroup({
  calls,
  runStatus,
  standaloneWhenSingle = false
}: {
  calls: CommandCall[];
  runStatus?: RunStatus;
  standaloneWhenSingle?: boolean;
}) {
  const callStates = calls.map((call) => ({ call, state: toolCallState(call.events, runStatus) }));
  const commandsOnly = calls.every((call) => {
    const first = call.events[0];
    const tool = String(first?.payload.tool || first?.payload.command || first?.payload.skillId || "");
    return toolCategory(tool) === "command";
  });
  const failedCalls = callStates.filter(({ state }) => state === "failed" || state === "conflicted");
  const cancelledCalls = callStates.filter(({ state }) => state === "cancelled");
  const incompleteCalls = callStates.filter(({ state }) => state === "incomplete");
  const groupState = commandGroupState(callStates.map(({ state }) => state));
  const [open, setOpen] = useState(true);
  // P1-PRC-3: 改手风琴为多开——用 Set 跟踪展开的卡片,允许同时对比多个命令输出。
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  const setCallOpen = (key: string, nextOpen: boolean) => setExpandedKeys((current) => {
    const next = new Set(current);
    if (nextOpen) next.add(key); else next.delete(key);
    return next;
  });
  const setGroupOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setExpandedKeys(new Set());
  };

  if (standaloneWhenSingle && calls.length === 1) {
    const call = calls[0];
    return (
      <ToolCallCard
        events={call.events}
        runStatus={runStatus}
        open={expandedKeys.has(call.key)}
        onOpenChange={(nextOpen) => setCallOpen(call.key, nextOpen)}
      />
    );
  }

  const label = toolGroupLabel(groupState, calls.length, commandsOnly);
  const failureLabel = failedCalls.length ? (commandsOnly ? t.commandGroupFailed(failedCalls.length) : t.toolGroupFailed(failedCalls.length)) : "";
  const cancelledLabel = cancelledCalls.length ? (commandsOnly ? t.commandGroupCancelledCount(cancelledCalls.length) : t.toolGroupCancelledCount(cancelledCalls.length)) : "";
  const incompleteLabel = incompleteCalls.length ? (commandsOnly ? t.commandGroupIncompleteCount(incompleteCalls.length) : t.toolGroupIncompleteCount(incompleteCalls.length)) : "";
  const accessibleLabel = [label, failureLabel, cancelledLabel, incompleteLabel].filter(Boolean).join(", ");
  const groupClass = groupState === "incomplete"
    ? "failed incomplete"
    : groupState === "conflicted" ? "failed conflicted" : groupState;
  return (
    <AnimatedDisclosure
      className={`command-group ${commandsOnly ? "commands" : "tools"} ${groupClass}`}
      open={open}
      onOpenChange={setGroupOpen}
      triggerAriaLabel={accessibleLabel}
      summary={
        <>
          <span className="command-group-icon" aria-hidden="true"><SquareTerminal size={15} /></span>
          <strong>{label}</strong>
          {failureLabel ? <em>{failureLabel}</em> : null}
          {cancelledLabel ? <em>{cancelledLabel}</em> : null}
          {incompleteLabel ? <em>{incompleteLabel}</em> : null}
          <ChevronRight className="command-group-chevron" size={14} />
        </>
      }
    >
      <div
        className="command-group-list"
        role={calls.length > 8 ? "region" : undefined}
        aria-label={calls.length > 8 ? accessibleLabel : undefined}
        tabIndex={calls.length > 8 ? 0 : undefined}
      >
        {calls.map((call) => (
          <ToolCallCard
            key={call.key}
            events={call.events}
            runStatus={runStatus}
            grouped
            open={expandedKeys.has(call.key)}
            onOpenChange={(nextOpen) => setCallOpen(call.key, nextOpen)}
          />
        ))}
      </div>
    </AnimatedDisclosure>
  );
}

export function ToolCallCard({
  events,
  runStatus,
  grouped = false,
  open,
  onOpenChange
}: {
  events: AiEvent[];
  runStatus?: RunStatus;
  grouped?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const first = events[0];
  const last = events.at(-1) || first;
  const tool = String(first.payload.tool || first.payload.command || first.payload.skillId || t.call);
  const failedEvent = events.find(toolEventFailed);
  const callState = toolCallState(events, runStatus);
  const failed = callState === "failed" || callState === "conflicted";
  const conflicted = callState === "conflicted";
  const cancelled = callState === "cancelled";
  const incomplete = callState === "incomplete";
  const running = callState === "running";
  const input = first.payload.input || first.payload.command || first.payload;
  const outputs = events.filter((event) => event.kind === "tool-output" || event.kind === "tool-complete");
  const failureText = failedEvent
    ? toolValueText(failedEvent.payload.error || failedEvent.payload.message || failedEvent.payload.output || failedEvent.payload)
    : "";
  const operation = toolOperationSummary(tool, input);
  const category = toolCategory(tool);
  const actionLabel = conflicted ? s.run.conflicted : failed ? t.runFailed : cancelled ? s.cancelled : incomplete ? t.incomplete : running ? t.running : t.ran;
  const liveNow = useLiveNow(running);
  const elapsed = formatDuration(first.timestamp, running ? new Date(liveNow).toISOString() : last.timestamp);
  const summaryLabel = category === "command" ? operation : tool;
  const titleOperation = toolTitleOperation(category, operation, tool);
  const inlineOperation = category === "command" ? "" : titleOperation && titleOperation !== tool ? titleOperation : "";
  const displayActionLabel = category === "command"
    ? conflicted ? s.run.conflicted : failed ? t.commandFailed : cancelled ? t.commandCancelled : incomplete ? t.commandIncomplete : running ? t.running : t.ran
    : actionLabel;
  const controlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  useEffect(() => {
    if (!controlled && !running) setInternalOpen(false);
  }, [controlled, running]);
  const disclosureOpen = controlled ? Boolean(open) : internalOpen;
  const groupedSummary = category === "command"
    ? operation
    : [tool, titleOperation].filter(Boolean).join(" \u00b7 ");
  const groupedAriaSummary = category === "command"
    ? operation
    : [tool, operation].filter(Boolean).join(" \u00b7 ");
  const setDisclosureOpen = (nextOpen: boolean) => {
    if (controlled) onOpenChange?.(nextOpen);
    else setInternalOpen(nextOpen);
  };

  return (
    <AnimatedDisclosure
      className={`tool-event ${category} ${grouped ? "grouped-command" : ""} ${failed ? "failed" : cancelled ? "cancelled" : incomplete ? "failed incomplete" : running ? "running" : "completed"}`}
      open={disclosureOpen}
      onOpenChange={setDisclosureOpen}
      triggerAriaLabel={`${displayActionLabel} ${grouped ? groupedAriaSummary : summaryLabel}`}
      summary={
        <>
          <span className="tool-event-icon" aria-hidden="true">{toolIcon(tool, running, failed || incomplete, cancelled)}</span>
          <span className="tool-event-title">
            {grouped ? (
              <span><strong>{displayActionLabel}</strong><small title={groupedSummary}>{groupedSummary}</small></span>
            ) : (
              <span>
                <strong>{displayActionLabel}</strong>
                <small title={summaryLabel}>{summaryLabel}</small>
                {inlineOperation ? <code title={inlineOperation}>{inlineOperation}</code> : null}
                <i>{toolCategoryLabel(category)}</i>
              </span>
            )}
            {failed && failureText && category !== "command" ? <em title={firstLine(failureText)}>{firstLine(failureText)}</em> : null}
          </span>
          <span className="tool-event-meta">{category === "command" || !running ? <small>{elapsed}</small> : null}<ChevronRight size={14} /></span>
        </>
      }
    >
      <div className="tool-event-body">
        <ToolResultTerminal
          tool={tool}
          category={category}
          input={input}
          operation={operation}
          outputs={outputs}
          events={events}
          failed={failed}
          running={running}
          failureText={failureText}
        />
      </div>
    </AnimatedDisclosure>
  );
}

function useLiveNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

export function toolIcon(_tool: string, running: boolean, failed: boolean, cancelled = false): ReactNode {
  if (running) return <LoaderCircle className="spin" size={15} />;
  if (failed) return <ShieldAlert size={15} />;
  if (cancelled) return <CircleStop size={15} />;
  return <Terminal size={15} />;
}

function ChunkedText({ lines }: { lines: TerminalLine[] }) {
  const [limit, setLimit] = useState(OUTPUT_CHUNK_SIZE);
  const total = terminalTextLength(lines);
  const visibleLines = limitTerminalLines(lines, limit);
  const visibleCount = Math.min(limit, total);
  const hasMore = visibleCount < total;
  const longOutput = total > 50_000;
  return (
    <>
      <OverflowBox
        className="command-terminal-overflow"
        maxHeight={360}
        expandAllLabel={hasMore ? t.expandAllOutput : undefined}
        onExpandAll={hasMore ? () => setLimit(total) : undefined}
      >
        <pre className="command-terminal-output">
          {visibleLines.map((line, index) => (
            <span className={`terminal-line ${line.kind}`} data-line={index} key={`${line.kind}-${index}`}>{line.text || " "}</span>
          ))}
        </pre>
      </OverflowBox>
      {hasMore ? (
        <div className="tool-output-actions">
          <button data-motion="action" className="tool-load-more" onClick={() => setLimit((value) => value + OUTPUT_CHUNK_SIZE)}>
            {t.loadMoreOutputProgress(visibleCount, total)}
          </button>
        </div>
      ) : null}
      {longOutput ? (
        <p className="tool-output-hint">{m.ai.overflow.longOutputHint}</p>
      ) : null}
    </>
  );
}

function ToolResultTerminal({
  tool,
  category,
  input,
  operation,
  outputs,
  events,
  failed,
  running,
  failureText
}: {
  tool: string;
  category: ReturnType<typeof toolCategory>;
  input: unknown;
  operation: string;
  outputs: AiEvent[];
  events: AiEvent[];
  failed: boolean;
  running: boolean;
  failureText: string;
}) {
  const inputRecord = asRecord(input);
  const outputRecords = outputs.map((event) => asRecord(event.payload.output || event.payload));
  const command = commandText(tool, input);
  const streams = collectStreams(outputs);
  const exitCode = firstScalar([
    ...outputRecords.map((record) => record.exitCode || record.exit_code || record.code || asRecord(record.item).exitCode || asRecord(record.item).exit_code),
    ...events.map((event) => event.payload.exitCode || event.payload.exit_code || event.payload.code)
  ]);
  const cwd = scalar(inputRecord.cwd || inputRecord.path);
  const invocation = category === "command"
    ? command || t.viewCommandDetail
    : [tool, operation].filter(Boolean).join(" ");
  const lines: TerminalLine[] = [];
  const result = category === "command" ? "" : finalToolResult(outputs, running, failed, failureText);
  if (category === "read") {
    return <ReadFileSummary path={readFilePath(input, outputRecords)} failed={failed} failureText={failureText} />;
  }
  if (category === "command") lines.push({ kind: "command", text: `$ ${invocation}` });
  if (category === "command" && cwd) lines.push({ kind: "meta", text: `# cwd: ${cwd}` });
  if (category === "command") {
    lines.push(...terminalLines(streams.stdout, "stdout"));
    lines.push(...terminalLines(streams.stderr, "stderr"));
  } else if (result) {
    lines.push(...terminalLines(result, failed ? "stderr" : "result"));
  }
  const lineText = lines.map((line) => line.text).join("\n");
  if (failed && failureText && !lineText.includes(failureText)) lines.push(...terminalLines(failureText, "stderr"));
  const displayLines = trimTrailingEmptyTerminalLines(lines);
  if (!displayLines.length) return null;
  const exitStatus = exitCode && exitCode !== "0" ? "failed" : "success";
  return (
    <section className="command-terminal">
      {exitCode ? <small className={`terminal-exit-badge ${exitStatus}`} aria-label={`${t.exitCode} ${exitCode}`}>exit {exitCode}</small> : null}
      <ChunkedText lines={displayLines} />
    </section>
  );
}

function ReadFileSummary({ path, failed, failureText }: { path: string; failed: boolean; failureText: string }) {
  const openPreview = useFilePreview();
  const previewPath = localFileReference(path) || path;
  const name = fileName(previewPath);
  if (!previewPath && !failureText) return null;
  if (!previewPath) {
    return (
      <section className="read-file-summary failed">
        <ShieldAlert size={14} />
        <span>{firstLine(failureText)}</span>
      </section>
    );
  }
  return (
    <section className={`read-file-summary${failed ? " failed" : ""}`}>
      <button
        data-motion="icon"
        type="button"
        className="read-file-link"
        title={previewPath}
        onClick={() => {
          if (openPreview) openPreview(previewPath);
          else void window.openmind.openPath(previewPath);
        }}
      >
        <FileText size={14} />
        <span>{t.readFile(name)}</span>
      </button>
      {failed && failureText ? <small>{firstLine(failureText)}</small> : null}
    </section>
  );
}

function toolTitleOperation(category: ReturnType<typeof toolCategory>, operation: string, tool: string): string {
  if (!operation || operation === tool) return "";
  if (category === "read") return fileName(localFileReference(operation) || operation);
  return operation;
}

function finalToolResult(outputs: AiEvent[], running: boolean, failed: boolean, failureText: string): string {
  const lastOutput = [...outputs].reverse().find((event) => event.kind === "tool-complete") || outputs.at(-1);
  const result = lastOutput
    ? toolValueText(lastOutput.payload.output || lastOutput.payload.text || lastOutput.payload.message || lastOutput.payload)
    : "";
  if (failed && failureText && result && !result.includes(failureText)) return `${result}\n${failureText}`;
  if (failed && failureText) return failureText;
  if (result) return result;
  return running ? s.running : "";
}

function readFilePath(input: unknown, outputRecords: Record<string, unknown>[]): string {
  const inputRecord = asRecord(input);
  const path = scalar(inputRecord.file_path || inputRecord.filePath || inputRecord.path);
  if (path) return path;
  for (const record of outputRecords) {
    const value = scalar(record.file_path || record.filePath || record.path || asRecord(record.item).path);
    if (value) return value;
  }
  return "";
}

function fileName(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

function commandText(tool: string, input: unknown): string {
  if (typeof input === "string") return input;
  const record = asRecord(input);
  return scalar(record.command || record.cmd || record.script || record.executable)
    || firstLine(toolOperationSummary(tool, input));
}

function collectStreams(outputs: AiEvent[]): { stdout: string; stderr: string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  for (const event of outputs) {
    const payload = asRecord(event.payload);
    const output = asRecord(payload.output);
    const item = asRecord(output.item || payload.item);
    const values = [payload, output, item];
    for (const record of values) {
      const out = scalar(record.stdout || record.output || record.text);
      const err = scalar(record.stderr || record.error);
      if (out) stdout.push(out);
      if (err) stderr.push(err);
    }
  }
  return { stdout: [...new Set(stdout)].join("\n"), stderr: [...new Set(stderr)].join("\n") };
}

function firstScalar(values: unknown[]): string {
  return values.map(scalar).find(Boolean) || "";
}

function terminalLines(text: string, kind: TerminalLine["kind"]): TerminalLine[] {
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => ({ kind, text: line }));
}

function trimTrailingEmptyTerminalLines(lines: TerminalLine[]): TerminalLine[] {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].text.trim()) end -= 1;
  return lines.slice(0, end);
}

function terminalTextLength(lines: TerminalLine[]): number {
  return lines.reduce((total, line, index) => total + line.text.length + (index < lines.length - 1 ? 1 : 0), 0);
}

function limitTerminalLines(lines: TerminalLine[], limit: number): TerminalLine[] {
  const result: TerminalLine[] = [];
  let remaining = limit;
  for (const [index, line] of lines.entries()) {
    if (remaining <= 0) break;
    const separator = index < lines.length - 1 ? 1 : 0;
    if (line.text.length + separator <= remaining) {
      result.push(line);
      remaining -= line.text.length + separator;
      continue;
    }
    const text = line.text.slice(0, remaining);
    if (text) result.push({ ...line, text });
    break;
  }
  return result;
}

function toolEventCancelled(event: AiEvent): boolean {
  const output = asRecord(event.payload.output);
  const state = scalar(event.payload.status || event.payload.state || output.status || output.state).toLocaleLowerCase();
  return state === "cancelled" || state === "canceled";
}

type ToolCallState = "running" | "completed" | "failed" | "cancelled" | "conflicted" | "incomplete";

function toolCallState(events: AiEvent[], runStatus?: RunStatus): ToolCallState {
  if (events.some(toolEventFailed)) return "failed";
  if (events.some(toolEventCancelled)) return "cancelled";
  if (events.some((event) => event.kind === "tool-complete")) return "completed";
  if (runStatus === "cancelled") return "cancelled";
  if (runStatus === "failed") return "failed";
  if (runStatus === "conflicted") return "conflicted";
  if (runStatus === "completed") return "incomplete";
  return "running";
}

function commandGroupState(states: ToolCallState[]): ToolCallState {
  if (states.includes("running")) return "running";
  if (states.includes("conflicted")) return "conflicted";
  if (states.includes("failed")) return "failed";
  if (states.includes("cancelled")) return "cancelled";
  if (states.includes("incomplete")) return "incomplete";
  return "completed";
}

function toolGroupLabel(state: ToolCallState, count: number, commandsOnly: boolean): string {
  if (commandsOnly) {
    if (state === "running") return t.commandGroupRunning(count);
    if (state === "conflicted") return t.commandGroupConflicted(count);
    if (state === "failed") return t.commandGroupFailedTitle(count);
    if (state === "cancelled") return t.commandGroupCancelled(count);
    if (state === "incomplete") return t.commandGroupIncomplete(count);
    return t.commandGroupRan(count);
  }
  if (state === "running") return t.toolGroupRunning(count);
  if (state === "conflicted") return t.toolGroupConflicted(count);
  if (state === "failed") return t.toolGroupFailedTitle(count);
  if (state === "cancelled") return t.toolGroupCancelled(count);
  if (state === "incomplete") return t.toolGroupIncomplete(count);
  return t.toolGroupRan(count);
}
