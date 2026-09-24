import { describe, expect, it } from "vitest";
import app from "../../src/worker/index.ts";

interface Captured { sql: string; values: unknown[] }

function fakeDb(rows: Captured[], failing = false) {
  return {
    prepare: (sql: string) => {
      if (failing) throw new Error("D1 is down");
      return {
        bind: (...values: unknown[]) => {
          rows.push({ sql, values });
          return { run: async () => ({ success: true }) };
        },
      };
    },
  };
}

const env = (rows: Captured[], failing = false) => ({
  ASSETS: { fetch: async () => new Response("{}", { status: 200 }) },
  DEMAND: fakeDb(rows, failing),
});

const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {}, props: {} };

describe("demand rows from the API", () => {
  it("records a search with its text and how many it found", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/search?q=titwan", { headers: { referer: "https://www.reddit.com/r/morocco/" } }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
    const search = rows.find((r) => r.values.includes("search"));
    expect(search?.values).toContain("titwan");
    expect(search?.values).toContain("reddit");
  });

  it("records the place a lookup names", async () => {
    const rows: Captured[] = [];
    await app.fetch(new Request("https://communes.pages.dev/api/communes/tanger"), env(rows) as never, ctx as never);
    const place = rows.find((r) => r.values.includes("place"));
    expect(place?.values).toContain("01.511.01.0");
  });

  it("writes no row for a search the scrub drops", async () => {
    const rows: Captured[] = [];
    // An email address scrubs to "", so the middleware's kind ternary falls through to
    // "place" (empty too, since this handler never sets demandCode) and then to null.
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/search?q=someone%40example.com"),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
    expect(rows.find((r) => r.values.includes("search"))).toBeUndefined();
    expect(rows).toHaveLength(0);
  });

  it("records the place a point lookup names", async () => {
    const rows: Captured[] = [];
    // Al Hoceima's centroid, from search-index.json. tileAt() resolves it against the real,
    // unmocked production tile index (api/generated/tile-index.json, loaded at module scope
    // in index.ts) to leaf tile "3/112/121", confirmed by walking the same quadtree logic
    // outside the test. The tile's contents, though, come from the ASSETS binding, and the
    // built tile files themselves are emitted at build time rather than checked into the
    // repo, so this fake serves a small synthetic square standing in for the real boundary:
    // it exercises the same code path (communeIn finds a code, the handler sets demandCode,
    // the middleware writes a place row) without depending on generated geometry a unit test
    // can't reach. Al Hoceima carries no arrondissements, so no second ASSETS fetch follows.
    const lat = 35.23871444189453;
    const lng = -3.941081692480469;
    const code = "01.051.01.01";
    const tile = { origin: [lng - 1, lat - 1], unit: 1, communes: [{ code, rings: [[0, 0, 2, 0, 2, 2, 0, 2]] }] };
    const assets = {
      fetch: async (request: Request) =>
        new Response(
          new URL(request.url).pathname.startsWith("/api/tiles/") ? JSON.stringify(tile) : "{}",
          { status: 200 },
        ),
    };
    const response = await app.fetch(
      new Request(`https://communes.pages.dev/api/communes/at?lat=${lat}&lng=${lng}`),
      { ASSETS: assets, DEMAND: fakeDb(rows) } as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
    const place = rows.find((r) => r.values.includes("place"));
    expect(place?.values).toContain(code);
  });

  it("answers normally when the database is down", async () => {
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/search?q=titwan"),
      env([], true) as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("data");
  });

  it("answers normally with no binding at all", async () => {
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/search?q=titwan"),
      { ASSETS: { fetch: async () => new Response("{}") } } as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
  });

  it("records the tool an assistant calls, not the handshake", async () => {
    const rows: Captured[] = [];
    await app.fetch(
      new Request("https://communes.pages.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_commune", arguments: { code: "01.511.01.0" } } }),
      }),
      env(rows) as never,
      ctx as never,
    );
    const tools = rows.filter((r) => r.values.includes("tool"));
    expect(tools).toHaveLength(1);
    expect(tools[0]!.values).toContain("get_commune");
  });
});
