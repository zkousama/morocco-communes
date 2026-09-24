import { describe, expect, it, vi } from "vitest";
import { isBot, scrubText } from "../../src/worker/demand.ts";
import app from "../../src/worker/index.ts";

vi.mock("../../src/worker/demand.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/worker/demand.ts")>();
  return { ...actual, scrubText: vi.fn(actual.scrubText), isBot: vi.fn(actual.isBot) };
});

const written: unknown[][] = [];
const env = {
  ASSETS: { fetch: async () => new Response(JSON.stringify({ data: { code: "01.511.01.0" } }), { status: 200 }) },
  DEMAND: {
    prepare: () => ({
      bind: (...values: unknown[]) => {
        written.push(values);
        return { run: async () => ({ success: true }) };
      },
    }),
  },
};
const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {}, props: {} };

const broken = () => {
  throw new Error("broken");
};

/** The same request answered twice, the second time with `fail` set to throw once. */
async function bothWays(request: () => Request, fail: () => void) {
  const usual = await app.fetch(request(), env as never, ctx as never);
  written.length = 0;
  fail();
  const failing = await app.fetch(request(), env as never, ctx as never);
  return { usual: { status: usual.status, body: await usual.text() }, failing: { status: failing.status, body: await failing.text() } };
}

const mcp = (params: Record<string, unknown>) => () =>
  new Request("https://communes.pages.dev/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params }),
  });

describe("a demand row that can't be built", () => {
  it("leaves a search's answer as it was", async () => {
    const { usual, failing } = await bothWays(
      () => new Request("https://communes.pages.dev/api/search?q=tanger"),
      () => vi.mocked(scrubText).mockImplementationOnce(broken),
    );
    expect(failing).toEqual(usual);
    expect(usual.status).toBe(200);
    expect(written).toHaveLength(0);
  });

  it("leaves a lookup's answer as it was", async () => {
    const { usual, failing } = await bothWays(
      () => new Request("https://communes.pages.dev/api/communes/tanger"),
      () => vi.mocked(isBot).mockImplementationOnce(broken),
    );
    expect(failing).toEqual(usual);
    expect(usual.status).toBe(200);
    expect(written).toHaveLength(0);
  });

  it("leaves an assistant's answer as it was, when its query can't be scrubbed", async () => {
    const { usual, failing } = await bothWays(
      mcp({ name: "search", arguments: { query: "tanger" } }),
      () => vi.mocked(scrubText).mockImplementationOnce(broken),
    );
    expect(failing).toEqual(usual);
    expect(usual.status).toBe(200);
    expect(written).toHaveLength(0);
  });

  it("leaves an assistant's answer as it was, when its row can't be built", async () => {
    const { usual, failing } = await bothWays(
      mcp({ name: "get_commune", arguments: { id: "tanger" } }),
      () => vi.mocked(isBot).mockImplementationOnce(broken),
    );
    expect(failing).toEqual(usual);
    expect(usual.status).toBe(200);
    expect(written).toHaveLength(0);
  });
});
