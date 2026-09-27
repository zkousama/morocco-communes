import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import app from "../../src/worker/index.ts";
import { pagesOf } from "../../src/lib/pages.ts";
import type { SearchIndex } from "../../src/lib/search.ts";
import rawIndex from "../../generated/search-index.json";
import rawArrondissements from "../../../data/v1/attributes/arrondissements.json";
import { pageOf } from "../../../site/src/lib/places.ts";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

/** The live database with last night's ranking in it. */
function ranked(rows: [code: string, n: number][], since = "2026-08-28") {
  const database = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  for (const [code, n] of rows) database.prepare("INSERT INTO ranking (code, n, since) VALUES (?, ?, ?)").run(code, n, since);
  return database;
}

/** D1's read calls over SQLite: prepare, an optional bind, then all(). */
function d1(database: DatabaseSync) {
  const statement = (sql: string, values: SQLInputValue[] = []) => ({
    bind: (...bound: SQLInputValue[]) => statement(sql, bound),
    all: async () => ({ results: database.prepare(sql).all(...values), success: true }),
  });
  return { prepare: (sql: string) => statement(sql) };
}

const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {}, props: {} };
const get = (env: object) => app.fetch(new Request("https://communes.pages.dev/api/most-looked-up"), env as never, ctx as never);
const withRanking = (database: DatabaseSync) => ({ ASSETS: { fetch: async () => new Response("{}") }, DEMAND: d1(database) });

type Body = { data: { since: string; places: { code: string; name: string; route: string; n: number }[] } };

describe("the most looked-up places, live", () => {
  it("gives last night's ranking, most opened first, with each place's name and page", async () => {
    const response = await get(withRanking(ranked([["01.511.01.0", 89], ["06.141.01.0", 183]])));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.data).toEqual({
      since: "2026-08-28",
      places: [
        { code: "06.141.01.0", name: "Casablanca", route: "communes/casablanca/", n: 183 },
        { code: "01.511.01.0", name: "Tanger", route: "communes/tanger/", n: 89 },
      ],
    });
  });

  it("sends an arrondissement to its city's page, as the search box does", async () => {
    const body = (await (await get(withRanking(ranked([["01.511.01.05", 12]])))).json()) as Body;
    expect(body.data.places).toEqual([{ code: "01.511.01.05", name: "Mghogha", route: "communes/tanger/", n: 12 }]);
  });

  it("drops a place the site has no page for, rather than linking nowhere", async () => {
    const body = (await (await get(withRanking(ranked([["01.051.03", 30], ["99.999.99.9", 20], ["01.051", 10]])))).json()) as Body;
    expect(body.data.places.map((p) => p.code)).toEqual(["01.051"]);
  });

  it("keeps a place opened fewer than 5 times off, whatever the table holds", async () => {
    const body = (await (await get(withRanking(ranked([["01.511.01.0", 4]])))).json()) as Body;
    expect(body.data.places).toEqual([]);
  });

  it("can be kept for a while, since it only changes once a night", async () => {
    const response = await get(withRanking(ranked([])));
    expect(response.headers.get("cache-control")).toMatch(/max-age=\d+/);
  });

  it("answers 503 when the database isn't there or can't be read, so the page keeps its own list", async () => {
    const missing = await get({ ASSETS: { fetch: async () => new Response("{}") } });
    expect(missing.status).toBe(503);
    const failing = await get({
      ASSETS: { fetch: async () => new Response("{}") },
      DEMAND: {
        prepare: () => {
          throw new Error("D1 is down");
        },
      },
    });
    expect(failing.status).toBe(503);
  });
});

describe("the page each place links to", () => {
  const pages = pagesOf(rawIndex as unknown as SearchIndex, rawArrondissements as { code: string; communeCode: string }[]);

  it("is the same page the site builds for it, for every place in the index", () => {
    for (const [code] of (rawIndex as unknown as SearchIndex).entries) {
      const site = pageOf(code);
      expect(pages.get(code), code).toEqual(site ? { name: site.name.fr, route: site.route } : undefined);
    }
  });
});
