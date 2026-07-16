import { describe, expect, it, vi } from "vitest";
import type { AiRun } from "../../shared/contracts";
import { ApprovalBroker } from "./approval-broker";

const run = {
  id: "run-1",
  sessionId: "session-1",
  projectId: "project",
  provider: "codex",
  providerId: "codex-native",
  permissionProfile: "edit",
  status: "running",
  prompt: "test",
  contexts: [],
  workspacePath: null,
  baseCommit: null,
  startedAt: new Date().toISOString(),
  completedAt: null,
  error: null,
  changeSet: null,
  risks: [],
  schemaVersion: 1
} satisfies AiRun;

describe("ApprovalBroker", () => {
  it("pauses until a decision and remembers safe session grants", async () => {
    const onRequest = vi.fn();
    const broker = new ApprovalBroker(onRequest);
    const pending = broker.request(run, { providerRequestId: "provider-1", category: "command", title: "运行测试", detail: "npm test", command: "npm test", paths: [] });
    const request = broker.list()[0];
    expect(onRequest).toHaveBeenCalledOnce();
    broker.resolve(request.id, "accept-session");
    await expect(pending).resolves.toBe("accept-session");
    await expect(broker.request(run, { providerRequestId: "provider-2", category: "command", title: "运行测试", detail: "npm test", command: "npm test", paths: [] })).resolves.toBe("accept-session");
  });

  it("does not remember dangerous approvals for the whole session", async () => {
    const onRequest = vi.fn();
    const broker = new ApprovalBroker(onRequest);
    const pending = broker.request(run, { providerRequestId: "provider-1", category: "delete", title: "删除", detail: "rm file", command: "rm file", paths: ["file"] });
    const request = broker.list()[0];
    broker.resolve(request.id, "accept-session");
    await expect(pending).resolves.toBe("accept-session");

    const second = broker.request(run, { providerRequestId: "provider-2", category: "delete", title: "删除", detail: "rm file", command: "rm file", paths: ["file"] });
    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(broker.list()).toHaveLength(1);
    broker.resolve(broker.list()[0].id, "decline");
    await expect(second).resolves.toBe("decline");
  });

  it("returns approvals declined by run cancellation for audit logging", async () => {
    const broker = new ApprovalBroker(() => undefined);
    const decision = broker.request(run, {
      providerRequestId: "request-2",
      category: "network",
      title: "Network",
      detail: "git push",
      paths: []
    });
    const declined = broker.declineForRun(run.id);
    expect(declined).toHaveLength(1);
    await expect(decision).resolves.toBe("decline");
  });
});
