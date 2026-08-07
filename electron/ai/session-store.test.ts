import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionStore } from "./session-store";
import { scanRisks } from "./risk-scanner";

const roots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-ai-store-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SessionStore", () => {
  it("stateRoot 存在时把会话状态写入 app-private root,不污染 workspace", () => {
    const workspace = createRoot();
    const stateRoot = createRoot();
    const store = new SessionStore(workspace, stateRoot);

    store.initialize();
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: workspace, title: "隔离状态", permissionProfile: "edit" });

    expect(store.root).toBe(path.join(stateRoot, ".cctools", "ai"));
    expect(fs.existsSync(path.join(store.root, "sessions", session.id, "session.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, ".cctools"))).toBe(false);
  });

  it("keeps session order anchored to creation when archiving or replying", () => {
    const store = new SessionStore(createRoot());
    let older = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "较早会话", permissionProfile: "edit" });
    let newer = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "较新会话", permissionProfile: "edit" });
    older = store.updateSession(older.id, { createdAt: "2026-01-01T00:00:00.000Z" });
    newer = store.updateSession(newer.id, { createdAt: "2026-01-02T00:00:00.000Z" });

    store.updateSession(older.id, { archived: true });
    store.createRun(older, "继续回复较早会话", []);

    expect(store.listSessions().map((item) => item.id)).toEqual([newer.id, older.id]);
  });

  it("persists sessions only when explicitly created and records semantic events", async () => {
    const root = createRoot();
    const store = new SessionStore(root);
    store.initialize();
    expect(store.listSessions()).toEqual([]);
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "真实任务", permissionProfile: "edit" });
    const run = store.createRun(session, "完成任务", []);
    expect(run.providerId).toBe("codex-native");
    expect(run.permissionProfile).toBe("edit");
    expect(run.turnContext).toBeNull();
    await store.appendEvent(run, "user-message", { text: "完成任务" });
    await store.appendEvent(run, "assistant-message", { text: "已完成" });
    expect(store.listSessions()).toHaveLength(1);
    expect(store.readEvents(session.id).map((event) => event.kind)).toEqual(["user-message", "assistant-message"]);
    expect(store.search("已完成")[0]?.id).toBe(session.id);
  });

  it("skips malformed rollout records and reports parse errors without rewriting history", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "恢复", permissionProfile: "read-only" });
    const run = store.createRun(session, "读取", []);
    await store.appendEvent(run, "user-message", { text: "保留我" });
    const rolloutFile = path.join(store.root, "sessions", session.id, "rollout.jsonl");
    store.readEvents(session.id);
    fs.appendFileSync(rolloutFile, "{\"broken\":");
    expect(store.readEvents(session.id)).toHaveLength(1);
    expect(store.listTurns(session.id).parseErrors).toBe(1);
    expect(fs.readFileSync(rolloutFile, "utf8")).toContain("{\"broken\":");
  });

  it("chunks large event payloads", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "大输出", permissionProfile: "edit" });
    const run = store.createRun(session, "输出", []);
    const events = await store.appendEvent(run, "tool-output", { text: "x".repeat(600_000) });
    expect(events.length).toBeGreaterThan(1);
    expect(events.every((event) => event.payload.chunk)).toBe(true);
    const restored = store.readEvents(session.id);
    expect(restored).toHaveLength(1);
    expect(restored[0].payload.text).toBe("x".repeat(600_000));
  });

  it("persists one canonical append-only rollout with explicit turn boundaries", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Rollout", permissionProfile: "edit" });
    let run = store.createRun(session, "hello", []);
    await store.beginTurn(run);
    run = store.updateRun(run.id, {
      status: "running",
      turnContext: {
        cwd: store.projectRoot,
        currentDate: "2026-07-01",
        timezone: "Asia/Shanghai",
        capturedAt: "2026-07-01T00:00:00.000Z"
      }
    });
    await store.appendTurnContext(run);
    await store.appendEvent(run, "assistant-message", { text: "hi" });
    run = store.updateRun(run.id, {
      status: "completed",
      completedAt: "2026-07-01T00:00:01.000Z"
    });
    await store.completeTurn(run);

    const rolloutFile = path.join(store.root, "sessions", session.id, "rollout.jsonl");
    const lines = fs.readFileSync(rolloutFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));

    expect(lines.map((line) => line.type)).toEqual([
      "session_meta",
      "event_msg",
      "response_item",
      "event_msg",
      "turn_context",
      "world_state",
      "response_item",
      "event_msg",
      "event_msg"
    ]);
    expect(lines.filter((line) => line.type === "event_msg").map((line) => line.payload.type)).toEqual([
      "turn_started",
      "user_message",
      "agent_message",
      "turn_complete"
    ]);
    expect(store.listTurns(session.id).data[0]).toMatchObject({
      id: run.id,
      status: "completed",
      events: [{ kind: "user-message" }, { kind: "assistant-message" }]
    });
  });

  it("stores the raw user message separately from model-visible composed input", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "Input", permissionProfile: "edit" });
    const run = store.createRun(session, "summarize", []);

    await store.beginTurn(run, "summarize\n<context>attached material</context>");

    const turn = store.listTurns(session.id).data[0];
    expect(turn.events[0].payload.text).toBe("summarize");
    expect(turn.events[0].payload.modelInput).toContain("attached material");
    expect(store.getContextState(session.id).history[0].content).toContain("attached material");
  });

  it("migrates legacy per-run event files once while preserving the originals", () => {
    const root = createRoot();
    const store = new SessionStore(root);
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "Legacy", permissionProfile: "edit" });
    let run = store.createRun(session, "old prompt", []);
    run = store.updateRun(run.id, { status: "completed", completedAt: "2026-07-01T00:00:02.000Z" });
    const legacyFile = path.join(store.root, "sessions", session.id, "runs", run.id, "events.jsonl");
    const legacyEvents = [
      legacyEvent(run, "legacy-user", "user-message", { text: "old prompt" }, 1),
      legacyEvent(run, "legacy-answer", "assistant-message", { text: "old answer" }, 2)
    ];
    fs.writeFileSync(legacyFile, `${legacyEvents.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
    fs.rmSync(path.join(store.root, "sessions", session.id, "rollout.jsonl"));

    const migrated = new SessionStore(root);

    expect(migrated.readEvents(session.id).map((event) => event.id)).toEqual(["legacy-user", "legacy-answer"]);
    expect(fs.existsSync(legacyFile)).toBe(true);
    const rolloutFile = path.join(store.root, "sessions", session.id, "rollout.jsonl");
    const firstMigration = fs.readFileSync(rolloutFile, "utf8");
    expect(JSON.parse(firstMigration.split("\n")[0]).type).toBe("session_meta");
    migrated.readEvents(session.id);
    expect(fs.readFileSync(rolloutFile, "utf8")).toBe(firstMigration);
  });

  it("records provider compaction with a bounded replacement-history checkpoint", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Compact", permissionProfile: "edit" });
    let run = store.createRun(session, "keep this", []);
    await store.beginTurn(run);
    run = store.updateRun(run.id, {
      turnContext: {
        cwd: store.projectRoot,
        currentDate: "2026-07-01",
        timezone: "Asia/Shanghai",
        capturedAt: "2026-07-01T00:00:00.000Z"
      }
    });
    await store.appendTurnContext(run);
    await store.appendEvent(run, "assistant-message", { text: "important answer" });
    await store.appendEvent(run, "system", { text: "Claude compacted context", subtype: "compact_boundary" });

    const context = store.getContextState(session.id);
    const rolloutFile = path.join(store.root, "sessions", session.id, "rollout.jsonl");
    const compacted = fs.readFileSync(rolloutFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((line) => line.type === "compacted");

    expect(compacted.payload.replacementHistory.map((item: { content: string }) => item.content))
      .toEqual(["keep this", "important answer"]);
    expect(context.history.map((item) => item.content)).toEqual(["keep this", "important answer"]);
    expect(context.historyVersion).toBe(1);
    expect(context.referenceContext?.turnId).toBe(run.id);
    expect(context.worldState).toEqual({ contexts: [], workspacePath: null });
  });

  it("reconciles materialized run metadata from durable turn lifecycle markers", async () => {
    const root = createRoot();
    const store = new SessionStore(root);
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "Recover", permissionProfile: "edit" });
    let run = store.createRun(session, "recover", []);
    await store.beginTurn(run);
    await store.completeTurn({ ...run, status: "completed", completedAt: "2026-07-01T00:00:05.000Z" });

    expect(run.status).toBe("queued");
    run = new SessionStore(root).getRun(run.id);
    expect(run.status).toBe("completed");
    expect(run.completedAt).toBe("2026-07-01T00:00:05.000Z");
  });

  it("forks surviving rollout history into a new independent session", async () => {
    const store = new SessionStore(createRoot());
    const source = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "Source", permissionProfile: "edit" });
    const first = await addCompletedTurn(store, source, "first prompt", "first answer");
    await addCompletedTurn(store, store.getSession(source.id), "second prompt", "second answer");

    const fork = await store.forkSession(source.id, first.id);
    const forkTurns = store.listTurns(fork.id, { sortDirection: "asc" });

    expect(fork.forkedFromId).toBe(source.id);
    expect(fork.providerSessionId).toBeNull();
    expect(forkTurns.data).toHaveLength(1);
    expect(forkTurns.data[0].events.map((event) => event.payload.text)).toEqual(["first prompt", "first answer"]);
    expect(forkTurns.data[0].events.every((event) => event.sessionId === fork.id)).toBe(true);
    expect(forkTurns.data[0].id).not.toBe(first.id);
  });

  it("rolls back turns by appending a marker and hiding rolled-back materialized runs", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Rollback", permissionProfile: "edit" });
    const first = await addCompletedTurn(store, session, "first", "one");
    const second = await addCompletedTurn(store, store.getSession(session.id), "second", "two");

    expect(await store.rollbackTurns(session.id, 1)).toEqual([second.id]);

    expect(store.listTurns(session.id, { sortDirection: "asc" }).data.map((turn) => turn.id)).toEqual([first.id]);
    expect(store.listRuns(session.id).map((run) => run.id)).toEqual([first.id]);
    expect(store.getContextState(session.id).history.map((item) => item.content)).toEqual(["first", "one"]);
    const rolloutFile = path.join(store.root, "sessions", session.id, "rollout.jsonl");
    expect(fs.readFileSync(rolloutFile, "utf8")).toContain('"type":"thread_rolled_back"');
  });

  it("does not persist Claude private token deltas and normalizes legacy init events", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "语义事件", permissionProfile: "edit" });
    const run = store.createRun(session, "运行", []);
    expect(await store.appendEvent(run, "system", { message: { type: "system", subtype: "thinking_tokens", estimated_tokens: 1 } })).toEqual([]);
    await store.appendEvent(run, "system", { message: { type: "system", subtype: "init", model: "test-model", claude_code_version: "1.0.0" } });
    expect(store.readEvents(session.id)).toMatchObject([{
      kind: "system",
      payload: { text: "Claude Code 已初始化", subtype: "init", model: "test-model", version: "1.0.0" }
    }]);
  });

  it("serializes concurrent appends with stable sequence numbers", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "并发", permissionProfile: "edit" });
    const run = store.createRun(session, "并发写入", []);
    const appendSpy = vi.spyOn(fs, "appendFileSync");
    await Promise.all(Array.from({ length: 80 }, (_, index) => store.appendEvent(run, "tool-output", { text: `line-${index}` })));
    expect(appendSpy).not.toHaveBeenCalled();
    const events = store.readEvents(session.id);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    appendSpy.mockRestore();
    expect(events).toHaveLength(80);
    expect(new Set(events.map((event) => event.seq)).size).toBe(80);
    expect(events.map((event) => event.seq)).toEqual(Array.from({ length: 80 }, (_, index) => index + 1));
  });

  it("writes approval audit records into the security report", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "审批审计", permissionProfile: "edit" });
    const run = store.createRun(session, "删除前审批", []);
    const approval = {
      id: "approval-1",
      runId: run.id,
      sessionId: session.id,
      providerRequestId: "provider-1",
      category: "delete" as const,
      title: "请求删除文件",
      detail: "rm draft.md",
      command: "rm draft.md",
      cwd: ".",
      paths: ["draft.md"],
      createdAt: new Date().toISOString(),
      status: "pending" as const
    };
    await store.appendEvent(run, "approval-request", { approval });
    await store.appendEvent(run, "approval-decision", { approvalId: approval.id, decision: "decline", approval, decidedAt: new Date().toISOString() });
    store.writeSecurityReport(run, []);

    const report = JSON.parse(fs.readFileSync(path.join(store.root, "sessions", session.id, "runs", run.id, "security-report.json"), "utf8"));
    expect(report.dangerousCategories).toEqual(["delete"]);
    expect(report.approvals).toMatchObject([
      { kind: "approval-request", approvalId: "approval-1", category: "delete", decision: null },
      { kind: "approval-decision", approvalId: "approval-1", category: "delete", decision: "decline" }
    ]);
  });

  it("keeps large session lists and searches usable through the in-memory index", () => {
    const store = new SessionStore(createRoot());
    for (let index = 0; index < 1_000; index++) {
      store.createSession({
        provider: index % 2 ? "claude" : "codex",
        providerId: index % 2 ? "claude-native" : "codex-native",
        cwd: ".",
        title: `session-${index}`,
        permissionProfile: "edit"
      });
    }
    expect(store.listSessions()).toHaveLength(1_000);
    expect(store.search("session-777").map((session) => session.title)).toEqual(["session-777"]);
  }, 20_000);

  it("defers search-index persistence until the turn boundary", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "搜索", permissionProfile: "edit" });
    let run = store.createRun(session, "查找", []);
    const searchFile = path.join(store.root, "sessions", session.id, "search-index.json");

    await store.appendEvent(run, "assistant-message", { text: "live searchable answer" });

    expect(store.search("live searchable answer")[0]?.id).toBe(session.id);
    expect(JSON.parse(fs.readFileSync(searchFile, "utf8")).body).toBe("");
    run = store.updateRun(run.id, { status: "completed", completedAt: new Date().toISOString() });
    await store.completeTurn(run);
    expect(JSON.parse(fs.readFileSync(searchFile, "utf8")).body).toContain("live searchable answer");
  });

  it("skips risk scans for tool output and usage events", async () => {
    const store = new SessionStore(createRoot());
    const session = store.createSession({ provider: "codex", providerId: "codex-native", cwd: ".", title: "风险", permissionProfile: "edit" });
    const run = store.createRun(session, "检查", []);
    const secret = "API_KEY=super-secret-value-12345";

    expect((await store.appendEvent(run, "tool-output", { text: secret }))[0].risks).toEqual([]);
    expect((await store.appendEvent(run, "usage", { text: secret }))[0].risks).toEqual([]);
    expect((await store.appendEvent(run, "user-message", { text: secret }))[0].risks.some((finding) => finding.kind === "credential")).toBe(true);
  });
});

function legacyEvent(
  run: ReturnType<SessionStore["createRun"]>,
  id: string,
  kind: "user-message" | "assistant-message",
  payload: Record<string, unknown>,
  seq: number
) {
  return {
    schemaVersion: 1,
    id,
    seq,
    timestamp: `2026-07-01T00:00:0${seq}.000Z`,
    projectId: run.projectId,
    sessionId: run.sessionId,
    runId: run.id,
    provider: run.provider,
    kind,
    payload,
    risks: []
  };
}

async function addCompletedTurn(
  store: SessionStore,
  session: ReturnType<SessionStore["createSession"]>,
  prompt: string,
  answer: string
) {
  let run = store.createRun(session, prompt, []);
  await store.beginTurn(run);
  await store.appendEvent(run, "assistant-message", { text: answer });
  run = store.updateRun(run.id, { status: "completed", completedAt: new Date().toISOString() });
  await store.completeTurn(run);
  return run;
}

describe("RiskScanner", () => {
  it("warns without changing raw content", () => {
    const raw = "API_KEY=super-secret-value-12345";
    const findings = scanRisks(raw);
    expect(findings.some((finding) => finding.kind === "credential")).toBe(true);
    expect(raw).toContain("super-secret-value");
  });

  it("bounds scanning work to the first 64 KiB", () => {
    const findings = scanRisks({ text: `${"x".repeat(70_000)} API_KEY=super-secret-value-12345` });
    expect(findings.some((finding) => finding.kind === "credential")).toBe(false);
  });
});
