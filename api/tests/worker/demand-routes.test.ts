import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import app from "../../src/worker/index.ts";
import { ROLLUP } from "../../../workers/rollup/src/sql.ts";

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

/** A captured row by column, in the order recordDemand binds them. */
const COLUMNS = ["day", "kind", "text", "code", "name", "results", "locale", "country", "via", "viaSite", "client", "bot", "dataset", "named"];
const byColumn = (row: Captured) => Object.fromEntries(COLUMNS.map((column, i) => [column, row.values[i]]));

const mcp = (body: unknown) =>
  new Request("https://communes.pages.dev/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });

const call = (name: string, args: Record<string, unknown>) =>
  mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

/** The captured rows written to SQLite with their own INSERT, then rolled up for their day. */
function rolledUp(rows: Captured[]) {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../../../migrations/0001_demand.sql", import.meta.url), "utf8"));
  for (const { sql, values } of rows) database.prepare(sql).run(...(values as SQLInputValue[]));
  for (const { day } of database.prepare("SELECT DISTINCT day FROM events").all()) database.prepare(ROLLUP).run(day as string);
  return database.prepare("SELECT kind, text, n FROM daily ORDER BY text").all();
}

const search = (q: string, rows: Captured[]) =>
  app.fetch(new Request(`https://communes.pages.dev/api/search?q=${encodeURIComponent(q)}`), env(rows) as never, ctx as never);

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

  it("leaves the site's own requests to its beacon, and still counts everyone else's", async () => {
    const own: Captured[] = [];
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/search?q=tan", { headers: { "sec-fetch-site": "same-origin" } }),
      env(own) as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
    expect(own).toHaveLength(0);

    const theirs: Captured[] = [];
    await app.fetch(new Request("https://communes.pages.dev/api/search?q=tan"), env(theirs) as never, ctx as never);
    expect(theirs.map(byColumn)).toMatchObject([{ kind: "search", text: "tan" }]);
  });

  it("writes no place row for the site's own lookup", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/communes/01.511.01.0", { headers: { "sec-fetch-site": "same-origin" } }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
    expect(rows).toHaveLength(0);
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

  it("records the tool an assistant calls", async () => {
    const rows: Captured[] = [];
    await app.fetch(call("get_commune", { id: "01.511.01.0" }), env(rows) as never, ctx as never);
    const tools = rows.filter((r) => r.values.includes("tool"));
    expect(tools).toHaveLength(1);
    expect(tools[0]!.values).toContain("get_commune");
  });
});

describe("whether a search names a place", () => {
  it("is worked out here, from the top hit, and never taken from the client", async () => {
    const rows: Captured[] = [];
    await search("tanger", rows);
    await search("titwan", rows);
    await search("ousama ajebbar", rows);
    await app.fetch(beacon({ kind: "search", text: "karim el idrissi", results: 50 }), env(rows) as never, ctx as never);
    await app.fetch(call("search", { query: "Tanger" }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([
      { kind: "search", text: "tanger", named: 1 },
      { kind: "search", text: "titwan", named: 1 },
      { kind: "search", text: "ousama ajebbar", named: 0 },
      { kind: "search", text: "karim el idrissi", results: 50, named: 0 },
      { kind: "tool", text: "tanger", named: 1 },
    ]);
  });

  it("folds a name typed once out of the rollup, though search found it hits and the beacon claimed 50", async () => {
    const rows: Captured[] = [];
    await search("ousama ajebbar", rows);
    await app.fetch(beacon({ kind: "search", text: "karim el idrissi", results: 50 }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn).map((r) => r.results)).toEqual([10, 50]);
    // 2 groups, since the API's row and the beacon's differ in via.
    expect(rolledUp(rows)).toEqual([
      { kind: "search", text: "", n: 1 },
      { kind: "search", text: "", n: 1 },
    ]);
  });

  it("keeps a place typed once in the rollup, by its name or a known spelling", async () => {
    const rows: Captured[] = [];
    await search("tanger", rows);
    await search("titwan", rows);
    expect(rolledUp(rows)).toEqual([
      { kind: "search", text: "tanger", n: 1 },
      { kind: "search", text: "titwan", n: 1 },
    ]);
  });
});

describe("the assistants that connect", () => {
  it("are counted from the handshake, one client row each", async () => {
    const rows: Captured[] = [];
    await app.fetch(
      mcp({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.0.0" } },
      }),
      env(rows) as never,
      ctx as never,
    );
    expect(rows.map(byColumn)).toMatchObject([{ kind: "client", name: "claude-code", client: "claude-code", text: "", code: "" }]);
  });

  it("aren't counted from a tools/list, and a tool row doesn't claim to know the client", async () => {
    const rows: Captured[] = [];
    await app.fetch(mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }), env(rows) as never, ctx as never);
    expect(rows).toHaveLength(0);
    await app.fetch(call("get_commune", { id: "tanger" }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([{ kind: "tool", client: "" }]);
  });
});

describe("the place an assistant asks about", () => {
  it("is the code get_commune's id resolves to", async () => {
    const rows: Captured[] = [];
    await app.fetch(call("get_commune", { id: "tanger" }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([{ kind: "tool", name: "get_commune", code: "01.511.01.0" }]);
  });

  it("is the code get_indicators' unit names", async () => {
    const rows: Captured[] = [];
    await app.fetch(call("get_indicators", { unit: "01.511.01.0" }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([{ kind: "tool", name: "get_indicators", code: "01.511.01.0" }]);
  });

  it("is read at the level the tool was given, where a name is shared", async () => {
    const rows: Captured[] = [];
    await app.fetch(call("get_unit", { unit: "tiznit", level: "province" }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([{ kind: "tool", name: "get_unit", code: "09.581" }]);
  });

  it("is empty for an argument that's neither a code nor a slug, or a slug that names nothing", async () => {
    for (const id of ["Hay Mohammadi, rue 12", "someone"]) {
      const rows: Captured[] = [];
      await app.fetch(call("get_commune", { id }), env(rows) as never, ctx as never);
      expect(rows.map(byColumn)).toMatchObject([{ kind: "tool", name: "get_commune", code: "" }]);
    }
  });
});

const beacon = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://communes.pages.dev/api/beacon", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://communes.pages.dev", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

// No Origin at all, unlike beacon() above, for the requests that stand or fall on Sec-Fetch-Site alone.
const beaconNoOrigin = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://communes.pages.dev/api/beacon", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("the beacon", () => {
  it("counts a place and answers 204", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(beacon({ kind: "place", code: "01.511.01.0", locale: "fr" }), env(rows) as never, ctx as never);
    expect(response.status).toBe(204);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.values).toContain("01.511.01.0");
    expect(rows[0]!.values).toContain("fr");
  });

  it("counts a download", async () => {
    const rows: Captured[] = [];
    await app.fetch(beacon({ kind: "download", file: "data/v1/attributes/communes.csv" }), env(rows) as never, ctx as never);
    expect(rows[0]!.values).toContain("data/v1/attributes/communes.csv");
  });

  it("counts a search the site's box settled on, scrubbed, with what it found and the page's language", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      beacon({ kind: "search", text: "  Tanger ", results: 3, locale: "fr" }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(204);
    expect(rows.map(byColumn)).toMatchObject([
      { kind: "search", text: "tanger", code: "", name: "search", results: 3, locale: "fr", via: "browser", client: "" },
    ]);
  });

  it("takes a search's results only as a whole number from 0 to 100", async () => {
    for (const [results, stored] of [[0, 0], [100, 100], [101, -1], [2.5, -1], [-3, -1], ["3", -1], [undefined, -1]]) {
      const rows: Captured[] = [];
      await app.fetch(beacon({ kind: "search", text: "tanger", results }), env(rows) as never, ctx as never);
      expect(rows.map(byColumn)).toMatchObject([{ kind: "search", results: stored }]);
    }
  });

  it("answers a search holding a phone number and keeps nothing of it", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      beacon({ kind: "search", text: "06 12 34 56 78", results: 0, locale: "fr" }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(204);
    expect(rows).toHaveLength(0);
  });

  it("refuses a body that isn't one of ours, and writes nothing", async () => {
    for (const body of [
      { kind: "search", text: 42 },
      { kind: "place", code: "'; DROP TABLE events; --" },
      { kind: "elsewhere", code: "01.511.01.0" },
      { kind: "download", file: "x".repeat(500) },
      { kind: "place", code: 42 },
      "not json at all",
    ]) {
      const rows: Captured[] = [];
      const response = await app.fetch(beacon(body), env(rows) as never, ctx as never);
      expect(response.status).toBe(400);
      expect(rows).toHaveLength(0);
    }
  });

  it("refuses a body over 1 KB before reading it, and writes nothing", async () => {
    const body = JSON.stringify({ kind: "place", code: "01.511.01.0", locale: "en", pad: "x".repeat(2000) });
    const rows: Captured[] = [];
    const response = await app.fetch(beacon(body, { "content-length": String(body.length) }), env(rows) as never, ctx as never);
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("refuses a body over 1 KB that came without a length, and writes nothing", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      beacon({ kind: "place", code: "01.511.01.0", locale: "en", pad: "x".repeat(2000) }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("refuses a request from another site", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      beacon({ kind: "place", code: "01.511.01.0" }, { origin: "https://example.org" }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("refuses a request with neither Origin nor Sec-Fetch-Site, and writes nothing", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      beaconNoOrigin({ kind: "place", code: "01.511.01.0" }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("accepts a request with no Origin but Sec-Fetch-Site same-origin", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      beaconNoOrigin({ kind: "place", code: "01.511.01.0" }, { "sec-fetch-site": "same-origin" }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(204);
    expect(rows).toHaveLength(1);
  });

  it("refuses a cross-site Sec-Fetch-Site even with an Origin present", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      beacon({ kind: "place", code: "01.511.01.0" }, { origin: "https://example.org", "sec-fetch-site": "cross-site" }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });
});
