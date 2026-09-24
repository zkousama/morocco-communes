import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import app from "../../src/worker/index.ts";
import { ROLLUP } from "../../../workers/rollup/src/sql.ts";
import { downloads } from "../../../site/src/generated/downloads.ts";

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
    // Al Hoceima's centre. The tile index is the real one, but the tiles themselves are
    // written by the build, so the fake serves a square around the point for its boundary.
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

  // What the privacy page says of Do Not Track: the box still asks the API, and that
  // request is counted like any other, without what was typed.
  it("counts the site's own search in Analytics Engine by its route, without its text", async () => {
    const rows: Captured[] = [];
    const points: { blobs?: string[] }[] = [];
    await app.fetch(
      new Request("https://communes.pages.dev/api/search?q=tanger", { headers: { "sec-fetch-site": "same-origin" } }),
      { ...env(rows), USAGE: { writeDataPoint: (point: { blobs?: string[] }) => points.push(point) } } as never,
      ctx as never,
    );
    expect(rows).toHaveLength(0);
    expect(points).toHaveLength(1);
    expect(points[0]!.blobs).toContain("search");
    expect(JSON.stringify(points)).not.toContain("tanger");
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
      { kind: "search", text: "titwan", named: 0 },
      { kind: "search", text: "ousama ajebbar", named: 0 },
      { kind: "search", text: "karim el idrissi", results: 50, named: 0 },
      { kind: "tool", text: "tanger", named: 1 },
    ]);
  });

  it("takes a place's name or code, and not a surname with a place's consonants", async () => {
    const rows: Captured[] = [];
    for (const q of ["tanger", "01.511.01.0", "ajebbar", "tazi", "bennani"]) await search(q, rows);
    expect(rows.map(byColumn)).toMatchObject([
      { text: "tanger", named: 1 },
      { text: "01.511.01.0", named: 1 },
      { text: "ajebbar", named: 0 },
      { text: "tazi", named: 0 },
      { text: "bennani", named: 0 },
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

  it("keeps a place's name typed once in the rollup, and another spelling of it once it's typed 3 times", async () => {
    const once: Captured[] = [];
    await search("tanger", once);
    await search("titwan", once);
    expect(rolledUp(once)).toEqual([
      { kind: "search", text: "", n: 1 },
      { kind: "search", text: "tanger", n: 1 },
    ]);

    const thrice: Captured[] = [];
    for (let i = 0; i < 3; i++) await search("titwan", thrice);
    expect(rolledUp(thrice)).toEqual([{ kind: "search", text: "titwan", n: 3 }]);
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

  it("are counted for the first 20 messages of a batch, and no more", async () => {
    const rows: Captured[] = [];
    const points: unknown[] = [];
    const batch = Array.from({ length: 25 }, (_, id) => ({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "get_commune", arguments: { id: "tanger" } },
    }));
    await app.fetch(mcp(batch), { ...env(rows), USAGE: { writeDataPoint: (point: unknown) => points.push(point) } } as never, ctx as never);
    expect(rows).toHaveLength(20);
    expect(points).toHaveLength(20);
  });
});

describe("the names an assistant gives", () => {
  const initialize = (name: string) =>
    mcp({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "1.0.0" } },
    });

  it("keep a tool's name only when the server has that tool", async () => {
    const rows: Captured[] = [];
    await app.fetch(call("ahmed 0612345678", { id: "tanger" }), env(rows) as never, ctx as never);
    await app.fetch(call("get_commune", { id: "tanger" }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([
      { kind: "tool", name: "other" },
      { kind: "tool", name: "get_commune" },
    ]);
    expect(JSON.stringify(rows)).not.toContain("0612345678");
  });

  it("pass a client's name through the scrub, and leave \"other\" when nothing survives it", async () => {
    const rows: Captured[] = [];
    await app.fetch(initialize("ahmed 0612345678"), env(rows) as never, ctx as never);
    await app.fetch(initialize("claude-code"), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([
      { kind: "client", name: "other", client: "other" },
      { kind: "client", name: "claude-code", client: "claude-code" },
    ]);
    expect(JSON.stringify(rows)).not.toContain("0612345678");
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

  it("checks a code-shaped search against the codes that exist", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(beacon({ kind: "search", text: "06.123.45.67.8", results: 0 }), env(rows) as never, ctx as never);
    expect(response.status).toBe(204);
    await app.fetch(call("search", { query: "06.123.45.67.8" }), env(rows) as never, ctx as never);
    await app.fetch(beacon({ kind: "search", text: "01 511 01 0", results: 1 }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([
      { kind: "tool", text: "" },
      { kind: "search", text: "01.511.01.0", named: 1 },
    ]);
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

  it("keeps a place only when its code names one, as the code it resolves to", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(beacon({ kind: "place", code: "99.999.99.99" }), env(rows) as never, ctx as never);
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
    await app.fetch(beacon({ kind: "place", code: "1511010" }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([{ kind: "place", code: "01.511.01.0" }]);
  });

  it("keeps every file the site offers for download", async () => {
    const offered = downloads.flatMap((group) => group.files.map((file) => file.href.replace(/^\//, "")));
    expect(offered).toContain("data/v1/crosswalk/2014-2024.csv");
    for (const file of offered) {
      const rows: Captured[] = [];
      const response = await app.fetch(beacon({ kind: "download", file }), env(rows) as never, ctx as never);
      expect(response.status, file).toBe(204);
      expect(rows.map(byColumn), file).toMatchObject([{ kind: "download", code: file }]);
    }
  });

  it("keeps no file the site doesn't offer", async () => {
    for (const file of ["data/v1/0612345678.json", "data/v1/ahmed-benali.json", "api/communes/ahmed.json", "somewhere/else.csv"]) {
      const rows: Captured[] = [];
      const response = await app.fetch(beacon({ kind: "download", file }), env(rows) as never, ctx as never);
      expect(response.status, file).toBe(400);
      expect(rows, file).toHaveLength(0);
    }
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

  it("says where the reader came from by the host the page read, never by the beacon's own Referer", async () => {
    const cases: [from: unknown, viaSite: string, headers?: Record<string, string>][] = [
      ["www.reddit.com", "reddit"],
      ["", "direct"],
      ["communes.pages.dev", "site"],
      ["not a host!", "other"],
      [42, "other"],
      [undefined, "direct", { referer: "https://www.reddit.com/r/morocco/" }],
    ];
    for (const [from, viaSite, headers] of cases) {
      const rows: Captured[] = [];
      const body = { kind: "place", code: "01.511.01.0", ...(from !== undefined && { from }) };
      await app.fetch(beacon(body, headers), env(rows) as never, ctx as never);
      expect(rows.map(byColumn), String(from)).toMatchObject([{ viaSite }]);
    }
  });

  it("keeps the class of the host a search came from, and never the host", async () => {
    const rows: Captured[] = [];
    await app.fetch(beacon({ kind: "search", text: "tanger", results: 3, from: "www.google.com" }), env(rows) as never, ctx as never);
    expect(rows.map(byColumn)).toMatchObject([{ kind: "search", viaSite: "search" }]);
    expect(JSON.stringify(rows)).not.toContain("google.com");
  });

  /** A beacon whose body is a stream, read only as far as the handler asks. */
  const streamed = (pull: (controller: ReadableStreamDefaultController<Uint8Array>) => void, headers: Record<string, string> = {}) =>
    new Request("https://communes.pages.dev/api/beacon", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://communes.pages.dev", ...headers },
      body: new ReadableStream({ pull }, { highWaterMark: 0 }),
      duplex: "half",
    } as RequestInit);

  it("refuses a body that says it's 5,000 bytes without touching it", async () => {
    let touched = false;
    const rows: Captured[] = [];
    const response = await app.fetch(
      streamed(() => {
        touched = true;
        throw new Error("the body was read");
      }, { "content-length": "5000" }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(400);
    expect(touched).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("stops reading a body with no length once it's past 1 KB", async () => {
    let pulls = 0;
    const rows: Captured[] = [];
    const response = await app.fetch(
      streamed((controller) => {
        pulls += 1;
        if (pulls > 100) controller.close();
        else controller.enqueue(new Uint8Array(512).fill(32));
      }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(400);
    expect(pulls).toBeLessThanOrEqual(3);
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
