import { describe, expect, it, vi } from "vitest";
import { AgentApprovalBroker } from "./agent-approval-broker";

describe("AgentApprovalBroker", () => {
  it("waits for a tool decision and scopes session grants to one Broker Run", async () => {
    const onRequest = vi.fn();
    const broker = new AgentApprovalBroker(onRequest);
    const first = broker.request("run-1", { tool: "shell", detail: "node script.mjs" });
    const request = broker.list()[0];
    expect(request).toMatchObject({ runId: "run-1", sessionId: "agent:run-1", category: "command", command: "node script.mjs" });
    expect(onRequest).toHaveBeenCalledOnce();

    expect(broker.resolve(request.id, "accept-session")).toBe(true);
    await expect(first).resolves.toBe("allow");
    await expect(broker.request("run-1", { tool: "shell", detail: "node script.mjs" })).resolves.toBe("allow");
    const second = broker.request("run-2", { tool: "shell", detail: "node script.mjs" });
    expect(broker.list()).toHaveLength(1);
    broker.resolve(broker.list()[0].id, "decline");
    await expect(second).resolves.toBe("deny");
  });

  it("releases pending approvals when a Broker Run is cancelled", async () => {
    const broker = new AgentApprovalBroker(() => undefined);
    const pending = broker.request("run-1", { tool: "browser", detail: "{\"action\":\"navigate\"}" });
    expect(broker.declineForRun("run-1")).toHaveLength(1);
    await expect(pending).resolves.toBe("deny");
    expect(broker.list()).toEqual([]);
  });
});
