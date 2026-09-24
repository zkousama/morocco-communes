import { describe, expect, it } from "vitest";
import { agentOf, mcpMessages, record, routeOf, type UsageDataset } from "../../src/worker/usage.ts";

describe("routeOf", () => {
  it("takes the codes and slugs out of a path", () => {
    expect(routeOf("/api/search")).toBe("search");
    expect(routeOf("/api/communes/at")).toBe("communes/at");
    expect(routeOf("/api/communes/near")).toBe("communes/near");
    expect(routeOf("/api/communes")).toBe("communes");
    expect(routeOf("/api/communes/tanger")).toBe("communes/:id");
    expect(routeOf("/api/provinces/01.511/economy")).toBe("provinces/:id/economy");
    expect(routeOf("/api/a/b/c/d")).toBe("other");
  });
});

describe("agentOf", () => {
  it("keeps the first product of a User-Agent", () => {
    expect(agentOf("node")).toBe("node");
    expect(agentOf("python-httpx/0.27.0")).toBe("python-httpx");
    expect(agentOf("Mozilla/5.0 (X11; Linux x86_64)")).toBe("mozilla");
    expect(agentOf(undefined)).toBe("");
  });
});

describe("mcpMessages", () => {
  it("names the tool a call uses and the client an initialize names", () => {
    expect(mcpMessages({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "Tanger" } } })).toEqual([
      { method: "tools/call", tool: "search", args: { query: "tanger" } },
    ]);
    expect(mcpMessages({ jsonrpc: "2.0", id: 0, method: "initialize", params: { clientInfo: { name: "claude-ai", version: "1" } } })).toEqual([
      { method: "initialize", client: "claude-ai" },
    ]);
  });

  it("reads a batch, and leaves notifications and junk out", () => {
    expect(
      mcpMessages([
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        "junk",
      ]),
    ).toEqual([{ method: "tools/list" }]);
    expect(mcpMessages(null)).toEqual([]);
  });

  it("never keeps an argument outside a place, its level or a query", () => {
    const [message] = mcpMessages({ method: "tools/call", params: { name: "search", arguments: { visitor: "private" } } });
    expect(JSON.stringify(message)).not.toContain("private");
  });
});

describe("record", () => {
  it("writes one data point, and does nothing without the binding", () => {
    const points: unknown[] = [];
    const dataset: UsageDataset = { writeDataPoint: (point) => points.push(point) };
    record(dataset, { kind: "mcp", name: "search", client: "claude-ai", agent: "node", country: "MA", status: 200, ms: 12 });
    expect(points).toEqual([{ indexes: ["mcp"], blobs: ["mcp", "search", "claude-ai", "node", "MA"], doubles: [200, 12] }]);
    expect(() => record(undefined, { kind: "api", name: "search", status: 200, ms: 1 })).not.toThrow();
  });

  it("swallows a failing write", () => {
    const broken: UsageDataset = {
      writeDataPoint: () => {
        throw new Error("quota");
      },
    };
    expect(() => record(broken, { kind: "api", name: "search", status: 200, ms: 1 })).not.toThrow();
  });
});
